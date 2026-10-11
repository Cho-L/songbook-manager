import { test } from "node:test";
import assert from "node:assert/strict";
import { formatOffset, formatStep, nudgeOffset, parseSyncStepTenths, SYNC_STEP_TENTHS } from "../src/lyrics/warp";

test("지원 간격은 0.1~1.0초 10개", () => {
  assert.deepEqual([...SYNC_STEP_TENTHS], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test("0.1초를 10번 더하면 정확히 1.0 (부동소수점 오차 없음)", () => {
  let o = 0;
  for (let i = 0; i < 10; i++) o = nudgeOffset(o, 1, 1);
  assert.equal(o, 1);
  for (let i = 0; i < 10; i++) o = nudgeOffset(o, 1, -1);
  assert.equal(o, 0);
});

test("0.3을 3번 -> 0.9, 0.7을 3번 -> 2.1", () => {
  let o = 0;
  for (let i = 0; i < 3; i++) o = nudgeOffset(o, 3, 1);
  assert.equal(o, 0.9);
  o = 0;
  for (let i = 0; i < 3; i++) o = nudgeOffset(o, 7, 1);
  assert.equal(o, 2.1);
});

test("간격을 바꿔도 기존 보정값은 유지: +0.3 상태에서 1.0초 간격으로 누르면 1.3 / -0.7", () => {
  assert.equal(nudgeOffset(0.3, 10, 1), 1.3);
  assert.equal(nudgeOffset(0.3, 10, -1), -0.7);
});

test("방향: +1 = offset 증가(가사 늦게), -1 = 감소(가사 빠르게) — 기존 0.5초 버튼과 같은 의미", () => {
  assert.equal(nudgeOffset(0, 5, 1), 0.5);
  assert.equal(nudgeOffset(0, 5, -1), -0.5);
});

test("첫 소절 맞추기 등으로 생긴 임의의 보정값에서도 0.01초 단위로 정리", () => {
  assert.equal(nudgeOffset(1.2345, 1, 1), 1.33);
});

test("잘못된 간격 값은 기본 0.5초", () => {
  for (const bad of [0, 11, 0.5, NaN, "x", null, undefined]) assert.equal(parseSyncStepTenths(bad), 5);
  assert.equal(parseSyncStepTenths("3"), 3);
});

test("표시 형식", () => {
  assert.equal(formatOffset(0.3), "+0.3초");
  assert.equal(formatOffset(-0.5), "-0.5초");
  assert.equal(formatOffset(0), "0초");
  assert.equal(formatOffset(1.33), "+1.33초");
  assert.equal(formatStep(1), "0.1초");
  assert.equal(formatStep(10), "1.0초");
});
