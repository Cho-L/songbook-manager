import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_OVERLAY_SETTINGS,
  OVERLAY_LAYOUTS,
  bannerSize,
  parseOverlaySettings,
  presetDefaults,
  sanitizeOverlaySettings,
  serializeOverlaySettings,
} from "../src/types/overlay";

const q = (s: string) => new URLSearchParams(s);

test("예전 URL(새 키 없음)은 그대로 해석되고 새 설정은 기본값이다", () => {
  const legacy = parseOverlaySettings(q("p=karaoke&sz=120&bg=card&op=70&pos=bc&ox=3"));
  assert.equal(legacy.preset, "karaoke");
  assert.equal(legacy.size, 120);
  assert.equal(legacy.layout, "basic");
  assert.equal(legacy.boxW, 1000);
  assert.equal(legacy.boxH, 180);
  assert.equal(legacy.showCurrent, true);
  assert.equal(legacy.showNext, true);
  assert.equal(legacy.showRequester, true);
  // 빈 URL = 기본값 전체
  assert.deepEqual(parseOverlaySettings(q("")), DEFAULT_OVERLAY_SETTINGS);
});

test("직렬화 → 파싱 왕복에서 값이 보존된다", () => {
  const s = { ...DEFAULT_OVERLAY_SETTINGS, preset: "banner" as const, layout: "custom" as const, boxW: 1337, boxH: 211, gap: 14, lyricsH: 45, showNext: false, showRequester: false, showCurrent: false };
  assert.deepEqual(parseOverlaySettings(q(serializeOverlaySettings(s))), s);
});

test("범위를 벗어나거나 깨진 값은 안전한 범위로 맞춰진다", () => {
  const p = parseOverlaySettings(q("bw=999999&bh=-5&gp=999&lyh=1&ly=evil&cur=x&nxt=2&req=null"));
  assert.equal(p.boxW, 3840);
  assert.equal(p.boxH, 60);
  assert.equal(p.gap, 30);
  assert.equal(p.lyricsH, 20);
  assert.equal(p.layout, "basic");
  assert.equal(p.showCurrent, true);
  assert.equal(p.showNext, true);
  assert.equal(p.showRequester, true);
  const nan = parseOverlaySettings(q("bw=abc&bh="));
  assert.equal(nan.boxW, 1000);
  assert.equal(nan.boxH, 180);
});

test("sanitize: 엉뚱한 타입/범위의 저장값도 안전하게 정리한다", () => {
  const s = sanitizeOverlaySettings({ preset: "banner", boxW: "x", boxH: 99999, gap: -3, lyricsH: 500, showNext: "yes", layout: "wide" });
  assert.equal(s.preset, "banner");
  assert.equal(s.boxW, 1000); // 문자열은 버리고 기본값
  assert.equal(s.boxH, 1080);
  assert.equal(s.gap, 0);
  assert.equal(s.lyricsH, 100);
  assert.equal(s.showNext, true);
  assert.equal(s.layout, "wide");
  assert.deepEqual(sanitizeOverlaySettings(null), DEFAULT_OVERLAY_SETTINGS);
  assert.deepEqual(sanitizeOverlaySettings("garbage"), DEFAULT_OVERLAY_SETTINGS);
});

test("bannerSize: 묶음은 고정 크기, 사용자 지정은 입력값", () => {
  const base = DEFAULT_OVERLAY_SETTINGS;
  assert.deepEqual(bannerSize({ ...base, layout: "basic" }), { w: 1000, h: 180 });
  assert.deepEqual(bannerSize({ ...base, layout: "wide" }), { w: 1200, h: 160 });
  assert.deepEqual(bannerSize({ ...base, layout: "ultra" }), { w: 1600, h: 140 });
  assert.deepEqual(bannerSize({ ...base, layout: "custom", boxW: 777, boxH: 123 }), { w: 777, h: 123 });
  assert.equal(OVERLAY_LAYOUTS.length, 4);
});

test("배너 프리셋 선택 시 기존 디자인 설정은 건드리지 않고 배너 기본 옵션만 적용된다", () => {
  const d = presetDefaults("banner");
  assert.equal(d.background, "translucent");
  assert.ok(!("position" in d) && !("size" in d) && !("layout" in d));
  // 다른 프리셋은 새 필드를 건드리지 않는다
  for (const p of ["minimal", "karaoke", "queue", "vertical"] as const) assert.ok(!("layout" in presetDefaults(p)));
});

test("신청자 이름 같은 문구는 URL에 실리지 않는다 (설정 URL에는 표시 옵션만)", () => {
  const url = serializeOverlaySettings(DEFAULT_OVERLAY_SETTINGS, "book1", "a".repeat(24));
  assert.ok(!/token|auth|secret|password/i.test(url));
});
