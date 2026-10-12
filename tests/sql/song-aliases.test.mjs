// 20261012_song_aliases.sql: 적용 전 데이터 보존/적용 후 기본값/재실행/롤백 (실제 Postgres=pglite)
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
const R = new URL("../../supabase/", import.meta.url).pathname;
const db = new PGlite(); let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) pass++; else fail++; console.log(c ? "PASS" : "FAIL", n, c ? "" : x); };
await db.exec(`create schema auth; create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create role anon nologin; create role authenticated nologin; create role service_role nologin;`);
await db.exec(fs.readFileSync(R + "schema.sql", "utf8"));
const U = "00000000-0000-0000-0000-00000000000a";
await db.exec(`insert into auth.users values ('${U}','a@x','{}')`);
await db.exec(`insert into songs (owner_id,title,artist,tags) values ('${U}','이름에게','아이유','{발라드}')`);
let missing = false; try { await db.exec(`insert into songs (owner_id,title,artist,title_aliases) values ('${U}','x','y','{a}')`); } catch { missing = true; }
ok("적용 전: 별칭 컬럼 쓰기는 거부(앱이 안내 문구로 변환)", missing);
ok("적용 전: 별칭 없이 저장/조회는 정상", (await db.query(`select title from songs`)).rows.length === 1);
const mig = fs.readFileSync(R + "migrations/20261012_song_aliases.sql", "utf8");
await db.exec(mig); await db.exec(mig);
ok("적용(재실행 포함) 후 기존 행 보존 + 기본값 '{}'", JSON.stringify((await db.query(`select title, title_aliases a, artist_aliases b, tags from songs`)).rows) === JSON.stringify([{ title: "이름에게", a: [], b: [], tags: ["발라드"] }]));
await db.exec(`update songs set title_aliases='{Dear Name}', artist_aliases='{IU}'`);
ok("별칭 저장/조회", (await db.query(`select title_aliases[1] a, artist_aliases[1] b from songs`)).rows[0].a === "Dear Name");
await db.exec(fs.readFileSync(R + "migrations/20261012_song_aliases_rollback.sql", "utf8"));
ok("롤백 후 곡 데이터 유지", (await db.query(`select title, tags from songs`)).rows[0].title === "이름에게");
console.log(`${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
