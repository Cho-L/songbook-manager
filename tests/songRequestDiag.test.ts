import test from "node:test";
import assert from "node:assert/strict";
import { handleSongRequests } from "../src/server/songRequestHandler.ts";

const KEY = "eyJhbGciOiJIUzI1NiJ9.SECRETPAYLOADSECRETPAYLOAD.SIGNATURESIGNATURE12345";
const env = { SUPABASE_URL: "https://abc.supabase.co", SUPABASE_SERVICE_ROLE_KEY: KEY, REQUEST_HASH_SALT: "salt" };
const BOOK = "11111111-1111-4111-8111-111111111111";
const SONG = "22222222-2222-4222-8222-222222222222";
const post = () =>
  new Request("https://x.dev/api/song-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookId: BOOK, songId: SONG, name: "철수" }),
  });

async function run(fetchImpl: typeof fetch) {
  const logs: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => void logs.push(a.join(" "));
  try {
    const res = await handleSongRequests(post(), env, fetchImpl);
    return { res, body: (await res.json()) as Record<string, unknown>, logs };
  } finally {
    console.error = orig;
  }
}
const j = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

const cases: [string, typeof fetch, string][] = [
  ["함수 없음(마이그레이션 미적용)", j(404, { code: "PGRST202", message: "Could not find the function" }), "rpc_function_missing_or_not_in_schema_cache"],
  ["권한 거부", j(403, { code: "42501", message: "permission denied for function" }), "rpc_permission_denied"],
  ["키 거부", j(401, { message: "Invalid API key" }), "rpc_auth_rejected"],
  ["잘못된 URL(HTML 404)", (async () => new Response("<html>", { status: 404 })) as unknown as typeof fetch, "rpc_not_json_404_wrong_url"],
  ["DB 내부 오류", j(500, { code: "XX000", message: "boom" }), "rpc_db_error"],
  ["네트워크", (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch, "rpc_network"],
];
for (const [name, f, reason] of cases) {
  test(`원인 분류: ${name}`, async () => {
    const { res, body, logs } = await run(f);
    assert.equal(res.status, 502);
    assert.equal(body.code, "server_error");
    assert.equal(body.reason, reason);
    const all = JSON.stringify(body) + logs.join("\n");
    assert.ok(!all.includes("SECRETPAYLOAD") && !all.includes(KEY), "키가 응답/로그에 없어야 한다");
    assert.ok(!all.includes("abc.supabase.co"), "URL 이 응답/로그에 없어야 한다");
    assert.ok(logs.length === 1 && JSON.parse(logs[0]).reason === reason);
  });
}
test("환경변수 누락은 not_configured + 누락 이름만 로그", async () => {
  const logs: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => void logs.push(a.join(" "));
  const res = await handleSongRequests(post(), { SUPABASE_URL: "https://a.supabase.co" }, j(200, {}));
  console.error = orig;
  assert.equal(res.status, 503);
  assert.ok(logs[0].includes("SUPABASE_SERVICE_ROLE_KEY") && !logs[0].includes("a.supabase.co"));
});
