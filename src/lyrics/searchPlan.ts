import { canonicalArtistQuery, splitArtists } from "./artist";
import { isAutoAccept, rankCandidates } from "./matching";
import { queryTitle } from "./text";
import { hasHangul } from "./phonetic";
import { LyricsApiError, isAbort } from "./errors";
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

/** 곡에 직접 입력했거나 기본 사전에 있는 다른 언어 표기 (원어/영문/로마자). 번역기로 만든 값이 아니다. */
export interface KnownAliases {
  titles?: string[];
  artists?: string[];
}

/** 한 곡에서 가사 서비스로 보낼 수 있는 요청의 상한 (별칭이 많아도 호출이 폭증하지 않게 한다) */
export const MAX_TOTAL_REQUESTS = 14;
const MAX_ALIAS_STEPS = 6;
const MAX_ALIAS_EACH = 3;

export function buildSearchPlan(title: string, artist: string, known?: KnownAliases): PlanStep[] {
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
  const base = steps.slice(0, MAX_STEPS);

  // 별칭 단계: 원어/영문/로마자 표기로 같은 곡을 찾는다 (예: 너는 록을 듣지 않아 / 아이묭 → 君はロックを聴かない / あいみょん)
  const titleAliases = (known?.titles ?? []).map((t) => t.trim()).filter(Boolean).slice(0, MAX_ALIAS_EACH);
  const artistAliases = (known?.artists ?? []).map((a) => a.trim()).filter(Boolean).slice(0, MAX_ALIAS_EACH);
  const extra: PlanStep[] = [];
  const addAlias = (t: string, a: string, label: string) => {
    const key = `${t.toLowerCase()}|${a.toLowerCase()}`;
    if (!t || seen.has(key)) return;
    seen.add(key);
    extra.push({ title: t, artist: a, label });
  };
  for (const ta of titleAliases) {
    const tq = queryTitle(ta);
    for (const aa of artistAliases) addAlias(tq, canonicalArtistQuery(aa), "alias-title+alias-artist");
    if (A) addAlias(tq, canon, "alias-title+artist");
  }
  for (const aa of artistAliases) addAlias(Tn, canonicalArtistQuery(aa), "title+alias-artist");
  for (const ta of titleAliases) addAlias(queryTitle(ta), "", "alias-title-only");
  return [...base, ...extra.slice(0, MAX_ALIAS_STEPS)];
}

export interface SearchOutcome {
  candidates: LyricsCandidate[];
  steps: PlanStep[];
  aliases?: TitleArtistAliases;
  budgetExhausted?: boolean;
  /** 모든 요청이 실패했을 때만 채워진다 (이 경우 searchCandidates 는 throw 한다) */
  error?: unknown;
}

/**
 * 계획대로 provider 를 호출해 후보를 모은다 (id 로 중복 제거).
 * 지금까지 모인 후보 중 "자동 선택 가능한(high)" 후보가 생기면 거기서 멈춘다.
 * 첫 호출이 실패하면(네트워크 오류) 그대로 던지고, 이후 단계의 오류는 이미 얻은 결과를 살리기 위해 무시한다.
 *
 * 확장 단계: 위 단계로도 자동 선택할 후보가 없고 입력에 한글이 있으면(예: 가사 DB 에는 "Flower Way - Kim Sejeong" 으로만 있는 "꽃길 - 김세정")
 * 1) 자유 검색(q) 으로 "제목 가수"를 한 번 더 찾고,
 * 2) aliasProvider(MusicBrainz) 가 확인해 준 영문 가수/제목 표기로 다시 찾는다. 한글을 영문으로 임의 변환하지 않는다.
 * 한 곡에서 보내는 요청은 전체 합쳐 최대 MAX_TOTAL_REQUESTS 번이고, 같은 검색어는 다시 보내지 않는다.
 */
export async function searchCandidates(
  provider: LyricsProvider,
  input: { title: string; artist: string; titleAliases?: string[]; artistAliases?: string[] },
  signal?: AbortSignal,
  aliasProvider?: AliasProvider
): Promise<SearchOutcome> {
  const known: KnownAliases = { titles: input.titleAliases, artists: input.artistAliases };
  const plan = buildSearchPlan(input.title, input.artist, known);
  // 알려진 별칭은 "같은 곡의 다른 표기"로 점수 계산에도 쓴다 (가수가 맞을 때만 제목 별칭이 인정된다)
  let aliases: TitleArtistAliases | undefined =
    (known.titles?.length ?? 0) + (known.artists?.length ?? 0) > 0 ? { titles: known.titles ?? [], artists: known.artists ?? [], trusted: true } : undefined;
  let requests = 0;
  let budgetExhausted = false;
  const hasArtist = Boolean(input.artist.trim());
  const byId = new Map<string, LyricsCandidate>();
  const used: PlanStep[] = [];
  const seenKeys = new Set<string>();
  let succeeded = false;
  let firstError: unknown;
  const done = () => ({ candidates: [...byId.values()], steps: used, aliases, budgetExhausted, error: succeeded ? undefined : firstError });
  const accepted = () => {
    const ranked = rankCandidates(input, [...byId.values()], aliases);
    return ranked.length > 0 && isAutoAccept(ranked[0], hasArtist);
  };
  const collect = (found: LyricsCandidate[]) => {
    for (const c of found) if (!byId.has(c.id)) byId.set(c.id, c);
  };
  /** 요청 1회: 같은 검색어 중복 제거 + 곡당 총 요청 상한. 오류가 나도 이미 얻은 결과는 살린다 (AbortError 만 즉시 전파) */
  const run = async (label: string, key: string, call: () => Promise<LyricsCandidate[]>): Promise<boolean> => {
    const k = key.toLowerCase();
    if (seenKeys.has(k)) return false;
    if (requests >= MAX_TOTAL_REQUESTS) {
      budgetExhausted = true;
      return false;
    }
    seenKeys.add(k);
    requests++;
    try {
      collect(await call());
      succeeded = true;
      used.push({ title: key, artist: "", label });
    } catch (e) {
      if (isAbort(e)) throw e;
      firstError ??= e;
      return false;
    }
    return accepted();
  };

  for (const step of plan) {
    if (await run(step.label, `${step.title}|${step.artist}`, () => provider.search(step.title, step.artist, signal))) return done();
    // 첫 요청부터 연결/서비스 오류면 더 시도해도 같은 오류일 가능성이 높다 → 바로 알린다
    if (!succeeded && requests >= 2 && firstError instanceof LyricsApiError && firstError.kind !== "client") break;
  }
  if (!succeeded && firstError) throw firstError;

  // ---- 확장 단계: 입력이나 별칭에 한글이 있거나, 원어 별칭이 있는 경우
  const T = input.title.trim();
  const A = input.artist.trim();
  const hasKnown = (known.titles?.length ?? 0) + (known.artists?.length ?? 0) > 0;
  if (!(hasHangul(T) || hasHangul(A) || hasKnown)) return done();

  const nonHangul = (xs?: string[]) => (xs ?? []).find((x) => x.trim() && !hasHangul(x));
  if (provider.searchQuery) {
    const q = [T, A].filter(Boolean).join(" ");
    if (await run("free-text", `q:${q}`, () => provider.searchQuery!(q, signal))) return done();
    // 별칭으로 자유 검색 (원어 제목 + 원어 가수)
    const aT = nonHangul(known.titles);
    const aA = nonHangul(known.artists);
    if (aT || aA) {
      const q2 = [aT ?? T, aA ?? A].filter(Boolean).join(" ");
      if (await run("free-text-known-alias", `q:${q2}`, () => provider.searchQuery!(q2, signal))) return done();
    }
  }

  if (aliasProvider && hasArtist) {
    // MusicBrainz 조회는 가능하면 원어/영문 표기로 한다 (한글 표기는 MB 에 없는 경우가 많다)
    const lookTitle = nonHangul(known.titles) ?? T;
    const lookArtist = nonHangul(known.artists) ?? A;
    let mb: TitleArtistAliases | undefined;
    try {
      mb = await aliasProvider.lookup(lookTitle, lookArtist, signal);
    } catch (e) {
      if (isAbort(e)) throw e;
      mb = undefined; // 별칭 조회 실패는 검색 자체를 막지 않는다
    }
    if (mb && (mb.artists.length > 0 || mb.titles.length > 0)) {
      aliases = mergeAliases(aliases, mb);
      // 가수 별칭이 없으면 입력한 가수 그대로 (예: 이미 영문으로 적힌 가수 + 한글 제목)
      const aArtist = mb.artists[0] ?? lookArtist;
      if (aArtist) {
        for (const aTitle of mb.titles.slice(0, 2)) {
          if (await run("alias-title+alias-artist", `${aTitle}|${aArtist}`, () => provider.search(aTitle, aArtist, signal))) return done();
        }
        if (provider.searchQuery && mb.titles[0]) {
          const q = [mb.titles[0], aArtist].join(" ");
          if (await run("free-text-alias", `q:${q}`, () => provider.searchQuery!(q, signal))) return done();
        }
        if (await run("title+alias-artist", `${T}|${aArtist}`, () => provider.search(T, aArtist, signal))) return done();
      }
    }
  }

  // 제목 표기가 달라서(한글 ↔ 원어) 제목으로는 못 찾는 경우: 가수가 확실하면 그 가수의 곡들을 후보로 보여 준다.
  // 이 후보들은 자동으로 고르지 않고, 사용자가 전체 가사를 미리 보고 직접 고른다 (isCrossScriptTitleChoice).
  if (provider.searchQuery && hasArtist && !accepted()) {
    const names = [...(aliases?.artists ?? []), ...(known.artists ?? [])].filter((n) => n.trim() && !hasHangul(n));
    const seenNames = new Set<string>();
    for (const n of names) {
      const nk = n.toLowerCase();
      if (seenNames.has(nk)) continue;
      seenNames.add(nk);
      if (seenNames.size > 2) break;
      if (await run("artist-browse", `q:${n}`, () => provider.searchQuery!(n, signal))) return done();
    }
  }
  return done();
}

export function mergeAliases(a: TitleArtistAliases | undefined, b: TitleArtistAliases | undefined): TitleArtistAliases | undefined {
  if (!a) return b;
  if (!b) return a;
  const uniq = (xs: string[]) => {
    const seen = new Set<string>();
    return xs.filter((x) => {
      const k = x.trim().toLowerCase();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  return { artists: uniq([...a.artists, ...b.artists]), titles: uniq([...a.titles, ...b.titles]), trusted: a.trusted && b.trusted };
}
