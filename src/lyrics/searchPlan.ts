import { getSongAliases } from "../utils/songAliases";
import { splitTranslatedName } from "./versions";
import { reportRequest } from "./diagnostics";
import { canonicalArtistQuery, splitArtists } from "./artist";
import { isAutoAccept, rankCandidates } from "./matching";
import { lyricsQueryVariants, normalizeText } from "./text";
import { hasHangul } from "./phonetic";
import { LyricsApiError, isAbort } from "./errors";
import type { AliasProvider, LyricsCandidate, LyricsProvider, TitleArtistAliases, LyricsRequestObserver, LyricsSearchStopReason } from "./types";

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
const MAX_TITLE_ALIASES = 3;
const spelling = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
const uniq = (values: string[]) => [...new Map(values.filter((v) => v.trim()).map((v) => [spelling(v), v.trim()])).values()];
const preferred = (values: string[]) => uniq(values).sort((a, b) => Number(hasHangul(a)) - Number(hasHangul(b))).slice(0, MAX_TITLE_ALIASES);

/** Round-robin script/shape diversity: roman name, acronym, native spelling, Korean.
 * Keep every confirmed alias eligible; only the global request budget limits execution. */
export function prioritizeArtistAliases(values: string[]): string[] {
  const seen = new Set<string>();
  const groups: string[][] = [[], [], [], []];
  for (const value of values.map((v) => v.trim()).filter(Boolean)) {
    const key = normalizeText(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const text = value.normalize("NFKC");
    const group = /^[A-Z0-9]{2,8}$/u.test(text) ? 1 : /[a-zA-Z]/u.test(text) && !/[^\p{Script=Latin}\p{N}\p{P}\p{Z}]/u.test(text) ? 0 : hasHangul(text) ? 3 : 2;
    groups[group].push(value);
  }
  const ordered: string[] = [];
  for (let i = 0; groups.some((g) => i < g.length); i++) for (const group of groups) if (group[i]) ordered.push(group[i]);
  return ordered;
}

const preferredTitles = (values: string[]) => {
  const seen = new Set<string>();
  const repeated: string[] = [];
  const distinct = uniq(values).sort((a, b) => Number(hasHangul(a)) - Number(hasHangul(b))).filter((v) => {
    const key = normalizeText(v);
    if (seen.has(key)) { repeated.push(v); return false; }
    seen.add(key);
    return true;
  });
  return [...distinct, ...repeated].slice(0, MAX_TITLE_ALIASES);
};

export function buildSearchPlan(title: string, artist: string, known?: KnownAliases): PlanStep[] {
  const titleName = splitTranslatedName(title);
  const artistName = splitTranslatedName(artist);
  if (titleName.primary !== title || artistName.primary !== artist) known = getSongAliases({ title, artist, titleAliases: known?.titles, artistAliases: known?.artists });
  title = titleName.primary;
  artist = artistName.primary;
  const titles = lyricsQueryVariants(title);
  const artists = uniq([artist.trim(), canonicalArtistQuery(artist), ...prioritizeArtistAliases(known?.artists ?? [])]);
  const aliases = preferredTitles(known?.titles ?? []).sort((a, b) => Number(normalizeText(a) === normalizeText(title)) - Number(normalizeText(b) === normalizeText(title)));
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
  const alternatives = prioritizeArtistAliases(artists).filter((a) => spelling(a) !== spelling(artist));
  const aliasArtists = alternatives;
  if (hasHangul(title)) for (const t of aliases.filter((t) => !hasHangul(t)).slice(0, 2)) {
    add(t, aliasArtists[0] ?? artist, "known-native-title");
  }
  for (const a of aliasArtists.slice(0, 2)) for (const t of titles.slice(0, 2)) add(t, a, "known-title+artist-alias");
  for (const a of aliasArtists.slice(2)) add(title.trim(), a, "known-title+artist-alias");
  for (const t of aliases) {
    const primaryArtist = /[A-Za-z]/u.test(artist) ? artist : artists.find((a) => /[A-Za-z]/u.test(a)) ?? artist;
    add(t, primaryArtist, "known-title+primary-artist");
    add(t, artist.trim(), "known-title+artist");
    for (const a of aliasArtists) add(t, a, "known-title+artist-alias");
  }
  for (const t of aliases) for (const v of lyricsQueryVariants(t).slice(1)) add(v, artists[0] ?? "", "normalized-alias");
  for (const a of splitArtists(artist).slice(0, 2)) add(titles[0] ?? "", a, "individual-artist");
  for (const t of titles) add(t, "", "title-only");
  return steps;
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
  aliasProvider?: AliasProvider,
  observe?: LyricsRequestObserver
): Promise<SearchOutcome> {
  const queryInput = { ...input, title: splitTranslatedName(input.title).primary, artist: splitTranslatedName(input.artist).primary };
  const known = queryInput.title !== input.title || queryInput.artist !== input.artist ? getSongAliases(input)
    : { titles: input.titleAliases ?? [], artists: input.artistAliases ?? [] };
  let aliases: TitleArtistAliases | undefined = known.titles.length || known.artists.length
    ? { titles: known.titles, artists: known.artists, trusted: true } : undefined;
  const plan = buildSearchPlan(queryInput.title, queryInput.artist, { titles: aliases?.titles, artists: aliases?.artists });
  const byId = new Map<string, LyricsCandidate>();
  const steps: PlanStep[] = [];
  const seen = new Set<string>();
  let requests = 0, successes = 0, failures = 0;
  let firstError: unknown;
  let budgetExhausted = false;
  let stop = false;
  let stopReason: LyricsSearchStopReason | undefined;
  let recoveryLeft: number | undefined;
  let serverErrors = 0;
  const done = (reason?: LyricsSearchStopReason) => {
    const finalReason = reason ?? stopReason ?? (budgetExhausted ? "request-limit" : "completed");
    reportRequest(observe, { endpoint: "plan", outcome: "stopped", stopReason: finalReason });
    return { candidates: [...byId.values()], steps, aliases, budgetExhausted,
    error: successes ? undefined : firstError,
    diagnostics: { stopReason: finalReason, requests, records: byId.size, withLyrics: [...byId.values()].filter((c) => !c.instrumental && (c.syncedLyrics || c.plainLyrics)).length, failures, budgetExhausted } };
  };
  const accepted = () => {
    const ranked = rankCandidates(input, [...byId.values()], aliases);
    return ranked.length > 0 && isAutoAccept(ranked[0], Boolean(queryInput.artist.trim()));
  };
  const run = async (label: string, key: string, call: () => Promise<LyricsCandidate[]>): Promise<boolean> => {
    if (signal?.aborted) { done("aborted"); throw new DOMException("Aborted", "AbortError"); }
    if (stop || seen.has(key)) return false;
    if (requests >= MAX_TOTAL_REQUESTS) { budgetExhausted = true; return false; }
    seen.add(key);
    if (recoveryLeft !== undefined) recoveryLeft--;
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
      if (isAbort(e)) { done("aborted"); throw e; }
      firstError ??= e;
      failures++;
      // Never retry the same URL. One transient 5xx permits at most two other
      // combinations; a second 5xx, rate-limit, auth/network/invalid response stops.
      if (e instanceof LyricsApiError) {
        if (e.kind === "rate-limit") { stop = true; stopReason = "rate-limit"; }
        else if (e.retryAfterRequested) { stop = true; stopReason = "retry-after"; }
        else if (e.kind === "server" && [500, 502, 503, 504].includes(e.status ?? 0)) {
          serverErrors++;
          if (serverErrors >= 2) { stop = true; stopReason = "server-error-limit"; }
          else recoveryLeft = 2;
        } else if (e.kind !== "client" || e.status === 401 || e.status === 403) {
          stop = true;
          stopReason = e.kind === "network" ? "network" : e.kind === "invalid" ? "invalid" : e.kind === "client" ? "unauthorized" : "service-error";
        }
      } else if (!successes && requests >= 2) { stop = true; stopReason = "network"; }
    }
    const matched = accepted();
    if (!matched && recoveryLeft === 0 && !stop) { stop = true; stopReason = "server-recovery-limit"; }
    return matched;
  };
  const structured = async (step: PlanStep) => run(step.label,
    `s:${JSON.stringify([spelling(step.title), spelling(step.artist)])}`, () => provider.search(step.title, step.artist, signal, observe));
  if (!queryInput.title.trim()) return done();
  // Six targeted requests, then metadata/aliases: do not starve later discovery paths.
  for (const step of plan.slice(0, 6)) {
    if (await structured(step)) return done("matched");
    if (stop) break;
  }
  if (!successes && firstError) { done(); throw firstError; }
  if (stop) return done();

  if (aliasProvider && queryInput.artist.trim()) {
    const title = preferred([queryInput.title, ...(queryInput.titleAliases ?? [])])[0] ?? queryInput.title;
    const artist = uniq([queryInput.artist, ...(queryInput.artistAliases ?? [])]).sort((a, b) => Number(hasHangul(a)) - Number(hasHangul(b)))[0] ?? queryInput.artist;
    try {
      const found = await aliasProvider.lookup(title, artist, signal);
      if (found.lookupUnavailable) failures++;
      aliases = mergeAliases(aliases, found);
    } catch (e) {
      if (isAbort(e)) { done("aborted"); throw e; }
      failures++; // metadata failure is not proof that the lyrics provider lacks this song
    }
  }
  const expanded = buildSearchPlan(queryInput.title, queryInput.artist, { titles: aliases?.titles, artists: aliases?.artists });
  for (const step of expanded.filter((s) => s.artist && !seen.has(`s:${JSON.stringify([spelling(s.title), spelling(s.artist)])}`)).slice(0, 4)) {
    if (await structured(step)) return done("matched");
    if (stop) return done();
  }

  // The DB metadata endpoint can find records missing from the full-text index.
  if (provider.get && queryInput.artist.trim()) {
    const titles = uniq([queryInput.title, ...preferred(aliases?.titles ?? [])]);
    const artists = uniq([queryInput.artist, ...prioritizeArtistAliases(aliases?.artists ?? [])]);
    const pairs = [{ title: titles[1] ?? titles[0], artist: artists[1] ?? artists[0] }, { title: titles[0], artist: artists[0] }];
    for (const pair of pairs) {
      const key = `get:${JSON.stringify([spelling(pair.title), spelling(pair.artist), input.referenceDuration ?? null])}`;
      if (await run("metadata-get", key, () => provider.get!(pair.title, pair.artist,
        input.referenceDuration === undefined ? {} : { duration: input.referenceDuration }, signal, observe))) return done("matched");
      if (stop) return done();
    }
    // A supplied recording duration can differ from the provider's metadata.
    // Retry one raw exact pair without that constraint; title/artist/version gates
    // still apply, and the same global request budget remains in force.
    if (input.referenceDuration !== undefined) {
      const key = `get:${JSON.stringify([spelling(queryInput.title), spelling(queryInput.artist), null])}`;
      if (await run("metadata-get-without-duration", key,
        () => provider.get!(queryInput.title, queryInput.artist, {}, signal, observe))) return done("matched");
      if (stop) return done();
    }
  }

  // Free text applies to Japanese/English too, with and without symbol spacing.
  if (provider.searchQuery) {
    const names = uniq([queryInput.artist, ...prioritizeArtistAliases(aliases?.artists ?? [])]);
    const titles = uniq([...preferredTitles(aliases?.titles ?? []), ...lyricsQueryVariants(queryInput.title)]);
    let freeQueries = 0;
    freeText: for (const title of titles.slice(0, 3)) {
      for (const artist of names.slice(0, 2)) {
        if (freeQueries++ >= 4) break freeText;
        const q = `${title} ${artist}`.trim();
        if (await run("free-text", `q:${spelling(q)}`, () => provider.searchQuery!(q, signal, observe))) return done("matched");
        if (stop) return done();
      }
    }
    for (const name of prioritizeArtistAliases(aliases?.artists ?? []).slice(0, 1)) {
      if (await run("artist-browse", `q:${spelling(name)}`, () => provider.searchQuery!(name, signal, observe))) return done("matched");
      if (stop) return done();
    }
    // Artist-independent title queries rescue missing artist spellings, but still require matching evidence.
    for (const title of lyricsQueryVariants(queryInput.title).slice(0, 2)) {
      if (await run("free-text-title", `q:${spelling(title)}`, () => provider.searchQuery!(title, signal, observe))) return done("matched");
      if (stop) return done();
    }
  }
  for (const step of expanded) {
    if (await structured(step)) return done("matched");
    if (stop) break;
  }
  if (provider.searchQuery && !stop) {
    for (const name of prioritizeArtistAliases(aliases?.artists ?? []).slice(0, 2)) {
      if (await run("artist-browse", `q:${spelling(name)}`, () => provider.searchQuery!(name, signal, observe))) return done("matched");
    }
  }
  if (!successes && firstError) { done(); throw firstError; }
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
