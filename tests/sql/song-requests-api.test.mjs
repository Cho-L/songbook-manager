// Worker 신청 API 핸들러 → (가짜 fetch) → 실제 Postgres(pglite)의 RPC 까지 이어서 검증한다.
// 실행: npm i --no-save @electric-sql/pglite && npx tsx tests/sql/song-requests-api.test.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import { handleSongRequests } from "../../src/server/songRequestHandler.ts";

const R = new URL("../../supabase/", import.meta.url).pathname;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) pass++; else fail++; console.log(c ? "PASS" : "FAIL", n, c ? "" : x); };

const db = new PGlite();
await db.exec(`
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.uid', true), '')::uuid $$;
create role anon nologin; create role authenticated nologin; create role service_role nologin;
grant usage on schema public, auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`);
await db.exec(fs.readFileSync(R + "schema.sql", "utf8"));
await db.exec(fs.readFileSync(R + "migrations/20261011_song_requests.sql", "utf8"));
await db.exec(fs.readFileSync(R + "migrations/20261012_request_queue_v2.sql", "utf8"));
const BOOK = "00000000-0000-0000-0000-00000000000a";
await db.exec(`insert into auth.users values ('${BOOK}','a@x','{}')`);
const songIds = [];
for (const t of ["곡1", "곡2", "곡3"]) songIds.push((await db.query(`insert into songs (owner_id,title,artist) values ($1,$2,'가수') returning id`, [BOOK, t])).rows[0].id);
await db.exec(`insert into song_request_settings (book_id, accepting, per_user_max, max_queue) values ('${BOOK}', true, 2, 50)`);

const SECRET = "service-role-secret-XYZ";
const env = { SUPABASE_URL: "https://fake.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SECRET };
let lastAuth = [];
// 가짜 PostgREST: /rest/v1/rpc/<name> → service_role 로 pglite 실행. service role 키가 맞을 때만.
const fakeFetch = async (url, init) => {
  const u = new URL(url);
  const name = u.pathname.split("/").pop();
  const h = init.headers;
  lastAuth.push(h.Authorization);
  if (h.apikey !== SECRET || h.Authorization !== `Bearer ${SECRET}`) return new Response("{}", { status: 401 });
  if (globalThis.__rpcDown) return new Response("boom", { status: 500 });
  const a = JSON.parse(init.body);
  await db.exec("set role service_role");
  try {
    const vals = Object.values(a);
    const sql = `select public.${name}(${vals.map((_, i) => `$${i + 1}`).join(",")}) r`;
    const r = (await db.query(sql, vals)).rows[0].r;
    return new Response(JSON.stringify(r), { status: 200, headers: { "Content-Type": "application/json" } });
  } finally { await db.exec("reset role"); }
};
const call = (method, { ip = "1.1.1.1", body, origin = "https://app.example", query = "", ct = "application/json", raw } = {}) =>
  handleSongRequests(new Request(`https://app.example/api/song-requests${query}`, {
    method,
    headers: { "CF-Connecting-IP": ip, ...(origin ? { Origin: origin } : {}), ...(ct ? { "Content-Type": ct } : {}) },
    body: method === "GET" ? undefined : raw ?? JSON.stringify(body),
  }), env, fakeFetch);
const post = (body, o = {}) => call("POST", { body, ...o });
const j = async (res) => res.json();
const clearCool = () => db.exec(`update song_requests set requested_at = now() - interval '5 minutes'`);

let res = await post({ bookId: BOOK, songId: songIds[0], name: " 시청자 " });
let body = await j(res);
ok("정상 신청 200", res.status === 200 && body.ok && body.position === 1, JSON.stringify(body));
ok("DB 저장: 이름 정리, 상태 pending, source web", (await db.query(`select requester_name n, status s, source o from song_requests`)).rows[0].n === "시청자");
const keyRow = (await db.query(`select requester_key k from song_requests`)).rows[0].k;
ok("신청자 키는 64자 hex 해시이고 원본 IP 미포함", /^[0-9a-f]{64}$/.test(keyRow) && !keyRow.includes("1.1.1.1"));
ok("DB 어디에도 원본 IP 문자열 없음", (await db.query(`select count(*)::int c from song_requests where requester_key like '%1.1.1.1%' or requester_name like '%1.1.1.1%'`)).rows[0].c === 0);
res = await post({ bookId: BOOK, songId: songIds[1], name: "시청자" });
ok("같은 IP 20초 내 재신청 → 429 + Retry-After", res.status === 429 && res.headers.get("Retry-After") === "20" && (await j(res)).code === "cooldown");
await clearCool();
res = await post({ bookId: BOOK, songId: songIds[0], name: "다른사람" }, { ip: "2.2.2.2" });
ok("같은 곡 중복 → 409 duplicate_song", res.status === 409 && (await j(res)).code === "duplicate_song");
res = await post({ bookId: BOOK, songId: songIds[1], name: "B" }, { ip: "2.2.2.2" });
ok("다른 IP는 다른 키로 신청 성공", res.status === 200);
await clearCool();
await post({ bookId: BOOK, songId: songIds[2], name: "시청자" }); await clearCool();
res = await post({ bookId: BOOK, songId: songIds[2], name: "시청자" });
ok("이미 대기 중인 곡(같은 사람)도 duplicate", res.status === 409);
const keys = (await db.query(`select distinct requester_key from song_requests`)).rows.length;
ok("IP 2개 → 키 2개", keys === 2, String(keys));

// 입력 검증
ok("UUID 아닌 bookId → 400", (await post({ bookId: "x", songId: songIds[0], name: "a" })).status === 400);
ok("UUID 아닌 songId → 400", (await post({ bookId: BOOK, songId: "1; drop table songs", name: "a" })).status === 400);
ok("빈 이름 → 400 bad_name", (await j(await post({ bookId: BOOK, songId: songIds[0], name: "  " }))).code === "bad_name");
ok("긴 이름 → 400", (await post({ bookId: BOOK, songId: songIds[0], name: "가".repeat(31) })).status === 400);
ok("이름이 문자열 아님 → 400", (await post({ bookId: BOOK, songId: songIds[0], name: { a: 1 } })).status === 400);
ok("배열 본문 → 400", (await post([1, 2])).status === 400);
ok("깨진 JSON → 400", (await call("POST", { raw: "{not json" })).status === 400);
ok("2KB 초과 → 413", (await post({ bookId: BOOK, songId: songIds[0], name: "a", pad: "x".repeat(3000) })).status === 413);
ok("Content-Type 아님 → 400", (await call("POST", { raw: "a=b", ct: "text/plain" })).status === 400);
ok("다른 사이트 Origin → 403", (await post({ bookId: BOOK, songId: songIds[0], name: "a" }, { origin: "https://evil.example" })).status === 403);
ok("잘못된 Origin 값 → 403", (await post({ bookId: BOOK, songId: songIds[0], name: "a" }, { origin: "not a url" })).status === 403);
ok("PUT → 405", (await call("PUT", { raw: "{}" })).status === 405);
const before = (await db.query(`select count(*)::int c from song_requests`)).rows[0].c;
await clearCool();
res = await post({ bookId: BOOK, songId: songIds[0], name: "봇", website: "http://spam" }, { ip: "9.9.9.9" });
ok("허니팟: 성공처럼 응답하지만 저장 안 함", res.status === 200 && (await j(res)).ok && (await db.query(`select count(*)::int c from song_requests`)).rows[0].c === before);
ok("SQL 인젝션 시도 이름도 문자열로만 저장", await (async () => { await clearCool(); await db.exec(`update song_requests set status='done'`); const r = await post({ bookId: BOOK, songId: songIds[0], name: "'; drop table songs;--" }, { ip: "3.3.3.3" }); return r.status === 200 && (await db.query(`select count(*)::int c from songs`)).rows[0].c === 3; })());

// 접수 닫힘 / 다른 노래책
await db.exec(`update song_request_settings set accepting=false`);
res = await post({ bookId: BOOK, songId: songIds[1], name: "a" }, { ip: "4.4.4.4" });
ok("접수 닫힘 → 403 closed", res.status === 403 && (await j(res)).code === "closed");
await db.exec(`update song_request_settings set accepting=true`);
res = await post({ bookId: "11111111-1111-1111-1111-111111111111", songId: songIds[1], name: "a" }, { ip: "4.4.4.4" });
ok("접수 설정 없는 노래책 → 403", res.status === 403);

// 공개 큐 조회
await db.exec(`update song_requests set status='approved' where title='곡2'`);
res = await call("GET", { query: `?book=${BOOK}`, origin: null });
body = await j(res);
ok("공개 큐: 승인된 곡만, 허용 필드만", res.status === 200 && body.accepting === true && body.queue.every((q) => Object.keys(q).sort().join() === "artist,id,requesterName,songId,status,title"), JSON.stringify(body));
ok("공개 큐: pendingSongIds 는 곡 id 문자열만", Array.isArray(body.pendingSongIds) && body.pendingSongIds.every((x) => typeof x === "string"));
ok("공개 큐 응답에 해시/비밀 없음", !JSON.stringify(body).includes(keyRow) && !JSON.stringify(body).includes(SECRET));
ok("공개 큐: book 파라미터 검증", (await call("GET", { query: "?book=zzz", origin: null })).status === 400);

// 서버 장애/설정
globalThis.__rpcDown = true;
res = await post({ bookId: BOOK, songId: songIds[1], name: "a" }, { ip: "5.5.5.5" });
const txt = await res.text();
ok("RPC 장애 → 502, 내부 정보/키 노출 없음", res.status === 502 && !txt.includes(SECRET) && !txt.includes("supabase.co"), txt);
globalThis.__rpcDown = false;
res = await handleSongRequests(new Request("https://app.example/api/song-requests", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } }), {}, fakeFetch);
ok("환경변수 없음 → 503", res.status === 503);
ok("RPC 호출은 항상 service role 키 사용", lastAuth.every((a) => a === `Bearer ${SECRET}`));

// 공개(anon) 키로는 RPC 를 못 부른다는 것도 함께 확인
await db.exec("set role anon");
let denied = false; try { await db.query(`select public.get_public_request_queue('${BOOK}')`); } catch { denied = true; }
await db.exec("reset role");
ok("anon 키로 직접 RPC 호출 불가", denied);
console.log(`${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
