import test from "node:test";
import assert from "node:assert/strict";
import { compareQueues } from "../src/utils/queueOverlay";

const a = (id: string, status: string, position: number) => ({ id, status, position });

test("compareQueues: 관리자 대기열과 공개 대기열 비교", () => {
  const admin = [a("1", "approved", 2), a("2", "playing", 5), a("3", "approved", 1), a("4", "pending", 0), a("5", "done", 9)];
  assert.equal(compareQueues(admin, { queue: [{ id: "2", status: "playing" }, { id: "3", status: "approved" }, { id: "1", status: "approved" }] }), "synced");
  assert.equal(compareQueues(admin, { queue: [{ id: "3", status: "approved" }, { id: "1", status: "approved" }] }), "pending", "재생 중인 곡이 아직 반영 안 됨");
  assert.equal(compareQueues(admin, { queue: [{ id: "2", status: "playing" }, { id: "1", status: "approved" }, { id: "3", status: "approved" }] }), "pending", "순서 다름");
  assert.equal(compareQueues(admin, null), "unknown", "공개 대기열을 못 읽으면 정상으로 표시하지 않는다");
  assert.equal(compareQueues([], { queue: [] }), "synced");
});
