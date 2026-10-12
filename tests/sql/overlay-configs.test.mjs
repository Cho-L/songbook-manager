// 20261013_overlay_configs.sql 검증 (실제 Postgres=pglite): Phase 2 SQL 만 적용된 상태 / Phase 3 적용 후 / 재실행 / RLS / 공개 RPC / 롤백.
// 실행: npm i --no-save @electric-sql/pglite && node tests/sql/overlay-configs.test.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
const R = new URL("../../supabase/", import.meta.url).pathname;
const db = new PGlite(); let pass = 0, fail = 0;
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
// ---- Phase 2 SQL 까지만 적용된 상태
for (const f of ["20261011_song_requests.sql", "20261012_request_queue_v2.sql", "20261012_song_aliases.sql"]) await db.exec(sql("migrations/" + f));
const A = "00000000-0000-0000-0000-00000000000a", B = "00000000-0000-0000-0000-00000000000b";
await db.exec(`insert into auth.users values ('${A}','a@x','{}'),('${B}','b@x','{}')`);
const sid = (await db.query(`insert into songs (owner_id,title,artist) values ('${A}','곡','가수') returning id`)).rows[0].id;
await db.query(`insert into song_request_settings (book_id,accepting) values ($1,true)`, [A]);
const as = async (role, uid, fn) => { await db.exec(`set role ${role}; select set_config('request.jwt.uid','${uid ?? ""}',false);`); try { return await fn(); } finally { await db.exec("reset role"); } };
const tryRun = async (role, uid, q, p = []) => { try { return { rows: (await as(role, uid, () => db.query(q, p))).rows }; } catch (e) { return { err: e.message }; } };
const tableCount = async () => (await db.query(`select count(*)::int c from pg_tables where tablename='overlay_configs'`)).rows[0].c;
ok("Phase 2 만 적용: overlay_configs 없음 (앱은 로컬 저장으로 대체)", (await tableCount()) === 0);
const reqCountBefore = (await db.query(`select count(*)::int c from song_request_settings`)).rows[0].c;

// ---- Phase 3 적용 + 재실행
await db.exec(sql("migrations/20261013_overlay_configs.sql")); await db.exec(sql("migrations/20261013_overlay_configs_rollback.sql")); await db.exec(sql("migrations/20261013_overlay_configs.sql"));
ok("Phase 3 적용 → 롤백 → 재적용 오류 없음", (await tableCount()) === 1);
ok("Phase 2 데이터/함수 영향 없음", (await db.query(`select count(*)::int c from song_request_settings`)).rows[0].c === reqCountBefore && (await db.query(`select count(*)::int c from pg_proc where proname in ('submit_song_request','get_public_request_queue','start_song_request')`)).rows[0].c === 3);

// ---- RLS: 주인만
const cfg = JSON.stringify({ queue: { n: 3 }, box: { w: 640 } });
const up = (uid, book, kind = "queue", c = cfg) => tryRun("authenticated", uid, `insert into overlay_configs (book_id,kind,config) values ($1,$2,$3::jsonb) on conflict (book_id,kind) do update set config=excluded.config returning rev`, [book, kind, c]);
ok("주인은 저장 가능", (await up(A, A)).rows?.[0]?.rev === 1);
ok("두 번째 저장(upsert) → rev 증가", (await up(A, A, "queue", JSON.stringify({ queue: { n: 4 } }))).rows?.[0]?.rev === 2);
ok("다른 사용자는 남의 노래책에 저장 불가", !!(await up(B, A, "song")).err);
ok("다른 사용자는 읽기도 불가(0행)", (await tryRun("authenticated", B, `select * from overlay_configs`)).rows.length === 0);
ok("주인은 자기 설정 읽기 가능", (await tryRun("authenticated", A, `select * from overlay_configs`)).rows.length === 1);
ok("익명(anon)은 테이블 직접 접근 불가", !!(await tryRun("anon", "", `select * from overlay_configs`)).err);
ok("종류는 song/lyrics/queue 만", !!(await up(A, A, "admin")).err);
ok("config 는 객체만", !!(await up(A, A, "song", JSON.stringify([1, 2]))).err);
ok("config 8KB 초과 거부", !!(await up(A, A, "song", JSON.stringify({ x: "가".repeat(9000) }))).err);
ok("종류별 독립 저장", (await up(A, A, "song", JSON.stringify({ overlay: { preset: "mini" } }))).rows?.[0]?.rev === 1 && (await up(A, A, "lyrics", JSON.stringify({ overlay: { preset: "karaoke" } }))).rows?.[0]?.rev === 1);

// ---- 공개 RPC (Worker=service_role 만)
const pub = (book, kind) => tryRun("service_role", "", `select public.get_public_overlay_config($1,$2) r`, [book, kind]);
const r1 = (await pub(A, "queue")).rows[0].r;
ok("공개 조회: 저장된 설정 + rev", r1.rev === 2 && r1.config.queue.n === 4, JSON.stringify(r1));
ok("공개 조회: 없으면 config=null, rev=0", await (async () => { const v = (await pub(B, "queue")).rows[0].r; return v.config === null && v.rev === 0; })());
ok("공개 조회 결과에 book_id/updated_at 등 다른 열 없음", Object.keys(r1).sort().join() === "config,rev");
for (const role of ["anon", "authenticated"]) ok(`${role} 는 공개 조회 RPC 실행 불가`, !!(await tryRun(role, A, `select public.get_public_overlay_config($1,$2)`, [A, "queue"])).err);

// ---- 노래책(프로필) 삭제 시 함께 삭제 / 롤백
await db.exec(`delete from songs; delete from song_requests; delete from song_request_settings`);
await db.exec(sql("migrations/20261013_overlay_configs_rollback.sql"));
ok("롤백: 표/함수 제거, 곡/신청 데이터 영향 없음", (await tableCount()) === 0 && (await db.query(`select count(*)::int c from pg_proc where proname='get_public_overlay_config'`)).rows[0].c === 0 && (await db.query(`select count(*)::int c from pg_proc where proname='submit_song_request'`)).rows[0].c === 1);
void sid;
console.log(`${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
