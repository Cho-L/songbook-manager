import { AUTO_ACCEPT_CONFIDENCE, rankCandidates, summarize } from "./matching";
import { formatLrc } from "./lrc";
import { hashText, normalizeTitle } from "./text";
import { ProviderLyricsSynchronizer } from "./synchronizers";
import { applyWarp } from "./warp";
import { IDENTITY_WARP, type LyricsProvider, type LyricsSynchronizer, type SyncEntry, type Warp } from "./types";

/**
 * 자동 가사 검색 + 싱크 파이프라인 (화면/저장소와 무관한 순수 로직).
 * 우선순위(호출하는 쪽 = useAutoLyrics 가 1·2번을 먼저 처리한다):
 *   1) 저장된 가사에 이미 타임스탬프가 있으면 이 파이프라인을 아예 쓰지 않는다
 *   2) 유효한 캐시(이전에 만든 자동 싱크 결과)
 *   3) provider 의 싱크 가사 → (저장된 평문 가사가 있으면 줄 정렬)
 *   4) provider 의 평문 가사만 있는 경우 → "가사만 찾음" (싱크 없음)
 *   5) 저장된 가사 그대로
 *   6) 실패
 */
export interface ResolveInput {
  songId: string;
  title: string;
  artist: string;
  ownLyrics: string;
}

export interface ResolveOptions {
  /** 사용자가 후보 목록에서 직접 고른 곡 — 신뢰도 기준을 건너뛴다 */
  candidateId?: string;
  synchronizer?: LyricsSynchronizer;
  now?: () => number;
  signal?: AbortSignal;
}

export function entryKeys(input: { title: string; artist: string; ownLyrics: string }) {
  return { titleKey: normalizeTitle(input.title), artistKey: normalizeTitle(input.artist), lyricsHash: hashText(input.ownLyrics.trim()) };
}

/** 이 캐시 항목이 지금의 곡 정보에 대해 여전히 유효한가 (제목/가수/저장된 가사가 그대로인가) */
export function isEntryValid(entry: SyncEntry, input: { title: string; artist: string; ownLyrics: string }): boolean {
  const k = entryKeys(input);
  return entry.v === 1 && entry.titleKey === k.titleKey && entry.artistKey === k.artistKey && entry.lyricsHash === k.lyricsHash;
}

export async function resolveLyrics(input: ResolveInput, provider: LyricsProvider, opts: ResolveOptions = {}): Promise<SyncEntry> {
  const now = opts.now ?? Date.now;
  const synchronizer = opts.synchronizer ?? new ProviderLyricsSynchronizer();
  const base = { v: 1 as const, songId: input.songId, ...entryKeys(input), createdAt: now(), lines: [], warps: {}, warnings: [] as string[] };

  const candidates = await provider.search(input.title, input.artist, opts.signal); // 네트워크 오류는 그대로 throw → 호출한 쪽이 "실패"로 표시 (캐시하지 않음)
  const ranked = rankCandidates(input, candidates);
  if (ranked.length === 0) return { ...base, outcome: "not-found" };

  // 점수가 거의 같으면(5% 이내) 싱크 가사가 있는 후보를 우선
  let chosen = opts.candidateId ? ranked.find((c) => c.id === opts.candidateId) : undefined;
  if (!chosen) {
    const top = ranked[0];
    chosen = ranked.find((c) => c.syncedLyrics && top.confidence - c.confidence <= 0.05) ?? top;
    if (chosen.confidence < AUTO_ACCEPT_CONFIDENCE) {
      return { ...base, outcome: "needs-choice", options: ranked.slice(0, 5).map(summarize), confidence: chosen.confidence };
    }
  }

  const candidate = { id: chosen.id, title: chosen.title, artist: chosen.artist, duration: chosen.duration };
  const warnings: string[] = [];
  if (chosen.versionMismatch) warnings.push("찾은 곡이 라이브/리믹스 등 다른 버전일 수 있어요");

  if (!chosen.syncedLyrics) {
    // 싱크 정보가 없다: 시간을 만들어내지 않는다
    if (!input.ownLyrics.trim() && chosen.plainLyrics) {
      return { ...base, outcome: "lyrics-only", source: chosen.source, candidate, confidence: chosen.confidence, plainLyrics: chosen.plainLyrics, warnings };
    }
    return { ...base, outcome: "no-sync", source: chosen.source, candidate, confidence: chosen.confidence, warnings };
  }

  const result = await synchronizer.synchronize({
    title: input.title,
    artist: input.artist,
    lyrics: input.ownLyrics,
    syncedLyrics: chosen.syncedLyrics,
  });

  if (result.status === "failed" || result.status === "unsynced") {
    // 저장된 가사와 거의 안 맞는 경우: 적용하지 않고, 이유를 남긴다
    return {
      ...base,
      outcome: input.ownLyrics.trim() ? "mismatch" : "no-sync",
      source: chosen.source,
      candidate,
      confidence: chosen.confidence,
      coverage: result.coverage,
      warnings: [...warnings, ...(result.message ? [result.message] : [])],
    };
  }
  const confidence = Math.round(chosen.confidence * (0.4 + 0.6 * (result.coverage ?? 1)) * 100) / 100;
  return {
    ...base,
    outcome: result.status === "synced" ? "synced" : "partial",
    source: chosen.source,
    candidate,
    confidence,
    coverage: result.coverage,
    lines: result.lines,
    warnings,
  };
}

// ---------------------------------------------------------------- 결과 → 기존 LRC 텍스트

export function getWarp(entry: SyncEntry, videoId: string | undefined): Warp {
  return entry.warps[videoId ?? ""] ?? IDENTITY_WARP;
}

/** 이 항목이 화면에 적용되는(저장된 가사를 대체하는) 종류인가 */
export function appliesToLyrics(entry: SyncEntry, ownLyrics: string): boolean {
  if (entry.outcome === "synced" || entry.outcome === "partial") return entry.lines.length > 0;
  if (entry.outcome === "lyrics-only") return !ownLyrics.trim() && Boolean(entry.plainLyrics);
  return false;
}

/** 캐시 항목 → SongMode/ConcertMode/OBS 가 읽는 기존 LRC 텍스트 (MR 보정값 적용) */
export function buildResolvedLyrics(entry: SyncEntry, videoId: string | undefined, ownLyrics: string): string {
  if (!appliesToLyrics(entry, ownLyrics)) return ownLyrics;
  if (entry.outcome === "lyrics-only") return entry.plainLyrics ?? ownLyrics;
  const warp = getWarp(entry, videoId);
  return formatLrc(entry.lines, (t) => applyWarp(t, warp));
}
