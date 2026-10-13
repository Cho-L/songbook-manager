export interface LyricLine {
  /** 초 단위 타임스탬프. 현재 데이터는 전부 일반 텍스트라 null. */
  time: number | null;
  text: string;
  /** 이 줄의 한글 발음 (가사 텍스트의 `{발음}` 보조 줄에서 읽는다). 없으면 undefined */
  pron?: string;
  /** 이 줄의 한국어 번역 (`{번역}` 보조 줄). 지금은 표시하지 않지만 3줄 표시(원문+발음+번역)를 위해 구조만 미리 둔다 */
  trans?: string;
}

/**
 * 발음/번역 보조 줄: 가사 줄 바로 다음 줄에 `{발음} 키미가 스키데스`, `{번역} 너를 좋아해요` 형태로 둔다.
 * 별도 DB 열 없이 기존 가사 텍스트(lyrics) 안에 들어가므로 기존 에디터·백업·CSV 가 그대로 동작하고,
 * 이 규칙을 모르는 예전 화면에서는 단지 "한 줄 더" 보일 뿐 데이터가 깨지지 않는다.
 */
export const TRACK_TAGS = { pron: "{발음}", trans: "{번역}" } as const;
const TRACK_PATTERN = /^\{(발음|번역)\}[ \t]?(.*)$/;

const TIMESTAMP_PATTERN = /^\[(\d{1,2}):(\d{2}(?:\.\d{1,2})?)\]\s*(.*)$/;

/**
 * 가사 원문(줄바꿈으로 구분된 일반 텍스트)을 줄 단위로 나눈다.
 * "[mm:ss.ms] 가사" 형식의 줄이 섞여 있으면 시간 정보도 함께 파싱해두지만,
 * 이번 단계에서는 그 시간 정보를 재생 위치와 연동(자동 싱크)하지는 않는다 —
 * 나중에 싱크 기능을 붙일 때 이 time 필드를 그대로 활용할 수 있도록 구조만 준비해둔 것.
 */
export function parseLyrics(raw: string | undefined): LyricLine[] {
  if (!raw) return [];
  const out: LyricLine[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const track = line.match(TRACK_PATTERN);
    if (track) {
      // 보조 줄은 바로 앞 가사 줄에 붙인다 (앞 줄이 없으면 무시). 줄 수/인덱스는 원문 기준 그대로 유지된다.
      const prev = out[out.length - 1];
      if (prev && prev.text.trim() !== "") {
        const value = track[2].trim();
        if (track[1] === "발음") prev.pron = value || undefined;
        else prev.trans = value || undefined;
      }
      continue;
    }
    const match = line.match(TIMESTAMP_PATTERN);
    if (match) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      out.push({ time: minutes * 60 + seconds, text: match[3] });
    } else {
      out.push({ time: null, text: line });
    }
  }
  return out;
}

/** 발음/번역 보조 줄을 뺀 가사 텍스트 (줄 정렬·해시처럼 "원문만" 필요한 곳에서 쓴다) */
export function stripLyricTracks(raw: string | undefined): string {
  if (!raw) return "";
  return raw
    .split(/\r?\n/)
    .filter((l) => !TRACK_PATTERN.test(l))
    .join("\n");
}

/** 가사 텍스트에 발음/번역 보조 줄이 하나라도 있는가 */
export function hasLyricTracks(raw: string | undefined): boolean {
  return Boolean(raw) && raw!.split(/\r?\n/).some((l) => TRACK_PATTERN.test(l));
}

/**
 * 원문 줄들(+ 줄별 발음)을 다시 가사 텍스트로 합친다.
 * 시간이 있는 줄은 `[mm:ss.xx] 원문`, 바로 다음 줄에 `{발음} …`. 기존 타임스탬프 형식은 바꾸지 않는다.
 */
export function formatLyricsWithTracks(lines: { time: number | null; text: string; pron?: string; trans?: string }[]): string {
  const out: string[] = [];
  for (const l of lines) {
    if (l.time !== null && Number.isFinite(l.time)) {
      const cs = Math.max(0, Math.round(l.time * 100));
      const mm = Math.floor(cs / 6000);
      const ss = ((cs % 6000) / 100).toFixed(2).padStart(5, "0");
      out.push(`[${String(mm).padStart(2, "0")}:${ss}] ${l.text}`);
    } else {
      out.push(l.text);
    }
    if (l.text.trim() !== "") {
      if (l.pron?.trim()) out.push(`${TRACK_TAGS.pron} ${l.pron.trim()}`);
      if (l.trans?.trim()) out.push(`${TRACK_TAGS.trans} ${l.trans.trim()}`);
    }
  }
  return out.join("\n");
}

/**
 * 연속으로 2줄 이상 반복되는 빈 줄만 1줄로 줄인다.
 * 실제 가사 줄은 절대 합치지 않는다 — 빈 줄이 아닌 줄은 그대로 다 보존된다.
 * 새로 입력/수정할 때만 호출한다 (기존 DB 데이터를 일괄 변경하지 않음).
 */
export function normalizeLyrics(raw: string): string {
  return raw
    .split(/\r?\n/)
    .reduce<string[]>((lines, line) => {
      const isBlank = line.trim() === "";
      const prevIsBlank = lines.length > 0 && lines[lines.length - 1].trim() === "";
      if (isBlank && prevIsBlank) return lines; // 연속 빈 줄이면 건너뜀
      lines.push(line);
      return lines;
    }, [])
    .join("\n");
}

const URL_PATTERN = /(https?:\/\/[^\s]+|www\.[^\s]+\.[^\s]+)/g;

/** 텍스트를 URL과 일반 텍스트 조각으로 나눈다 (렌더링은 호출부에서 안전하게 처리) */
export function splitTextByUrls(text: string): { text: string; isUrl: boolean }[] {
  const parts: { text: string; isUrl: boolean }[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      parts.push({ text: text.slice(lastIndex, start), isUrl: false });
    }
    parts.push({ text: match[0], isUrl: true });
    lastIndex = start + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), isUrl: false });
  }
  return parts.length > 0 ? parts : [{ text, isUrl: false }];
}

/** 가사 중 하나라도 타임스탬프가 있으면 true (자동 싱크 대상 여부 판정용) */
export function hasTimestamps(lines: LyricLine[]): boolean {
  return lines.some((l) => l.time !== null);
}

/**
 * 현재 재생시간(초) 기준으로 "지금 불러야 할 가사"의 인덱스를 찾는다.
 * 현재 시간보다 작거나 같은 타임스탬프 중 가장 늦은(=가장 최근) 것을 고른다.
 * 타임스탬프가 하나도 아직 지나지 않았으면 -1(아직 없음).
 */
export function findCurrentLyricIndex(lines: LyricLine[], currentTime: number): number {
  let result = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].time;
    if (t !== null && t <= currentTime) {
      result = i;
    }
  }
  return result;
}

/**
 * 원문 가사 텍스트의 각 줄은 그대로 두고, 줄별 발음만 `{발음}` 보조 줄로 끼워 넣는다 (원문·타임스탬프 표기는 한 글자도 바꾸지 않는다).
 * prons[i] 는 "보조 줄을 뺀 원문의 i번째 줄"에 대한 발음이다. 비어 있으면 그 줄의 발음은 없어진다. 기존 {번역} 줄은 유지한다.
 */
export function applyPronToRaw(raw: string | undefined, prons: (string | undefined)[]): string {
  const base = stripLyricTracks(raw).split(/\r?\n/);
  const parsed = parseLyrics(raw);
  const out: string[] = [];
  base.forEach((line, i) => {
    out.push(line);
    if (line.trim() === "") return;
    const p = prons[i]?.replace(/[\r\n]+/g, " ").trim();
    if (p) out.push(`${TRACK_TAGS.pron} ${p}`);
    const t = parsed[i]?.trans;
    if (t) out.push(`${TRACK_TAGS.trans} ${t}`);
  });
  return out.join("\n");
}
