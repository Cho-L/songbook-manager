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
