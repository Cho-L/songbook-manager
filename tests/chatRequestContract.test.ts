import test from "node:test";
import assert from "node:assert/strict";
import type { Song } from "../src/types/song.ts";
import { searchSongs } from "../src/utils/search.ts";
import { ChatRequestModel, matchCommand, parseCommand, type Envelope, type Platform } from "./fixtures/chatRequestModel.ts";

// These are proposed contracts in a test fixture, NOT an implemented platform integration.
const NOW = Date.parse("2026-10-26T00:00:00Z");
const song = (id: string, title: string, artist: string, extra: Partial<Song> = {}): Song => ({
  id, ownerId: "book-a", title, artist, tags: [], favorite: false, createdAt: "", updatedAt: "", ...extra,
});
const songs = [song("dear", "이름에게", "아이유"), song("night", "밤편지", "아이유"), song("jp", "夜に駆ける", "YOASOBI"),
  song("wrong-artist", "Dear Name", "Other Person"), song("live", "이름에게 (Live)", "아이유"),
  song("other-book", "이름에게", "아이유", { ownerId: "book-b" })];
function model(capacity = 1000) {
  return new ChatRequestModel(songs, [
    { platform: "chzzk", channelId: "channel-a", bookId: "book-a" },
    { platform: "soop", channelId: "channel-a", bookId: "book-a" },
    { platform: "chzzk", channelId: "channel-b", bookId: "book-b" },
  ], undefined, capacity);
}
const event = (platform: Platform, extra: Partial<Envelope> = {}): Envelope => ({
  platform, channelId: "channel-a", userId: "user-a", eventId: "event-1", displayName: "모의 시청자", text: "!신청 Dear Name / IU", ...extra,
});
for (const [raw, expected] of [
  ["!신청 이름에게 / 아이유", { kind: "submit", title: "이름에게", artist: "아이유" }],
  ["  !신청　Dear   Name ／ ＩＵ ", { kind: "submit", title: "Dear Name", artist: "IU" }],
  ["!신청 夜に駆ける / ヨアソビ", { kind: "submit", title: "夜に駆ける", artist: "ヨアソビ" }],
  ["!대기열", { kind: "queue" }], ["!취소", { kind: "cancel" }],
] as const) test(`proposed parser: ${raw}`, () => assert.deepEqual(parseCommand(raw), expected));
for (const raw of ["!신청곡", "!신청", "!신청 곡", "!신청 / 가수", "!신청 곡 /", "!신청 곡 / 가수 / 다른", "!대기열 추가", "!취소 user-b", "!신청 곡\n/ 가수", "!신청 곡\u0000 / 가수", "a".repeat(301), "일반 채팅"]) {
  test(`proposed parser refuses malformed/ambiguous command ${JSON.stringify(raw).slice(0, 40)}`, () => assert.equal(parseCommand(raw), null));
}
for (const query of ["Dear Name / IU", "이름에게 / 아이유", "밤을 달리다 / 요아소비", "Yoru ni Kakeru / YOASOBI", "夜に駆ける / ヨアソビ"]) {
  test(`existing aliases reused for exact chat matching: ${query}`, () => {
    const cmd = parseCommand(`!신청 ${query}`);
    assert.ok(cmd?.kind === "submit");
    const found = matchCommand(songs.filter((s) => s.ownerId === "book-a"), cmd);
    assert.deepEqual(found.map((s) => s.id), [query.includes("Name") || query.includes("이름에게") ? "dear" : "jp"]);
  });
}
test("[KNOWN GAP CHAT-MATCH] broad UI search is not safe auto-selection for short titles", () => {
  const pool = [song("long", "이름에게 (Live)", "아이유")];
  assert.equal(searchSongs(pool, "이름 / 아이유").length, 1, "existing UI supports partial matching");
  assert.deepEqual(matchCommand(pool, { kind: "submit", title: "이름", artist: "아이유" }), [], "proposed contract refuses partial/version mismatch");
});
for (const platform of ["chzzk", "soop"] as const) {
  test(`${platform} MODEL: accept, duplicate event, duplicate song and cooldown reuse existing rules`, () => {
    const m = model();
    assert.equal(m.handle(event(platform), NOW).code, "accepted");
    assert.equal(m.handle(event(platform), NOW + 1).code, "duplicate_event");
    assert.equal(m.handle(event(platform, { eventId: "e2", userId: "user-b" }), NOW + 2).code, "duplicate_song");
    assert.equal(m.handle(event(platform, { eventId: "e3", text: "!신청 밤편지 / 아이유" }), NOW + 3).code, "cooldown");
    assert.equal(m.rows.length, 1);
  });
  test(`${platform} MODEL: identity uses verified user id, not display name`, () => {
    const m = model();
    m.handle(event(platform), NOW);
    assert.equal(m.handle(event(platform, { eventId: "e2", userId: "imposter", text: "!취소" }), NOW + 1).code, "nothing_to_cancel");
    assert.equal(m.handle(event(platform, { eventId: "e3", displayName: "다른 이름", text: "!취소" }), NOW + 2).code, "canceled");
    assert.equal(m.rows[0].status, "canceled");
  });
  test(`${platform} MODEL: !취소 only latest own pending, never approved/playing or other book`, () => {
    const m = model();
    m.handle(event(platform), NOW);
    m.handle(event(platform, { eventId: "e2", text: "!신청 밤편지 / 아이유" }), NOW + 21_000);
    assert.equal(m.handle(event(platform, { eventId: "e3", text: "!취소" }), NOW + 22_000).id, "mock-2");
    m.rows[0].status = "approved";
    assert.equal(m.handle(event(platform, { eventId: "e4", text: "!취소" }), NOW + 23_000).code, "nothing_to_cancel");
    m.rows[0].status = "playing";
    assert.equal(m.handle(event(platform, { eventId: "e5", text: "!취소" }), NOW + 24_000).code, "nothing_to_cancel");
    assert.equal(m.rows[0].status, "playing");
  });
  test(`${platform} MODEL: queue/cancel flood is limited independently of accepted submissions`, () => {
    const m = model();
    for (let i = 0; i < 5; i++) assert.equal(m.handle(event(platform, { eventId: `e${i}`, text: "!대기열" }), NOW + i).code, "queue");
    assert.equal(m.handle(event(platform, { eventId: "e6", text: "!취소" }), NOW + 5).code, "command_rate_limited");
    assert.equal(m.handle(event(platform, { eventId: "e7", text: "!대기열" }), NOW + 20_010).code, "queue");
  });
}
test("MODEL: identical event/user ids are isolated by platform and channel/book", () => {
  const m = model();
  m.handle(event("chzzk"), NOW);
  assert.equal(m.handle(event("soop", { text: "!취소" }), NOW + 1).code, "nothing_to_cancel");
  assert.equal(m.handle(event("chzzk", { channelId: "channel-b", text: "!취소" }), NOW + 2).code, "nothing_to_cancel");
  assert.equal(m.rows[0].status, "pending");
  assert.equal(m.handle(event("chzzk", { channelId: "channel-b", eventId: "new-event" }), NOW + 3).code, "accepted");
  assert.equal(m.rows[1].songId, "other-book");
});
test("MODEL: reject unsupported platform/unbound channel/anonymous event and ignore self replies", () => {
  const m = model();
  assert.equal(m.handle({ ...event("chzzk"), platform: "unsupported" }, NOW).code, "unsupported_platform");
  assert.equal(m.handle(event("chzzk", { channelId: "unbound" }), NOW).code, "unbound_channel");
  assert.equal(m.handle(event("chzzk", { userId: "" }), NOW).code, "invalid_event");
  assert.equal(m.handle(event("chzzk", { eventId: "" }), NOW).code, "invalid_event");
  assert.equal(m.handle(event("chzzk", { fromSelf: true }), NOW).code, "ignored_self");
  assert.equal(m.rows.length, 0);
});
test("MODEL: ambiguous/unknown songs stay out of queue, not first hit", () => {
  const m = new ChatRequestModel([...songs, song("duplicate", "이름에게", "아이유")], [{ platform: "chzzk", channelId: "channel-a", bookId: "book-a" }]);
  assert.equal(m.handle(event("chzzk"), NOW).code, "needs_choice");
  assert.equal(m.handle(event("chzzk", { eventId: "e2", text: "!신청 Unknown / IU" }), NOW).code, "song_not_found");
  assert.equal(m.rows.length, 0);
});
test("MODEL: public queue reveals approved/playing summaries only, never private identity or pending title", () => {
  const m = model();
  m.handle(event("chzzk"), NOW);
  let response = m.handle(event("chzzk", { eventId: "e2", text: "!대기열" }), NOW + 1);
  assert.deepEqual(response, { code: "queue", pendingCount: 1, queue: [] });
  m.rows[0].status = "approved";
  response = m.handle(event("chzzk", { eventId: "e3", text: "!대기열" }), NOW + 2);
  assert.deepEqual(response.queue, [{ title: "이름에게", artist: "아이유", status: "approved" }]);
  assert.ok(!JSON.stringify(response).includes("user-a"));
  assert.ok(!JSON.stringify(response).includes("requesterKey"));
});
test("MODEL: replay cache is bounded/fail-closed and TTL expiry does not bypass accepted-row duplicate rules", () => {
  const m = model(1);
  assert.equal(m.handle(event("chzzk"), NOW).code, "accepted");
  assert.equal(m.handle(event("chzzk", { eventId: "e2", text: "!大" }), NOW + 1).code, "invalid_command");
  assert.equal(m.handle(event("chzzk", { eventId: "e2" }), NOW + 2).code, "busy");
  assert.equal(m.handle(event("chzzk"), NOW + 600_001).code, "duplicate_song");
  assert.equal(m.seen.size, 1);
});
test("MODEL: accepted request user/queue limits reuse evaluateSubmit rather than new rules", () => {
  const m = model();
  m.handle(event("chzzk"), NOW);
  m.handle(event("chzzk", { eventId: "e2", text: "!신청 밤편지 / 아이유" }), NOW + 21_000);
  assert.equal(m.handle(event("chzzk", { eventId: "e3", text: "!신청 夜に駆ける / YOASOBI" }), NOW + 42_000).code, "user_limit");
  const small = new ChatRequestModel(songs, [{ platform: "chzzk", channelId: "channel-a", bookId: "book-a" }], { accepting: true, maxQueue: 1, perUserMax: 2 });
  small.handle(event("chzzk"), NOW);
  assert.equal(small.handle(event("chzzk", { eventId: "e2", userId: "other", text: "!신청 밤편지 / 아이유" }), NOW + 1).code, "queue_full");
});
test("MODEL: canceled submissions still count towards existing hourly spam limit", () => {
  const m = model();
  for (let i = 0; i < 10; i++) {
    assert.equal(m.handle(event("chzzk", { eventId: `submit-${i}` }), NOW + i * 21_000).code, "accepted");
    assert.equal(m.handle(event("chzzk", { eventId: `cancel-${i}`, text: "!취소" }), NOW + i * 21_000 + 1).code, "canceled");
  }
  assert.equal(m.handle(event("chzzk", { eventId: "eleventh" }), NOW + 210_000).code, "rate_limited");
  assert.equal(m.rows.length, 10);
});
test("MODEL: both platforms share book duplicate checks while their requester identities remain distinct", () => {
  const m = model();
  assert.equal(m.handle(event("chzzk"), NOW).code, "accepted");
  assert.equal(m.handle(event("soop"), NOW + 1).code, "duplicate_song");
  assert.equal(m.handle(event("soop", { eventId: "e2", text: "!신청 밤편지 / 아이유" }), NOW + 2).code, "accepted");
  assert.deepEqual(m.rows.map((r) => r.platform), ["chzzk", "soop"]);
});
