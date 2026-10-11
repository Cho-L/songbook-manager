// 실제 Postgres(pglite, WASM)로 마이그레이션 SQL/RLS/RPC 를 검증한다.
// 실행: npm i --no-save @electric-sql/pglite && node tests/sql/song-requests-db.mjs  (package.json 에는 추가하지 않는다)
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
const R = new URL("../../supabase/", import.meta.url).pathname;
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) pass++; else fail++; console.log(c ? "PASS" : "FAIL", n, x); };
// Supabase 흉내: auth 스키마, 역할
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
await db.exec(fs.readFileSync(R + "migrations/20261011_song_requests.sql", "utf8")); // idempotent
ok("스키마 + 마이그레이션 적용, 재실행 안전", true);
const A = "00000000-0000-0000-0000-00000000000a", B = "00000000-0000-0000-0000-00000000000b";
await db.exec(`insert into auth.users values ('${A}','a@x','{}'),('${B}','b@x','{}');`);
const songs = {};
for (const [k, o, t] of [["s1", A, "곡1"], ["s2", A, "곡2"], ["s3", A, "곡3"], ["s4", A, "곡4"], ["sB", B, "B의곡"]]) {
  const r = await db.query(`insert into songs (owner_id,title,artist) values ('${o}','${t}','가수') returning id`); songs[k] = r.rows[0].id;
}
const as = async (role, uid, fn) => { await db.exec(`set role ${role}; select set_config('request.jwt.uid','${uid ?? ""}',false);`); try { return await fn(); } finally { await db.exec("reset role"); } };
const key = (c) => (/^[0-9a-f]$/.test(c) ? c : (c.charCodeAt(0) % 10).toString()).repeat(64);
const submit = (book, song, name, k) => as("service_role", "", async () => (await db.query(`select public.submit_song_request($1,$2,$3,$4) r`, [book, song, name, k])).rows[0].r);
const tryQ = async (role, uid, sql, p = []) => { try { return { rows: (await as(role, uid, () => db.query(sql, p))).rows }; } catch (e) { return { err: e.message }; } };

// 접수 닫힘이 기본
ok("설정 없으면 closed", (await submit(A, songs.s1, "철수", key("a"))).code === "closed");
await as("authenticated", A, () => db.query(`insert into song_request_settings (book_id, accepting, per_user_max, max_queue) values ($1,true,2,3)`, [A]));
let r = await submit(A, songs.s1, "  철수   님 ", key("a"));
ok("정상 접수 + 이름 공백 정리", r.ok === true && r.position === 1, JSON.stringify(r));
ok("저장된 이름 정리됨", (await db.query(`select requester_name n from song_requests`)).rows[0].n === "철수 님");
ok("20초 쿨다운", (await submit(A, songs.s2, "철수", key("a"))).code === "cooldown");
await db.exec(`update song_requests set requested_at = now() - interval '1 minute'`);
ok("같은 곡 중복", (await submit(A, songs.s1, "영희", key("b"))).code === "duplicate_song");
ok("다른 노래책의 곡은 불가", (await submit(A, songs.sB, "영희", key("b"))).code === "song_not_found");
ok("존재하지 않는 곡", (await submit(A, "11111111-1111-1111-1111-111111111111", "영희", key("b"))).code === "song_not_found");
ok("잘못된 키", (await submit(A, songs.s2, "영희", "short")).code === "bad_request");
ok("빈 이름", (await submit(A, songs.s2, "   ", key("b"))).code === "bad_name");
ok("31자 이름", (await submit(A, songs.s2, "가".repeat(31), key("b"))).code === "bad_name");
ok("제어문자 이름", (await submit(A, songs.s2, "a\u0007b", key("b"))).code === "bad_name");
r = await submit(A, songs.s2, "철수", key("a"));
ok("1인 2곡까지", r.ok === true && r.position === 2);
await db.exec(`update song_requests set requested_at = now() - interval '1 minute'`);
ok("1인 한도(per_user_max=2) 초과", (await submit(A, songs.s3, "철수", key("a"))).code === "user_limit");
ok("다른 사람은 가능", (await submit(A, songs.s3, "영희", key("c"))).ok === true);
await db.exec(`update song_requests set requested_at = now() - interval '1 minute'`);
ok("큐 가득(max_queue=3)", (await submit(A, songs.s4, "민수", key("d"))).code === "queue_full");
// 시간당 10회
await db.exec(`update song_requests set status='rejected'`);
await db.exec(`update song_request_settings set max_queue=100, per_user_max=10`);
for (let i = 0; i < 10; i++) { await db.exec(`insert into song_requests (book_id,title,requester_name,requester_key,status,requested_at) values ('${A}','t${i}','x','${key("e")}','done', now() - interval '2 minutes')`); }
ok("시간당 10회 제한", (await submit(A, songs.s4, "스팸", key("e"))).code === "rate_limited");
// 거절된 곡은 다시 신청 가능
await db.exec(`update song_requests set status='done'`);
ok("끝난 곡은 재신청 가능", (await submit(A, songs.s1, "새사람", key("f"))).ok === true);
// 접수 닫기
await as("authenticated", A, () => db.query(`update song_request_settings set accepting=false where book_id=$1`, [A]));
ok("접수 닫으면 거절", (await submit(A, songs.s2, "또", key("g"))).code === "closed");

// ---- 동시성: 같은 곡 동시 신청은 한 건만 (advisory lock + 부분 unique)
await db.exec(`update song_requests set status='done'; update song_request_settings set accepting=true, per_user_max=10, max_queue=100 where book_id='${A}'`);
const res = await Promise.all([1, 2, 3, 4, 5].map((i) => submit(A, songs.s4, "동시" + i, (String(i)).repeat(64))));
ok("동시 5건 같은 곡 → 성공 1건", res.filter((x) => x.ok).length === 1, JSON.stringify(res.map((x) => x.code ?? "ok")));

// ---- 권한/RLS
const anonRead = await tryQ("anon", "", `select * from song_requests`);
ok("anon 직접 SELECT 거부(RLS/권한)", anonRead.err || anonRead.rows.length === 0, JSON.stringify(anonRead).slice(0, 80));
ok("anon 직접 INSERT 거부", !!(await tryQ("anon", "", `insert into song_requests (book_id,title,requester_name,requester_key) values ('${A}','x','y','${key("z")}')`)).err);
ok("anon RPC 직접 호출 거부", !!(await tryQ("anon", "", `select public.submit_song_request('${A}','${songs.s1}','x','${key("z")}')`)).err);
ok("authenticated(비관리자) RPC 직접 호출 거부", !!(await tryQ("authenticated", B, `select public.submit_song_request('${A}','${songs.s1}','x','${key("z")}')`)).err);
ok("anon 공개큐 RPC 직접 호출 거부", !!(await tryQ("anon", "", `select public.get_public_request_queue('${A}')`)).err);
ok("다른 관리자(B)는 A의 신청을 못 봄", (await tryQ("authenticated", B, `select * from song_requests where book_id='${A}'`)).rows.length === 0);
ok("소유자(A)는 봄", (await tryQ("authenticated", A, `select * from song_requests where book_id='${A}'`)).rows.length > 0);
ok("다른 관리자(B)는 A의 신청 수정 불가", (await tryQ("authenticated", B, `update song_requests set status='approved' where book_id='${A}' returning id`)).rows.length === 0);
const ownIns = await tryQ("authenticated", B, `insert into song_request_settings (book_id,accepting) values ('${A}',true)`);
ok("B가 A의 접수 설정을 바꾸려는 INSERT 거부", !!ownIns.err, ownIns.err?.slice(0, 60));
// 공개 큐
await db.exec(`update song_requests set status='approved', position=2 where title='곡4'`);
await db.exec(`insert into song_requests (book_id,title,artist,requester_name,requester_key,status,position) values ('${A}','재생중곡','가','재생자','${key("p")}','playing',9)`);
const pub = (await as("service_role", "", () => db.query(`select public.get_public_request_queue($1) r`, [A]))).rows[0].r;
ok("공개 큐: 재생중이 맨 앞, 해시/키 미포함", pub.queue[0].status === "playing" && !JSON.stringify(pub).includes(key("p")) && !("requesterKey" in pub.queue[0]), JSON.stringify(pub).slice(0, 200));
// 상태 전이 트리거
await as("authenticated", A, () => db.query(`update song_requests set status='done' where title='재생중곡'`));
const done = (await db.query(`select done_at, approved_at from song_requests where title='재생중곡'`)).rows[0];
ok("done_at 자동 기록", !!done.done_at);
await db.exec(`update song_requests set status='pending', approved_at=null where title='곡3'`);
await as("authenticated", A, () => db.query(`update song_requests set status='approved' where title='곡3'`));
ok("approved_at 자동 기록", !!(await db.query(`select approved_at a from song_requests where title='곡3'`)).rows[0].a);
// 노래 삭제 시 기록 보존
await db.exec(`delete from songs where id='${songs.s4}'`);
const kept = (await db.query(`select title, song_id from song_requests where title='곡4'`)).rows[0];
ok("곡 삭제 후에도 신청 기록(제목) 보존, song_id=null", kept && kept.song_id === null);
// 롤백
await db.exec(fs.readFileSync(R + "migrations/20261011_song_requests_rollback.sql", "utf8"));
ok("롤백 SQL 동작, 기존 songs 유지", (await db.query(`select count(*)::int c from songs`)).rows[0].c >= 4);
console.log(`${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
