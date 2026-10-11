import { canonicalArtistQuery, splitArtists } from "./artist";
import { isAutoAccept, rankCandidates } from "./matching";
import { queryTitle } from "./text";
import { hasHangul } from "./phonetic";
import type { AliasProvider, LyricsCandidate, LyricsProvider, TitleArtistAliases } from "./types";

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

const MAX_EXTENDED_STEPS = 6;

/**
 * 계획대로 provider 를 호출해 후보를 모은다 (id 로 중복 제거).
 * 지금까지 모인 후보 중 "자동 선택 가능한(high)" 후보가 생기면 거기서 멈춘다.
 * 첫 호출이 실패하면(네트워크 오류) 그대로 던지고, 이후 단계의 오류는 이미 얻은 결과를 살리기 위해 무시한다.
 *
 * 확장 단계: 위 단계로도 자동 선택할 후보가 없고 입력에 한글이 있으면(예: 가사 DB 에는 "Flower Way - Kim Sejeong" 으로만 있는 "꽃길 - 김세정")
 * 1) 자유 검색(q) 으로 "제목 가수"를 한 번 더 찾고,
 * 2) aliasProvider(MusicBrainz) 가 확인해 준 영문 가수/제목 표기로 다시 찾는다. 한글을 영문으로 임의 변환하지 않는다.
 * 확장 단계의 요청은 최대 MAX_EXTENDED_STEPS 번이다.
 */
export async function searchCandidates(
  provider: LyricsProvider,
  input: { title: string; artist: string },
  signal?: AbortSignal,
  aliasProvider?: AliasProvider
): Promise<{ candidates: LyricsCandidate[]; steps: PlanStep[]; aliases?: TitleArtistAliases }> {
  const plan = buildSearchPlan(input.title, input.artist);
  const hasArtist = Boolean(input.artist.trim());
  const byId = new Map<string, LyricsCandidate>();
  const used: PlanStep[] = [];
  let succeeded = false;
  let aliases: TitleArtistAliases | undefined;
  const accepted = () => {
    const ranked = rankCandidates(input, [...byId.values()], aliases);
    return ranked.length > 0 && isAutoAccept(ranked[0], hasArtist);
  };
  const collect = (found: LyricsCandidate[]) => {
    for (const c of found) if (!byId.has(c.id)) byId.set(c.id, c);
  };

  for (const step of plan) {
    try {
      collect(await provider.search(step.title, step.artist, signal));
      succeeded = true;
      used.push(step);
    } catch (e) {
      if (!succeeded) throw e;
      continue;
    }
    if (accepted()) return { candidates: [...byId.values()], steps: used };
  }

  // ---- 확장 단계
  if (!(hasHangul(input.title) || hasHangul(input.artist))) return { candidates: [...byId.values()], steps: used };
  const seen = new Set<string>();
  let budget = MAX_EXTENDED_STEPS;
  const run = async (label: string, key: string, call: () => Promise<LyricsCandidate[]>): Promise<boolean> => {
    if (budget <= 0 || seen.has(key.toLowerCase())) return false;
    seen.add(key.toLowerCase());
    budget--;
    try {
      collect(await call());
      used.push({ title: key, artist: "", label });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      return false; // 얻은 결과는 살린다
    }
    return accepted();
  };

  const T = input.title.trim();
  const A = input.artist.trim();
  if (provider.searchQuery) {
    const q = [T, A].filter(Boolean).join(" ");
    if (await run("free-text", `q:${q}`, () => provider.searchQuery!(q, signal))) return { candidates: [...byId.values()], steps: used, aliases };
  }
  if (aliasProvider && hasArtist) {
    try {
      aliases = await aliasProvider.lookup(T, A, signal);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      aliases = undefined;
    }
    if (aliases && (aliases.artists.length > 0 || aliases.titles.length > 0)) {
      // 가수 별칭이 없으면 입력한 가수 그대로 (예: 이미 영문으로 적힌 가수 + 한글 제목)
      const aArtist = aliases.artists[0] ?? A;
      if (aArtist) {
        for (const aTitle of aliases.titles.slice(0, 2)) {
          if (await run("alias-title+alias-artist", `${aTitle}|${aArtist}`, () => provider.search(aTitle, aArtist, signal))) return { candidates: [...byId.values()], steps: used, aliases };
        }
        if (provider.searchQuery) {
          const q = [aliases.titles[0], aArtist].filter(Boolean).join(" ");
          if (await run("free-text-alias", `q:${q}`, () => provider.searchQuery!(q, signal))) return { candidates: [...byId.values()], steps: used, aliases };
        }
        if (await run("title+alias-artist", `${T}|${aArtist}`, () => provider.search(T, aArtist, signal))) return { candidates: [...byId.values()], steps: used, aliases };
      }
    }
  }
  return { candidates: [...byId.values()], steps: used, aliases };
}
