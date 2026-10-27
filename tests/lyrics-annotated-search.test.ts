import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { splitTranslatedName, lyricsVersionsMatch } from "../src/lyrics/versions.ts";
import { getSongAliases } from "../src/utils/songAliases.ts";
import { buildSearchPlan, MAX_TOTAL_REQUESTS } from "../src/lyrics/searchPlan.ts";
import { resolveLyricsDetailed, isEntryValid, buildResolvedLyrics } from "../src/lyrics/pipeline.ts";
import { LrclibProvider } from "../src/lyrics/providers/lrclib.ts";
import { MusicBrainzAliasProvider } from "../src/lyrics/providers/musicbrainz.ts";
import { searchRecordingLyrics } from "../src/lyrics/recordingSearch.ts";
import { isExpired } from "../src/lyrics/cache.ts";
import { LyricsSearchDiagnostics } from "../src/components/song/LyricsSearchDiagnostics.tsx";
import type { LyricsDiagnosticEvent, LyricsRequestDiagnostic } from "../src/lyrics/types.ts";
import { JP, BARE, KO, ROM, original, discoveryFetch } from "./fixtures/lyricsDiscovery.ts";

const originalFetch = globalThis.fetch;
const originalReact = Object.getOwnPropertyDescriptor(globalThis, "React");
let realRequests = 0;
before(() => {
  Object.defineProperty(globalThis, "React", { configurable: true, value: React });
  globalThis.fetch = async () => { realRequests++; throw Error("real network forbidden"); };
});
after(() => {
  globalThis.fetch = originalFetch;
  if (originalReact) Object.defineProperty(globalThis, "React", originalReact); else Reflect.deleteProperty(globalThis, "React");
  assert.equal(realRequests, 0);
});
const annotated = { songId: "mock-annotated", title: `${JP}(${KO})`, artist: "神宿(카미야도)", ownLyrics: "" };
const requests = (events: LyricsDiagnosticEvent[]) => events.filter((d): d is LyricsRequestDiagnostic => d.endpoint !== "plan");
for (const [title, artist] of [[annotated.title, annotated.artist], [`${JP}（${KO}）`, "神宿（카미야도）"], [`${JP} [${KO}]`, "神宿 [카미야도]"]]) {
  test(`split annotation before generating symbol variants: ${title}`, () => {
    assert.equal(splitTranslatedName(title).primary, JP);
    assert.deepEqual(splitTranslatedName(title).aliases, [KO]);
    assert.equal(splitTranslatedName(artist).primary, "神宿");
    const aliases = getSongAliases({ title, artist });
    assert.ok(aliases.titles.includes(ROM));
    assert.ok(aliases.artists.includes("Kamiyado"));
    assert.ok(aliases.artists.includes("KMYD"));
    const first = buildSearchPlan(title, artist).slice(0, 6);
    assert.deepEqual(first.map(s => [s.title, s.artist]), [[JP,"神宿"],[BARE,"神宿"],[JP,"Kamiyado"],[BARE,"Kamiyado"],[JP,"KMYD"],[BARE,"KMYD"]]);
    assert.equal(new Set(first.map(s => `${s.title}|${s.artist}`)).size, first.length);
  });
}
for (const annotation of ["Live", "Cover", "MR", "ライブ", "カバー", "伴奏", "라이브", "커버", "반주", "feat. Guest"]) {
  test(`recording/credit annotation is not a translation: ${annotation}`, () => {
    assert.equal(splitTranslatedName(`Song (${annotation})`).primary, `Song (${annotation})`);
    assert.deepEqual(splitTranslatedName(`Song (${annotation})`).aliases, []);
  });
}
for (const version of ["Live", "Cover", "MR", "ライブ", "カバー", "伴奏"]) {
  test(`translation removal retains ${version} safety and same-version compatibility`, () => {
    assert.equal(lyricsVersionsMatch(annotated.title, `${JP} (${version})`), false);
    assert.equal(lyricsVersionsMatch(`${annotated.title} (${version})`, JP), false);
    assert.equal(lyricsVersionsMatch(`${annotated.title} (${version})`, `${JP} (${version})`), true);
  });
}
test("real reported sequence 200 empty, 200 empty, 503 continues to KMYD without repeating a URL", async () => {
  const calls: URL[] = [], events: LyricsDiagnosticEvent[] = [];
  const p = new LrclibProvider("https://lyrics.invalid", async target => {
    const u = new URL(String(target)); calls.push(u);
    if (calls.length === 3) return new Response("synthetic upstream outage", { status: 503 });
    return Response.json(u.searchParams.get("artist_name") === "KMYD" ? [{ ...original, artistName: "KMYD" }] : []);
  });
  const { entry } = await resolveLyricsDetailed(annotated, p, { observe: d => events.push(d) });
  assert.equal(entry.outcome, "synced");
  assert.equal(entry.candidate?.artist, "KMYD");
  assert.equal(entry.discovery?.failures, 1);
  assert.equal(entry.discovery?.stopReason, "matched");
  assert.equal(calls.length, 5);
  assert.equal(new Set(calls.map(String)).size, calls.length);
  assert.ok(calls.every(u => !u.searchParams.get("track_name")?.includes(KO)));
  assert.deepEqual(requests(events).map(d => d.httpStatus), [200, 200, 503, 200, 200]);
  assert.deepEqual(entry.lines.map(l => l.time), [10,20]);
});
test("a recovered server error never bypasses a different-version gate", async () => {
  let n = 0;
  const p = new LrclibProvider("https://lyrics.invalid", async () => {
    n++;
    return n === 1 ? new Response("", { status: 503 }) : Response.json([{ ...original, trackName: `${JP} (Live)`, id: 101 }]);
  });
  const { entry } = await resolveLyricsDetailed(annotated, p);
  assert.equal(entry.outcome, "needs-choice");
  assert.equal(entry.lines.length, 0);
  assert.equal(n, 3);
  assert.equal(entry.discovery?.stopReason, "server-recovery-limit");
});
for (const statuses of [[503,503], [503,200,200], [503,200,429], [429], [401], [403]]) {
  test(`bounded continuation and explicit stop: ${statuses.join(",")}`, async () => {
    const events: LyricsDiagnosticEvent[] = [], calls: string[] = [];
    const p = new LrclibProvider("https://lyrics.invalid", async target => {
      calls.push(String(target));
      const status = statuses[calls.length - 1] ?? 200;
      return status === 200 ? Response.json([]) : new Response("", { status });
    });
    await searchRecordingLyrics(annotated, p, d => events.push(d));
    assert.equal(calls.length, statuses.length);
    assert.equal(new Set(calls).size, calls.length);
    const reason = statuses.includes(429) ? "rate-limit" : statuses.includes(401) || statuses.includes(403) ? "unauthorized" : statuses.at(-1) === 503 ? "server-error-limit" : "server-recovery-limit";
    const last = events.at(-1);
    assert.ok(last?.endpoint === "plan");
    assert.equal(last.stopReason, reason);
  });
}
test("network/CORS and malformed responses stop immediately, no guessed HTTP status", async () => {
  for (const mode of ["network", "invalid"] as const) {
    let n = 0;
    const events: LyricsDiagnosticEvent[] = [];
    const p = new LrclibProvider("https://lyrics.invalid", async () => {
      n++;
      if (mode === "network") throw new TypeError("private upstream detail");
      return new Response("not json", { status: 200 });
    });
    const { result } = await searchRecordingLyrics(annotated, p, d => events.push(d));
    assert.equal(result.status, "failed");
    assert.equal(n, 1);
    assert.equal(requests(events)[0].httpStatus, mode === "network" ? undefined : 200);
    const last = events.at(-1);
    assert.ok(last?.endpoint === "plan");
    assert.equal(last.stopReason, mode);
    assert.doesNotMatch(JSON.stringify(events), /private upstream detail|not json/);
  }
});
test("an error on request 14 cannot expand the request budget", async () => {
  const calls: string[] = [];
  const p = new LrclibProvider("https://lyrics.invalid", async target => {
    calls.push(String(target)); return calls.length === 14 ? new Response("", { status: 503 }) : new URL(String(target)).pathname.endsWith("/get") ? Response.json({}, { status: 404 }) : Response.json([]);
  });
  const { entry } = await resolveLyricsDetailed({ songId: "mock", title: "Mock Song", artist: "Mock Singer", artistAliases: Array.from({length:30},(_,i)=>`Artist ${i}`), ownLyrics: "" }, p);
  assert.equal(calls.length, MAX_TOTAL_REQUESTS);
  assert.equal(new Set(calls).size, calls.length);
  assert.equal(entry.discovery?.stopReason, "request-limit");
});
test("network, in-flight sharing and settled cache diagnostics are separate", async () => {
  let release!: (response: Response) => void;
  const events: LyricsDiagnosticEvent[] = [];
  const p = new LrclibProvider("https://lyrics.invalid", () => new Promise<Response>(r => { release = r; }));
  const a = p.search(JP, "神宿", undefined, d => events.push(d));
  const b = p.search(JP, "神宿", undefined, d => events.push(d));
  release(Response.json([original])); await Promise.all([a,b]);
  await p.search(JP, "神宿", undefined, d => events.push(d));
  assert.deepEqual(requests(events).map(d=>d.source), ["network","shared","cache"]);
  assert.equal(p.requestCount, 1);
  const html = renderToStaticMarkup(createElement(LyricsSearchDiagnostics, { enabled:true, requests:requests(events), stopReason:"server-recovery-limit", onToggle:()=>{} }));
  assert.match(html, /실제 네트워크 요청/);
  assert.match(html, /캐시 결과 \(이번 네트워크 요청 아님\)/);
  assert.match(html, /진행 중 요청 공유/);
  assert.match(html, /다른 조합 2개까지/);
  assert.doesNotMatch(html, /synthetic alpha|syncedLyrics/);
});
test("positive cache and existing per-video warp survive query normalization", async () => {
  const { entry } = await resolveLyricsDetailed(annotated, { name:"mock", search:async()=>[{id:"mock",source:"mock",title:JP,artist:"神宿",syncedLyrics:"[00:10.00] synthetic alpha\n[00:20.00] synthetic beta"}] });
  const old = {...entry,searchRevision:3,warps:{mr:{offset:3,ratio:1.1}}};
  assert.equal(isEntryValid(old,annotated),true);
  assert.equal(isExpired(old),false);
  assert.match(buildResolvedLyrics(old,"mr",""),/\[00:14\.00\]/);
});
test("unseeded MusicBrainz artist aliases still feed the search plan", async () => {
  let mbCalls = 0;
  const mb = new MusicBrainzAliasProvider("https://metadata.invalid", async target => {
    mbCalls++;
    return Response.json(new URL(String(target)).pathname.endsWith("/artist") ? {artists:[{id:"mock",name:"Mock Group",score:100,aliases:[{name:"別名"},{name:"Alternative Name"},{name:"ALTID"}]}]} : {recordings:[],"recording-count":0});
  });
  const p = new LrclibProvider("https://lyrics.invalid",async target => {
    const u = new URL(String(target));
    return Response.json(u.searchParams.get("artist_name")==="ALTID" ? [{...original,trackName:"Mock Song",artistName:"ALTID"}] : []);
  });
  const {entry}=await resolveLyricsDetailed({songId:"mock",title:"Mock Song",artist:"Mock Group",ownLyrics:""},p,{aliasProvider:mb});
  assert.equal(entry.outcome,"synced");
  assert.equal(entry.candidate?.artist,"ALTID");
  assert.ok(mbCalls > 0);
});

test("annotated title retains a distinct romanized query rather than spending alias slots on symbols", async () => {
  const calls: URL[] = [];
  const { entry } = await resolveLyricsDetailed(annotated, new LrclibProvider("https://lyrics.invalid", discoveryFetch("roman", calls)));
  assert.equal(entry.outcome, "synced");
  assert.equal(entry.candidate?.title, ROM);
  assert.ok(calls.length <= MAX_TOTAL_REQUESTS);
});

for (const prefix of ["Live", "Cover"]) test(`translated annotation cannot hide a leading ${prefix} version`, () => {
  assert.equal(lyricsVersionsMatch(`${prefix} Song(노래)`, "Song"), false);
  assert.equal(lyricsVersionsMatch("Song", `${prefix} Song(노래)`), false);
});

test("503 Retry-After cooldown stops rather than trying more combinations", async () => {
  let n = 0;
  const events: LyricsDiagnosticEvent[] = [];
  const { result } = await searchRecordingLyrics(annotated, new LrclibProvider("https://lyrics.invalid", async () => {
    n++; return new Response("", { status: 503, headers: { "Retry-After": "60" } });
  }), d => events.push(d));
  assert.equal(n, 1);
  assert.equal(result.status, "failed");
  const last = events.at(-1);
  assert.ok(last?.endpoint === "plan");
  assert.equal(last.stopReason, "retry-after");
});
