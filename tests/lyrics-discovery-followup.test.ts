import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { lyricsVersionKey, lyricsVersionsMatch } from "../src/lyrics/versions.ts";
import { resolveLyricsDetailed, isEntryValid, buildResolvedLyrics } from "../src/lyrics/pipeline.ts";
import { LrclibProvider } from "../src/lyrics/providers/lrclib.ts";
import { isExpired } from "../src/lyrics/cache.ts";
import { MAX_TOTAL_REQUESTS } from "../src/lyrics/searchPlan.ts";
import { JP, LRC, original } from "./fixtures/lyricsDiscovery.ts";

const savedFetch = globalThis.fetch;
let networkAttempts = 0;
before(() => { globalThis.fetch = async () => { networkAttempts++; throw Error("network forbidden"); }; });
after(() => { globalThis.fetch = savedFetch; assert.equal(networkAttempts, 0); });
for (const [title, alias] of [["리브 포에버", "Live Forever"], ["커버 미", "Cover Me"], ["라이브 포에버", "Live Forever"]]) {
  test(`ordinary title word keeps confirmed multilingual original match: ${alias} / ${title}`, async () => {
    assert.equal(lyricsVersionKey(alias), "original");
    const record = { id: "mock", source: "mock", title: alias, artist: "Mock Singer", syncedLyrics: LRC };
    const { entry } = await resolveLyricsDetailed({ songId: "mock", title, artist: "Mock Singer", ownLyrics: "", titleAliases: [alias] }, { name: "mock", search: async () => [record] });
    assert.equal(entry.outcome, "synced");
    assert.deepEqual(entry.lines.map((l) => l.time), [10, 20]);
  });
}
for (const version of ["Live", "Cover", "MR", "ライブ", "カバー", "伴奏"]) {
  test(`ordinary Live title still blocks explicit ${version} in both directions`, () => {
    assert.equal(lyricsVersionsMatch("Live Forever", `Live Forever (${version})`), false);
    assert.equal(lyricsVersionsMatch(`Live Forever (${version})`, "Live Forever"), false);
  });
}
for (const title of ["Song Live", "Song - Live at Tokyo", "Song Live Tokyo", "Song ライブ", "Song Cover", "Song MR", "Song Piano Version", "Live in Tokyo"]) {
  test(`unbracketed version metadata remains conservative: ${title}`, () => {
    assert.notEqual(lyricsVersionKey(title), "original");
  });
}
for (const suffix of ["", " (Live)"]) {
  test(`duration-constrained get miss retries without duration, version gate retained: ${suffix || "original"}`, async () => {
    const calls: URL[] = [];
    const provider = new LrclibProvider("https://lyrics.invalid", async (target) => {
      const url = new URL(String(target)); calls.push(url);
      if (url.pathname !== "/api/get") return Response.json([]);
      if (url.searchParams.has("duration")) return Response.json({}, { status: 404 });
      return Response.json({ ...original, trackName: JP + suffix });
    });
    const { entry } = await resolveLyricsDetailed({ songId: "mock", title: JP, artist: "神宿", ownLyrics: "", referenceDuration: 250 }, provider);
    assert.equal(entry.outcome, suffix ? "needs-choice" : "synced");
    if (suffix) assert.equal(entry.lines.length, 0);
    assert.ok(calls.some((u) => u.pathname === "/api/get" && u.searchParams.get("duration") === "250"));
    assert.ok(calls.some((u) => u.pathname === "/api/get" && !u.searchParams.has("duration")));
    assert.ok(calls.length <= MAX_TOTAL_REQUESTS);
    assert.equal(new Set(calls.map(String)).size, calls.length);
  });
}
test("revision one positive cache retains warp; negative discovery is refreshed", async () => {
  const input = { songId: "mock", title: JP, artist: "神宿", ownLyrics: "" };
  const { entry } = await resolveLyricsDetailed(input, { name: "mock", search: async () => [{ id: "mock", source: "mock", title: JP, artist: "神宿", syncedLyrics: LRC }] });
  const previous = { ...entry, searchRevision: 1, warps: { mr: { offset: 3, ratio: 1.1 } } };
  assert.equal(isEntryValid(previous, input), true);
  assert.equal(isExpired(previous), false);
  assert.match(buildResolvedLyrics(previous, "mr", ""), /\[00:14\.00\]/);
  assert.equal(isExpired({ ...previous, outcome: "not-found" }), true);
});
for (const prefix of ["Live ", "Cover ", "MR ", "ライブ", "カバー", "伴奏"]) {
  test(`explicit leading version of the same title still blocked: ${prefix}`, () => {
    assert.equal(lyricsVersionsMatch(`${prefix}Song`, "Song"), false);
    assert.equal(lyricsVersionsMatch("Song", `${prefix}Song`), false);
  });
}
test("unbracketed live recording retains venue annotations", () => {
  assert.equal(lyricsVersionsMatch("Song (Tokyo) Live", "Song (Osaka) Live"), false);
});
