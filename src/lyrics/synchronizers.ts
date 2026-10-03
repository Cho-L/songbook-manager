import { alignPlainToSynced } from "./matching";
import { parseLrc } from "./lrc";
import type { LyricsSynchronizer, SyncInput, SyncResult, SyncedLyricLine } from "./types";

/** 이보다 낮게 맞은 저장 가사는 "다른 가사"로 보고 적용하지 않는다 */
export const MIN_COVERAGE = 0.4;
/** 이 이상이면 완전 싱크, 그 아래는 부분 싱크 */
export const FULL_COVERAGE = 0.85;

/** 싱크 결과의 시간이 말이 되는지 검사 (NaN, 음수, 비정상적으로 큰 값, 역순). 하나라도 어긋나면 실패로 본다. */
export function validateLines(lines: SyncedLyricLine[]): string | null {
  let prev = -1;
  let timed = 0;
  for (const l of lines) {
    if (l.time === null) continue;
    if (!Number.isFinite(l.time) || l.time < 0 || l.time > 6 * 3600) return "시간 값이 올바르지 않아요";
    if (l.time + 1e-6 < prev) return "시간 순서가 뒤섞여 있어요";
    prev = l.time;
    timed++;
  }
  return timed >= 2 ? null : "싱크된 줄이 너무 적어요";
}

/**
 * 1차 구현 — 외부 provider(LRCLIB 등)가 준 "줄 단위 싱크 가사"를 쓴다.
 * - 저장된 평문 가사가 없으면: provider 가사를 그대로 사용 (모든 줄 matched)
 * - 저장된 평문 가사가 있으면: 순서를 지키는 줄 정렬(alignPlainToSynced)로 저장된 가사의 각 줄에 시간을 붙인다.
 *   짝을 못 찾은 줄은 시간 없이 남기고, 거의 안 맞으면(mismatch) 결과를 만들지 않는다.
 * 균등 분배/임의 시간은 어디서도 만들지 않는다.
 */
export class ProviderLyricsSynchronizer implements LyricsSynchronizer {
  readonly name = "provider-synced-lyrics";

  async synchronize(input: SyncInput): Promise<SyncResult> {
    const generatedAt = new Date().toISOString();
    if (!input.syncedLyrics) {
      return { status: "unsynced", lines: [], message: "싱크 정보가 없어요", source: this.name, generatedAt };
    }
    const providerLines = parseLrc(input.syncedLyrics);
    const providerErr = validateLines(providerLines);
    if (providerErr) return { status: "failed", lines: [], message: `외부 싱크 데이터 오류: ${providerErr}`, source: this.name, generatedAt };

    const own = (input.lyrics ?? "").split(/\r?\n/);
    const hasOwn = own.some((l) => l.trim() !== "");
    if (!hasOwn) {
      return { status: "synced", lines: providerLines, coverage: 1, confidence: 1, source: this.name, generatedAt };
    }
    const aligned = alignPlainToSynced(own, providerLines);
    if (aligned.coverage < MIN_COVERAGE) {
      return {
        status: "failed",
        lines: [],
        coverage: aligned.coverage,
        message: "저장된 가사와 찾은 가사가 많이 달라요",
        source: this.name,
        generatedAt,
      };
    }
    const err = validateLines(aligned.lines);
    if (err) return { status: "failed", lines: [], coverage: aligned.coverage, message: err, source: this.name, generatedAt };
    return {
      status: aligned.coverage >= FULL_COVERAGE ? "synced" : "partially-synced",
      lines: aligned.lines,
      coverage: aligned.coverage,
      confidence: aligned.meanSimilarity,
      source: this.name,
      generatedAt,
    };
  }
}

/**
 * 장기 구현 자리 — 보컬 포함 기준 오디오 + 평문 가사로 forced alignment 를 수행하는 "별도 백엔드"를 호출한다.
 * (이 브라우저 앱은 YouTube 오디오를 내려받거나 분석하지 않는다. 기준 오디오는 사용자가 합법적으로 제공한 파일이어야 한다.)
 *
 * 요청:  POST {endpoint}  { title, artist, lyrics, language, referenceAudioUrl }
 * 응답:  { status: "synced"|"partially-synced"|"unsynced"|"failed", confidence?, lines: [{ time|null, text, matched, confidence?, words?: [{time,text}] }] }
 * 백엔드가 설정되지 않았거나 기준 오디오가 없으면 호출하지 않고 "failed"를 돌려준다 — 조용히 가짜 결과를 만들지 않는다.
 */
export class RemoteAlignmentSynchronizer implements LyricsSynchronizer {
  readonly name = "remote-forced-alignment";
  private endpoint: string | undefined;
  private fetchImpl: typeof fetch;
  constructor(endpoint: string | undefined, fetchImpl: typeof fetch = (...a) => fetch(...a)) {
    this.endpoint = endpoint;
    this.fetchImpl = fetchImpl;
  }

  async synchronize(input: SyncInput): Promise<SyncResult> {
    const generatedAt = new Date().toISOString();
    if (!this.endpoint) return { status: "failed", lines: [], message: "정렬 백엔드가 설정되지 않았어요", source: this.name, generatedAt };
    if (!input.referenceAudio) return { status: "failed", lines: [], message: "기준 오디오가 없어요", source: this.name, generatedAt };
    if (!input.lyrics?.trim()) return { status: "failed", lines: [], message: "가사가 없어요", source: this.name, generatedAt };
    try {
      const res = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: input.title,
          artist: input.artist,
          lyrics: input.lyrics,
          language: input.language ?? "auto",
          referenceAudioUrl: input.referenceAudio.url,
        }),
      });
      if (!res.ok) return { status: "failed", lines: [], message: `정렬 서버 오류 (${res.status})`, source: this.name, generatedAt };
      const data = (await res.json()) as Partial<SyncResult> & { lines?: unknown };
      const lines = Array.isArray(data.lines) ? (data.lines as SyncedLyricLine[]) : [];
      const clean = lines.map((l) => ({
        time: typeof l.time === "number" ? l.time : null,
        text: String(l.text ?? ""),
        matched: Boolean(l.matched) && typeof l.time === "number",
        ...(typeof l.confidence === "number" ? { confidence: l.confidence } : {}),
        ...(Array.isArray(l.words) ? { words: l.words } : {}),
      }));
      const err = validateLines(clean);
      if (err || (data.status !== "synced" && data.status !== "partially-synced")) {
        return { status: "failed", lines: [], message: err ?? "정렬 결과를 얻지 못했어요", source: this.name, generatedAt };
      }
      const matched = clean.filter((l) => l.matched).length;
      return {
        status: data.status,
        lines: clean,
        coverage: clean.length ? matched / clean.length : 0,
        confidence: typeof data.confidence === "number" ? data.confidence : undefined,
        source: this.name,
        generatedAt,
      };
    } catch {
      return { status: "failed", lines: [], message: "정렬 서버에 연결하지 못했어요", source: this.name, generatedAt };
    }
  }
}
