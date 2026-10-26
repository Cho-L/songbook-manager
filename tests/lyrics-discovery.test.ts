import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AutoLyricsBar } from "../src/components/song/AutoLyricsBar.tsx";
import type { useAutoLyrics } from "../src/hooks/useAutoLyrics.ts";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { LrclibProvider } from "../src/lyrics/providers/lrclib.ts";
import { MusicBrainzAliasProvider } from "../src/lyrics/providers/musicbrainz.ts";
import { resolveLyricsDetailed, buildResolvedLyrics } from "../src/lyrics/pipeline.ts";
import { getSongAliases } from "../src/utils/songAliases.ts";
import { MAX_TOTAL_REQUESTS, searchCandidates } from "../src/lyrics/searchPlan.ts";
import { lyricsQueryVariants } from "../src/lyrics/text.ts";
import { isExpired } from "../src/lyrics/cache.ts";
import { LyricsApiError } from "../src/lyrics/errors.ts";
import { describeStatus } from "../src/hooks/useAutoLyrics.ts";
import { parseLyrics, findCurrentLyricIndex } from "../src/utils/lyrics.ts";
import { buildLiveLyrics } from "../src/utils/liveBroadcast.ts";
import { clockedLineIndex } from "../src/utils/liveClock.ts";
import { songsToJSON, parseSongsJSON } from "../src/utils/backup.ts";
import type { Song } from "../src/types/song.ts";
import { JP, BARE, KO, ROM, LRC, original, discoveryFetch } from "./fixtures/lyricsDiscovery.ts";

const originalFetch = globalThis.fetch;
const originalReact = Object.getOwnPropertyDescriptor(globalThis, "React");
let attempts = 0;
before(() => { Object.defineProperty(globalThis, "React", { configurable: true, value: React }); globalThis.fetch = async () => { attempts++; throw new Error("real network forbidden"); }; });
after(() => {
  globalThis.fetch = originalFetch;
  if (originalReact) Object.defineProperty(globalThis, "React", originalReact); else Reflect.deleteProperty(globalThis, "React");
  assert.equal(attempts, 0);
});
function input(title = JP, artist = "神宿") {
  const aliases = getSongAliases({ title, artist });
  return { songId: "mock-song", title, artist, ownLyrics: "", titleAliases: aliases.titles, artistAliases: aliases.artists };
}
for (const [title, artist] of [[JP, "神宿"], [BARE, "神宿"], [KO, "카미야도"], [JP, "Kamiyado"], [ROM, "Kamiyado"]]) {
  test(`discover romanized provider record from ${title} / ${artist}`, async () => {
    const calls: URL[] = [];
    const { entry } = await resolveLyricsDetailed(input(title, artist), new LrclibProvider("https://lyrics.invalid", discoveryFetch("roman", calls)));
    assert.equal(entry.outcome, "synced");
    assert.equal(entry.candidate?.title, ROM);
    assert.ok(calls.length <= 8, `targeted aliases should win early, requests=${calls.length}`);
    assert.deepEqual(entry.lines.map((l) => l.time), [10, 20]);
  });
}
test("symbol normalization reaches stored original before metadata/broad queries", async () => {
  const calls: URL[] = [];
  const { entry } = await resolveLyricsDetailed(input(), new LrclibProvider("https://lyrics.invalid", discoveryFetch("symbols", calls)));
  assert.equal(entry.outcome, "synced");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].searchParams.get("track_name"), BARE);
  assert.ok(lyricsQueryVariants("Don't　Stop!").includes("Dont Stop"));
});
test("symbol spelling aliases survive browse normalization and remain scoped to the correct artist", () => {
  assert.ok(getSongAliases({ title: BARE, artist: "神宿" }).titles.includes(JP));
  assert.ok(!getSongAliases({ title: BARE, artist: "Unrelated Artist" }).titles.includes(ROM));
});
test("metadata get rescues an existing record when every search index query is empty", async () => {
  const calls: URL[] = [];
  const { entry } = await resolveLyricsDetailed(input(), new LrclibProvider("https://lyrics.invalid", discoveryFetch("metadata", calls)));
  assert.equal(entry.outcome, "synced");
  assert.ok(calls.some((u) => u.pathname === "/api/get"));
  assert.ok(calls.filter((u) => u.pathname === "/api/get").every((u) => !u.searchParams.has("duration")), "must not invent a duration from MR");
  assert.equal(entry.discovery?.withLyrics, 1);
});
test("get sends explicit reference duration/album, caches and shares a single-record response", async () => {
  const calls: URL[] = [];
  const p = new LrclibProvider("https://lyrics.invalid", async (url) => { calls.push(new URL(String(url))); return Response.json(original); });
  const [a, b] = await Promise.all([p.get(JP, "神宿", { duration: 246, album: "mock single" }), p.get(JP, "神宿", { duration: 246, album: "mock single" })]);
  assert.equal(a, b);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].searchParams.get("duration"), "246");
  assert.equal(calls[0].searchParams.get("album_name"), "mock single");
  assert.equal(a[0].syncedLyrics, LRC);
  await assert.rejects(p.get(JP, "神宿", { duration: NaN }), (e) => e instanceof LyricsApiError && e.kind === "client");
  assert.equal(calls.length, 1);
});
test("get 404 is a scoped miss, not a network error or proof of global absence", async () => {
  const p = new LrclibProvider("https://lyrics.invalid", async () => Response.json({}, { status: 404 }));
  assert.deepEqual(await p.get(JP, "神宿"), []);
});
for (const [name, response, kind] of [
  ["rate limit", () => new Response("", { status: 429 }), "rate-limit"],
  ["server", () => new Response("", { status: 503 }), "server"],
  ["invalid JSON", () => new Response("<html>"), "invalid"],
  ["wrong get shape", () => Response.json([]), "invalid"],
] as const) test(`get preserves ${name} error classification`, async () => {
  const p = new LrclibProvider("https://lyrics.invalid", async () => response());
  await assert.rejects(p.get(JP, "神宿"), (e) => e instanceof LyricsApiError && e.kind === kind);
});
for (const mode of ["empty", "no-lyrics"] as const) test(`${mode}: bounded, diagnosed miss; manual lyrics/LRC fallback stays available`, async () => {
  const calls: URL[] = [];
  const { entry } = await resolveLyricsDetailed(input(), new LrclibProvider("https://lyrics.invalid", discoveryFetch(mode, calls)));
  assert.equal(entry.outcome, "not-found");
  assert.equal(entry.discovery?.withLyrics, 0);
  assert.equal(Boolean(entry.discovery?.records), mode === "no-lyrics");
  assert.ok(calls.length <= MAX_TOTAL_REQUESTS);
  assert.equal(new Set(calls.map(String)).size, calls.length);
  const status = describeStatus({ entry, searching: false, error: null, ownSynced: false, enabled: true });
  assert.match(status.text, /현재 연결된 가사 제공자/);
  assert.ok(status.notes.some((n) => n.includes("직접 입력")));
  assert.equal(entry.lines.length, 0);
});
test("a returned but wrong-artist candidate is distinguished from absent provider data", async () => {
  const p = new LrclibProvider("https://lyrics.invalid", async (url) => new URL(String(url)).pathname === "/api/get" ? Response.json({}, { status: 404 }) : Response.json([{ ...original, artistName: "Unrelated Artist ZZZ" }]));
  const { entry } = await resolveLyricsDetailed(input(), p);
  assert.notEqual(entry.outcome, "synced");
  assert.equal(entry.discovery?.withLyrics, 1);
  assert.equal(entry.candidate, undefined);
});
test("partial failures never become an authoritative absence or sticky negative cache", async () => {
  let calls = 0;
  const p = new LrclibProvider("https://lyrics.invalid", async () => ++calls === 1 ? Response.json([]) : new Response("", { status: 503 }));
  const { entry } = await resolveLyricsDetailed(input(), p);
  assert.equal(entry.outcome, "not-found");
  assert.equal(entry.discovery?.failures, 1);
  assert.ok(entry.warnings.some((w) => w.includes("단정")));
  assert.equal(isExpired(entry), true);
  assert.equal(calls, 2);
});
test("plain-only provider response stays plain; original/live 246/251-second recordings remain distinct", async () => {
  const plain = await resolveLyricsDetailed(input(), new LrclibProvider("https://lyrics.invalid", async () => Response.json([{ ...original, syncedLyrics: null }])));
  assert.equal(plain.entry.outcome, "lyrics-only");
  assert.ok(parseLyrics(buildResolvedLyrics(plain.entry, "mr", "")).every((l) => l.time === null));
  const onlyLive = await resolveLyricsDetailed(input(), new LrclibProvider("https://lyrics.invalid", discoveryFetch("live", [])));
  assert.equal(onlyLive.entry.outcome, "needs-choice");
  assert.equal(onlyLive.entry.lines.length, 0);
  const both = await resolveLyricsDetailed(input(), new LrclibProvider("https://lyrics.invalid", discoveryFetch("both", [])));
  assert.equal(both.entry.candidate?.duration, 246);
  assert.equal(both.pool.length, 2);
});
test("legacy negative cache is refreshed, positive v2 cache and video warp remain usable", async () => {
  const { entry } = await resolveLyricsDetailed(input(), new LrclibProvider("https://lyrics.invalid", discoveryFetch("both", [])));
  assert.equal(isExpired(entry), false);
  assert.equal(isExpired({ ...entry, outcome: "not-found", searchRevision: undefined }), true);
  entry.warps["mr"] = { offset: 3, ratio: 1 };
  const lines = parseLyrics(buildResolvedLyrics(entry, "mr", ""));
  const live = buildLiveLyrics(lines, findCurrentLyricIndex(lines, 23));
  assert.deepEqual(live.times, [13, 23]);
  assert.equal(clockedLineIndex({ ...live, synced: true, pos: 23, rate: 1, playback: "paused" }, 1000, 1000), 1);
});
test("original Song/aliases/MR/LRC still round-trip through the existing backup format", () => {
  const song: Song = { id: "mock", ownerId: "owner", title: JP, artist: "神宿", titleAliases: [ROM, KO], artistAliases: ["Kamiyado"], lyrics: LRC, youtubeVideoId: "mock-video", tags: [], favorite: false, createdAt: "", updatedAt: "" };
  const encoded = songsToJSON([song]);
  const decoded = parseSongsJSON(encoded).valid;
  assert.equal(decoded[0].title, JP);
  assert.equal(decoded[0].lyrics, LRC);
  assert.equal(decoded[0].youtubeVideoId, "mock-video");
  assert.deepEqual(decoded[0].titleAliases, [ROM, KO]);
});
test("unseeded romanized title is discovered through registered MusicBrainz aliases, not guessed transliteration", async () => {
  const calls: URL[] = [];
  const metadata = new MusicBrainzAliasProvider("https://metadata.invalid", async (target) => {
    const url = new URL(String(target));
    calls.push(url);
    if (url.pathname.endsWith("/artist")) return Response.json({ artists: [{ id: "artist-a", name: "架空歌手", score: 100, aliases: [{ name: "Mock Artist" }] }] });
    return Response.json({ recordings: [
      { id: "record-a", title: "未登録の原語曲", aliases: [{ name: "Unknown Roman Name" }], "artist-credit": [{ artist: { id: "artist-a" } }], releases: [{ title: "Not A Song Alias" }] },
      { id: "live-a", title: "未登録の原語曲 (Live)", aliases: [{ name: "Unknown Roman Name" }], "artist-credit": [{ artist: { id: "artist-a" } }] },
      { id: "wrong-a", title: "Other Work", aliases: [{ name: "Unknown Roman Name" }], "artist-credit": [{ artist: { id: "other-artist" } }] },
    ] });
  });
  const fetchLyrics: typeof fetch = async (target) => {
    const url = new URL(String(target));
    if (url.searchParams.get("track_name") === "未登録の原語曲" && url.searchParams.get("artist_name") === "架空歌手") return Response.json([{ ...original, trackName: "未登録の原語曲", artistName: "架空歌手" }]);
    return url.pathname === "/api/get" ? Response.json({}, { status: 404 }) : Response.json([]);
  };
  const noAlias = await resolveLyricsDetailed(input("Unknown Roman Name", "Mock Artist"), new LrclibProvider("https://lyrics.invalid", fetchLyrics));
  assert.equal(noAlias.entry.outcome, "not-found");
  const found = await resolveLyricsDetailed(input("Unknown Roman Name", "Mock Artist"), new LrclibProvider("https://lyrics.invalid", fetchLyrics), { aliasProvider: metadata });
  assert.equal(found.entry.outcome, "synced");
  assert.equal(found.entry.candidate?.title, "未登録の原語曲");
  const aliases = await metadata.lookup("Unknown Roman Name", "Mock Artist");
  assert.ok(!aliases.titles.includes("Not A Song Alias"));
  assert.ok(!aliases.titles.includes("Other Work"));
  assert.ok(!aliases.titles.some((s) => s.includes("Live")));
  assert.ok(calls[0].searchParams.get("query")?.includes("alias:"));
});
test("English punctuation/spacing and free-text fallback work without a seed entry", async () => {
  const calls: URL[] = [];
  const p = new LrclibProvider("https://lyrics.invalid", async (target) => {
    const url = new URL(String(target));
    calls.push(url);
    if (url.searchParams.get("q") === "Dont Stop Mock Singer") return Response.json([{ ...original, trackName: "Don't Stop", artistName: "Mock Singer" }]);
    return url.pathname === "/api/get" ? Response.json({}, { status: 404 }) : Response.json([]);
  });
  const { entry } = await resolveLyricsDetailed(input("Don't　Stop!", "Mock Singer"), p);
  assert.equal(entry.outcome, "synced");
  assert.ok(calls.some((u) => u.searchParams.get("q") === "Dont Stop Mock Singer"));
  assert.ok(calls.length <= MAX_TOTAL_REQUESTS);
});
test("a cancelled caller on a shared/cached request does not cancel another caller or silently succeed", async () => {
  let complete!: (value: Response) => void;
  let calls = 0;
  const p = new LrclibProvider("https://lyrics.invalid", async () => { calls++; return new Promise<Response>((resolve) => { complete = resolve; }); });
  const first = p.search(JP, "神宿");
  const abort = new AbortController();
  const second = p.search(JP, "神宿", abort.signal);
  abort.abort();
  await assert.rejects(second, (e) => e instanceof DOMException && e.name === "AbortError");
  complete(Response.json([original]));
  assert.equal((await first).length, 1);
  await assert.rejects(p.search(JP, "神宿", abort.signal), (e) => e instanceof DOMException && e.name === "AbortError");
  await assert.rejects(p.search("new uncached title", "神宿", abort.signal), (e) => e instanceof DOMException && e.name === "AbortError");
  assert.equal(calls, 1);
});
test("empty query does not trigger provider requests or invent absence evidence", async () => {
  const result = await searchCandidates({ name: "mock", search: async () => assert.fail("must not query empty title") }, { title: "", artist: "" });
  assert.equal(result.diagnostics.requests, 0);
});

for (const canSave of [true, false]) test(`manual input link is available only to song editors: ${canSave}`, async () => {
  const { entry } = await resolveLyricsDetailed(input(), { name: "empty", search: async () => [] });
  const auto = { entry, rawSong: { id: "mock-song", ownerId: "owner", title: JP }, canSave, ownSynced: false, enabled: true,
    searching: false, error: null, applied: false, warp: { offset: 0, ratio: 1 }, candidates: [] } as unknown as ReturnType<typeof useAutoLyrics>;
  const html = renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(AutoLyricsBar, { auto, currentTime: 0, mrDuration: 0 })));
  assert.equal(html.includes('href="/books/owner/songs/mock-song/edit"'), canSave);
  assert.ok(html.includes("LRC"));
});
test("bounded incomplete searches retry after a short cooldown, not the legacy 24-hour negative TTL", async () => {
  const { entry } = await resolveLyricsDetailed(input(), new LrclibProvider("https://lyrics.invalid", discoveryFetch("empty", [])), { now: () => 1000 });
  const partial = { ...entry, discovery: { ...entry.discovery!, budgetExhausted: true } };
  assert.equal(isExpired(partial, 2000), false);
  assert.equal(isExpired(partial, 62_000), true);
});

test("MusicBrainz failure is distinct from no registered alias and is not cached as permanent absence", async () => {
  let calls = 0;
  const metadata = new MusicBrainzAliasProvider("https://metadata.invalid", async () => { calls++; return new Response("", { status: 503 }); });
  const { entry } = await resolveLyricsDetailed(input("unknown song", "unknown artist"), { name: "empty", search: async () => [] }, { aliasProvider: metadata });
  assert.equal(entry.discovery?.failures, 1);
  assert.equal(isExpired(entry), true);
  await metadata.lookup("unknown song", "unknown artist");
  assert.equal(calls, 2);
});

test("legacy bracket-stripped search remains reachable while the requested Live gate stays intact", async () => {
  assert.ok(lyricsQueryVariants("Offline Song (Live)").includes("Offline Song"));
  const { entry } = await resolveLyricsDetailed(input("Offline Song (Live)", "Mock Singer"), {
    name: "mock", search: async (title) => title === "Offline Song" ? [{ id: "mock-live", source: "mock", title: "Offline Song (Live)", artist: "Mock Singer", syncedLyrics: LRC }] : [],
  });
  assert.equal(entry.outcome, "synced");
  assert.equal(entry.candidate?.id, "mock-live");
});
