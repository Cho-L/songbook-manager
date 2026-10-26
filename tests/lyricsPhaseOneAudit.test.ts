import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { resolveLyricsDetailed, buildResolvedLyrics, getWarp, isEntryValid, entryKeys } from "../src/lyrics/pipeline.ts";
import { scoreCandidate, isAutoAccept, dedupeCandidates, alignPlainToSynced } from "../src/lyrics/matching.ts";
import { getSongAliases } from "../src/utils/songAliases.ts";
import { parseLrc } from "../src/lyrics/lrc.ts";
import { parseLyrics, findCurrentLyricIndex } from "../src/utils/lyrics.ts";
import { buildLiveLyrics } from "../src/utils/liveBroadcast.ts";
import { clockPos, clockedLineIndex, MAX_EXTRAPOLATE_SEC } from "../src/utils/liveClock.ts";
import { warpFromAnchors, applyWarp, compareDurations } from "../src/lyrics/warp.ts";
import { anchorOffset } from "../src/lyrics/lyricOffset.ts";
import { ProviderLyricsSynchronizer } from "../src/lyrics/synchronizers.ts";
import type { AliasProvider, LyricsCandidate, LyricsProvider } from "../src/lyrics/types.ts";

// Audit only. KNOWN GAP tests reproduce current defects; passing is NOT a safety fix.
// Synthetic lyrics are not user data or copied song lyrics. All providers are in-memory mocks.
const originalFetch = globalThis.fetch;
let networkAttempts = 0;
before(() => { globalThis.fetch = async () => { networkAttempts++; throw new Error("network forbidden in audit"); }; });
after(() => { globalThis.fetch = originalFetch; assert.equal(networkAttempts, 0); });
const candidate = (patch: Partial<LyricsCandidate> = {}): LyricsCandidate => ({
  id: "offline", title: "Offline Song", artist: "Mock Singer", source: "mock",
  duration: 180, syncedLyrics: "[00:10.00] synthetic alpha\n[00:20.00] synthetic beta", ...patch,
});
function provider(candidates: LyricsCandidate[]): LyricsProvider {
  return { name: "offline-only", search: async () => candidates, searchQuery: async () => candidates };
}
const input = (title = "Offline Song", artist = "Mock Singer") => ({ songId: "mock-song", title, artist, ownLyrics: "" });
for (const [title, artist] of [
  ["밤을 달리다", "요아소비"], ["夜に駆ける", "ヨアソビ"], ["Yoru ni Kakeru", "YOASOBI"], ["Racing into the Night", "YOASOBI"],
]) test(`existing verified aliases connect KO/JA/EN/romanized: ${title}`, async () => {
  const aliases = getSongAliases({ title, artist });
  const { entry } = await resolveLyricsDetailed({ ...input(title, artist), titleAliases: aliases.titles, artistAliases: aliases.artists }, provider([candidate({ title: "夜に駆ける", artist: "YOASOBI" })]));
  assert.equal(entry.outcome, "synced");
  assert.equal(entry.candidate?.title, "夜に駆ける");
});
test("unknown romanization is not invented; mock metadata can supply a verified original title", async () => {
  const c = candidate({ title: "踊り子", artist: "Vaundy" });
  const plain = await resolveLyricsDetailed(input("Odoriko", "Vaundy"), provider([c]));
  assert.notEqual(plain.entry.outcome, "synced");
  let lookups = 0;
  const aliasProvider: AliasProvider = { name: "mock-metadata", lookup: async () => { lookups++; return { titles: ["踊り子"], artists: ["Vaundy"] }; } };
  const linked = await resolveLyricsDetailed(input("Odoriko", "Vaundy"), provider([c]), { aliasProvider });
  assert.equal(lookups, 1);
  assert.equal(linked.entry.outcome, "synced");
});
test("artist-only cross-script evidence requires user choice, not invented title translation", async () => {
  const { entry } = await resolveLyricsDetailed({ ...input("무희", "바운디"), artistAliases: ["Vaundy"] }, provider([candidate({ title: "踊り子", artist: "Vaundy" })]));
  assert.equal(entry.outcome, "needs-choice");
  assert.equal(entry.lines.length, 0);
});
test("same title but different artist is not auto-accepted", async () => {
  const c = candidate({ artist: "Unrelated Artist ZZZ" });
  assert.equal(isAutoAccept(scoreCandidate(input(), c), true), false);
  const { entry } = await resolveLyricsDetailed(input(), provider([c]));
  assert.notEqual(entry.outcome, "synced");
});
test("title alias cannot override a different artist", () => {
  const c = candidate({ title: "Flower Way", artist: "Unrelated Artist ZZZ" });
  const scored = scoreCandidate(input("꽃길", "김세정"), c, { titles: ["Flower Way"], artists: ["Kim Sejeong"], trusted: true });
  assert.equal(isAutoAccept(scored, true), false);
});
for (const version of ["Live", "Cover", "MR", "ライブ", "カバー", "伴奏"]) {
  test(`[KNOWN GAP LYR-VERSION] ${version} candidate can still auto-apply to original`, async () => {
    const c = candidate({ title: `Offline Song (${version})` });
    const scored = scoreCandidate(input(), c);
    assert.equal(isAutoAccept(scored, true), true, "characterizes unsafe current behavior, not desired acceptance");
    const { entry } = await resolveLyricsDetailed(input(), provider([c]));
    assert.equal(entry.outcome, "synced");
    assert.equal(entry.candidate?.title, c.title);
  });
}
test("[KNOWN GAP LYR-REVERSE] requesting Live can auto-apply studio lyrics without a version warning", () => {
  const scored = scoreCandidate(input("Offline Song (Live)"), candidate());
  assert.equal(scored.versionMismatch, false);
  assert.equal(isAutoAccept(scored, true), true);
});
test("[KNOWN GAP LYR-DEDUPE] different recordings/durations collapse by title+artist", () => {
  const a = candidate({ id: "studio", duration: 180 });
  const b = candidate({ id: "extended", duration: 300 });
  const merged = dedupeCandidates([a, b]);
  assert.deepEqual(merged.map((c) => c.id), ["studio"]);
  assert.equal(compareDurations(a.duration, b.duration)?.similar, false);
});
test("[KNOWN GAP LYR-CACHE] version-only title changes can keep an old cache valid", async () => {
  const { entry } = await resolveLyricsDetailed(input(), provider([candidate()]));
  assert.equal(isEntryValid(entry, input("Offline Song (Live)")), true);
  assert.deepEqual(entryKeys(input()), entryKeys(input("Offline Song (Live)")));
});
test("plain lyrics produce no fabricated timestamps", async () => {
  const { entry } = await resolveLyricsDetailed(input(), provider([candidate({ syncedLyrics: undefined, plainLyrics: "synthetic alpha\nsynthetic beta" })]));
  assert.equal(entry.outcome, "lyrics-only");
  assert.equal(entry.lines.length, 0);
  assert.ok(parseLyrics(buildResolvedLyrics(entry, "video-a", "")).every((l) => l.time === null));
});
test("unmatched own lines stay untimed and low-coverage alignment is refused", async () => {
  const lines = alignPlainToSynced(["synthetic alpha", "unknown line", "synthetic beta"], parseLrc(candidate().syncedLyrics!));
  assert.equal(lines.lines[1].time, null);
  assert.equal(lines.lines[1].matched, false);
  const result = await new ProviderLyricsSynchronizer().synchronize({ title: "mock", artist: "mock", lyrics: "가나다라마\n완전히 다른 문장", syncedLyrics: candidate().syncedLyrics });
  assert.equal(result.status, "failed");
  assert.equal(result.lines.length, 0);
});
test("per-video warp stays isolated; user offset and LRC offset have opposite sign conventions", async () => {
  const { entry } = await resolveLyricsDetailed(input(), provider([candidate()]));
  entry.warps["video-a"] = { offset: 3, ratio: 1.1 };
  assert.deepEqual(getWarp(entry, "video-b"), { offset: 0, ratio: 1 });
  assert.equal(parseLyrics(buildResolvedLyrics(entry, "video-a", ""))[0].time, 14);
  assert.equal(parseLyrics(buildResolvedLyrics(entry, "video-b", ""))[0].time, 10);
  assert.equal(anchorOffset(10, 13), 3, "user positive offset delays display");
  assert.equal(parseLrc("[offset:1000]\n[00:10.00] synthetic alpha")[0].time, 9, "LRC metadata positive offset advances display");
});
test("[KNOWN GAP LRC-PARSERS] directly saved extended LRC differs from provider parser", () => {
  const text = "[offset:1000]\n[00:10.00][00:20.00] synthetic alpha";
  assert.deepEqual(parseLrc(text).map((l) => l.time), [9, 19]);
  const app = parseLyrics(text);
  assert.deepEqual(app.filter((l) => l.time !== null).map((l) => l.time), [10]);
  assert.match(app[1].text, /\[00:20.00\]/);
});
test("two anchors model intro/tempo change but cannot prove a different recording is aligned", () => {
  const warp = warpFromAnchors([{ ref: 10, actual: 15 }, { ref: 110, actual: 125 }]);
  assert.ok(warp);
  assert.equal(applyWarp(60, warp), 70);
  assert.equal(warpFromAnchors([{ ref: 0, actual: 0 }, { ref: 10, actual: 40 }]), null);
});
test("LRC -> YouTube position -> OBS share timed line/pronunciation index without double offset", () => {
  const lyricLines = parseLyrics("[00:10.00] synthetic alpha\n{발음} 모의 알파\nuntimed interlude\n[00:20.00] synthetic beta\n{발음} 모의 베타");
  const sender = findCurrentLyricIndex(lyricLines, 23 - 3);
  const live = buildLiveLyrics(lyricLines, sender, 3);
  assert.deepEqual(live.times, [13, 23]);
  assert.deepEqual(live.pron, ["모의 알파", "모의 베타"]);
  const state = { ...live, synced: true, pos: 23, rate: 1, playback: "playing" as const };
  assert.equal(clockedLineIndex(state, 5000, 5000), live.lineIndex);
  assert.equal(clockedLineIndex(state, 5000, 5000), 1);
});
test("OBS clock handles pause/buffering/seek/rate and caps stale extrapolation", () => {
  const base = { synced: true, lines: ["a", "b"], times: [10, 20], pos: 10, rate: 2, playback: "playing" as const };
  assert.equal(clockedLineIndex(base, 6000, 1000), 1);
  assert.equal(clockPos({ ...base, playback: "paused" }, 6000, 1000), 10);
  assert.equal(clockPos({ ...base, playback: "waiting" }, 6000, 1000), 10);
  assert.equal(clockPos(base, 100_000, 1000), 10 + MAX_EXTRAPOLATE_SEC * 2);
  assert.equal(clockedLineIndex({ ...base, pos: 1 }, 7000, 7000), -1, "seek uses latest received position");
  assert.equal(clockedLineIndex({ ...base, times: [] }, 6000, 1000), null);
});
