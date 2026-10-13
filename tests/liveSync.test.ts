import test from "node:test";
import assert from "node:assert/strict";
import { MAX_EXTRAPOLATE_SEC, clockPos, clockedLineIndex, hasClock, indexAt, msToNextLine } from "../src/utils/liveClock";
import { buildLiveLyrics } from "../src/utils/liveBroadcast";
import { findCurrentLyricIndex, parseLyrics } from "../src/utils/lyrics";
import { OFFSET_LIMIT_SEC, clampOffset, formatOffsetSec, readLyricOffset, writeLyricOffset } from "../src/lyrics/lyricOffset";

const base = { synced: true, lines: ["a", "b", "c"], times: [10, 20, 30], pos: 12, rate: 1, playback: "playing" as const };

test("OBS 시계: 받은 시각 기준으로 playing 일 때만 진행", () => {
  assert.equal(clockPos(base, 5000, 5000), 12);
  assert.equal(clockPos(base, 13000, 5000), 20); // 8초 경과
  assert.equal(clockedLineIndex(base, 5000, 5000), 0);
  assert.equal(clockedLineIndex(base, 13000, 5000), 1); // 20초 → 두 번째 줄
  assert.equal(clockedLineIndex({ ...base, playback: "paused" }, 99999, 5000), 0); // 일시정지: 위치 유지
  assert.equal(clockedLineIndex({ ...base, playback: "waiting" }, 99999, 5000), 0); // 버퍼링: 위치 유지
  assert.equal(clockPos({ ...base, rate: 2 }, 6000, 5000), 14); // 재생 속도 반영
});

test("OBS 시계: 메시지가 끊기면 무한히 진행하지 않는다", () => {
  const p = clockPos(base, 5000 + 600_000, 5000) as number;
  assert.equal(p, 12 + MAX_EXTRAPOLATE_SEC);
});

test("OBS 시계: 시간 정보가 없으면 null(기존 lineIndex 사용)", () => {
  assert.equal(hasClock({ ...base, times: undefined }), false);
  assert.equal(clockedLineIndex({ ...base, times: undefined }, 1, 1), null);
  assert.equal(clockedLineIndex({ ...base, pos: undefined }, 1, 1), null);
  assert.equal(clockedLineIndex({ ...base, times: [1, 2] }, 1, 1), null); // 길이 불일치
  assert.equal(clockedLineIndex({ ...base, synced: false }, 1, 1), null);
});

test("OBS 시계: 탐색 후 새 pos 를 받으면 즉시 그 줄 / 첫 줄 전은 -1", () => {
  assert.equal(clockedLineIndex({ ...base, pos: 31, playback: "paused" }, 0, 0), 2);
  assert.equal(clockedLineIndex({ ...base, pos: 3, playback: "paused" }, 0, 0), -1);
  assert.equal(indexAt([10, 20, 30], 20), 1); // 경계는 포함
});

test("다음 줄까지 남은 시간(타이머용)", () => {
  assert.equal(msToNextLine(base, 5000, 5000), 8000);
  assert.equal(msToNextLine({ ...base, rate: 2 }, 5000, 5000), 4000);
  assert.equal(msToNextLine({ ...base, playback: "paused" }, 5000, 5000), null);
  assert.equal(msToNextLine({ ...base, pos: 31 }, 5000, 5000), null); // 마지막 줄 이후
});

test("방송 시간표에 싱크 보정값이 반영되고 원문/발음 인덱스가 같다", () => {
  const lines = parseLyrics("[00:10.00]a\n{발음} 아\n[00:20.00]b\n{발음} 비\n메모(시간 없음)");
  const plain = buildLiveLyrics(lines, 1, 0);
  assert.deepEqual(plain.times, [10, 20]);
  const shifted = buildLiveLyrics(lines, 1, 0.5); // 가사를 0.5초 늦게
  assert.deepEqual(shifted.times, [10.5, 20.5]);
  assert.equal(shifted.pron?.length, shifted.lines.length);
  // 같은 재생 시간에서 보정 전/후 줄이 달라진다 (SongMode 의 currentTime - offset 와 OBS 의 times 비교가 일치)
  assert.equal(findCurrentLyricIndex(lines, 10.2 - 0.5), -1);
  assert.equal(indexAt(shifted.times, 10.2), -1);
  assert.equal(indexAt(shifted.times, 10.6), 0);
  assert.equal(findCurrentLyricIndex(lines, 10.6 - 0.5), 0);
  // 시간 없는 줄(메모)은 시간표에 들어가지 않는다 / 시간 없는 가사는 times 가 비어 있다
  assert.equal(shifted.lines.length, 2);
  assert.deepEqual(buildLiveLyrics(parseLyrics("a\nb"), -1, 0).times, []);
});

test("곡별 보정값: 범위 제한·0.1초 단위·초기화·곡별 분리", () => {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  } as unknown as Storage;
  assert.equal(readLyricOffset("a"), 0);
  writeLyricOffset("a", 0.5);
  writeLyricOffset("b", -1.5);
  assert.equal(readLyricOffset("a"), 0.5);
  assert.equal(readLyricOffset("b"), -1.5);
  writeLyricOffset("a", 0);
  assert.equal(readLyricOffset("a"), 0);
  assert.equal(store.size, 1); // 0 이면 저장값을 지운다
  assert.equal(clampOffset(999), OFFSET_LIMIT_SEC);
  assert.equal(clampOffset(NaN), 0);
  assert.equal(clampOffset(0.1 + 0.2), 0.3);
  assert.equal(formatOffsetSec(0.5), "+0.5초");
  assert.equal(formatOffsetSec(-1), "-1.0초");
  assert.equal(readLyricOffset(undefined), 0);
});
