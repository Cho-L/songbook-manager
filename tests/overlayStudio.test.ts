import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_OVERLAY_SETTINGS } from "../src/types/overlay.ts";
import { DEFAULT_QUEUE_OVERLAY, buildQueueOverlayUrl, parseQueueOverlay } from "../src/utils/queueOverlay.ts";
import { buildPortableUrl, buildStudioUrl, constrainOverlay, defaultStudioConfig, sanitizeBox, sanitizeQueueSettings, sanitizeStudioConfig, toStoredConfig } from "../src/utils/overlayStudio.ts";
import { handleOverlayConfig } from "../src/server/overlayConfigHandler.ts";

const BOOK = "11111111-1111-4111-8111-111111111111";

test("기본 설정: 종류별로 서로 독립, 현재곡=가사 없음 / 가사=가사 있음", () => {
  const song = defaultStudioConfig("song"), lyrics = defaultStudioConfig("lyrics"), q = defaultStudioConfig("queue");
  assert.equal(song.overlay.showLyrics, false); assert.equal(lyrics.overlay.showLyrics, true);
  assert.equal(song.overlay.preset, "nowplaying"); assert.equal(lyrics.overlay.preset, "lyrics");
  assert.deepEqual(q.queue, DEFAULT_QUEUE_OVERLAY);
  assert.notDeepEqual(song.box, q.box);
});
test("종류에 안 맞는 스타일/값은 바로잡힌다", () => {
  const s = constrainOverlay("lyrics", { ...DEFAULT_OVERLAY_SETTINGS, preset: "covercard", showLyrics: false });
  assert.equal(s.preset, "lyrics"); assert.equal(s.showLyrics, true);
  const t = constrainOverlay("song", { ...DEFAULT_OVERLAY_SETTINGS, preset: "karaoke", showLyrics: true });
  assert.equal(t.showLyrics, false); assert.ok(t.preset !== "karaoke");
});
test("범위 밖/깨진 값/악의적 값 보정", () => {
  const b = sanitizeBox({ w: 99999, h: -5, radius: 1e9, borderW: "x", borderColor: "red;}</style><script>", padding: NaN }, "queue");
  assert.equal(b.w, 3840); assert.equal(b.h, 60); assert.equal(b.radius, 80); assert.equal(b.borderW, 0); assert.equal(b.borderColor, "#ffffff"); assert.equal(b.padding, 10);
  const q = sanitizeQueueSettings({ n: 0, fs: 1000, tc: "url(javascript:alert(1))", bgc: "#GGGGGG", align: "justify", st: "yes", fw: 5, gap: 99 });
  assert.equal(q.n, 1); assert.equal(q.fs, 96); assert.equal(q.tc, DEFAULT_QUEUE_OVERLAY.tc); assert.equal(q.bgc, "#000000"); assert.equal(q.align, "left"); assert.equal(q.st, true); assert.equal(q.fw, 400); assert.equal(q.gap, 20);
  for (const junk of [null, undefined, 5, "str", [], { overlay: "x", box: [] }]) {
    const c = sanitizeStudioConfig("song", junk);
    assert.equal(c.kind, "song"); assert.equal(c.overlay.showLyrics, false);
  }
});
test("저장 JSON 왕복 (종류별로 필요한 부분만)", () => {
  const c = defaultStudioConfig("queue"); c.queue.n = 3; c.box.radius = 20;
  const stored = toStoredConfig(c);
  assert.deepEqual(Object.keys(stored).sort(), ["box", "queue"]);
  assert.deepEqual(sanitizeStudioConfig("queue", JSON.parse(JSON.stringify(stored))), c);
  assert.deepEqual(Object.keys(toStoredConfig(defaultStudioConfig("lyrics"))).sort(), ["box", "overlay"]);
});
test("주소: Studio 주소엔 비밀/설정값 없음, 독립형 주소 왕복, 옛 주소 호환", () => {
  const studio = buildStudioUrl("https://x.dev", "queue", BOOK, "KEYKEYKEYKEYKEY1");
  assert.equal(studio, `https://x.dev/overlay/queue?book=${BOOK}&cfg=1`); // queue 는 방송 키 불필요
  assert.ok(buildStudioUrl("https://x.dev", "lyrics", BOOK, "abcdefghijklmnop").includes("lk=abcdefghijklmnop"));
  const c = defaultStudioConfig("queue"); c.queue.n = 2; c.queue.tc = "#112233"; c.queue.sa = false;
  const url = new URL(buildPortableUrl("https://x.dev", c, BOOK));
  assert.deepEqual(parseQueueOverlay(url.searchParams), c.queue);
  // Phase 2 형식의 옛 URL 은 새 필드가 전부 기본값
  assert.deepEqual(parseQueueOverlay(new URLSearchParams("book=x&n=3&fs=40&al=center&bg=20&tc=ffffff&ac=fbbf24&req=0&head=0")), { ...DEFAULT_QUEUE_OVERLAY, n: 3, fs: 40, align: "center", bg: 20, req: false, head: false });
  assert.equal(buildQueueOverlayUrl("https://x.dev", BOOK, DEFAULT_QUEUE_OVERLAY), `https://x.dev/overlay/queue?book=${BOOK}`);
  assert.ok(buildPortableUrl("https://x.dev", defaultStudioConfig("song"), BOOK, "abcdefghijklmnop").startsWith("https://x.dev/overlay?")); // 기존 /overlay 형식
});

// ---- 공개 설정 API
const env = { SUPABASE_URL: "https://abc.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "eyJhbGciOiJIUzI1NiJ9.SECRETPAYLOADSECRETPAYLOAD.SIG123456789012" };
const get = (qs: string, method = "GET") => new Request(`https://x.dev/api/overlay-config${qs}`, { method });
const ok = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
test("공개 설정 API: 검증/응답/오류가 비밀을 드러내지 않음", async () => {
  assert.equal((await handleOverlayConfig(get("?book=zzz&kind=queue"), env, ok({}))).status, 400);
  assert.equal((await handleOverlayConfig(get(`?book=${BOOK}&kind=admin`), env, ok({}))).status, 400);
  assert.equal((await handleOverlayConfig(get(`?book=${BOOK}&kind=queue`, "POST"), env, ok({}))).status, 405);
  assert.equal((await handleOverlayConfig(get(`?book=${BOOK}&kind=queue`), {}, ok({}))).status, 503);
  const res = await handleOverlayConfig(get(`?book=${BOOK}&kind=queue`), env, ok({ config: { queue: { n: 2 } }, rev: 3 }));
  assert.equal(res.status, 200); assert.deepEqual(await res.json(), { config: { queue: { n: 2 } }, rev: 3 });
  const logs: string[] = []; const orig = console.error; console.error = (...a: unknown[]) => void logs.push(a.join(" "));
  const bad = await handleOverlayConfig(get(`?book=${BOOK}&kind=song`), env, (async () => new Response(JSON.stringify({ code: "PGRST202" }), { status: 404 })) as unknown as typeof fetch);
  console.error = orig;
  const txt = JSON.stringify(await bad.json()) + logs.join("");
  assert.equal(bad.status, 502); assert.ok(txt.includes("rpc_function_missing"));
  assert.ok(!txt.includes("SECRETPAYLOAD") && !txt.includes("abc.supabase.co"));
});
