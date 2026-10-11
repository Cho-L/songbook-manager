import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMrQueries, decideMr, rankMrCandidates, searchMrForRows } from "../src/utils/mrSearch";
import type { YouTubeSearchResult } from "../src/services/youtubeService";

const yt = (videoId: string, title: string, channelTitle = "채널"): YouTubeSearchResult => ({ videoId, title, channelTitle });
const song = { title: "꽃길", artist: "김세정" };

test("검색어: 곡당 최대 2개 (MR → 노래방 반주)", () => {
  assert.deepEqual(buildMrQueries("꽃길", "김세정"), ["꽃길 김세정 MR", "꽃길 김세정 노래방 반주"]);
});

test("확실한 단독 MR 후보는 자동 연결", () => {
  const c = rankMrCandidates(song, [yt("a", "[MR] 꽃길 - 김세정", "TJ노래방"), yt("b", "꽃길 김세정 뮤직비디오"), yt("c", "전혀 다른 영상")]);
  const d = decideMr(c);
  assert.equal(d.status, "auto");
  assert.equal(d.status === "auto" && d.best.videoId, "a");
});

test("원곡 MV / 라이브 / 커버 / 보컬만(MR 제거)은 자동 연결하지 않는다", () => {
  for (const t of ["꽃길 김세정 MV", "꽃길 김세정 라이브 MR", "꽃길 김세정 커버 MR", "꽃길 김세정 MR제거"]) {
    const d = decideMr(rankMrCandidates(song, [yt("x", t)]));
    assert.notEqual(d.status, "auto", t);
  }
});

test("비슷한 MR 후보가 여럿이면 사용자가 고른다 (review)", () => {
  const d = decideMr(rankMrCandidates(song, [yt("a", "꽃길 김세정 MR", "TJ노래방"), yt("b", "꽃길 김세정 MR", "KY Karaoke")]));
  assert.equal(d.status, "review");
  assert.equal(d.candidates.length, 2);
});

test("후보가 없으면 none, 제목이 안 맞는 영상만 있어도 자동 연결 안 함", () => {
  assert.equal(decideMr(rankMrCandidates(song, [])).status, "none");
  assert.notEqual(decideMr(rankMrCandidates(song, [yt("z", "다른 노래 MR 가수 노래방")])).status, "auto");
});

test("같은 videoId 중복 제거", () => {
  assert.equal(rankMrCandidates(song, [yt("a", "꽃길 김세정 MR"), yt("a", "꽃길 김세정 MR")]).length, 1);
});

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ row: i + 2, title: `곡${i}`, artist: "가수" }));
const noWait = async () => {};

test("자동 연결되면 두 번째 검색어는 쓰지 않는다 (요청 절약)", async () => {
  const queries: string[] = [];
  const s = await searchMrForRows(rows(2), {
    search: async (q) => { queries.push(q); return [yt(`id-${q}`, `${q.replace(" MR", "")} [MR]`, "TJ노래방")]; },
    wait: noWait,
  });
  assert.equal(queries.length, 2);
  assert.equal(s.requests, 2);
});

test("같은 곡(제목+가수)은 한 번만 검색", async () => {
  let calls = 0;
  const r = [{ row: 2, title: "꽃길", artist: "김세정" }, { row: 3, title: "꽃길", artist: "김세정" }];
  const s = await searchMrForRows(r, { search: async () => { calls++; return [yt("a", "꽃길 김세정 MR", "TJ노래방")]; }, wait: noWait });
  assert.equal(calls, 1);
  assert.equal(s.results.size, 2);
});

test("개별 실패는 그 행만 error, 나머지는 계속", async () => {
  let i = 0;
  const s = await searchMrForRows(rows(3), {
    search: async () => { i++; if (i <= 2) throw Object.assign(new Error("boom"), { status: 502 }); return [yt("a", "곡2 가수 MR", "TJ노래방")]; },
    wait: noWait,
    maxConsecutiveFailures: 5,
  });
  const kinds = [...s.results.values()].map((x) => x.kind);
  assert.ok(kinds.includes("error"));
  assert.ok(s.results.size === 3);
});

test("연속 3번 실패하면 전체 중단 (할당량 초과 가능성 안내), 이미 찾은 결과는 유지", async () => {
  let i = 0;
  const s = await searchMrForRows(rows(10), {
    search: async () => { i++; if (i <= 2) return [yt("ok", "곡0 가수 MR", "TJ노래방")]; throw Object.assign(new Error("quota"), { status: 502 }); },
    wait: noWait,
  });
  assert.ok(s.abortedReason?.includes("연속 실패"));
  assert.ok(s.results.size < 10);
  assert.equal(s.results.get(2)?.kind, "decision");
});

test("API 키 미설정(500)은 즉시 중단", async () => {
  const s = await searchMrForRows(rows(5), { search: async () => { throw Object.assign(new Error("서버에 YOUTUBE_API_KEY가 설정되지 않았습니다."), { status: 500 }); }, wait: noWait });
  assert.ok(s.abortedReason?.includes("API 키"));
  assert.equal(s.results.size, 1);
});

test("네트워크 오류(status 0)만 1회 재시도", async () => {
  let n = 0;
  const s = await searchMrForRows(rows(1), {
    search: async () => { n++; if (n === 1) throw Object.assign(new Error("net"), { status: 0 }); return [yt("a", "곡0 가수 MR", "TJ노래방")]; },
    wait: noWait,
  });
  assert.equal(n, 2);
  assert.equal(s.results.get(2)?.kind, "decision");
});

test("취소: 즉시 멈추고 그때까지 결과는 유지", async () => {
  const ac = new AbortController();
  let n = 0;
  const s = await searchMrForRows(rows(10), {
    signal: ac.signal,
    search: async () => { n++; if (n === 4) ac.abort(); return [yt("a", "곡 가수 MR", "TJ노래방")]; },
    wait: noWait,
  });
  assert.equal(s.cancelled, true);
  assert.ok(s.results.size >= 1 && s.results.size < 10);
});
