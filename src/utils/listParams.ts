import type { SortOption } from "../types/song";

const SORT_VALUES: SortOption[] = ["recent", "title", "artist", "difficulty", "favorite"];

/** URL의 sort 값을 검증한다 — 알 수 없는 값은 기본 정렬(recent) */
export function parseSortParam(raw: string | null): SortOption {
  return SORT_VALUES.includes(raw as SortOption) ? (raw as SortOption) : "recent";
}

/** URL의 page 값을 검증한다 — 숫자가 아니거나 1 미만이면 1 */
export function parsePageParam(raw: string | null): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}
