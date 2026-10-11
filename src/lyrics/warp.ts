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

// ---------------------------------------------------------------- 싱크 보정 간격

/** 한 번 누를 때 움직일 수 있는 간격(초): 0.1 ~ 1.0, 0.1 단위. 정수 "십분의 일 초"(1~10)로 다뤄 부동소수점 오차를 피한다. */
export const SYNC_STEP_TENTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
export const DEFAULT_SYNC_STEP_TENTHS = 5; // 기존 동작(0.5초)

/** 저장값/입력값을 1~10 정수로 정리한다. 잘못된 값은 기본(0.5초) */
export function parseSyncStepTenths(raw: unknown): number {
  const n = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : DEFAULT_SYNC_STEP_TENTHS;
}

/**
 * 누적 보정값(초)에 stepTenths/10 초를 direction(+1: 가사 늦게, -1: 가사 빠르게) 방향으로 더한다.
 * 0.01초 단위로 반올림해서 0.1을 여러 번 더해도 0.30000000000000004 같은 오차가 쌓이지 않는다.
 */
export function nudgeOffset(current: number, stepTenths: number, direction: 1 | -1): number {
  const step = parseSyncStepTenths(stepTenths);
  return Math.round(current * 100 + direction * step * 10) / 100;
}

/** "+0.3초" / "-0.5초" / "0초" — 0.1초 단위면 소수 1자리, 그 외(첫 소절 맞추기로 생긴 값)는 2자리 */
export function formatOffset(offset: number): string {
  const r = Math.round(offset * 100) / 100;
  if (r === 0) return "0초";
  const tenths = Math.round(r * 10) / 10;
  const text = Math.abs(r - tenths) < 1e-9 ? tenths.toFixed(1) : r.toFixed(2);
  return `${r > 0 ? "+" : ""}${text}초`;
}

export function formatStep(stepTenths: number): string {
  return `${(parseSyncStepTenths(stepTenths) / 10).toFixed(1)}초`;
}

const STEP_KEY = "songbook:sync-step-tenths";
/** 마지막으로 고른 보정 간격 (이 브라우저에만 저장되는 보기 설정. 누적 보정값과는 별개) */
export function readSyncStep(): number {
  try {
    return parseSyncStepTenths(localStorage.getItem(STEP_KEY));
  } catch {
    return DEFAULT_SYNC_STEP_TENTHS;
  }
}
export function writeSyncStep(stepTenths: number): void {
  try {
    localStorage.setItem(STEP_KEY, String(parseSyncStepTenths(stepTenths)));
  } catch {
    // ignore
  }
}
