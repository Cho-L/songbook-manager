import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  COOLDOWN_SEC,
  SUBMIT_ERRORS,
  canTransition,
  cleanRequesterName,
  evaluateSubmit,
  isUuid,
  makeRequesterKey,
  moveInOrder,
  parseSubmitBody,
  type ExistingRequest,
  type RequestSettings,
} from "../src/utils/songRequest";

const BOOK = "00000000-0000-0000-0000-00000000000a";
const SONG = "00000000-0000-0000-0000-0000000000s1".replace("s", "5");

test("이름 정리/검증", () => {
  assert.equal(cleanRequesterName("  철수   님 "), "철수 님");
  assert.equal(cleanRequesterName(""), null);
  assert.equal(cleanRequesterName("   "), null);
  assert.equal(cleanRequesterName("가".repeat(30)), "가".repeat(30));
  assert.equal(cleanRequesterName("가".repeat(31)), null);
  assert.equal(cleanRequesterName("a\u0007b"), null);
  assert.equal(cleanRequesterName(123), null);
  assert.equal(cleanRequesterName(null), null);
  assert.equal(cleanRequesterName("<script>alert(1)</script>"), "<script>alert(1)</script>"); // 문자열로만 다루고 화면은 React 텍스트로 그린다
});

test("요청 본문 검사: UUID/허니팟/타입", () => {
  assert.ok(isUuid(BOOK));
  assert.ok(!isUuid("abc"));
  const good = parseSubmitBody({ bookId: BOOK, songId: SONG, name: " a " }, { requireUuid: true });
  assert.deepEqual(good, { ok: true, value: { bookId: BOOK, songId: SONG, name: "a" } });
  assert.deepEqual(parseSubmitBody({ bookId: "x", songId: SONG, name: "a" }, { requireUuid: true }), { ok: false, code: "bad_request" });
  assert.deepEqual(parseSubmitBody({ bookId: BOOK, songId: SONG, name: "" }, { requireUuid: true }), { ok: false, code: "bad_name" });
  assert.deepEqual(parseSubmitBody({ bookId: BOOK, songId: SONG, name: "a", website: "http://x" }, { requireUuid: true }), { ok: "bot" });
  assert.deepEqual(parseSubmitBody({ bookId: BOOK, songId: SONG, name: "a", website: "   " }, { requireUuid: true }).ok, true);
  for (const bad of [null, undefined, 5, "str", [], [1]]) assert.deepEqual(parseSubmitBody(bad, { requireUuid: true }), { ok: false, code: "bad_request" });
  // 로컬 모드는 UUID 가 아닌 id 도 허용하되 길이는 제한
  assert.equal(parseSubmitBody({ bookId: "demo-owner", songId: "123-abc", name: "a" }, { requireUuid: false }).ok, true);
  assert.deepEqual(parseSubmitBody({ bookId: "x".repeat(81), songId: "1", name: "a" }, { requireUuid: false }), { ok: false, code: "bad_request" });
});

test("신청자 해시: 결정적, IP/노래책/salt 가 다르면 달라지고 원본 IP 미포함", async () => {
  const a = await makeRequesterKey("1.2.3.4", BOOK, "salt");
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, await makeRequesterKey("1.2.3.4", BOOK, "salt"));
  assert.notEqual(a, await makeRequesterKey("1.2.3.5", BOOK, "salt"));
  assert.notEqual(a, await makeRequesterKey("1.2.3.4", BOOK.replace(/a$/, "b"), "salt"));
  assert.notEqual(a, await makeRequesterKey("1.2.3.4", BOOK, "salt2"));
  assert.ok(!a.includes("1.2.3.4"));
});

test("상태 전이 규칙", () => {
  assert.ok(canTransition("pending", "approved"));
  assert.ok(canTransition("pending", "rejected"));
  assert.ok(!canTransition("pending", "playing")); // 승인 없이 바로 재생 불가
  assert.ok(!canTransition("pending", "done"));
  assert.ok(canTransition("approved", "playing"));
  assert.ok(canTransition("playing", "done"));
  assert.ok(!canTransition("done", "pending")); // 끝난 곡은 되살리지 않는다 (같은 곡은 새로 신청)
  assert.ok(canTransition("rejected", "pending"));
  assert.ok(!canTransition("rejected", "playing"));
});

test("순서 이동", () => {
  assert.deepEqual(moveInOrder(["a", "b", "c"], "b", -1), ["b", "a", "c"]);
  assert.deepEqual(moveInOrder(["a", "b", "c"], "b", 1), ["a", "c", "b"]);
  assert.deepEqual(moveInOrder(["a", "b", "c"], "a", -1), ["a", "b", "c"]);
  assert.deepEqual(moveInOrder(["a", "b", "c"], "c", 1), ["a", "b", "c"]);
  assert.deepEqual(moveInOrder(["a", "b"], "zzz", 1), ["a", "b"]);
});

const S: RequestSettings = { accepting: true, maxQueue: 3, perUserMax: 2 };
const NOW = Date.parse("2026-10-11T12:00:00Z");
const row = (o: Partial<ExistingRequest>): ExistingRequest => ({ songId: "x", status: "pending", requestedAt: new Date(NOW - 600_000).toISOString(), position: 1, requesterKey: "k0", ...o });

test("접수 규칙(로컬 모드 = DB RPC 와 같은 순서/코드)", () => {
  const input = { songId: "s1", key: "kA", songExists: true };
  assert.deepEqual(evaluateSubmit([], { ...S, accepting: false }, input, NOW), { ok: false, code: "closed" });
  assert.deepEqual(evaluateSubmit([], S, { ...input, songExists: false }, NOW), { ok: false, code: "song_not_found" });
  assert.deepEqual(evaluateSubmit([], S, input, NOW), { ok: true, position: 1 });
  assert.equal(evaluateSubmit([row({ requesterKey: "kA", requestedAt: new Date(NOW - (COOLDOWN_SEC - 1) * 1000).toISOString(), songId: "s0" })], S, input, NOW).ok, false);
  assert.equal((evaluateSubmit([row({ requesterKey: "kA", requestedAt: new Date(NOW - (COOLDOWN_SEC - 1) * 1000).toISOString(), songId: "s0" })], S, input, NOW) as { code: string }).code, "cooldown");
  assert.equal((evaluateSubmit([row({ songId: "s1" })], S, input, NOW) as { code: string }).code, "duplicate_song");
  assert.equal(evaluateSubmit([row({ songId: "s1", status: "done" })], S, input, NOW).ok, true); // 끝난 곡은 재신청 가능
  assert.equal(evaluateSubmit([row({ songId: "s1", status: "rejected" })], S, input, NOW).ok, true);
  assert.equal((evaluateSubmit([row({ songId: "a", requesterKey: "kA" }), row({ songId: "b", requesterKey: "kA" })], S, input, NOW) as { code: string }).code, "user_limit");
  assert.equal((evaluateSubmit([row({ songId: "a" }), row({ songId: "b", requesterKey: "k2" }), row({ songId: "c", requesterKey: "k3", status: "approved" })], S, input, NOW) as { code: string }).code, "queue_full");
  // 재생 중인 곡은 큐 한도/1인 한도에는 안 세지만 같은 곡 중복은 막는다
  assert.equal((evaluateSubmit([row({ songId: "s1", status: "playing" })], S, input, NOW) as { code: string }).code, "duplicate_song");
  const many = Array.from({ length: 10 }, (_, i) => row({ songId: `h${i}`, requesterKey: "kA", status: "done", requestedAt: new Date(NOW - 120_000).toISOString() }));
  assert.equal((evaluateSubmit(many, S, input, NOW) as { code: string }).code, "rate_limited");
  // position 은 기존 최대값 + 1
  assert.deepEqual(evaluateSubmit([row({ songId: "q", position: 7, requesterKey: "k2", status: "done" })], S, input, NOW), { ok: true, position: 8 });
});

test("DB RPC 가 돌려주는 모든 실패 코드에 사용자 문구/HTTP 상태가 있다", () => {
  const sql = fs.readFileSync(new URL("../supabase/migrations/20261011_song_requests.sql", import.meta.url), "utf8");
  const codes = [...sql.matchAll(/'code',\s*'([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(codes.length >= 8);
  for (const c of new Set(codes)) assert.ok(SUBMIT_ERRORS[c], `누락된 코드: ${c}`);
  for (const [c, e] of Object.entries(SUBMIT_ERRORS)) assert.ok(e.message && e.status >= 400, c);
});
