import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_QUEUE_OVERLAY, buildQueueOverlayUrl, nextPollDelay, parseQueueOverlay, toQueueView } from "../src/utils/queueOverlay.ts";
import { canTransition, type PublicQueue } from "../src/utils/songRequest.ts";

const item = (id: string, status: "approved" | "playing") => ({ id, title: id, artist: "a", requesterName: "r", status });

test("기본값/범위 보정/잘못된 색 무시", () => {
  assert.deepEqual(parseQueueOverlay(new URLSearchParams("book=x")), DEFAULT_QUEUE_OVERLAY);
  const s = parseQueueOverlay(new URLSearchParams("n=99&fs=1&bg=500&tc=zzzzzz&ac=%2300ff00&al=bogus&req=0&head=0"));
  assert.equal(s.n, 12); assert.equal(s.fs, 12); assert.equal(s.bg, 100); assert.equal(s.tc, DEFAULT_QUEUE_OVERLAY.tc); assert.equal(s.ac, "#00ff00");
  assert.equal(s.align, "left"); assert.equal(s.req, false); assert.equal(s.head, false);
});
test("URL 생성 ↔ 파싱 왕복, 기본값은 생략", () => {
  const custom = { ...DEFAULT_QUEUE_OVERLAY, n: 3, fs: 40, align: "right" as const, bg: 0, ac: "#112233", req: false };
  const url = buildQueueOverlayUrl("https://x.dev", "BOOK", custom);
  assert.deepEqual(parseQueueOverlay(new URL(url).searchParams), custom);
  assert.equal(buildQueueOverlayUrl("https://x.dev", "BOOK", DEFAULT_QUEUE_OVERLAY), "https://x.dev/overlay/queue?book=BOOK");
});
test("재생 중 1곡 + 대기 n곡 + 나머지 수", () => {
  const q: PublicQueue = { accepting: true, pendingCount: 0, queue: [item("p", "playing"), ...["a", "b", "c", "d"].map((i) => item(i, "approved"))] };
  const v = toQueueView(q, 2);
  assert.equal(v.playing?.id, "p"); assert.deepEqual(v.upcoming.map((x) => x.id), ["a", "b"]); assert.equal(v.more, 2);
  assert.deepEqual(toQueueView(null, 5), { playing: null, upcoming: [], more: 0 });
  assert.equal(toQueueView({ ...q, queue: [item("x", "playing"), item("y", "playing")] }, 5).upcoming.length, 1); // 재생 중이 둘로 와도 한 곡만 재생 중
});
test("재시도 간격: 성공 4초, 실패마다 2배, 최대 20초", () => {
  assert.deepEqual([0, 1, 2, 3, 9].map((f) => nextPollDelay(f)), [4000, 8000, 16000, 20000, 20000]);
});
test("상태 전이: 승인→재생/취소, 완료·취소는 되돌릴 수 없음, 재생→대기(건너뛰기)", () => {
  assert.ok(canTransition("pending", "approved") && canTransition("approved", "canceled") && canTransition("playing", "approved") && canTransition("playing", "done"));
  assert.ok(!canTransition("done", "approved") && !canTransition("canceled", "pending") && !canTransition("pending", "playing"));
});
