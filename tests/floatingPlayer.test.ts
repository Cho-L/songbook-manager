import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FLOAT_CHROME_H, FLOAT_DEFAULT_W, FLOAT_MARGIN, FLOAT_MIN_W, clampLayout, defaultLayout, maxWidthFor, minWidthFor,
  moveLayout, parseStoredLayout, resizeLayout, totalHeight, videoHeight,
} from "../src/utils/floatingPlayer";

const inside = (l: { x: number; y: number; w: number }, vw: number, vh: number) =>
  l.x >= FLOAT_MARGIN - 1e-9 && l.y >= FLOAT_MARGIN - 1e-9 && l.x + l.w <= vw - FLOAT_MARGIN + 1e-9 && l.y + totalHeight(l.w) <= vh - FLOAT_MARGIN + 1e-9;

test("기본 크기 320×180, 우하단", () => {
  const l = defaultLayout(1280, 800);
  assert.equal(l.w, 320);
  assert.equal(videoHeight(l.w), 180);
  assert.ok(l.x > 1280 / 2 && l.y > 800 / 2);
  assert.ok(inside(l, 1280, 800));
});

test("최소 240×135 / 최대는 화면 기준", () => {
  assert.equal(clampLayout({ x: 0, y: 0, w: 10 }, 1280, 800).w, FLOAT_MIN_W);
  assert.equal(videoHeight(FLOAT_MIN_W), 135);
  const big = clampLayout({ x: 0, y: 0, w: 5000 }, 1280, 800);
  assert.equal(big.w, Math.round(maxWidthFor(1280, 800)));
  assert.ok(inside(big, 1280, 800));
});

test("이동은 화면 밖으로 나가지 않는다", () => {
  const s = { x: 500, y: 300, w: 320 };
  for (const [dx, dy] of [[-9999, -9999], [9999, 9999], [-9999, 9999], [9999, -9999]]) assert.ok(inside(moveLayout(s, dx, dy, 1280, 800), 1280, 800));
});

test("크기 조절: 16:9 유지(너비로만 표현), 최소/최대 제한, 화면 안", () => {
  const s = { x: 800, y: 500, w: 320 };
  const grown = resizeLayout(s, 400, 400, 1280, 800);
  assert.ok(grown.w > 320 && inside(grown, 1280, 800));
  const shrunk = resizeLayout(s, -9999, -9999, 1280, 800);
  assert.equal(shrunk.w, FLOAT_MIN_W);
  // 대각선 드래그는 더 크게 움직인 축을 따른다
  assert.equal(resizeLayout({ x: 10, y: 10, w: 320 }, 100, 0, 1280, 800).w, 420);
  assert.equal(resizeLayout({ x: 10, y: 10, w: 320 }, 0, 90, 1280, 800).w, 480); // 90px 높이 = 160px 너비
});

test("좁은 모바일 화면: 최소 크기보다 화면 안 표시가 우선", () => {
  const vw = 200, vh = 700;
  assert.ok(minWidthFor(vw, vh) < FLOAT_MIN_W);
  const l = defaultLayout(vw, vh);
  assert.ok(l.w <= vw - 2 * FLOAT_MARGIN && inside(l, vw, vh));
});

test("낮은 화면(가로 모드): 높이 때문에 너비가 줄어도 전체 창이 들어온다", () => {
  const vw = 800, vh = 300;
  const l = clampLayout({ x: 600, y: 200, w: 320 }, vw, vh);
  assert.ok(inside(l, vw, vh));
  assert.ok(l.w <= ((vh - 2 * FLOAT_MARGIN - FLOAT_CHROME_H) * 16) / 9 + 1);
});

test("화면 크기가 바뀌면 위치/크기가 보정된다 (큰 화면에서 저장 → 작은 화면)", () => {
  const saved = { x: 1500, y: 900, w: 1200 };
  const small = clampLayout(saved, 800, 600);
  assert.ok(inside(small, 800, 600));
  assert.ok(small.w < 1200);
});

test("저장값 검증: 깨진/이상한 값은 null", () => {
  assert.deepEqual(parseStoredLayout('{"x":10,"y":20,"w":300}'), { x: 10, y: 20, w: 300 });
  for (const bad of [null, "", "not json", "{}", '{"x":"a","y":1,"w":2}', '{"x":1,"y":2,"w":-5}', '{"x":null,"y":2,"w":5}', "[1,2,3]", "null"]) assert.equal(parseStoredLayout(bad), null, String(bad));
  assert.equal(FLOAT_DEFAULT_W, 320);
});

test("NaN/Infinity가 섞여도 화면 안으로", () => {
  const l = clampLayout({ x: 0, y: 0, w: 320 }, 1280, 800);
  assert.ok(Number.isFinite(l.x) && Number.isFinite(l.y));
});
