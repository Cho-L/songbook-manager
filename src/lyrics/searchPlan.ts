import { canonicalArtistQuery, splitArtists } from "./artist";
import { isAutoAccept, rankCandidates } from "./matching";
import { queryTitle } from "./text";
import type { LyricsCandidate, LyricsProvider } from "./types";

/**
 * 단계적 검색: 처음부터 너무 엄격한 한 번의 질의로 후보 자체를 놓치지 않도록, 엄격한 것부터 느슨한 것까지 차례로 시도한다.
 *   1. 제목 + 가수 (입력 그대로)
 *   2. 제목 + 정규화한 가수 목록 ("로제,브루노마스" → "로제, 브루노마스", 악센트 제거)
 *   3. 정규화한 제목("APT." → "APT") + 정규화한 가수 목록
 *   4. 정규화한 제목 + 가수 이름 하나씩
 *   5. 제목만 (+ 정규화한 제목만)
 * 어느 단계의 후보든 마지막에는 제목/가수 점수로 다시 검증한다 — 제목만 맞는다고 무조건 고르지 않는다.
 */
export interface PlanStep {
  title: string;
  artist: string;
  label: string;
}

const MAX_STEPS = 7;

export function buildSearchPlan(title: string, artist: string): PlanStep[] {
  const T = title.trim();
  const Tn = queryTitle(T);
  const A = artist.trim();
  const names = splitArtists(A);
  const canon = canonicalArtistQuery(A);
  const steps: PlanStep[] = [];
  const seen = new Set<string>();
  const add = (t: string, a: string, label: string) => {
    const key = `${t.toLowerCase()}|${a.toLowerCase()}`;
    if (!t || seen.has(key)) return;
    seen.add(key);
    steps.push({ title: t, artist: a, label });
  };
  add(T, A, "exact");
  if (A) {
    add(T, canon, "title+artist-normalized");
    add(Tn, canon, "title-normalized+artist-normalized");
    if (names.length > 1) for (const n of names.slice(0, 3)) add(Tn, n, "title+individual-artist");
    else if (names.length === 1) add(Tn, names[0], "title+individual-artist");
  }
  add(Tn, "", "title-only");
  add(T, "", "title-only-raw");
  return steps.slice(0, MAX_STEPS);
}

/**
 * 계획대로 provider 를 호출해 후보를 모은다 (id 로 중복 제거).
 * 지금까지 모인 후보 중 "자동 선택 가능한(high)" 후보가 생기면 거기서 멈춘다.
 * 첫 호출이 실패하면(네트워크 오류) 그대로 던지고, 이후 단계의 오류는 이미 얻은 결과를 살리기 위해 무시한다.
 */
export async function searchCandidates(
  provider: LyricsProvider,
  input: { title: string; artist: string },
  signal?: AbortSignal
): Promise<{ candidates: LyricsCandidate[]; steps: PlanStep[] }> {
  const plan = buildSearchPlan(input.title, input.artist);
  const hasArtist = Boolean(input.artist.trim());
  const byId = new Map<string, LyricsCandidate>();
  const used: PlanStep[] = [];
  let succeeded = false;
  for (const step of plan) {
    try {
      const found = await provider.search(step.title, step.artist, signal);
      succeeded = true;
      used.push(step);
      for (const c of found) if (!byId.has(c.id)) byId.set(c.id, c);
    } catch (e) {
      if (!succeeded) throw e;
      continue;
    }
    const ranked = rankCandidates(input, [...byId.values()]);
    if (ranked.length > 0 && isAutoAccept(ranked[0], hasArtist)) break;
  }
  return { candidates: [...byId.values()], steps: used };
}
