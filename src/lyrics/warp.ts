import type { Warp } from "./types";

/** 기준 녹음 시간 → MR 재생 시간 */
export function applyWarp(t: number, warp: Warp): number {
  return Math.max(0, warp.offset + warp.ratio * t);
}

export function isIdentity(w: Warp): boolean {
  return Math.abs(w.offset) < 1e-6 && Math.abs(w.ratio - 1) < 1e-6;
}

export const MAX_OFFSET_SEC = 60;
const RATIO_MIN = 0.8;
const RATIO_MAX = 1.25;

export function clampWarp(w: Warp): Warp {
  return {
    offset: Math.max(-MAX_OFFSET_SEC, Math.min(MAX_OFFSET_SEC, w.offset)),
    ratio: Math.max(RATIO_MIN, Math.min(RATIO_MAX, w.ratio)),
  };
}

export interface Anchor {
  /** 기준 녹음에서의 시간 */
  ref: number;
  /** MR 에서 실제로 그 부분이 나오는 시간 */
  actual: number;
}

/**
 * 사용자가 알려 준 대응점으로 변환식을 만든다.
 * - 1개: 전체 오프셋만 (intro 길이 차이 등)
 * - 2개 이상: 처음/끝 대응점으로 템포 비율까지 (서로 10초 이상 떨어져 있고 비율이 합리적일 때만)
 * 불가능하거나 비합리적이면 null 을 돌려주고, 호출한 쪽은 기존 값을 유지한다.
 */
export function warpFromAnchors(anchors: Anchor[]): Warp | null {
  if (anchors.length === 0) return null;
  const sorted = [...anchors].sort((a, b) => a.ref - b.ref);
  if (sorted.some((a) => !Number.isFinite(a.ref) || !Number.isFinite(a.actual))) return null;
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (sorted.length === 1 || last.ref - first.ref < 10) {
    const w = { offset: first.actual - first.ref, ratio: 1 };
    return Math.abs(w.offset) <= MAX_OFFSET_SEC ? w : null;
  }
  const ratio = (last.actual - first.actual) / (last.ref - first.ref);
  if (!(ratio >= RATIO_MIN && ratio <= RATIO_MAX)) return null;
  const w = { offset: first.actual - ratio * first.ref, ratio };
  return Math.abs(w.offset) <= MAX_OFFSET_SEC ? w : null;
}

/** 원곡(기준) 길이와 MR 길이 비교. 둘 다 알 때만 의미가 있다. */
export function compareDurations(refSec: number | undefined, mrSec: number | undefined, toleranceSec = 3): { diff: number; similar: boolean } | null {
  if (!refSec || !mrSec || refSec <= 0 || mrSec <= 0) return null;
  const diff = mrSec - refSec;
  return { diff, similar: Math.abs(diff) <= toleranceSec };
}
