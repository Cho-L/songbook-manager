export interface LyricLine {
  /** 초 단위 타임스탬프. 현재 데이터는 전부 일반 텍스트라 null. */
  time: number | null;
  text: string;
}

const TIMESTAMP_PATTERN = /^\[(\d{1,2}):(\d{2}(?:\.\d{1,2})?)\]\s*(.*)$/;

/**
 * 가사 원문(줄바꿈으로 구분된 일반 텍스트)을 줄 단위로 나눈다.
 * "[mm:ss.ms] 가사" 형식의 줄이 섞여 있으면 시간 정보도 함께 파싱해두지만,
 * 이번 단계에서는 그 시간 정보를 재생 위치와 연동(자동 싱크)하지는 않는다 —
 * 나중에 싱크 기능을 붙일 때 이 time 필드를 그대로 활용할 수 있도록 구조만 준비해둔 것.
 */
export function parseLyrics(raw: string | undefined): LyricLine[] {
  if (!raw) return [];
  return raw.split(/\r?\n/).map((line) => {
    const match = line.match(TIMESTAMP_PATTERN);
    if (match) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      return { time: minutes * 60 + seconds, text: match[3] };
    }
    return { time: null, text: line };
  });
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
