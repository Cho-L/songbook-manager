/**
 * 곡별 가사 싱크 보정값(초) — DB 변경 없이 이 브라우저(localStorage)에 곡 id 별로 저장한다.
 * 부호: 양수 = 가사를 늦게(가사 시간표가 +만큼 뒤로 밀림), 음수 = 빠르게. 자동 찾은 가사의 기존 "싱크 보정(warp)"과 같은 방향이다.
 * 방송(OBS)에는 보정이 적용된 시간표를 보내므로 OBS 쪽은 이 값을 몰라도 같은 줄이 나온다.
 */
const PREFIX = "songbook:lyric-offset:v1:";
export const OFFSET_STEP_SEC = 0.5;
export const OFFSET_LIMIT_SEC = 30;

export function clampOffset(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const r = Math.round(v * 10) / 10; // 0.1초 단위로 정리 (부동소수점 오차 방지)
  return Math.max(-OFFSET_LIMIT_SEC, Math.min(OFFSET_LIMIT_SEC, r));
}

export function readLyricOffset(songId: string | undefined): number {
  if (!songId) return 0;
  try {
    const raw = localStorage.getItem(PREFIX + songId);
    return raw === null ? 0 : clampOffset(Number(raw));
  } catch {
    return 0;
  }
}

export function writeLyricOffset(songId: string, offset: number): void {
  try {
    const v = clampOffset(offset);
    if (v === 0) localStorage.removeItem(PREFIX + songId);
    else localStorage.setItem(PREFIX + songId, String(v));
  } catch {
    // 저장소를 못 써도 이번 화면에서는 계속 쓸 수 있다
  }
}

export function formatOffsetSec(v: number): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}초`;
}
