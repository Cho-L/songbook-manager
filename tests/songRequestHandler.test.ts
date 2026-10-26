import test from "node:test";
import assert from "node:assert/strict";
import { handleSongRequests } from "../src/server/songRequestHandler.ts";
import { makeRequesterKey, SUBMIT_ERRORS } from "../src/utils/songRequest.ts";

// All requests terminate in an injected stub; no credentials, services or user data are used.
const env = { SUPABASE_URL: "https://rpc.invalid", SUPABASE_SERVICE_ROLE_KEY: "offline-test-key", REQUEST_HASH_SALT: "offline-test-salt" };
const BOOK = "11111111-1111-4111-8111-111111111111";
const SONG = "22222222-2222-4222-8222-222222222222";
const payload = { bookId: BOOK, songId: SONG, name: " 시청자 " };
const raw = JSON.stringify(payload);
const encode = (s: string) => new TextEncoder().encode(s);
const success = { ok: true, id: "offline-request", position: 3 };

function post(body: BodyInit | null = raw, headers: Record<string, string> = {}): Request {
  return new Request("https://app.invalid/api/song-requests", {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body,
    ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
  });
}
function stub(result: unknown = success) {
  const calls: { url: string; args: Record<string, unknown> }[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), args: JSON.parse(String(init?.body)) });
    return Response.json(result);
  };
  return { calls, fetchImpl };
}
async function reject(request: Request, code: string) {
  const { calls, fetchImpl } = stub();
  const res = await handleSongRequests(request, env, fetchImpl);
  assert.equal(res.status, SUBMIT_ERRORS[code].status);
  assert.deepEqual(await res.json(), { ok: false, code, error: SUBMIT_ERRORS[code].message });
  assert.match(res.headers.get("Content-Type")!, /application\/json/);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.equal(calls.length, 0, "invalid input must not call RPC");
}

for (const length of [undefined, "1", "2048", "999999", "not-a-number", "-1"]) {
  test(`oversize body rejected regardless of Content-Length=${length}`, async () => {
    await reject(post(" ".repeat(2049), length === undefined ? {} : { "Content-Length": length }), "too_large");
  });
  test(`valid body uses actual bytes, not Content-Length=${length}`, async () => {
    const { calls, fetchImpl } = stub();
    const res = await handleSongRequests(post(raw, length === undefined ? {} : { "Content-Length": length }), env, fetchImpl);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), success);
    assert.equal(calls.length, 1);
  });
}

test("exactly 2048 UTF-8 bytes accepted, 2049 rejected", async () => {
  const padded = raw + " ".repeat(2048 - encode(raw).length);
  assert.equal(encode(padded).length, 2048);
  const { calls, fetchImpl } = stub();
  assert.equal((await handleSongRequests(post(padded), env, fetchImpl)).status, 200);
  assert.equal(calls.length, 1);
  await reject(post(padded + " "), "too_large");
});
test("byte limit applies to multibyte input, not JS string length", async () => {
  const body = JSON.stringify({ ...payload, extra: "가".repeat(700) });
  assert.ok(body.length < 2048 && encode(body).length > 2048);
  await reject(post(body), "too_large");
});
test("chunked oversize stream is cancelled before reading the rest", async () => {
  let pulls = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls++;
      assert.ok(pulls <= 3, "must not drain remaining chunks");
      controller.enqueue(new Uint8Array(1024).fill(32));
    },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  const request = post(stream, { "Content-Length": "1" });
  await reject(request, "too_large");
  assert.equal(pulls, 3);
  assert.equal(cancelled, true);
  assert.equal(stream.locked, false);
});
test("single oversized chunk cancels even if cancellation never settles", { timeout: 2000 }, async () => {
  let cancelled = false;
  let pulls = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      assert.ok(++pulls <= 2, "must not drain oversized chunks");
      controller.enqueue(new Uint8Array(100_000));
    },
    cancel() { cancelled = true; return new Promise<void>(() => {}); },
  }, { highWaterMark: 0 });
  await reject(post(stream), "too_large");
  assert.equal(cancelled, true);
  assert.equal(stream.locked, false);
});
test("multibyte UTF-8 split between chunks decodes after bounded read", async () => {
  const bytes = encode(raw);
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset === bytes.length) controller.close();
      else controller.enqueue(bytes.subarray(offset, ++offset));
    },
  }, { highWaterMark: 0 });
  const { calls, fetchImpl } = stub();
  assert.equal((await handleSongRequests(post(stream), env, fetchImpl)).status, 200);
  assert.equal(calls[0].args.p_name, "시청자");
  assert.equal(stream.locked, false);
});
test("stream read error returns bad_request without RPC", async () => {
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.error(new Error("offline read failure")); } });
  await reject(post(stream), "bad_request");
  assert.equal(stream.locked, false);
});
for (const body of ["{", "", "too_large", "null", "[]", "123", JSON.stringify("string")]) {
  test(`malformed JSON or wrong shape: ${body}`, () => reject(post(body), "bad_request"));
}
for (const field of ["bookId", "songId"]) {
  test(`invalid UUID in ${field}`, () => reject(post(JSON.stringify({ ...payload, [field]: "not-a-uuid" })), "bad_request"));
}
for (const method of ["PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]) {
  test(`unsupported method ${method} returns 405 and Allow`, async () => {
    const { calls, fetchImpl } = stub();
    const res = await handleSongRequests(new Request("https://app.invalid/api/song-requests", { method }), env, fetchImpl);
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("Allow"), "GET, POST");
    assert.deepEqual(await res.json(), { ok: false, code: "bad_request", error: "허용되지 않는 방식이에요." });
    assert.equal(calls.length, 0);
  });
}
for (const origin of ["https://other.invalid", "http://app.invalid", "https://app.invalid:8443", "null", "not-an-origin"]) {
  test(`different or invalid Origin rejected: ${origin}`, () => reject(post(raw, { Origin: origin }), "forbidden"));
}
for (const origin of [undefined, "https://app.invalid"]) {
  test(`normal submission with ${origin ?? "absent Origin"} preserves RPC and response`, async () => {
    const { calls, fetchImpl } = stub();
    const res = await handleSongRequests(post(raw, { ...(origin ? { Origin: origin } : {}), "CF-Connecting-IP": "192.0.2.1" }), env, fetchImpl);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), success);
    assert.equal(res.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(calls, [{ url: "https://rpc.invalid/rest/v1/rpc/submit_song_request", args: {
      p_book_id: BOOK, p_song_id: SONG, p_name: "시청자", p_key: await makeRequesterKey("192.0.2.1", BOOK, env.REQUEST_HASH_SALT),
    } }]);
  });
}
test("non-JSON Content-Type rejected", () => reject(post(raw, { "Content-Type": "text/plain" }), "bad_request"));
test("honeypot returns fake success without RPC", async () => {
  const { calls, fetchImpl } = stub();
  const res = await handleSongRequests(post(JSON.stringify({ ...payload, website: "https://bot.invalid" })), env, fetchImpl);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(calls.length, 0);
});
for (const code of ["closed", "song_not_found", "duplicate_song", "user_limit", "queue_full", "cooldown", "rate_limited"]) {
  test(`RPC rejection ${code} preserves status, shape and Retry-After`, async () => {
    const { calls, fetchImpl } = stub({ ok: false, code });
    const res = await handleSongRequests(post(), env, fetchImpl);
    assert.equal(res.status, SUBMIT_ERRORS[code].status);
    assert.deepEqual(await res.json(), { ok: false, code, error: SUBMIT_ERRORS[code].message });
    assert.equal(res.headers.get("Retry-After"), code === "cooldown" ? "20" : null);
    assert.equal(calls.length, 1);
  });
}
