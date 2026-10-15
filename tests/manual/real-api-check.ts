/**
 * 실제 외부 서비스(LRCLIB, MusicBrainz) 검증 스크립트 — 자동 테스트(tests/*.test.ts)와 분리된 "수동 실행용"이다.
 *
 *   실제 API:  npx tsx tests/manual/real-api-check.ts
 *   모의(점검용): npx tsx tests/manual/real-api-check.ts --selftest   ← 가짜 응답. 실제 검증이 아니다 (이 스크립트 자체의 동작 확인용)
 *
 * 옵션: --only=3 (3번 입력만)  --out=결과파일경로(기본 real-api-report.json / .md)  --pron (가사 앞 3줄 한글 발음도 확인)
 * 환경변수(선택): MB_CONTACT — MusicBrainz 가 요구하는 식별용 연락처(이메일 또는 URL). User-Agent 에만 들어간다.
 *
 * 지키는 것: MusicBrainz 는 초당 1회 이내 + 식별 가능한 User-Agent 를 요구한다 → 요청 간격 1.1초, User-Agent 지정.
 * 출력에는 요청 주소(검색어)·HTTP 상태·건수만 나온다. API 키/토큰/쿠키/개인 데이터는 쓰지도 출력하지도 않는다.
 * 판정: PASS / FAIL / BLOCKED(네트워크·서비스 오류로 확인 불가) / NA. "가사 없음"과 "API 오류"는 구분해서 표시한다.
 */
import { writeFileSync } from "node:fs";
import { LrclibProvider } from "../../src/lyrics/providers/lrclib";
import { MusicBrainzAliasProvider } from "../../src/lyrics/providers/musicbrainz";
import { resolveLyricsDetailed, searchRanked } from "../../src/lyrics/pipeline";
import { isAutoAccept } from "../../src/lyrics/matching";
import { parseLrc } from "../../src/lyrics/lrc";
import { LyricsApiError } from "../../src/lyrics/errors";
import { getSongAliases } from "../../src/utils/songAliases";
import type { ArtistHit, ScoredCandidate } from "../../src/lyrics/types";

const args = process.argv.slice(2);
const SELFTEST = args.includes("--selftest");
const PRON = args.includes("--pron");
const ONLY = Number(args.find((a) => a.startsWith("--only="))?.slice(7)) || 0;
const OUT = args.find((a) => a.startsWith("--out="))?.slice(6) ?? (SELFTEST ? "selftest-report" : "real-api-report");
const MODE = SELFTEST ? "MOCK(가짜 응답 — 실제 검증 아님)" : "REAL(실제 LRCLIB/MusicBrainz)";
const CONTACT = process.env.MB_CONTACT?.trim() || "no-contact-set";
const UA = `songbook-manager-real-check/1.0 (personal project; ${CONTACT})`;

interface Case { n: number; title: string; artist: string; titleRe: RegExp; artistRe: RegExp; names: string[] }
const CASES: Case[] = [
  { n: 1, title: "무희", artist: "바운디", titleRe: /踊り子|odoriko/i, artistRe: /vaundy/i, names: ["Vaundy"] },
  { n: 2, title: "무희", artist: "VAUNDY", titleRe: /踊り子|odoriko/i, artistRe: /vaundy/i, names: ["Vaundy"] },
  { n: 3, title: "Odoriko", artist: "Vaundy", titleRe: /踊り子|odoriko/i, artistRe: /vaundy/i, names: ["Vaundy"] },
  { n: 4, title: "踊り子", artist: "Vaundy", titleRe: /踊り子|odoriko/i, artistRe: /vaundy/i, names: ["Vaundy"] },
  { n: 5, title: "너는 록을 듣지 않아", artist: "아이묭", titleRe: /君はロックを聴かない|君はロックを聞かない|kimi wa rock/i, artistRe: /あいみょん|aimyon/i, names: ["あいみょん", "Aimyon"] },
  { n: 6, title: "君はロックを聴かない", artist: "あいみょん", titleRe: /君はロックを聴かない|君はロックを聞かない|kimi wa rock/i, artistRe: /あいみょん|aimyon/i, names: ["あいみょん", "Aimyon"] },
];

// ------------------------------------------------------------------ 요청 기록용 fetch (실제 또는 모의)
interface Req { service: string; path: string; status: number | "NETWORK_ERROR"; ms: number; detail?: string }
let reqLog: Req[] = [];
const TRUNC = (s: string) => (s.length > 160 ? s.slice(0, 157) + "..." : s);

function mockFetch(): typeof fetch {
  const LRC = "[00:01.00] a\n[00:02.00] b\n[00:03.00] c";
  const LR = [
    { id: 1, trackName: "踊り子", artistName: "Vaundy", duration: 238, syncedLyrics: LRC, plainLyrics: "a\nb\nc" },
    { id: 2, trackName: "君はロックを聴かない", artistName: "あいみょん", duration: 260, syncedLyrics: LRC, plainLyrics: "a\nb\nc" },
  ];
  const n = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  return (async (u: unknown) => {
    const url = new URL(String(u));
    if (url.hostname.includes("lrclib")) {
      const q = url.searchParams.get("q"), t = url.searchParams.get("track_name"), a = url.searchParams.get("artist_name");
      const r = LR.filter((x) => (q ? n(x.trackName + x.artistName).includes(n(q)) : (!t || n(x.trackName) === n(t)) && (!a || n(x.artistName) === n(a))));
      return new Response(JSON.stringify(r), { status: 200 });
    }
    const query = (url.searchParams.get("query") ?? "").toLowerCase();
    if (url.pathname.endsWith("/artist")) {
      const arts = [{ id: "va", name: "Vaundy", "sort-name": "Vaundy", score: 100, aliases: [] }, { id: "ai", name: "あいみょん", "sort-name": "Aimyon", score: 100, aliases: [{ name: "Aimyon" }] }];
      return new Response(JSON.stringify({ artists: arts.filter((x) => [x.name, ...x.aliases.map((y) => y.name)].some((nm) => query.includes(`"${nm.toLowerCase()}"`))) }), { status: 200 });
    }
    const aid = url.searchParams.get("artist");
    const recs = [
      { id: "r1", title: "踊り子", length: 238000, aliases: [{ name: "Odoriko" }], "artist-credit": [{ name: "Vaundy", artist: { id: "va" } }] },
      { id: "r2", title: "君はロックを聴かない", length: 260000, aliases: [], "artist-credit": [{ name: "あいみょん", artist: { id: "ai" } }] },
    ];
    if (aid) { const r = recs.filter((x) => x["artist-credit"][0].artist.id === aid); return new Response(JSON.stringify({ recordings: r, "recording-count": r.length }), { status: 200 }); }
    return new Response(JSON.stringify({ recordings: recs.filter((x) => query.includes(`"${x.title}"`)) }), { status: 200 });
  }) as typeof fetch;
}

function instrumented(): typeof fetch {
  const base: typeof fetch = SELFTEST ? mockFetch() : (...a) => fetch(...a);
  return (async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input));
    const service = url.hostname.includes("lrclib") ? "LRCLIB" : "MusicBrainz";
    const headers = new Headers(init?.headers);
    headers.set("User-Agent", UA);
    if (service === "LRCLIB") headers.set("Lrclib-Client", UA);
    const t0 = Date.now();
    try {
      const res = await base(String(input), { ...init, headers });
      reqLog.push({ service, path: TRUNC(decodeURIComponent(url.pathname + url.search)), status: res.status, ms: Date.now() - t0 });
      return res;
    } catch (e) {
      reqLog.push({ service, path: TRUNC(decodeURIComponent(url.pathname + url.search)), status: "NETWORK_ERROR", ms: Date.now() - t0, detail: e instanceof Error ? `${e.name}: ${e.message}${(e as { cause?: { code?: string } }).cause?.code ? ` (${(e as { cause?: { code?: string } }).cause?.code})` : ""}` : String(e) });
      throw e;
    }
  }) as typeof fetch;
}

type Verdict = "PASS" | "FAIL" | "BLOCKED" | "NA";
interface Check { name: string; verdict: Verdict; note: string }
const isBlocked = (r: Req) => r.status === "NETWORK_ERROR" || r.status === 403 || r.status === 407;
/** 확인하려던 것이 오류 때문에 못 이뤄졌다면 FAIL 이 아니라 BLOCKED(차단/네트워크) 또는 FAIL(API 오류 응답) 로 따로 표시한다 */
function failOrBlocked(since: number, name: string, note: string): Check {
  const errs = reqLog.slice(since).filter((r) => r.status === "NETWORK_ERROR" || (typeof r.status === "number" && r.status >= 400));
  if (errs.length > 0) {
    const blocked = errs.every(isBlocked);
    return { name, verdict: "BLOCKED", note: `${blocked ? "연결 불가/차단" : "서비스 오류 응답"}: ${errs.slice(0, 2).map((e) => `${e.service} ${e.status}${e.detail ? ` ${e.detail}` : ""}`).join(" | ")}` };
  }
  return { name, verdict: "FAIL", note };
}

async function runCase(c: Case, provider: LrclibProvider, mb: MusicBrainzAliasProvider) {
  reqLog = [];
  const checks: Check[] = [];
  const known = getSongAliases({ title: c.title, artist: c.artist });
  const input = { songId: "qa", title: c.title, artist: c.artist, ownLyrics: "", titleAliases: known.titles, artistAliases: known.artists };
  const lines: string[] = [];

  // 1) 앱과 같은 흐름으로 검색 (자동 선택 여부까지)
  let outcome = "-";
  let pool: ScoredCandidate[] = [];
  let s0 = reqLog.length;
  try {
    const r = await resolveLyricsDetailed(input, provider, { aliasProvider: mb });
    outcome = r.entry.outcome;
    pool = r.pool;
    lines.push(`앱 검색 결과: ${outcome}${r.entry.warnings.length ? ` (${r.entry.warnings.join(" / ")})` : ""}`);
  } catch (e) {
    outcome = `API_ERROR(${e instanceof LyricsApiError ? e.kind : "unknown"})`;
    lines.push(`앱 검색 결과: ${outcome} — 가사 없음이 아니라 서비스 오류`);
  }
  const searchReqs = reqLog.slice(s0);

  // A) 아티스트 식별
  s0 = reqLog.length;
  let hits: ArtistHit[] = [];
  const nameForMb = [...c.names, ...known.artists].find((x) => x.trim() && !/[가-힣]/.test(x)) ?? c.artist;
  try {
    hits = await mb.searchArtists(nameForMb);
  } catch { /* 아래에서 BLOCKED/FAIL 로 분류 */ }
  const best = hits.find((h) => [h.name, ...h.aliases].some((x) => c.artistRe.test(x)));
  checks.push(best ? { name: "아티스트 식별(MusicBrainz)", verdict: "PASS", note: `${best.name} [${best.mbid}] ${best.country ?? ""}` } : failOrBlocked(s0, "아티스트 식별(MusicBrainz)", `'${nameForMb}' 검색 결과 ${hits.length}명, 일치 없음`));

  // B) 후보 표시
  const found = pool.find((p) => c.titleRe.test(p.title) && c.artistRe.test(p.artist));
  const hangulInput = /[가-힣]/.test(c.title);
  if (found) {
    const auto = isAutoAccept(found, true);
    checks.push({ name: "올바른 곡 후보 표시", verdict: "PASS", note: `${found.title} / ${found.artist} · ${found.evidence?.label ?? ""} · ${auto ? "자동 선택됨" : "후보로 표시(직접 선택)"}${hangulInput && auto ? " ⚠ 한글 제목인데 자동 선택됨" : ""}` });
    if (hangulInput && auto) checks[checks.length - 1].verdict = "FAIL";
  } else {
    const errs = searchReqs.filter((r) => r.status === "NETWORK_ERROR" || (typeof r.status === "number" && r.status >= 400));
    checks.push(errs.length === searchReqs.length && searchReqs.length > 0 ? { name: "올바른 곡 후보 표시", verdict: "BLOCKED", note: `모든 검색 요청 실패 (${errs[0].status})` } : { name: "올바른 곡 후보 표시", verdict: hangulInput ? "NA" : "FAIL", note: `후보 ${pool.length}개 중 일치 없음${hangulInput ? " — 한글 제목은 '가수별 곡 찾기'로 직접 고르는 경로를 확인" : ""}` });
  }

  // C) 아티스트별 곡 목록 (등록된 곡에서 기대 제목 찾기, 최대 3페이지)
  let picked: { title: string; alt: string[] } | null = null;
  if (best) {
    s0 = reqLog.length;
    let off = 0;
    let total = 0;
    let scanned = 0;
    try {
      for (let page = 0; page < 3 && !picked; page++) {
        const p = await mb.browseRecordings(best.mbid, off);
        total = p.total;
        scanned += p.rawCount;
        const m = p.items.find((i) => [i.title, ...i.altTitles].some((t) => c.titleRe.test(t)));
        if (m) picked = { title: m.title, alt: m.altTitles };
        off += p.rawCount;
        if (p.rawCount === 0 || off >= p.total) break;
      }
    } catch { /* 분류는 아래 */ }
    checks.push(picked ? { name: "아티스트별 곡 목록 조회", verdict: "PASS", note: `등록 녹음 ${total}개 중 ${scanned}개 확인, '${picked.title}' 발견${picked.alt[0] ? ` (${picked.alt[0]})` : ""}` } : failOrBlocked(s0, "아티스트별 곡 목록 조회", `등록 녹음 ${total}개 중 ${scanned}개 확인, 기대 곡 없음 (MusicBrainz 등록 범위/페이지 한계일 수 있음)`));
  } else {
    checks.push({ name: "아티스트별 곡 목록 조회", verdict: "NA", note: "아티스트를 식별하지 못해 건너뜀" });
  }

  // D/E) 곡 선택 → LRCLIB 재검색 → 가사/싱크
  let lyricCand: ScoredCandidate | undefined;
  if (picked) {
    s0 = reqLog.length;
    try {
      const ranked = await searchRanked({ ...input, title: picked.title, artist: best!.name, titleAliases: picked.alt, artistAliases: [best!.name, ...best!.aliases] }, provider);
      lyricCand = ranked.find((r) => c.titleRe.test(r.title) && c.artistRe.test(r.artist));
      checks.push(lyricCand ? { name: "곡 선택 후 가사 조회", verdict: "PASS", note: `${lyricCand.title} / ${lyricCand.artist} · ${lyricCand.duration ?? "?"}s · ${lyricCand.syncedLyrics ? "싱크 가사" : lyricCand.plainLyrics ? "일반 가사만" : "가사 본문 없음"}` } : { name: "곡 선택 후 가사 조회", verdict: "FAIL", note: `LRCLIB 응답은 정상(오류 없음)이지만 이 곡의 가사가 없음 → '가사 없음'(API 오류 아님). 후보 ${ranked.length}개` });
    } catch (e) {
      checks.push({ name: "곡 선택 후 가사 조회", verdict: "BLOCKED", note: `API 오류라서 가사 유무를 알 수 없음: ${e instanceof LyricsApiError ? `${e.kind}${e.status ? " " + e.status : ""}` : "unknown"}` });
    }
  } else {
    checks.push({ name: "곡 선택 후 가사 조회", verdict: "NA", note: "곡 목록에서 곡을 고르지 못해 건너뜀" });
  }
  checks.push(lyricCand ? { name: "싱크 가사 여부", verdict: lyricCand.syncedLyrics ? "PASS" : "FAIL", note: lyricCand.syncedLyrics ? `싱크 ${parseLrc(lyricCand.syncedLyrics).length}줄` : "싱크 없음 (일반 가사만)" } : { name: "싱크 가사 여부", verdict: "NA", note: "가사 후보 없음" });
  checks.push({ name: "사용자가 곡을 선택할 수 있음", verdict: picked ? "PASS" : "NA", note: picked ? "목록에 곡이 나와 선택 가능" : "곡 목록 없음" });

  // 가사 앞 3줄 발음(선택)
  if (PRON && lyricCand?.syncedLyrics) {
    try {
      const { generatePronunciation } = await import("../../src/lyrics/pronunciation");
      const { TokenizerBuilder } = await import("@patdx/kuromoji");
      const NodeLoader = (await import("@patdx/kuromoji/node")).default;
      const tk = (await new TokenizerBuilder({ loader: new NodeLoader({ dic_path: "node_modules/@patdx/kuromoji/dict" } as never) }).build()) as never;
      const ls = parseLrc(lyricCand.syncedLyrics).slice(0, 3).map((l) => l.text);
      const pr = generatePronunciation(ls, { tokenizer: tk });
      ls.forEach((l, i) => lines.push(`  발음: ${l} → ${pr[i].pron} [${pr[i].status}]`));
    } catch (e) {
      lines.push(`  발음 확인 건너뜀: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { c, outcome, checks, requests: [...reqLog], lines };
}

async function main() {
  console.log(`모드: ${MODE}\nUser-Agent: ${UA}\n(요청 사이 간격: MusicBrainz 1.1초)\n`);
  const f = instrumented();
  const provider = new LrclibProvider(undefined, f);
  const mb = new MusicBrainzAliasProvider(undefined, f, SELFTEST ? 0 : 1100);
  const results = [];
  for (const c of CASES) {
    if (ONLY && c.n !== ONLY) continue;
    console.log(`\n=== [${c.n}/6] ${c.title} / ${c.artist}`);
    const r = await runCase(c, provider, mb);
    for (const q of r.requests) console.log(`  ${q.service} ${q.path} → ${q.status} (${q.ms}ms)${q.detail ? ` ${q.detail}` : ""}`);
    for (const l of r.lines) console.log(`  ${l}`);
    for (const k of r.checks) console.log(`  [${k.verdict}] ${k.name} — ${k.note}`);
    results.push(r);
  }
  // 요약
  const tally: Record<Verdict, number> = { PASS: 0, FAIL: 0, BLOCKED: 0, NA: 0 };
  for (const r of results) for (const k of r.checks) tally[k.verdict]++;
  console.log(`\n=== 요약 (${MODE}) PASS ${tally.PASS} · FAIL ${tally.FAIL} · BLOCKED ${tally.BLOCKED} · NA ${tally.NA}`);
  if (tally.BLOCKED > 0 && tally.PASS === 0) console.log("→ 이 환경에서는 외부 API 에 연결할 수 없어 실제 검증을 하지 못했습니다 (BLOCKED). 인터넷이 되는 PC 에서 다시 실행하세요.");
  const md = [`# 실제 API 검증 결과 — ${MODE}`, `실행: ${new Date().toISOString()}`, "", ...results.flatMap((r) => [`## [${r.c.n}] ${r.c.title} / ${r.c.artist}`, `앱 검색 결과: ${r.outcome}`, "", "요청:", ...r.requests.map((q) => `- ${q.service} \`${q.path}\` → ${q.status} (${q.ms}ms)${q.detail ? ` ${q.detail}` : ""}`), "", "검사:", ...r.checks.map((k) => `- **${k.verdict}** ${k.name} — ${k.note}`), ""]), `요약: PASS ${tally.PASS} · FAIL ${tally.FAIL} · BLOCKED ${tally.BLOCKED} · NA ${tally.NA}`].join("\n");
  writeFileSync(`${OUT}.md`, md);
  writeFileSync(`${OUT}.json`, JSON.stringify({ mode: MODE, results }, null, 2));
  console.log(`\n결과 파일: ${OUT}.md / ${OUT}.json (공유해도 되는 내용만 들어 있어요: 요청 주소·상태·곡 정보)`);
}
await main();
