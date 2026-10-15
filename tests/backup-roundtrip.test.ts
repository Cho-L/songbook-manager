import test from "node:test";
import assert from "node:assert/strict";
import { parseSongsCSV, parseSongsJSON, songsToCSV, songsToJSON } from "../src/utils/backup";
import type { Song } from "../src/types/song";

// Import/Export 는 Phase 3.7 에서 바꾸지 않았다. 다국어 곡/발음 보조 줄/별칭이 왕복(내보내기→가져오기)에서 보존되는지만 확인한다.
const now = new Date().toISOString();
const songs: Song[] = [
  { id: "1", ownerId: "o", title: "踊り子", artist: "Vaundy", tags: ["j-rock", "신청"], favorite: false, createdAt: now, updatedAt: now, titleAliases: ["Odoriko", "무희"], artistAliases: ["바운디"], lyrics: "[00:10.00] 君が好きです\n{발음} 키미가 스키데스\n[00:15.00] La la", youtubeVideoId: "dQw4w9WgXcQ" },
  { id: "2", ownerId: "o", title: "쉼표, \"따옴표\"", artist: "아이묭", tags: [], favorite: true, createdAt: now, updatedAt: now, lyrics: "줄1\n줄2" },
];

test("JSON 왕복: 제목/별칭/발음 줄/태그 보존", () => {
  const r = parseSongsJSON(songsToJSON(songs));
  assert.equal(r.errors.length, 0);
  assert.equal(r.valid.length, 2);
  assert.equal(r.valid[0].title, "踊り子");
  assert.deepEqual(r.valid[0].titleAliases, ["Odoriko", "무희"]);
  assert.deepEqual(r.valid[0].artistAliases, ["바운디"]);
  assert.ok(r.valid[0].lyrics?.includes("{발음} 키미가 스키데스"));
  assert.deepEqual(r.valid[0].tags, ["j-rock", "신청"]);
  assert.equal(r.valid[1].title, '쉼표, "따옴표"');
});

test("CSV 왕복: 쉼표/따옴표/줄바꿈/일본어 보존", () => {
  const r = parseSongsCSV(songsToCSV(songs));
  assert.equal(r.errors.length, 0);
  assert.equal(r.valid.length, 2);
  assert.equal(r.valid[0].title, "踊り子");
  assert.ok(r.valid[0].lyrics?.includes("{발음} 키미가 스키데스"));
  assert.equal(r.valid[1].title, '쉼표, "따옴표"');
  assert.equal(r.valid[1].lyrics, "줄1\n줄2");
});

test("잘못된 행만 오류로 분리하고 나머지는 가져온다", () => {
  const bad = JSON.stringify({ format: "songbook-manager", version: 1, songs: [{ title: "ok", artist: "a" }, { title: "", artist: "" }, 5] });
  const r = parseSongsJSON(bad);
  assert.equal(r.valid.length, 1);
  assert.ok(r.errors.length >= 1);
});
