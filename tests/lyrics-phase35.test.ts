import test from "node:test";
import assert from "node:assert/strict";
import { MusicBrainzAliasProvider } from "../src/lyrics/providers/musicbrainz";
import { LrclibProvider } from "../src/lyrics/providers/lrclib";
import { MAX_TOTAL_REQUESTS, searchCandidates } from "../src/lyrics/searchPlan";
import { isAutoAccept, rankCandidates } from "../src/lyrics/matching";
import { resolveLyricsDetailed } from "../src/lyrics/pipeline";
import { filterGroups, groupRecordings } from "../src/lyrics/catalog";
import { getSongAliases } from "../src/utils/songAliases";

const LRC = "[00:01.00] a\n[00:02.00] b\n[00:03.00] c";
const LR = [
  { id: 1, trackName: "踊り子", artistName: "Vaundy", duration: 238, syncedLyrics: LRC, plainLyrics: "a\nb\nc" },
  { id: 2, trackName: "怪獣の花唄", artistName: "Vaundy", duration: 250, syncedLyrics: LRC, plainLyrics: "a" },
  { id: 3, trackName: "踊り子", artistName: "別の歌手", duration: 200, syncedLyrics: LRC, plainLyrics: "z" },
  { id: 4, trackName: "君はロックを聴かない", artistName: "あいみょん", duration: 260, syncedLyrics: LRC, plainLyrics: "a" },
  { id: 5, trackName: "マリーゴールド", artistName: "あいみょん", duration: 300, syncedLyrics: LRC, plainLyrics: "a" },
];
const n = (s: string) => s.toLowerCase().replace(/\s+/g, "");
function lrFetch(log: string[]): typeof fetch {
  return (async (u: unknown) => {
    const url = new URL(String(u));
    const q = url.searchParams.get("q"), t = url.searchParams.get("track_name"), a = url.searchParams.get("artist_name");
    log.push(q ? `q:${q}` : `t:${t}|${a ?? ""}`);
    const r = LR.filter((x) => (q ? n(x.trackName + x.artistName).includes(n(q)) : (!t || n(x.trackName) === n(t)) && (!a || n(x.artistName) === n(a))));
    if (url.pathname === "/api/get") return Response.json(r[0] ?? {}, { status: r.length ? 200 : 404 });
    return new Response(JSON.stringify(r), { status: 200 });
  }) as typeof fetch;
}
const rec = (id: string, title: string, artistId: string, extra: object = {}) => ({ id, title, length: 238000, "artist-credit": [{ name: "x", artist: { id: artistId } }], ...extra });
function mbFetch(log: string[], opts: { aliasesOnRecording?: boolean } = {}): typeof fetch {
  const artists = [
    { id: "va", name: "Vaundy", "sort-name": "Vaundy", score: 100, type: "Person", country: "JP", aliases: [] },
    { id: "ai", name: "あいみょん", "sort-name": "Aimyon", score: 100, aliases: [{ name: "Aimyon" }] },
  ];
  const recs = [
    rec("r1", "踊り子", "va", { aliases: [{ name: "Odoriko" }], releases: [{ title: "strobo" }] }),
    rec("r1b", "踊り子 (Live)", "va"),
    rec("r1c", "踊り子", "va", { length: null }),
    rec("r2", "怪獣の花唄", "va", { aliases: [{ name: "Kaijuu no Hanauta" }] }),
    rec("rX", "他人の曲", "zz"), // 이 아티스트가 아닌 녹음 → 걸러져야 한다
    rec("r3", "君はロックを聴かない", "ai", { aliases: [{ name: "Kimi wa Rock wo Kikanai" }] }),
  ];
  return (async (u: unknown) => {
    const url = new URL(String(u));
    const query = url.searchParams.get("query") ?? "";
    log.push(`MB ${url.pathname} ${url.searchParams.get("artist") ?? query}`);
    if (url.pathname.endsWith("/artist")) {
      const m = artists.filter((x) => [x.name, ...x.aliases.map((y) => y.name)].some((nm) => query.toLowerCase().includes(`"${nm.toLowerCase()}"`)));
      return new Response(JSON.stringify({ artists: m }), { status: 200 });
    }
    const aid = url.searchParams.get("artist");
    if (aid) {
      const off = Number(url.searchParams.get("offset") ?? 0);
      const lim = Number(url.searchParams.get("limit") ?? 100);
      const all = recs.filter((r) => aid === "va" ? r.id.startsWith("r1") || r.id === "r2" || r.id === "rX" : r.id === "r3");
      return new Response(JSON.stringify({ recordings: all.slice(off, off + Math.min(lim, 2)), "recording-count": all.length }), { status: 200 });
    }
    const m = recs.filter((r) => query.includes(`"${r.title}"`) && query.includes(`arid:${r["artist-credit"][0].artist.id}`));
    return new Response(JSON.stringify({ recordings: opts.aliasesOnRecording ? m : m }), { status: 200 });
  }) as typeof fetch;
}
const run = async (title: string, artist: string, mbLog: string[] = [], lrLog: string[] = []) => {
  const al = getSongAliases({ title, artist });
  const lr = new LrclibProvider("https://x", lrFetch(lrLog));
  const mb = new MusicBrainzAliasProvider("https://m", mbFetch(mbLog));
  const out = await searchCandidates(lr, { title, artist, titleAliases: al.titles, artistAliases: al.artists }, undefined, mb);
  const ranked = rankCandidates({ title, artist }, out.candidates, out.aliases);
  return { out, ranked, lrLog, mbLog, top: ranked[0] };
};

test("로마자 제목(Odoriko/Vaundy): MusicBrainz 에 등록된 별칭으로 원어 제목을 찾아 자동 선택 (다른 가수의 같은 제목은 제외)", async () => {
  const r = await run("Odoriko", "Vaundy");
  assert.equal(r.top.title, "踊り子");
  assert.equal(r.top.artist, "Vaundy");
  assert.ok(isAutoAccept(r.top, true));
  assert.ok(r.lrLog.length <= MAX_TOTAL_REQUESTS);
  assert.ok(!r.ranked.slice(0, 1).some((c) => c.artist === "別の歌手"));
});

test("한글 제목(무희/바운디·VAUNDY): 번역을 지어내지 않는다 — 자동 선택 없이 같은 가수의 곡만 후보로", async () => {
  for (const artist of ["바운디", "VAUNDY"]) {
    const r = await run("무희", artist);
    assert.ok(r.ranked.length > 0, artist);
    for (const c of r.out.candidates) assert.equal(c.artist, "Vaundy", "다른 가수의 곡이 섞이면 안 된다");
    assert.ok(!isAutoAccept(r.top, true), `${artist}: 한글 제목은 자동 선택되면 안 된다`);
  }
});

test("너는 록을 듣지 않아/아이묭: 가수는 같지만 제목 확인 불가 → 자동 선택 안 함, 후보로 제공", async () => {
  const r = await run("너는 록을 듣지 않아", "아이묭");
  assert.ok(r.out.candidates.some((c) => c.title === "君はロックを聴かない"));
  assert.ok(!isAutoAccept(r.top, true));
  const d = await resolveLyricsDetailed(
    { songId: "s", title: "너는 록을 듣지 않아", artist: "아이묭", ownLyrics: "", titleAliases: [], artistAliases: getSongAliases({ title: "x", artist: "아이묭" }).artists },
    new LrclibProvider("https://x", lrFetch([])),
    { aliasProvider: new MusicBrainzAliasProvider("https://m", mbFetch([])) }
  );
  assert.equal(d.entry.outcome, "needs-choice");
});

test("원어 입력은 1회 요청으로 자동 선택", async () => {
  for (const [t, a] of [["君はロックを聴かない", "あいみょん"], ["踊り子", "Vaundy"]]) {
    const r = await run(t, a);
    assert.equal(r.lrLog.length, 1);
    assert.ok(isAutoAccept(r.top, true));
  }
});

test("아티스트 검색: mbid·구분 정보·별칭을 돌려주고 같은 검색은 캐시", async () => {
  const log: string[] = [];
  const mb = new MusicBrainzAliasProvider("https://m", mbFetch(log));
  const hits = await mb.searchArtists("Vaundy");
  assert.equal(hits[0].mbid, "va");
  assert.equal(hits[0].country, "JP");
  const h2 = await mb.searchArtists("  vaundy ");
  assert.equal(h2.length, 1);
  assert.equal(log.length, 1, "같은 이름은 다시 요청하지 않는다");
  assert.deepEqual(await mb.searchArtists("없는가수"), []);
});

test("아티스트별 곡: 페이지 이어받기, 다른 아티스트 녹음 제외, 로마자 표기 보존, 중복·버전 정리", async () => {
  const mb = new MusicBrainzAliasProvider("https://m", mbFetch([]));
  const p1 = await mb.browseRecordings("va", 0);
  assert.equal(p1.total, 5);
  assert.equal(p1.rawCount, 2);
  const p2 = await mb.browseRecordings("va", p1.offset + p1.rawCount);
  const p3 = await mb.browseRecordings("va", p1.rawCount + p2.rawCount);
  const all = [...p1.items, ...p2.items, ...p3.items];
  assert.ok(!all.some((r) => r.title === "他人の曲"), "크레딧에 없는 녹음 제외");
  const groups = groupRecordings(all);
  assert.equal(groups.length, 2, "踊り子 3건(원곡/라이브/중복)이 1곡으로, 怪獣の花唄 1곡");
  const odoriko = groups.find((g) => g.main.title === "踊り子")!;
  assert.equal(odoriko.count, 3);
  assert.ok(!odoriko.main.isVersion);
  assert.ok(odoriko.altTitles.includes("Odoriko"));
  assert.deepEqual(filterGroups(groups, "odoriko").map((g) => g.main.title), ["踊り子"]);
  assert.deepEqual(filterGroups(groups, "かいじゅう").length, 0);
  assert.equal(filterGroups(groups, "").length, 2);
});

test("MusicBrainz 오류는 검색 자체를 막지 않지만 곡 목록 조회는 오류를 알린다", async () => {
  const bad = new MusicBrainzAliasProvider("https://m", (async () => new Response("x", { status: 503 })) as unknown as typeof fetch);
  await assert.rejects(() => bad.browseRecordings("va", 0), /503/);
  await assert.rejects(() => bad.searchArtists("Vaundy"));
  assert.deepEqual(await bad.lookup("Odoriko", "Vaundy"), { artists: [], titles: [], lookupUnavailable: true });
});

test("요청 간격(throttle): minGapMs 를 주면 요청 사이에 간격을 둔다", async () => {
  const times: number[] = [];
  const f = (async () => {
    times.push(Date.now());
    return new Response(JSON.stringify({ artists: [] }), { status: 200 });
  }) as unknown as typeof fetch;
  const mb = new MusicBrainzAliasProvider("https://m", f, 120);
  await Promise.all([mb.searchArtists("a1"), mb.searchArtists("b2"), mb.searchArtists("c3")]);
  assert.ok(times[1] - times[0] >= 100 && times[2] - times[1] >= 100, JSON.stringify(times));
});
