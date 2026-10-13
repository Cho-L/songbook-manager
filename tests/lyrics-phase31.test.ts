import test from "node:test";
import assert from "node:assert/strict";
import { applyPronToRaw, parseLyrics, stripLyricTracks, hasLyricTracks } from "../src/utils/lyrics";
import { buildLiveLyrics } from "../src/utils/liveBroadcast";
import { getSongAliases } from "../src/utils/songAliases";
import { resolveLyricsDetailed } from "../src/lyrics/pipeline";
import { MAX_TOTAL_REQUESTS, buildSearchPlan } from "../src/lyrics/searchPlan";
import { LrclibProvider } from "../src/lyrics/providers/lrclib";
import { LyricsApiError, describeLyricsError } from "../src/lyrics/errors";
import { buildPreview, textForApply } from "../src/lyrics/apply";
import { arpabetToHangul } from "../src/lyrics/pronunciation/english";
import { generatePronunciation, detectLineLang } from "../src/lyrics/pronunciation";
import { japaneseToHangul } from "../src/lyrics/pronunciation/kana";
import type { LyricsCandidate, LyricsProvider } from "../src/lyrics/types";

const LRC = "[00:10.00]君が好きです\n[00:15.50]ロックを聴かない\n[00:20.00]La la la";
const DB: LyricsCandidate[] = [
  { id: "1", title: "君はロックを聴かない", artist: "あいみょん", duration: 240, source: "mock", plainLyrics: "君が好きです\nロックを聴かない\nLa la la", syncedLyrics: LRC },
  { id: "2", title: "マリーゴールド", artist: "あいみょん", duration: 300, source: "mock", plainLyrics: "x\ny", syncedLyrics: "[00:01.00]x\n[00:02.00]y" },
  { id: "3", title: "君はロックを聴かない", artist: "別の歌手", duration: 200, source: "mock", plainLyrics: "zzz", syncedLyrics: "[00:01.00]z\n[00:02.00]zz" },
];
function mock(): LyricsProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    name: "mock",
    calls,
    async search(t, a) {
      calls.push(`s:${t}|${a}`);
      return DB.filter((c) => c.title === t && (!a || c.artist === a));
    },
    async searchQuery(q) {
      calls.push(`q:${q}`);
      return DB.filter((c) => q.includes(c.title) || q.trim() === c.artist);
    },
  };
}
const KO = { songId: "s", title: "너는 록을 듣지 않아", artist: "아이묭", ownLyrics: "" };

test("가사 텍스트의 발음 보조 줄: 파싱·제거·재조립", () => {
  const raw = "[00:10.00] 君が好きです\n{발음} 키미가 스키데스\n[00:15.00] ロック\n\n[Chorus]";
  const lines = parseLyrics(raw);
  assert.equal(lines.length, 4); // 보조 줄은 별도 줄이 아니다
  assert.equal(lines[0].pron, "키미가 스키데스");
  assert.equal(lines[0].time, 10);
  assert.equal(lines[1].pron, undefined);
  assert.ok(hasLyricTracks(raw));
  assert.equal(stripLyricTracks(raw), "[00:10.00] 君が好きです\n[00:15.00] ロック\n\n[Chorus]");
  const again = applyPronToRaw(raw, ["키미가 스키데스", "록쿠"]);
  assert.equal(parseLyrics(again)[1].pron, "록쿠");
  assert.equal(stripLyricTracks(again), stripLyricTracks(raw)); // 원문은 한 글자도 안 바뀐다
  assert.equal(stripLyricTracks(applyPronToRaw(raw, [])), stripLyricTracks(raw));
  // 예전 데이터(보조 줄 없음)는 결과가 동일
  assert.deepEqual(parseLyrics("a\n[00:01.00]b"), [{ time: null, text: "a" }, { time: 1, text: "b" }]);
});

test("라이브 전송: 원문과 발음이 같은 인덱스, 발음 없으면 필드 없음", () => {
  const withP = buildLiveLyrics(parseLyrics("[00:01.00]a\n{발음} 아\n[00:02.00]b\n{발음} 비"), 1);
  assert.deepEqual(withP, { lines: ["a", "b"], lineIndex: 1, pron: ["아", "비"], times: [1, 2] });
  const none = buildLiveLyrics(parseLyrics("[00:01.00]a\n[00:02.00]b"), 0);
  assert.equal("pron" in none, false);
});

test("재현: 한글 제목 + 한글 가수 → 기본 사전 가수 별칭으로 원어 곡을 찾아 '직접 선택' 목록에 올린다", async () => {
  const al = getSongAliases({ title: KO.title, artist: KO.artist });
  assert.ok(al.artists.includes("あいみょん"));
  const p = mock();
  const { entry } = await resolveLyricsDetailed({ ...KO, titleAliases: al.titles, artistAliases: al.artists }, p);
  assert.equal(entry.outcome, "needs-choice"); // 제목을 비교할 수 없으니 자동 선택하지 않는다
  const titles = entry.options?.map((o) => o.title);
  assert.ok(titles?.includes("君はロックを聴かない"));
  assert.ok(!entry.options?.some((o) => o.artist === "別の歌手"), "다른 가수의 같은 제목은 후보에 없다");
});

test("곡에 원어 제목 별칭이 있으면 자동 선택된다 (같은 가수일 때만)", async () => {
  const al = getSongAliases({ title: KO.title, artist: KO.artist, titleAliases: ["君はロックを聴かない"] });
  const { entry } = await resolveLyricsDetailed({ ...KO, titleAliases: al.titles, artistAliases: al.artists }, mock());
  assert.equal(entry.outcome, "synced");
  assert.equal(entry.candidate?.id, "1");
  // 가수가 다른 곡(3)은 같은 제목이어도 고르지 않는다
  const wrong = await resolveLyricsDetailed({ ...KO, titleAliases: ["君はロックを聴かない"], artistAliases: ["존재하지않는가수"] }, mock());
  assert.notEqual(wrong.entry.candidate?.id, "3");
});

test("후보 선택은 이미 받은 후보를 쓰고 다시 검색하지 않는다", async () => {
  const p = mock();
  const input = { ...KO, titleAliases: [], artistAliases: ["あいみょん"] };
  const first = await resolveLyricsDetailed(input, p);
  const n = p.calls.length;
  const chosen = await resolveLyricsDetailed(input, p, { candidateId: "1", pool: first.pool });
  assert.equal(p.calls.length, n);
  assert.equal(chosen.entry.outcome, "synced");
  assert.equal(chosen.entry.lines.length, 3);
});

test("검색 횟수 상한과 중복 요청 제거", async () => {
  const calls: string[] = [];
  const never: LyricsProvider = {
    name: "n",
    async search(t, a) { calls.push(`s:${t}|${a}`); return []; },
    async searchQuery(q) { calls.push(`q:${q}`); return []; },
  };
  const many = Array.from({ length: 10 }, (_, i) => `별칭${i}`);
  await resolveLyricsDetailed({ ...KO, titleAliases: many, artistAliases: many }, never);
  assert.ok(calls.length <= MAX_TOTAL_REQUESTS, `요청 ${calls.length}회`);
  assert.equal(new Set(calls).size, calls.length, "같은 검색어를 두 번 보내지 않는다");
  assert.ok(buildSearchPlan("a", "b", { titles: many, artists: many }).length <= 7 + 6);
});

test("외부 서비스 오류를 분류한다 (429/5xx/네트워크/응답 형식)", async () => {
  const mk = (impl: typeof fetch) => new LrclibProvider("https://x.test", impl);
  const status = (n: number): typeof fetch => async () => new Response("", { status: n });
  await assert.rejects(mk(status(429)).search("a", "b"), (e) => e instanceof LyricsApiError && e.kind === "rate-limit");
  await assert.rejects(mk(status(503)).search("a", "b"), (e) => e instanceof LyricsApiError && e.kind === "server");
  await assert.rejects(mk((async () => { throw new TypeError("fail"); }) as typeof fetch).search("a", "b"), (e) => e instanceof LyricsApiError && e.kind === "network");
  await assert.rejects(mk((async () => new Response("<html>", { status: 200 })) as typeof fetch).search("a", "b"), (e) => e instanceof LyricsApiError && e.kind === "invalid");
  assert.match(describeLyricsError(new LyricsApiError("rate-limit", "x")), /요청 제한/);
  // 전부 실패하면 resolve 는 분류된 오류를 그대로 던진다
  await assert.rejects(resolveLyricsDetailed(KO, mk(status(429))), (e) => e instanceof LyricsApiError && e.kind === "rate-limit");
});

test("LRCLIB: 같은 요청 공유/캐시, 깨진 싱크 가사는 '싱크 있음'으로 보이지 않는다", async () => {
  let n = 0;
  const body = JSON.stringify([
    { id: 1, trackName: "A", artistName: "B", duration: 100, plainLyrics: "x\ny", syncedLyrics: "[00:01.00]x\n[00:02.00]y" },
    { id: 2, trackName: "C", artistName: "D", duration: 100, plainLyrics: "x\ny", syncedLyrics: "그냥 텍스트" },
    { id: 3, trackName: "E", artistName: "F", duration: 100, plainLyrics: "", syncedLyrics: "" },
  ]);
  const p = new LrclibProvider("https://x.test", (async () => { n++; return new Response(body, { status: 200 }); }) as typeof fetch);
  const [r1, r2] = await Promise.all([p.search("A", "B"), p.search("A", "B")]);
  await p.search("A", "B");
  assert.equal(n, 1);
  assert.equal(r1, r2);
  assert.ok(r1[0].syncedLyrics);
  assert.equal(r1[1].syncedLyrics, undefined);
  assert.equal(r1[2].plainLyrics, undefined);
});

test("미리보기: 타임스탬프 보존, 길이 차이, 싱크 없음 안내, 저장된 가사 정렬", () => {
  const p = buildPreview(DB[0], { mrDuration: 250 });
  assert.equal(p.synced, true);
  assert.deepEqual(p.lines.map((l) => l.time), [10, 15.5, 20]);
  assert.equal(p.durationDiff, 10);
  assert.equal(p.durationSimilar, false);
  assert.ok(p.warnings.some((w) => w.includes("10초")));
  assert.equal(p.replaceText, "[00:10.00] 君が好きです\n[00:15.50] ロックを聴かない\n[00:20.00] La la la");
  const plain = buildPreview({ ...DB[0], syncedLyrics: undefined }, {});
  assert.equal(plain.synced, false);
  assert.ok(plain.warnings.some((w) => w.includes("싱크")));
  assert.equal(textForApply(plain, "align"), null);
  const own = buildPreview(DB[0], { ownLyrics: "君が好きです\n{발음} 키미가 스키데스\nロックを聴かない\nLa la la" });
  assert.ok(own.alignedText);
  assert.equal(parseLyrics(own.alignedText)[0].pron, "키미가 스키데스"); // 사용자 발음 보존
  assert.equal(parseLyrics(own.alignedText)[1].time, 15.5);
});

test("발음: 일본어 가나 규칙·한자 상태 표시", () => {
  assert.equal(japaneseToHangul("ありがとう").text, "아리가토");
  assert.equal(japaneseToHangul("ありがとう").status, "ok");
  assert.equal(japaneseToHangul("ロックを").text, "롯쿠오");
  assert.equal(japaneseToHangul("きょう").text, "쿄우");
  assert.equal(japaneseToHangul("しゃべる").text, "샤베루");
  const kanji = japaneseToHangul("君が好きです");
  assert.equal(kanji.text, "키미가스키데스");
  assert.equal(kanji.status, "review");
  const unknown = japaneseToHangul("学校へ");
  assert.equal(unknown.status, "unsupported");
  assert.ok(unknown.text.includes("学校")); // 읽지 못한 한자는 원문 그대로
  assert.equal(japaneseToHangul("は").status, "review");
});

test("발음: 영어(ARPAbet)·줄 단위 1:1·실패 시 원문 유지", () => {
  assert.equal(arpabetToHangul("L AH1 V"), "러브");
  assert.equal(arpabetToHangul("Y UW1"), "유");
  assert.equal(arpabetToHangul("N AY1 T"), "나이트");
  const dict = { love: "L AH1 V", you: "Y UW1" };
  const lines = ["I love you", "love you", "君が好き", "[Chorus]", "", "안녕", "xyzzy"];
  const out = generatePronunciation(lines, { dict });
  assert.equal(out.length, lines.length);
  assert.equal(out[0].status, "review"); // "I"는 사전에 없음 → 원문 유지 + 검토 필요
  assert.ok(out[0].pron.includes("러브") && out[0].pron.includes("I"));
  assert.equal(out[1].pron, "러브 유");
  assert.equal(out[1].status, "ok");
  assert.equal(out[2].lang, "ja");
  assert.equal(out[3].status, "skipped");
  assert.equal(out[5].status, "skipped");
  assert.equal(out[6].status, "unsupported");
  assert.equal(out[6].pron, "");
  // 사전이 없으면 영어 줄은 지원 불가로 표시하고 원문은 건드리지 않는다
  assert.equal(generatePronunciation(["love you"])[0].status, "unsupported");
  assert.equal(detectLineLang("(Hey)"), "none");
});
