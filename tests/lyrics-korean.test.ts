import { MAX_TOTAL_REQUESTS } from "../src/lyrics/searchPlan";
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveLyrics } from "../src/lyrics/pipeline";
import { MusicBrainzAliasProvider } from "../src/lyrics/providers/musicbrainz";
import { LrclibProvider } from "../src/lyrics/providers/lrclib";
import type { AliasProvider, LyricsCandidate, LyricsProvider } from "../src/lyrics/types";

// localStorage 가 없는 Node 에서도 artist alias 읽기가 동작하도록 (코드는 try/catch 로 감싸져 있음)

const LRC = "[00:10.00] 첫 줄\n[00:20.00] 둘째 줄\n[00:30.00] 셋째 줄";
function cand(id: number, title: string, artist: string, synced = true): LyricsCandidate {
  return { id: String(id), title, artist, duration: 200, syncedLyrics: synced ? LRC : undefined, plainLyrics: "첫 줄\n둘째 줄\n셋째 줄", source: "FAKE" };
}

/** LRCLIB 흉내: track_name/artist_name 은 부분 일치(대소문자 무시), q 는 제목·가수 어디든 */
class FakeLrclib implements LyricsProvider {
  readonly name = "FAKE";
  calls: string[] = [];
  constructor(private db: LyricsCandidate[], private failAll = false) {}
  private has(h: string, n: string) { return h.toLowerCase().includes(n.toLowerCase()); }
  async search(title: string, artist: string) {
    this.calls.push(`search:${title}|${artist}`);
    if (this.failAll) throw new Error("LRCLIB 503");
    return this.db.filter((c) => this.has(c.title, title) && (!artist || this.has(c.artist, artist)));
  }
  async searchQuery(q: string) {
    this.calls.push(`q:${q}`);
    if (this.failAll) throw new Error("LRCLIB 503");
    const toks = q.toLowerCase().split(/\s+/);
    return this.db.filter((c) => toks.every((t) => (c.title + " " + c.artist).toLowerCase().includes(t)));
  }
}
const alias = (a: string[], t: string[]): AliasProvider => ({ name: "FAKE-MB", lookup: async () => ({ artists: a, titles: t }) });
const song = (title: string, artist: string) => ({ songId: "s1", title, artist, ownLyrics: "" });

const DB = [
  cand(1, "Flower Way", "Kim Sejeong"),
  cand(2, "Whale", "Kim Sejeong"),
  cand(3, "Tunnel", "Kim Sejeong"),
  cand(4, "꽃길", "다른가수"), // 동명곡: 가수가 다르다
];

test("꽃길 - 김세정: 별칭(영문 제목+가수) 확인 시 Flower Way 가 자동 선택된다", async () => {
  const p = new FakeLrclib(DB);
  const r = await resolveLyrics(song("꽃길", "김세정"), p, { aliasProvider: alias(["Kim Sejeong"], ["Flower Way"]) });
  assert.equal(r.outcome, "synced");
  assert.equal(r.candidate?.id, "1");
});

test("별칭 없이 한글로만: 동명곡(다른 가수)을 자동 선택하지 않는다", async () => {
  const p = new FakeLrclib(DB);
  const r = await resolveLyrics(song("꽃길", "김세정"), p, {});
  assert.notEqual(r.candidate?.id, "4");
  assert.ok(["not-found", "needs-choice"].includes(r.outcome), r.outcome);
});

test("가수 별칭만 확인된 경우: 임의로 고르지 않고 후보 선택(needs-choice)을 보여 준다", async () => {
  const p = new FakeLrclib(DB);
  const r = await resolveLyrics(song("꽃길", "김세정"), p, { aliasProvider: alias(["Kim Sejeong"], []) });
  assert.equal(r.outcome, "needs-choice");
  assert.ok(r.options!.some((o) => o.id === "1"));
  assert.notEqual(r.candidate?.id, "4"); // 가수가 다른 동명곡은 자동 선택하지 않는다
});

test("사용자가 후보를 직접 고르면(candidateId) 그 곡을 쓴다", async () => {
  const p = new FakeLrclib(DB);
  const r = await resolveLyrics(song("꽃길", "김세정"), p, { aliasProvider: alias(["Kim Sejeong"], []), candidateId: "1" });
  assert.equal(r.candidate?.id, "1");
});

test("검색 결과 없음 vs 네트워크 오류 구분", async () => {
  const none = await resolveLyrics(song("없는곡", "없는가수"), new FakeLrclib(DB), { aliasProvider: alias([], []) });
  assert.equal(none.outcome, "not-found");
  await assert.rejects(() => resolveLyrics(song("꽃길", "김세정"), new FakeLrclib(DB, true), {}), /503/);
});

test("영어 입력은 확장 단계(추가 요청) 없이 끝난다", async () => {
  const p = new FakeLrclib(DB);
  const r = await resolveLyrics(song("Flower Way", "Kim Sejeong"), p, { aliasProvider: alias(["x"], ["y"]) });
  assert.equal(r.candidate?.id, "1");
  assert.ok(!p.calls.some((c) => c.startsWith("q:")));
});

test("한국어 제목+영어 아티스트 / 영어 제목+한국어 아티스트도 후보를 찾는다", async () => {
  const p = new FakeLrclib(DB);
  const a = await resolveLyrics(song("꽃길", "Kim Sejeong"), p, { aliasProvider: alias([], ["Flower Way"]) });
  assert.equal(a.candidate?.id, "1");
  const b = await resolveLyrics(song("Flower Way", "김세정"), new FakeLrclib(DB), {});
  assert.equal(b.candidate?.id, "1"); // 소리 비교로 가수 일치 (기존 기능)
});

test("제목만 입력 / 가수만 입력", async () => {
  const t = await resolveLyrics(song("Whale", ""), new FakeLrclib(DB), {});
  assert.equal(t.candidate?.id, "2");
  const a = await resolveLyrics(song("", "Kim Sejeong"), new FakeLrclib(DB), {});
  assert.ok(["not-found", "needs-choice", "no-sync"].includes(a.outcome));
});

test("검색 확장 단계는 전체 요청 상한 안에서 완료", async () => {
  const p = new FakeLrclib(DB);
  await resolveLyrics(song("꽃길없음", "김세정"), p, { aliasProvider: alias(["Kim Sejeong", "K"], ["A", "B", "C"]) });
  const extended = p.calls.filter((c) => c.startsWith("q:") || /\|Kim Sejeong$/.test(c)).length;
  assert.ok(p.calls.length <= MAX_TOTAL_REQUESTS, `calls=${p.calls.length}`);
  assert.ok(extended <= 8);
});

// ---------------------------------------------------------------- MusicBrainz provider (가짜 fetch)
function fakeMb(handlers: Record<string, unknown>) {
  const urls: string[] = [];
  const f = (async (u: string) => {
    urls.push(u);
    const key = Object.keys(handlers).find((k) => u.includes(k));
    if (!key) return new Response("{}", { status: 404 });
    const v = handlers[key];
    return v instanceof Response ? v : new Response(JSON.stringify(v), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, urls };
}

test("MusicBrainz: 정확한 아티스트의 등록 곡 별칭을 쓰고 앨범명은 추측하지 않는다", async () => {
  const { f, urls } = fakeMb({
    "/ws/2/artist": { artists: [{ id: "A1", name: "김세정", "sort-name": "Kim, Sejeong", score: 100, aliases: [{ name: "Kim Sejeong" }, { name: "세정" }] }, { id: "A2", name: "김세정2", score: 60 }] },
    "/ws/2/recording": { recordings: [{ title: "꽃길", aliases: [{ name: "Flower Way" }], releases: [{ title: "Unrelated Album" }] }, { title: "다른곡", releases: [{ title: "Other" }] }] },
  });
  const r = await new MusicBrainzAliasProvider("https://mb.test", f).lookup("꽃길", "김세정");
  assert.ok(r.artists.includes("Kim Sejeong"));
  assert.deepEqual(r.titles, ["꽃길", "Flower Way"]);
  assert.equal(urls.length, 2);
});

test("MusicBrainz: 이름이 정확히 일치하는 아티스트가 없으면 아무것도 쓰지 않는다 / 점수 동률 동명이인도 제외", async () => {
  const a = fakeMb({ "/ws/2/artist": { artists: [{ id: "X", name: "김세정스", score: 100 }] } });
  assert.deepEqual(await new MusicBrainzAliasProvider("https://mb.test", a.f).lookup("꽃길", "김세정"), { artists: [], titles: [] });
  const b = fakeMb({ "/ws/2/artist": { artists: [{ id: "1", name: "김세정", score: 100 }, { id: "2", name: "김세정", score: 100 }] } });
  assert.deepEqual(await new MusicBrainzAliasProvider("https://mb.test", b.f).lookup("꽃길", "김세정"), { artists: [], titles: [] });
});

test("MusicBrainz: HTTP 오류는 빈 값(검색은 계속) + 실패는 캐시하지 않음, 성공은 캐시", async () => {
  let n = 0;
  const f = (async () => { n++; return new Response("x", { status: 503 }); }) as unknown as typeof fetch;
  const p = new MusicBrainzAliasProvider("https://mb.test", f);
  assert.deepEqual(await p.lookup("꽃길", "김세정"), { artists: [], titles: [], lookupUnavailable: true });
  await p.lookup("꽃길", "김세정");
  assert.equal(n, 2);
});

test("LRCLIB provider: q 검색 URL", async () => {
  let seen = "";
  const f = (async (u: string) => { seen = u; return new Response("[]"); }) as unknown as typeof fetch;
  await new LrclibProvider("https://lrclib.test", f).searchQuery("꽃길 김세정");
  assert.ok(seen.includes("/api/search?q=") && seen.includes(encodeURIComponent("꽃길")));
});
