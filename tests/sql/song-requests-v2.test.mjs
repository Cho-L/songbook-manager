// 20261012 마이그레이션 검증 (실제 Postgres=pglite): 적용 전/후 호환, 원자적 재생 시작, 재생 중 1곡 제약, 롤백.
// 실행: npm i --no-save @electric-sql/pglite && node tests/sql/song-requests-v2.test.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
const R = new URL("../../supabase/", import.meta.url).pathname;
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) pass++; else fail++; console.log(c ? "PASS" : "FAIL", n, c ? "" : x); };
await db.exec(`
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.uid', true), '')::uuid $$;
create role anon nologin; create role authenticated nologin; create role service_role nologin;
grant usage on schema public, auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`);
const sql = (f) => fs.readFileSync(R + f, "utf8");
await db.exec(sql("schema.sql"));
await db.exec(sql("migrations/20261011_song_requests.sql"));
const A = "00000000-0000-0000-0000-00000000000a", B = "00000000-0000-0000-0000-00000000000b";
await db.exec(`insert into auth.users values ('${A}','a@x','{}'),('${B}','b@x','{}');`);
const mk = async (o, t) => (await db.query(`insert into songs (owner_id,title,artist) values ($1,$2,'가수') returning id`, [o, t])).rows[0].id;
const s1 = await mk(A, "곡1"), s2 = await mk(A, "곡2"), s3 = await mk(A, "곡3");
const k = (c) => c.repeat(64);
const ins = async (song, st, pos, key = "a") => (await db.query(`insert into song_requests (book_id,song_id,title,requester_name,requester_key,status,position) values ($1,$2,'t','x',$3,$4,$5) returning id`, [A, song, k(key), st, pos])).rows[0].id;
const as = async (role, uid, fn) => { await db.exec(`set role ${role}; select set_config('request.jwt.uid','${uid ?? ""}',false);`); try { return await fn(); } finally { await db.exec("reset role"); } };
const pub = () => as("service_role", "", async () => (await db.query(`select public.get_public_request_queue('${A}') r`)).rows[0].r);

// --- 적용 전(v1) 호환
const r1 = await ins(s1, "approved", 1), r2 = await ins(s2, "pending", 2, "b");
let q = await pub();
ok("v1: songId/pendingSongIds 없음, 기존 필드 정상", q.pendingSongIds === undefined && q.queue.length === 1 && q.queue[0].songId === undefined && q.pendingCount === 1);

// --- v2 적용 (재실행 안전)
await db.exec(sql("migrations/20261012_request_queue_v2.sql"));
await db.exec(sql("migrations/20261012_request_queue_v2_rollback.sql"));
await db.exec(sql("migrations/20261012_request_queue_v2.sql"));
ok("v2 적용 → 롤백 → 재적용 오류 없음", true);
q = await pub();
ok("v2: queue 에 songId, pendingSongIds 에 대기곡 id", q.queue[0].songId === s1 && JSON.stringify(q.pendingSongIds) === JSON.stringify([s2]));
ok("v2: pending 쪽에 신청자 이름/키 없음", !JSON.stringify(q).includes(k("b")) && q.pendingSongIds.every((x) => typeof x === "string"));
ok("anon/authenticated 는 공개 큐 RPC 실행 불가", await (async () => { for (const role of ["anon", "authenticated"]) { try { await as(role, A, () => db.query(`select public.get_public_request_queue('${A}')`)); return false; } catch { /* 기대한 거부 */ } } return true; })());

// --- 재생 시작 RPC
const start = (uid, id) => as("authenticated", uid, async () => (await db.query(`select public.start_song_request($1) r`, [id])).rows[0].r);
ok("다른 노래책 관리자는 시작 불가(RLS: 보이지 않아 false)", (await start(B, r1)) === false);
ok("pending 곡은 시작 불가(false)", (await start(A, r2)) === false);
ok("본인 approved 곡 시작 → true", (await start(A, r1)) === true);
const st = async () => Object.fromEntries((await db.query(`select id, status from song_requests`)).rows.map((r) => [r.id, r.status]));
ok("재생 중 상태로 변경", (await st())[r1] === "playing");
await db.exec(`update song_requests set status='approved' where id='${r2}'`);
ok("두 번째 곡 시작 → 기존 재생 곡은 done, 새 곡만 playing", (await start(A, r2)) === true && (await st())[r1] === "done" && (await st())[r2] === "playing");
ok("같은 곡 재시작은 멱등(true), 여전히 재생 중 1곡", (await start(A, r2)) === true && (await db.query(`select count(*)::int c from song_requests where status='playing'`)).rows[0].c === 1);
const r3 = await ins(s3, "approved", 3, "c");
let dup = false; try { await db.exec(`update song_requests set status='playing' where id='${r3}'`); } catch { dup = true; }
ok("직접 UPDATE 로 재생 중 2곡 만들기 → 유니크 인덱스가 막음", dup);

// --- 조건부 상태 변경(승인 중복 방지) 시뮬레이션: 같은 pending 을 두 화면이 동시에 승인/거절
const p = await ins(await mk(A, "곡4"), "pending", 4, "d");
const cond = async (to, from) => (await as("authenticated", A, () => db.query(`update song_requests set status=$1 where id=$2 and status = any($3::text[]) returning id`, [to, p, from]))).rows.length;
const first = await cond("approved", ["pending", "rejected"]);
const second = await cond("rejected", ["pending", "approved"].filter((x) => x === "pending")); // 두 번째 화면: 아직 pending 인 줄 알고 거절 시도
ok("첫 화면 승인 1건 반영", first === 1);
ok("두 번째 화면의 거절은 0건 → 충돌 감지(승인 결과를 덮지 않음)", second === 0 && (await st())[p] === "approved");

// --- 롤백
await db.exec(sql("migrations/20261012_request_queue_v2_rollback.sql"));
q = await pub();
ok("롤백 후 v1 응답 형태, 인덱스/함수 제거", q.pendingSongIds === undefined && (await db.query(`select count(*)::int c from pg_indexes where indexname='song_requests_one_playing_uidx'`)).rows[0].c === 0 && (await db.query(`select count(*)::int c from pg_proc where proname='start_song_request'`)).rows[0].c === 0);
console.log(`${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
