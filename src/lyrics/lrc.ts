import type { SyncedLyricLine, SyncedWord } from "./types";

/**
 * LRC 파서/포맷터.
 * - 한 줄에 시간 태그 여러 개([00:12.00][01:30.00]가사) 지원
 * - [offset:±ms] 지원 (LRC 표준: 양수 = 가사가 더 일찍 나옴)
 * - Enhanced LRC 단어 태그(<00:12.35>가 <00:12.60>사)가 있으면 words 로 보존 (karaoke 하이라이트 확장용)
 */
const TAG = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
const META = /^\[([a-z]{2,8}):([^\]]*)\]\s*$/i;
const WORD_TAG = /<(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)>/g;

function toSeconds(mm: string, ss: string): number {
  return Number(mm) * 60 + Number(ss.replace(":", "."));
}

export function parseLrc(text: string): SyncedLyricLine[] {
  let offset = 0;
  const out: SyncedLyricLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const meta = line.match(META);
    if (meta && !/^\d/.test(meta[1])) {
      if (meta[1].toLowerCase() === "offset") {
        const n = Number(meta[2]);
        if (Number.isFinite(n)) offset = n / 1000;
      }
      continue;
    }
    const times: number[] = [];
    let rest = line;
    let m: RegExpExecArray | null;
    TAG.lastIndex = 0;
    // 맨 앞에 연속으로 붙은 시간 태그만 읽는다
    while ((m = /^\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/.exec(rest)) !== null) {
      times.push(toSeconds(m[1], m[2]));
      rest = rest.slice(m[0].length);
    }
    if (times.length === 0) continue;
    const words: SyncedWord[] = [];
    let plain = rest;
    if (WORD_TAG.test(rest)) {
      WORD_TAG.lastIndex = 0;
      const parts = rest.split(WORD_TAG);
      // split 결과: [앞텍스트, mm, ss, 텍스트, mm, ss, 텍스트 ...]
      let acc = parts[0] ?? "";
      for (let i = 1; i + 2 < parts.length + 1; i += 3) {
        const t = toSeconds(parts[i], parts[i + 1]) - offset;
        const w = parts[i + 2] ?? "";
        if (w.trim()) words.push({ time: Math.max(0, t), text: w.trim() });
        acc += w;
      }
      plain = acc;
    }
    WORD_TAG.lastIndex = 0;
    for (const t of times) {
      out.push({
        time: Math.max(0, t - offset),
        text: plain.trim(),
        matched: true,
        ...(words.length ? { words } : {}),
      });
    }
  }
  return out.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
}

export function formatTimestamp(sec: number): string {
  const cs = Math.max(0, Math.round(sec * 100));
  const mm = Math.floor(cs / 6000);
  const ss = (cs % 6000) / 100;
  return `${String(mm).padStart(2, "0")}:${ss.toFixed(2).padStart(5, "0")}`;
}

/**
 * 줄 목록 → 기존 파서가 읽는 LRC 텍스트. 시간을 못 얻은 줄(matched=false)은 시간 없이 그대로 둔다.
 * words 는 기존 파서가 이해하지 못하므로 출력하지 않는다(캐시에는 남아 있다).
 */
export function formatLrc(lines: SyncedLyricLine[], mapTime: (t: number) => number = (t) => t): string {
  return lines
    .map((l) => (l.matched && l.time !== null ? `[${formatTimestamp(mapTime(l.time))}] ${l.text}` : l.text))
    .join("\n");
}
