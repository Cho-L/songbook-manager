import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { lyricsVersionKey, lyricsVersionsMatch } from "../src/lyrics/versions.ts";
import { scoreCandidate, isAutoAccept, dedupeCandidates } from "../src/lyrics/matching.ts";
import { resolveLyricsDetailed, entryKeys, isEntryValid, buildResolvedLyrics } from "../src/lyrics/pipeline.ts";
import { normalizeTitle, hashText } from "../src/lyrics/text.ts";
import { getSongAliases } from "../src/utils/songAliases.ts";
import { parseLyrics } from "../src/utils/lyrics.ts";
import type { LyricsCandidate, LyricsProvider, SyncEntry } from "../src/lyrics/types.ts";

// PR #8 / 7de3199 audit cases, converted to safe expectations on latest main.
// Synthetic provider data only: no real APIs, account data or copied lyrics.
const originalFetch = globalThis.fetch;
let networkAttempts = 0;
before(() => { globalThis.fetch = async () => { networkAttempts++; throw new Error("network forbidden"); }; });
after(() => { globalThis.fetch = originalFetch; assert.equal(networkAttempts, 0); });
const candidate = (patch: Partial<LyricsCandidate> = {}): LyricsCandidate => ({
  id: "offline", title: "Offline Song", artist: "Mock Singer", source: "mock", duration: 180,
  syncedLyrics: "[00:10.00] synthetic alpha\n[00:20.00] synthetic beta", ...patch,
});
const input = (title = "Offline Song", artist = "Mock Singer") => ({ songId: "mock-song", title, artist, ownLyrics: "" });
const provider = (records: LyricsCandidate[]): LyricsProvider => ({ name: "mock", search: async () => records, searchQuery: async () => records });

for (const version of ["Live", "Cover", "MR", "ライブ", "カバー", "伴奏", "라이브", "커버", "반주", "Acoustic", "Remix", "Radio Edit", "2020 Remaster", "Piano Version"]) {
  for (const reverse of [false, true]) test(`version gate blocks ${reverse ? "version -> original" : "original -> version"}: ${version}`, async () => {
    const title = `Offline Song (${version})`;
    const song = input(reverse ? title : "Offline Song");
    const c = candidate({ title: reverse ? "Offline Song" : title });
    const scored = scoreCandidate(song, c);
    assert.equal(scored.versionMismatch, true);
    assert.equal(isAutoAccept(scored, true), false);
    assert.notEqual(scored.evidence?.level, "high");
    const { entry } = await resolveLyricsDetailed(song, provider([c]));
    assert.equal(entry.outcome, "needs-choice");
    assert.equal(entry.lines.length, 0);
    assert.equal(entry.candidate, undefined);
    assert.equal(entry.options?.[0].id, c.id);
  });
}
for (const [a, b] of [["Radio Edit", "Remaster"], ["Live", "Cover"], ["Cover", "MR"], ["MR", "ライブ"], ["Live Cover", "Live"], ["Live at Tokyo 2020", "Live at Osaka 2024"]]) {
  test(`different version categories/recording qualifiers require choice: ${a} / ${b}`, async () => {
    const { entry } = await resolveLyricsDetailed(input(`Offline Song (${a})`), provider([candidate({ title: `Offline Song (${b})` })]));
    assert.equal(entry.outcome, "needs-choice");
    assert.equal(entry.lines.length, 0);
  });
}
for (const [a, b] of [["Live", "ライブ"], ["Cover", "カバー"], ["MR", "伴奏"], ["Instrumental", "Off Vocal"], ["Live ver.", "라이브"]]) {
  test(`explicit compatible version labels retain normal sync: ${a} / ${b}`, async () => {
    assert.equal(lyricsVersionsMatch(`Offline Song (${a})`, `Offline Song (${b})`), true);
    const { entry } = await resolveLyricsDetailed(input(`Offline Song (${a})`), provider([candidate({ title: `Offline Song (${b})` })]));
    assert.equal(entry.outcome, "synced");
    assert.deepEqual(entry.lines.map((l) => l.time), [10, 20]);
  });
}
test("matching original remains original, generic/qualified versions stay conservative", () => {
  assert.equal(lyricsVersionsMatch("Song", "Song (Original Version)"), true);
  assert.equal(lyricsVersionsMatch("Song", "Song (Original Piano Version)"), false);
  assert.equal(lyricsVersionsMatch("Song (Piano Version)", "Song (Orchestra Version)"), false);
  assert.equal(lyricsVersionsMatch("Song - Live at Tokyo", "Song - Live at Osaka"), false);
  assert.equal(lyricsVersionKey("Song - Live"), lyricsVersionKey("Song (ライブ)"));
});
test("title aliases cannot bypass the actual requested version gate", async () => {
  const { entry } = await resolveLyricsDetailed({ ...input(), titleAliases: ["Offline Song (Cover)"] }, provider([candidate({ title: "Offline Song (Cover)" })]));
  assert.equal(entry.outcome, "needs-choice");
  assert.equal(entry.lines.length, 0);
});
test("matching original wins over high-scoring incompatible version", async () => {
  const { entry } = await resolveLyricsDetailed(input(), provider([candidate({ id: "live", title: "Offline Song (Live)" }), candidate()]));
  assert.equal(entry.outcome, "synced");
  assert.equal(entry.candidate?.id, "offline");
});
test("explicit user choice still applies a previewed mismatched version without refetch or fabricated timing", async () => {
  const p = provider([candidate({ title: "Offline Song (Cover)" })]);
  const first = await resolveLyricsDetailed(input(), p);
  assert.equal(first.entry.outcome, "needs-choice");
  const noFetch: LyricsProvider = { name: "must-not-fetch", search: async () => assert.fail("must reuse preview pool") };
  const chosen = await resolveLyricsDetailed(input(), noFetch, { pool: first.pool, candidateId: "offline" });
  assert.equal(chosen.entry.outcome, "synced");
  assert.deepEqual(chosen.entry.lines.map((l) => l.time), [10, 20]);
  assert.ok(chosen.entry.warnings.length > 0);
});
test("dedupe preserves different provider IDs, durations, versions, sources and recording contents", () => {
  const records = [candidate(), candidate({ id: "other-recording" }), candidate({ duration: 300 }),
    candidate({ title: "Offline Song (Live)" }), candidate({ source: "other-provider" }),
    candidate({ syncedLyrics: "[00:15.00] synthetic alpha\n[00:25.00] synthetic beta" })];
  assert.deepEqual(dedupeCandidates(records), records);
  assert.deepEqual(dedupeCandidates([records[0], { ...records[0] }, ...records.slice(1)]), records);
});
test("near-equal recordings remain distinct options and never silently pick the first", async () => {
  const records = [candidate(), candidate({ id: "longer", duration: 300 })];
  const first = await resolveLyricsDetailed(input(), provider(records));
  assert.equal(first.entry.outcome, "needs-choice");
  assert.deepEqual(first.entry.options?.map((o) => [o.id, o.duration]), [["offline", 180], ["longer", 300]]);
  const chosen = await resolveLyricsDetailed(input(), provider([]), { candidateId: "longer", pool: first.pool });
  assert.equal(chosen.entry.outcome, "synced");
  assert.equal(chosen.entry.candidate?.id, "longer");
});
test("identical repeat observation is deduped without turning an exact match into ambiguity", async () => {
  const first = await resolveLyricsDetailed(input(), provider([candidate(), candidate()]));
  assert.equal(first.entry.outcome, "synced");
});
for (const [title, artist] of [["밤을 달리다", "요아소비"], ["夜に駆ける", "ヨアソビ"], ["Yoru ni Kakeru", "YOASOBI"], ["Racing into the Night", "YOASOBI"]]) {
  test(`existing multilingual aliases retain correct original sync: ${title}`, async () => {
    const aliases = getSongAliases({ title, artist });
    const { entry } = await resolveLyricsDetailed({ ...input(title, artist), titleAliases: aliases.titles, artistAliases: aliases.artists }, provider([candidate({ title: "夜に駆ける", artist: "YOASOBI" })]));
    assert.equal(entry.outcome, "synced");
  });
}
test("wrong artist and plain unsynced lyrics keep existing safety behavior", async () => {
  const wrong = await resolveLyricsDetailed(input(), provider([candidate({ artist: "Unrelated Artist ZZZ" })]));
  assert.notEqual(wrong.entry.outcome, "synced");
  const plain = await resolveLyricsDetailed(input(), provider([candidate({ syncedLyrics: undefined, plainLyrics: "synthetic alpha\nsynthetic beta" })]));
  assert.equal(plain.entry.outcome, "lyrics-only");
  assert.equal(plain.entry.lines.length, 0);
});
test("version/qualifier title changes invalidate cached automatic lyrics in both directions", async () => {
  const { entry } = await resolveLyricsDetailed(input(), provider([candidate()]));
  assert.equal(isEntryValid(entry, input()), true);
  for (const title of ["Offline Song (Live)", "Offline Song (Cover)", "Offline Song (ライブ)", "Offline Song (Live at Tokyo)"]) {
    assert.equal(isEntryValid(entry, input(title)), false);
    assert.notDeepEqual(entryKeys(input()), entryKeys(input(title)));
  }
  const { entry: live } = await resolveLyricsDetailed(input("Offline Song (Live)"), provider([candidate({ title: "Offline Song (Live)" })]));
  assert.equal(isEntryValid(live, input()), false);
  assert.equal(isEntryValid(live, input("Offline Song (Live at Osaka)")), false);
});
test("legacy v1 policy cache is rejected even if old title normalization matches", async () => {
  const { entry } = await resolveLyricsDetailed(input(), provider([candidate()]));
  const legacy: SyncEntry = { ...entry, titleKey: normalizeTitle(input().title), artistKey: normalizeTitle(input().artist), lyricsHash: hashText("") };
  assert.equal(isEntryValid(legacy, input()), false);
  assert.equal(isEntryValid(legacy, input("Offline Song (Live)")), false);
});
test("new cache preserves harmless case/fullwidth normalization and existing per-video warp output", async () => {
  const { entry } = await resolveLyricsDetailed(input(), provider([candidate()]));
  assert.equal(isEntryValid(entry, input("ＯＦＦＬＩＮＥ ＳＯＮＧ")), true);
  entry.warps["video-a"] = { offset: 3, ratio: 1.1 };
  assert.equal(parseLyrics(buildResolvedLyrics(entry, "video-a", ""))[0].time, 14);
  assert.equal(parseLyrics(buildResolvedLyrics(entry, "video-b", ""))[0].time, 10);
});

test("timestamps alone cannot choose between different recordings with identical title/artist evidence", async () => {
  const records = [candidate(), candidate({ id: "plain-long", duration: 300, syncedLyrics: undefined, plainLyrics: "synthetic alpha\nsynthetic beta" })];
  const result = await resolveLyricsDetailed(input(), provider(records));
  assert.equal(result.entry.outcome, "needs-choice");
  assert.equal(result.entry.options?.length, 2);
  assert.equal(result.entry.lines.length, 0);
});
