import { canonicalArtistQuery, splitArtists } from "./artist";
import { isAutoAccept, rankCandidates } from "./matching";
import { lyricsQueryVariants, normalizeText } from "./text";
import { hasHangul } from "./phonetic";
import { LyricsApiError, isAbort } from "./errors";
import type { AliasProvider, LyricsCandidate, LyricsProvider, TitleArtistAliases } from "./types";

/** Targeted spelling/alias queries first; metadata get and broad search share a strict request budget. */
export interface PlanStep {
  title: string;
  artist: string;
  label: string;
}

/** Known spellings, not speculative translations. */
export interface KnownAliases { titles?: string[]; artists?: string[] }
/** LRCLIB search + get share one budget. MusicBrainz has its own bounded lookup/throttle. */
export const MAX_TOTAL_REQUESTS = 14;
const MAX_ALIAS_EACH = 3;
const spelling = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
const uniq = (values: string[]) => [...new Map(values.filter((v) => v.trim()).map((v) => [spelling(v), v.trim()])).values()];
const preferred = (values: string[]) => uniq(values).sort((a, b) => Number(hasHangul(a)) - Number(hasHangul(b))).slice(0, MAX_ALIAS_EACH);

const preferredTitles = (values: string[]) => {
  const seen = new Set<string>();
  const repeated: string[] = [];
  const distinct = preferred(values).filter((v) => {
    const key = normalizeText(v);
    if (seen.has(key)) { repeated.push(v); return false; }
    seen.add(key);
    return true;
  });
  return [...distinct, ...repeated];
};

export function buildSearchPlan(title: string, artist: string, known?: KnownAliases): PlanStep[] {
  const titles = lyricsQueryVariants(title);
  const artists = uniq([artist.trim(), canonicalArtistQuery(artist), ...preferred(known?.artists ?? [])]);
  const aliases = preferredTitles(known?.titles ?? []);
  const steps: PlanStep[] = [];
  const seen = new Set<string>();
  const add = (t: string, a: string, label: string) => {
    const key = JSON.stringify([spelling(t), spelling(a)]);
    if (!t || seen.has(key)) return;
    seen.add(key);
    steps.push({ title: t, artist: a, label });
  };
  add(title.trim(), artist.trim(), "exact");
  for (const t of titles.slice(1)) add(t, canonicalArtistQuery(artist), "symbols+spacing");
  // Try confirmed cross-script spellings before broad title-only searches consume the budget.
  const alternatives = preferred(artists).filter((a) => spelling(a) !== spelling(artist));
  const nativeAlternatives = alternatives.filter((a) => !hasHangul(a));
  const aliasArtists = (nativeAlternatives.length ? nativeAlternatives : alternatives).slice(0, 2);
  for (const t of [title.trim(), ...aliases]) {
    for (const a of aliasArtists) add(t, a, "known-title+artist-alias");
    if (t !== title.trim()) add(t, artist.trim(), "known-title+artist");
  }
  for (const t of aliases) for (const v of lyricsQueryVariants(t).slice(1)) add(v, artists[0] ?? "", "normalized-alias");
  for (const a of splitArtists(artist).slice(0, 2)) add(titles[0] ?? "", a, "individual-artist");
  for (const t of titles) add(t, "", "title-only");
  return steps.slice(0, 13);
}

export interface SearchOutcome {
  candidates: LyricsCandidate[];
  steps: PlanStep[];
  aliases?: TitleArtistAliases;
  budgetExhausted?: boolean;
  /** 모든 요청이 실패했을 때만 채워진다 (이 경우 searchCandidates 는 throw 한다) */
  error?: unknown;
  diagnostics: { requests: number; records: number; withLyrics: number; failures: number; budgetExhausted: boolean };
}

/**
 * Reuse confirmed spellings, then MusicBrainz metadata, exact get and free-text search in all languages.
 * Stop on a safe match or service failure; never infer global absence from a bounded search miss.
 */
export async function searchCandidates(
  provider: LyricsProvider,
  input: { title: string; artist: string; titleAliases?: string[]; artistAliases?: string[]; referenceDuration?: number },
  signal?: AbortSignal,
  aliasProvider?: AliasProvider
): Promise<SearchOutcome> {
  let aliases: TitleArtistAliases | undefined = input.titleAliases?.length || input.artistAliases?.length
    ? { titles: input.titleAliases ?? [], artists: input.artistAliases ?? [], trusted: true } : undefined;
  const plan = buildSearchPlan(input.title, input.artist, { titles: aliases?.titles, artists: aliases?.artists });
  const byId = new Map<string, LyricsCandidate>();
  const steps: PlanStep[] = [];
  const seen = new Set<string>();
  let requests = 0, successes = 0, failures = 0;
  let firstError: unknown;
  let budgetExhausted = false;
  let stop = false;
  const done = () => ({ candidates: [...byId.values()], steps, aliases, budgetExhausted,
    error: successes ? undefined : firstError,
    diagnostics: { requests, records: byId.size, withLyrics: [...byId.values()].filter((c) => !c.instrumental && (c.syncedLyrics || c.plainLyrics)).length, failures, budgetExhausted } });
  const accepted = () => {
    const ranked = rankCandidates(input, [...byId.values()], aliases);
    return ranked.length > 0 && isAutoAccept(ranked[0], Boolean(input.artist.trim()));
  };
  const run = async (label: string, key: string, call: () => Promise<LyricsCandidate[]>): Promise<boolean> => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (stop || seen.has(key)) return false;
    if (requests >= MAX_TOTAL_REQUESTS) { budgetExhausted = true; return false; }
    seen.add(key);
    requests++;
    steps.push({ title: key, artist: "", label });
    try {
      for (const c of await call()) {
        const id = `${c.source}:${c.id}`;
        const previous = byId.get(id);
        if (!previous || (!previous.syncedLyrics && c.syncedLyrics) || (!previous.plainLyrics && c.plainLyrics)) byId.set(id, c);
      }
      successes++;
    } catch (e) {
      if (isAbort(e)) throw e;
      firstError ??= e;
      failures++;
      // Do not hammer a service that is unavailable/rate-limited or returning invalid responses.
      stop = e instanceof LyricsApiError && e.kind !== "client";
      if (!successes && requests >= 2) stop = true;
    }
    return accepted();
  };
  const structured = async (step: PlanStep) => run(step.label,
    `s:${JSON.stringify([spelling(step.title), spelling(step.artist)])}`, () => provider.search(step.title, step.artist, signal));
  if (!input.title.trim()) return done();
  // Six targeted requests, then metadata/aliases: do not starve later discovery paths.
  for (const step of plan.slice(0, 6)) {
    if (await structured(step)) return done();
    if (stop) break;
  }
  if (!successes && firstError) throw firstError;
  if (stop) return done();

  if (aliasProvider && input.artist.trim()) {
    const title = preferred([input.title, ...(input.titleAliases ?? [])])[0] ?? input.title;
    const artist = preferred([input.artist, ...(input.artistAliases ?? [])])[0] ?? input.artist;
    try {
      const found = await aliasProvider.lookup(title, artist, signal);
      if (found.lookupUnavailable) failures++;
      aliases = mergeAliases(aliases, found);
    } catch (e) {
      if (isAbort(e)) throw e;
      failures++; // metadata failure is not proof that the lyrics provider lacks this song
    }
  }
  const expanded = buildSearchPlan(input.title, input.artist, { titles: aliases?.titles, artists: aliases?.artists });
  for (const step of expanded.filter((s) => s.artist).slice(0, 8)) {
    if (await structured(step)) return done();
    if (stop) return done();
  }

  // The DB metadata endpoint can find records missing from the full-text index.
  if (provider.get && input.artist.trim()) {
    const titles = uniq([input.title, ...preferred(aliases?.titles ?? [])]);
    const artists = uniq([input.artist, ...preferred(aliases?.artists ?? [])]);
    const pairs = [{ title: titles[1] ?? titles[0], artist: artists[1] ?? artists[0] }, { title: titles[0], artist: artists[0] }];
    for (const pair of pairs) {
      const key = `get:${JSON.stringify([spelling(pair.title), spelling(pair.artist), input.referenceDuration ?? null])}`;
      if (await run("metadata-get", key, () => provider.get!(pair.title, pair.artist,
        input.referenceDuration === undefined ? {} : { duration: input.referenceDuration }, signal))) return done();
      if (stop) return done();
    }
  }

  // Free text applies to Japanese/English too, with and without symbol spacing.
  if (provider.searchQuery) {
    const names = preferred([input.artist, ...(aliases?.artists ?? [])]);
    const titles = uniq([...preferredTitles(aliases?.titles ?? []), ...lyricsQueryVariants(input.title)]);
    let freeQueries = 0;
    freeText: for (const title of titles.slice(0, 3)) {
      for (const artist of names.slice(0, 2)) {
        if (freeQueries++ >= 4) break freeText;
        const q = `${title} ${artist}`.trim();
        if (await run("free-text", `q:${spelling(q)}`, () => provider.searchQuery!(q, signal))) return done();
        if (stop) return done();
      }
    }
    for (const name of preferred(aliases?.artists ?? []).slice(0, 1)) {
      if (await run("artist-browse", `q:${spelling(name)}`, () => provider.searchQuery!(name, signal))) return done();
      if (stop) return done();
    }
    // Artist-independent title queries rescue missing artist spellings, but still require matching evidence.
    for (const title of lyricsQueryVariants(input.title).slice(0, 2)) {
      if (await run("free-text-title", `q:${spelling(title)}`, () => provider.searchQuery!(title, signal))) return done();
      if (stop) return done();
    }
  }
  for (const step of expanded) {
    if (await structured(step)) return done();
    if (stop) break;
  }
  if (provider.searchQuery && !stop) {
    for (const name of preferred(aliases?.artists ?? []).slice(0, 2)) {
      if (await run("artist-browse", `q:${spelling(name)}`, () => provider.searchQuery!(name, signal))) return done();
    }
  }
  if (!successes && firstError) throw firstError;
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
