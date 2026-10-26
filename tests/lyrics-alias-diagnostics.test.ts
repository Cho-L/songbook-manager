import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { LrclibProvider } from "../src/lyrics/providers/lrclib.ts";
import { MusicBrainzAliasProvider } from "../src/lyrics/providers/musicbrainz.ts";
import { getSongAliases } from "../src/utils/songAliases.ts";
import { resolveLyricsDetailed } from "../src/lyrics/pipeline.ts";
import { searchRecordingLyrics } from "../src/lyrics/recordingSearch.ts";
import { prioritizeArtistAliases, searchCandidates, MAX_TOTAL_REQUESTS } from "../src/lyrics/searchPlan.ts";
import { describeStatus } from "../src/hooks/useAutoLyrics.ts";
import { LyricsSearchDiagnostics } from "../src/components/song/LyricsSearchDiagnostics.tsx";
import { RecordingLyricsFeedback } from "../src/components/song/RecordingLyricsFeedback.tsx";
import type { LyricsRequestDiagnostic } from "../src/lyrics/types.ts";
import { JP, BARE, KO, ROM, original } from "./fixtures/lyricsDiscovery.ts";

const originalFetch = globalThis.fetch;
const originalReact = Object.getOwnPropertyDescriptor(globalThis, "React");
let realCalls = 0;
before(() => {
  Object.defineProperty(globalThis, "React", { configurable: true, value: React });
  globalThis.fetch = async () => { realCalls++; throw Error("real network forbidden"); };
});
after(() => {
  globalThis.fetch = originalFetch;
  if (originalReact) Object.defineProperty(globalThis, "React", originalReact); else Reflect.deleteProperty(globalThis, "React");
  assert.equal(realCalls, 0);
});
function input(title = JP, artist = "神宿") {
  const aliases = getSongAliases({ title, artist });
  return { songId: "mock", title, artist, ownLyrics: "", titleAliases: aliases.titles, artistAliases: aliases.artists };
}
function mb() {
  return new MusicBrainzAliasProvider("https://metadata.invalid", async (target) => {
    const u = new URL(String(target));
    return Response.json(u.pathname.endsWith("/artist") ? { artists: [{ id: "mock-mbid", name: "神宿", score: 100,
      aliases: ["かみやど", "Kamiyado", "KMYD", "ＫＭＹＤ", "카미야도"].map(name => ({ name })) }] } : { recordings: [], "recording-count": 0 });
  });
}
for (const [title, artist] of [[JP, "神宿"], [BARE, "神宿"], [KO, "카미야도"], [JP, "Kamiyado"], [ROM, "Kamiyado"]]) {
  test(`fourth MusicBrainz alias KMYD actually discovers ${title} / ${artist}`, async () => {
    const calls: URL[] = [], diagnostics: LyricsRequestDiagnostic[] = [];
    const p = new LrclibProvider("https://lyrics.invalid", async (target) => {
      const u = new URL(String(target)); calls.push(u);
      return u.pathname.endsWith("/get") ? Response.json({}, { status: 404 }) : Response.json(u.searchParams.get("artist_name") === "KMYD" ? [{ ...original, artistName: "KMYD" }] : []);
    });
    const { entry } = await resolveLyricsDetailed(input(title, artist), p, { aliasProvider: mb(), observe: d => diagnostics.push(d) });
    assert.equal(entry.outcome, "synced");
    assert.equal(entry.candidate?.artist, "KMYD");
    assert.deepEqual(entry.lines.map(l => l.time), [10, 20]);
    assert.ok(calls.length <= MAX_TOTAL_REQUESTS);
    assert.equal(new Set(calls.map(String)).size, calls.length);
    assert.ok(diagnostics.some(d => d.artist === "KMYD" && d.httpStatus === 200 && d.records === 1));
    assert.equal(JSON.stringify(entry).includes('"endpoint"'), false, "request traces must not enter persistent cache entries");
  });
}
test("alias priority keeps late acronyms eligible, dedupes equivalent spellings and preserves all unique aliases", () => {
  const aliases = ["神宿", "かみやど", ...Array.from({ length: 20 }, (_, i) => `Alternate Name ${i}`), "KMYD", "ＫＭＹＤ", "kmyd", "Kamiyado"];
  const ranked = prioritizeArtistAliases(aliases);
  assert.ok(ranked.indexOf("KMYD") >= 0 && ranked.indexOf("KMYD") < 3);
  assert.equal(ranked.filter(a => a.normalize("NFKC").toLowerCase() === "kmyd").length, 1);
  assert.ok(ranked.includes("Alternate Name 19"));
  assert.ok(ranked.includes("Kamiyado"));
});
test("many confirmed aliases retain the global request limit and explicit incomplete status", async () => {
  const calls: string[] = [];
  const result = await searchCandidates({ name: "mock", search: async (t, a) => { calls.push(`${t}|${a}`); return []; } },
    { title: JP, artist: "神宿", artistAliases: Array.from({ length: 50 }, (_, i) => `Alias ${i}`) });
  assert.equal(calls.length, MAX_TOTAL_REQUESTS);
  assert.equal(new Set(calls).size, calls.length);
  assert.equal(result.budgetExhausted, true);
});
for (const version of ["Live", "Cover", "MR", "ライブ", "カバー", "伴奏"]) {
  test(`expanded KMYD aliases cannot override original/${version} safety`, async () => {
    const p = new LrclibProvider("https://lyrics.invalid", async target => {
      const u = new URL(String(target));
      return u.pathname.endsWith("/get") ? Response.json({}, { status: 404 }) : Response.json(u.searchParams.get("artist_name") === "KMYD" ? [{ ...original, trackName: `${JP} (${version})`, artistName: "KMYD" }] : []);
    });
    const { entry } = await resolveLyricsDetailed(input(), p, { aliasProvider: mb() });
    assert.equal(entry.outcome, "needs-choice");
    assert.equal(entry.lines.length, 0);
  });
}
for (const status of [403, 429, 503]) {
  test(`recording search HTTP ${status} is failure, never an empty-result message`, async () => {
    const trace: LyricsRequestDiagnostic[] = [];
    const { result } = await searchRecordingLyrics(input(), new LrclibProvider("https://lyrics.invalid", async () => new Response("private error payload", { status })), d => trace.push(d));
    assert.equal(result.status, "failed");
    assert.equal(trace[0].httpStatus, status);
    assert.equal(trace[0].outcome, "error");
    const html = renderToStaticMarkup(createElement(RecordingLyricsFeedback, { result }));
    assert.match(html, /rec-failed/);
    assert.doesNotMatch(html, /rec-empty|검색한 표기에서 사용할 가사 후보/);
    assert.doesNotMatch(JSON.stringify(trace), /private error payload/);
  });
}
test("network/CORS-like failure has no HTTP status and stays distinct from empty", async () => {
  const trace: LyricsRequestDiagnostic[] = [];
  const { result } = await searchRecordingLyrics(input(), new LrclibProvider("https://lyrics.invalid", async () => { throw new TypeError("secret URL or account data"); }), d => trace.push(d));
  assert.equal(result.status, "failed");
  assert.equal(trace[0].errorKind, "network");
  assert.equal(trace[0].httpStatus, undefined);
  assert.doesNotMatch(JSON.stringify(trace), /secret URL or account data/);
});
test("completed empty response, partial HTTP failure and request budget remain distinct", async () => {
  const empty = await searchRecordingLyrics({ songId: "mock", title: JP, artist: "神宿", ownLyrics: "" }, { name: "mock", search: async () => [] });
  assert.equal(empty.result.status, "empty");
  assert.match(renderToStaticMarkup(createElement(RecordingLyricsFeedback, { result: empty.result })), /rec-empty/);
  let n = 0;
  const p = new LrclibProvider("https://lyrics.invalid", async () => ++n === 1 ? Response.json([]) : new Response("", { status: 503 }));
  const partial = await searchRecordingLyrics(input(), p);
  assert.equal(partial.result.status, "incomplete");
  assert.match(partial.result.message!, /실패/);
  const { entry } = await resolveLyricsDetailed(input(), new LrclibProvider("https://lyrics.invalid", async () => ++n === 3 ? Response.json([]) : new Response("", { status: 503 })));
  assert.equal(describeStatus({ entry, searching: false, error: null, ownSynced: false, enabled: true }).kind, "failed");
});
test("get 404, HTTP 200 empty/records and shared cache have explicit diagnostic outcomes", async () => {
  const trace: LyricsRequestDiagnostic[] = [];
  let n = 0;
  const p = new LrclibProvider("https://lyrics.invalid", async target => {
    n++; return new URL(String(target)).pathname.endsWith("/get") ? Response.json({}, { status: 404 }) : Response.json([original]);
  });
  await p.get(JP, "神宿", {}, undefined, d => trace.push(d));
  await p.search(JP, "神宿", undefined, d => trace.push(d));
  await p.search(JP, "神宿", undefined, d => trace.push(d));
  assert.deepEqual(trace.map(d => [d.httpStatus, d.outcome, d.cached]), [[404, "not-found", false], [200, "results", false], [200, "results", true]]);
  assert.equal(n, 2);
  assert.doesNotMatch(JSON.stringify(trace), /synthetic alpha|syncedLyrics|plainLyrics/);
});
test("diagnostics redact email/URL/tokens and never expose data while disabled", async () => {
  const trace: LyricsRequestDiagnostic[] = [];
  const p = new LrclibProvider("https://lyrics.invalid", async () => Response.json([]));
  await p.search("Song https://private.invalid/key owner@example.invalid", "a".repeat(48), undefined, d => trace.push(d));
  const json = JSON.stringify(trace);
  assert.doesNotMatch(json, /private\.invalid|owner@|a{48}/);
  assert.match(json, /redacted/);
  const hidden = renderToStaticMarkup(createElement(LyricsSearchDiagnostics, { enabled: false, requests: trace, onToggle: () => {} }));
  assert.doesNotMatch(hidden, /HTTP 200|Song|候補/);
  const shown = renderToStaticMarkup(createElement(LyricsSearchDiagnostics, { enabled: true, requests: trace, onToggle: () => {} }));
  assert.match(shown, /HTTP 200|후보 0개/);
});
test("diagnostic consumer failure cannot turn a successful request into API failure", async () => {
  const p = new LrclibProvider("https://lyrics.invalid", async () => Response.json([original]));
  assert.equal((await p.search(JP, "神宿", undefined, () => { throw Error("consumer failed"); })).length, 1);
});
