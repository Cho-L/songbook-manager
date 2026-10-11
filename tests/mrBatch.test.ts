import { test } from "node:test";
import assert from "node:assert/strict";
import type { Song } from "../src/types/song";
import { classifyBookSongs, isMrEmpty, saveMrChoices, type MrSetResult } from "../src/utils/mrBatch";
import { estimateMrQuota, searchMrForRows } from "../src/utils/mrSearch";
import { LocalSongRepository } from "../src/services/songRepository";

const song = (id: string, over: Partial<Song> = {}): Song => ({
  id, ownerId: "o", title: `제목${id}`, artist: `가수${id}`, tags: [], favorite: false, createdAt: "", updatedAt: "", ...over,
});

test("isMrEmpty: null/undefined/빈 문자열/공백만 = 비어 있음", () => {
  for (const v of [null, undefined, "", "   ", "\t\n "]) assert.equal(isMrEmpty(v), true, JSON.stringify(v));
});

test("isMrEmpty: 값이 하나라도 있으면(형식이 잘못돼도, 'null' 글자여도) 비어 있지 않음", () => {
  for (const v of ["dQw4w9WgXcQ", "not a url!!", "x", "null", "undefined", " abc ", 0, {}]) assert.equal(isMrEmpty(v), false, JSON.stringify(v));
});

test("검색 대상: MR이 비어 있고 제목·가수가 있는 곡만", () => {
  const songs = [
    song("1"), // 대상
    song("2", { youtubeVideoId: "" }), // 대상
    song("3", { youtubeVideoId: "   " }), // 대상 (공백만)
    song("4", { youtubeVideoId: "abcDEF12345" }), // 제외: MR 있음
    song("5", { youtubeVideoId: "잘못된 형식 값" }), // 제외: 비어 있지 않음
    song("6", { youtubeVideoId: "null" }), // 제외: 글자 "null" 도 값이 있는 것
    song("7", { title: "  " }), // 제외: 제목 부족
    song("8", { artist: "" }), // 제외: 가수 부족
    song("9", { youtubeVideoId: undefined }), // 대상
  ];
  const st = classifyBookSongs(songs);
  assert.deepEqual(st.targets.map((s) => s.id), ["1", "2", "3", "9"]);
  assert.equal(st.total, 9);
  assert.equal(st.withMr, 3);
  assert.equal(st.withoutMr, 6);
  assert.equal(st.insufficient, 2);
});

test("할당량 추정: 곡당 1~2회, 회당 100", () => {
  assert.deepEqual(estimateMrQuota(10), { minRequests: 10, maxRequests: 20, minUnits: 1000, maxUnits: 2000 });
  assert.deepEqual(estimateMrQuota(0), { minRequests: 0, maxRequests: 0, minUnits: 0, maxUnits: 0 });
});

// ---------------------------------------------------------------- 저장
function deps(initial: Song[], opts: { onSet?: (id: string) => void; failIds?: string[]; failFetch?: boolean; mutateBeforeSet?: (db: Map<string, Song>) => void } = {}) {
  const db = new Map(initial.map((s) => [s.id, { ...s }]));
  const writes: string[] = [];
  return {
    db, writes,
    deps: {
      fetchLatest: async () => { if (opts.failFetch) throw new Error("네트워크 오류"); return [...db.values()].map((s) => ({ ...s })); },
      // 저장소의 조건부 갱신 흉내: 비어 있을 때만 쓴다
      setIfEmpty: async (id: string, videoId: string): Promise<MrSetResult> => {
        opts.mutateBeforeSet?.(db);
        if (opts.failIds?.includes(id)) throw new Error("RLS/네트워크 실패");
        const s = db.get(id);
        if (!s) return "not-found";
        if (!isMrEmpty(s.youtubeVideoId)) return "conflict";
        s.youtubeVideoId = videoId; writes.push(id); opts.onSet?.(id);
        return "updated";
      },
    },
  };
}

test("저장: 비어 있는 곡만 쓰고, 기존 MR은 덮어쓰지 않는다", async () => {
  const t = deps([song("1"), song("2", { youtubeVideoId: "EXISTING_ID" }), song("3", { youtubeVideoId: "  " })]);
  const out = await saveMrChoices([{ songId: "1", videoId: "NEW1" }, { songId: "2", videoId: "NEW2" }, { songId: "3", videoId: "NEW3" }], t.deps);
  assert.equal(out.get("1")?.kind, "saved");
  assert.equal(out.get("2")?.kind, "conflict");
  assert.equal(out.get("3")?.kind, "saved");
  assert.equal(t.db.get("2")?.youtubeVideoId, "EXISTING_ID");
  assert.deepEqual(t.writes, ["1", "3"]);
});

test("저장 직전 다른 사용자가 MR을 등록하면(최신 조회에서 발견) 그 곡은 쓰지 않는다", async () => {
  const t = deps([song("1"), song("2")]);
  t.db.get("1")!.youtubeVideoId = "OTHER_USER"; // 검색하는 동안 다른 사용자가 등록
  const out = await saveMrChoices([{ songId: "1", videoId: "MINE" }, { songId: "2", videoId: "MINE2" }], t.deps);
  assert.equal(out.get("1")?.kind, "conflict");
  assert.equal(out.get("2")?.kind, "saved");
  assert.equal(t.db.get("1")?.youtubeVideoId, "OTHER_USER");
});

test("최신 조회 이후~쓰기 사이에 등록돼도(경쟁) 조건부 갱신이 막는다", async () => {
  const t = deps([song("1")], { mutateBeforeSet: (db) => { db.get("1")!.youtubeVideoId = "RACE_WINNER"; } });
  const out = await saveMrChoices([{ songId: "1", videoId: "MINE" }], t.deps);
  assert.equal(out.get("1")?.kind, "conflict");
  assert.equal(t.db.get("1")?.youtubeVideoId, "RACE_WINNER");
});

test("일부 저장 실패: 성공/건너뜀/실패가 곡별로 정확히 구분되고, 실패한 곡만 재시도할 수 있다", async () => {
  let failing = ["2"];
  const t = deps([song("1"), song("2"), song("3", { youtubeVideoId: "X1" })]);
  const wrapped = { ...t.deps, setIfEmpty: (id: string, v: string) => (failing.includes(id) ? Promise.reject(new Error("일시 오류")) : t.deps.setIfEmpty(id, v)) };
  const choices = [{ songId: "1", videoId: "A" }, { songId: "2", videoId: "B" }, { songId: "3", videoId: "C" }, { songId: "gone", videoId: "D" }];
  const out = await saveMrChoices(choices, wrapped);
  assert.deepEqual([...out].map(([id, s]) => `${id}:${s.kind}`), ["1:saved", "2:failed", "3:conflict", "gone:not-found"]);
  assert.equal((out.get("2") as { message: string }).message, "일시 오류");
  assert.equal(t.db.get("2")?.youtubeVideoId, undefined);
  // 실패한 곡만 재시도
  failing = [];
  const retry = await saveMrChoices([{ songId: "2", videoId: "B" }], wrapped);
  assert.equal(retry.get("2")?.kind, "saved");
  assert.equal(t.db.get("1")?.youtubeVideoId, "A"); // 이미 저장된 곡은 그대로
});

test("최신 목록을 못 읽으면 아무것도 쓰지 않고 전부 실패 처리", async () => {
  const t = deps([song("1")], { failFetch: true });
  const out = await saveMrChoices([{ songId: "1", videoId: "A" }], t.deps);
  assert.equal(out.get("1")?.kind, "failed");
  assert.deepEqual(t.writes, []);
});

// ---------------------------------------------------------------- 검색 중 데이터 보존 / 중복 요청
test("검색 취소 후에도 데이터는 그대로 (검색은 저장소에 쓰지 않는다)", async () => {
  const t = deps([song("1"), song("2"), song("3")]);
  const before = JSON.stringify([...t.db.values()]);
  const ac = new AbortController();
  let n = 0;
  const s = await searchMrForRows([...t.db.values()].map((x, i) => ({ row: i + 1, title: x.title, artist: x.artist })), {
    signal: ac.signal,
    search: async () => { n++; if (n === 2) ac.abort(); return []; },
    wait: async () => {},
  });
  assert.equal(s.cancelled, true);
  assert.equal(JSON.stringify([...t.db.values()]), before);
  assert.deepEqual(t.writes, []);
});

test("같은 곡은 배치를 나눠 호출해도 공유 캐시로 다시 검색하지 않는다", async () => {
  const cache = new Map();
  let calls = 0;
  const search = async () => { calls++; return [{ videoId: "a", title: "제목1 가수1 MR", channelTitle: "TJ노래방" }]; };
  const a = { row: 1, title: "제목1", artist: "가수1" };
  await searchMrForRows([a], { search, cache, wait: async () => {} });
  const before = calls;
  await searchMrForRows([{ ...a, row: 5 }], { search, cache, wait: async () => {} });
  assert.equal(calls, before);
});

test("오류 결과는 캐시하지 않아 다시 검색할 수 있다", async () => {
  const cache = new Map();
  let fail = true;
  const search = async () => { if (fail) throw Object.assign(new Error("x"), { status: 502 }); return []; };
  const row = { row: 1, title: "제목", artist: "가수" };
  const r1 = await searchMrForRows([row], { search, cache, wait: async () => {}, maxConsecutiveFailures: 9 });
  assert.equal(r1.results.get(1)?.kind, "error");
  fail = false;
  const r2 = await searchMrForRows([row], { search, cache, wait: async () => {} });
  assert.equal(r2.results.get(1)?.kind, "decision");
});

// ---------------------------------------------------------------- 로컬 저장소의 조건부 갱신 (실제 구현 코드)
test("LocalSongRepository.setYoutubeVideoIdIfEmpty: 비어 있을 때만 쓰고 다른 필드는 그대로", async () => {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(), key: () => null, length: 0,
  } as Storage;
  const repo = new LocalSongRepository();
  const a = await repo.add({ title: "A", artist: "a", tags: [], memo: "메모", youtubeVideoId: "  " }, "o");
  const b = await repo.add({ title: "B", artist: "b", tags: [], youtubeVideoId: "KEEP_ME_123" }, "o");
  assert.equal(await repo.setYoutubeVideoIdIfEmpty(a.id, "NEWID"), "updated");
  assert.equal(await repo.setYoutubeVideoIdIfEmpty(a.id, "OTHER"), "conflict"); // 두 번째는 이미 값이 있음
  assert.equal(await repo.setYoutubeVideoIdIfEmpty(b.id, "NEWID"), "conflict");
  assert.equal(await repo.setYoutubeVideoIdIfEmpty("nope", "X"), "not-found");
  const all = await repo.getByOwner("o");
  assert.equal(all.find((s) => s.id === a.id)?.youtubeVideoId, "NEWID");
  assert.equal(all.find((s) => s.id === a.id)?.memo, "메모");
  assert.equal(all.find((s) => s.id === b.id)?.youtubeVideoId, "KEEP_ME_123");
});
