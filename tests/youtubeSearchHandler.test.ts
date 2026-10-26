import test from "node:test";
import assert from "node:assert/strict";
import { handleYoutubeSearch } from "../src/server/youtubeSearchHandler.ts";
import worker from "../workers/worker.js";

const env = { YOUTUBE_API_KEY: "offline-test-key" };
const upstream = { items: [
  { id: { videoId: "v1" }, snippet: { title: "노래 &amp; MR", channelTitle: "채널", thumbnails: { medium: { url: "https://image.invalid/medium" }, default: { url: "https://image.invalid/default" } } } },
  { id: { videoId: "v2" }, snippet: { title: "default", channelTitle: "channel", thumbnails: { default: { url: "https://image.invalid/default" } } } },
  { id: { videoId: "v3" }, snippet: { title: "no thumbnail", channelTitle: "channel" } },
] };
const expected = { results: [
  { videoId: "v1", title: "노래 &amp; MR", channelTitle: "채널", thumbnailUrl: "https://image.invalid/medium" },
  { videoId: "v2", title: "default", channelTitle: "channel", thumbnailUrl: "https://image.invalid/default" },
  { videoId: "v3", title: "no thumbnail", channelTitle: "channel" },
] };
const request = (q: string, method = "GET") => new Request(`https://app.invalid/api/youtube-search?q=${encodeURIComponent(q)}`, { method });
function stub() {
  const calls: URL[] = [];
  const fetchImpl: typeof fetch = async (url) => { calls.push(new URL(String(url))); return Response.json(upstream); };
  return { calls, fetchImpl };
}
async function rejected(req: Request, status: number, expectedError?: string) {
  let calls = 0;
  const res = await handleYoutubeSearch(req, env, async () => { calls++; throw new Error("unexpected fetch"); });
  assert.equal(res.status, status);
  const body = await res.json();
  assert.deepEqual(Object.keys(body), ["error"]);
  assert.equal(typeof body.error, "string");
  if (expectedError) assert.equal(body.error, expectedError);
  assert.equal(res.headers.get("Content-Type"), "application/json");
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.equal(calls, 0);
  return res;
}
for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]) {
  test(`YouTube proxy rejects ${method} before upstream`, async () => {
    const res = await rejected(request("song", method), 405);
    assert.equal(res.headers.get("Allow"), "GET");
  });
}
for (const q of ["", " ", "\u00a0\u3000"]) {
  test(`empty query ${JSON.stringify(q)} returns legacy error`, () => rejected(request(q), 400, "검색어(q)가 필요합니다."));
}
test("missing q returns 400", () => rejected(new Request("https://app.invalid/api/youtube-search"), 400));
for (const q of ["a".repeat(101), "😀".repeat(101), "song\u0000", "song\u007f", "song\u0085", "song\nother", "song\tother", "\ufffd", "\ud800"]) {
  test(`abnormal or long query ${JSON.stringify(q).slice(0, 45)} rejected`, async () => {
    // URLSearchParams replaces an unpaired surrogate with U+FFFD, like a browser URL.
    const url = new URL("https://app.invalid/api/youtube-search");
    url.searchParams.set("q", q);
    await rejected(new Request(url), 400);
  });
}
test("ambiguous duplicate q rejected", () => rejected(new Request("https://app.invalid/api/youtube-search?q=one&q=two"), 400));
test("malformed UTF-8 query rejected", () => rejected(new Request("https://app.invalid/api/youtube-search?q=%FF"), 400));
for (const q of ["a".repeat(100), "😀".repeat(100)]) {
  test(`100 Unicode code points accepted (${q.length} UTF-16 units)`, async () => {
    const { calls, fetchImpl } = stub();
    assert.equal((await handleYoutubeSearch(request(q), env, fetchImpl)).status, 200);
    assert.equal(calls[0].searchParams.get("q"), q);
  });
}
test("trim and collapse Unicode spaces before length validation and upstream encoding", async () => {
  const { calls, fetchImpl } = stub();
  const res = await handleYoutubeSearch(request("  아이유\u3000\u00a0밤편지    MR  "), env, fetchImpl);
  assert.equal(res.status, 200);
  assert.equal(calls[0].searchParams.get("q"), "아이유 밤편지 MR");
});
test("query operators and URL metacharacters stay in q, not extra upstream parameters", async () => {
  const q = "夜に駆ける 😀 &key=attacker + # ? / % | -cover";
  const { calls, fetchImpl } = stub();
  const res = await handleYoutubeSearch(request(q), env, fetchImpl);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  const url = calls[0];
  assert.equal(url.origin + url.pathname, "https://www.googleapis.com/youtube/v3/search");
  assert.equal(url.searchParams.get("q"), q);
  assert.equal(url.searchParams.get("key"), env.YOUTUBE_API_KEY);
  assert.equal(url.searchParams.get("part"), "snippet");
  assert.equal(url.searchParams.get("type"), "video");
  assert.equal(url.searchParams.get("maxResults"), "8");
  assert.equal([...url.searchParams].length, 5);
});
test("normal response preserves field names, thumbnail fallback and encoded titles", async () => {
  const { fetchImpl } = stub();
  const res = await handleYoutubeSearch(request("song"), env, fetchImpl);
  assert.deepEqual(await res.json(), expected);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
});
for (const data of [{}, { items: [] }]) {
  test(`empty upstream results ${JSON.stringify(data)} preserve results array`, async () => {
    const res = await handleYoutubeSearch(request("song"), env, async () => Response.json(data));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { results: [] });
  });
}
test("missing key preserves legacy 500 without fetching", async () => {
  const res = await handleYoutubeSearch(request("song"), {}, async () => { throw new Error("must not fetch"); });
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: "서버에 YOUTUBE_API_KEY가 설정되지 않았습니다." });
});
for (const status of [400, 403, 429, 500, 503]) {
  test(`upstream HTTP ${status} preserves generic 502 without retry`, async () => {
    let calls = 0;
    const res = await handleYoutubeSearch(request("song"), env, async () => { calls++; return new Response(env.YOUTUBE_API_KEY, { status }); });
    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), { error: "YouTube 검색에 실패했습니다. 잠시 후 다시 시도해주세요." });
    assert.equal(calls, 1);
  });
}
for (const [label, fetchImpl] of [
  ["network error", async () => { throw new Error(env.YOUTUBE_API_KEY); }],
  ["invalid JSON", async () => new Response("<html>upstream</html>")],
  ["invalid shape", async () => Response.json({ items: [{}] })],
] as const) {
  test(`${label} returns legacy generic 502`, async () => {
    const res = await handleYoutubeSearch(request("song"), env, fetchImpl);
    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), { error: "YouTube 검색에 실패했습니다. 잠시 후 다시 시도해주세요." });
  });
}
for (const mode of ["absent", "present", "unusable"]) {
  test(`cache API ${mode}: no cache dependency or claimed quota savings`, async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "caches");
    try {
      if (mode === "absent") Reflect.deleteProperty(globalThis, "caches");
      else if (mode === "present") Object.defineProperty(globalThis, "caches", { configurable: true, value: {
        default: {
          match: () => assert.fail("must not read cache"),
          put: () => assert.fail("must not write cache"),
        },
      } });
      else Object.defineProperty(globalThis, "caches", { configurable: true, get() {
        throw new Error("Cache API unsupported");
      } });
      const { calls, fetchImpl } = stub();
      for (let i = 0; i < 2; i++) {
        const res = await handleYoutubeSearch(request("same query"), env, fetchImpl);
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), expected);
      }
      assert.equal(calls.length, 2, "repeated searches still consume upstream calls; no false cache claim");
    } finally {
      if (previous) Object.defineProperty(globalThis, "caches", previous);
      else Reflect.deleteProperty(globalThis, "caches");
    }
  });
}
test("Worker route uses the hardened handler, not static assets", async (t) => {
  const { calls, fetchImpl } = stub();
  t.mock.method(globalThis, "fetch", fetchImpl);
  const workerEnv = { ...env, ASSETS: { fetch: () => { throw new Error("must not serve assets"); } } };
  const success = await worker.fetch(request("song"), workerEnv, {});
  assert.deepEqual(await success.json(), expected);
  const invalid = await worker.fetch(request("song", "POST"), workerEnv, {});
  assert.equal(invalid.status, 405);
  assert.equal(invalid.headers.get("Allow"), "GET");
  assert.equal(calls.length, 1);
});

test("Vite adapter preserves HTTP status, Allow and response body offline", async (t) => {
  const { createServer } = await import("vite");
  const { get } = await import("node:http");
  const previousKey = process.env.YOUTUBE_API_KEY;
  process.env.YOUTUBE_API_KEY = env.YOUTUBE_API_KEY;
  const { calls, fetchImpl } = stub();
  t.mock.method(globalThis, "fetch", fetchImpl);
  const server = await createServer({
    configFile: new URL("../vite.config.ts", import.meta.url).pathname,
    server: { host: "127.0.0.1", port: 0, strictPort: true },
  });
  try {
    await server.listen();
    const address = server.httpServer!.address();
    assert.ok(address && typeof address !== "string");
    const local = (query: string, method = "GET") => new Promise<{ status: number; allow?: string; body: unknown }>((resolve, reject) => {
      const req = get(`http://127.0.0.1:${address.port}/api/youtube-search${query}`, { method }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => {
          try { resolve({ status: res.statusCode!, allow: res.headers.allow, body: JSON.parse(body) }); }
          catch (e) { reject(e); }
        });
      });
      req.on("error", reject);
    });
    assert.equal((await local("?q=song", "POST")).status, 405);
    assert.equal((await local("?q=song", "POST")).allow, "GET");
    assert.equal((await local("?q=")).status, 400);
    assert.equal((await local(`?q=${"a".repeat(101)}`)).status, 400);
    const result = await local("?q=song");
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, expected);
    assert.equal(calls.length, 1);
  } finally {
    await server.close();
    if (previousKey === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = previousKey;
  }
});
