import test from "node:test";
import assert from "node:assert/strict";
import { searchSongs } from "../src/utils/search.ts";
import { normalizeForSearch, toChoseong } from "../src/utils/searchNormalize.ts";
import type { Song } from "../src/types/song.ts";

const mk = (id: string, title: string, artist: string, extra: Partial<Song> = {}): Song => ({
  id, ownerId: "o", title, artist, tags: [], favorite: false, createdAt: "", updatedAt: "", ...extra,
});
const songs = [
  mk("1", "이름에게", "아이유"),
  mk("2", "밤편지", "아이유"),
  mk("3", "Dear Name", "다른가수"),
  mk("4", "夜に駆ける", "YOASOBI"),
  mk("5", "Custom", "나", { titleAliases: ["커스텀별칭"] }),
];
const ids = (q: string) => searchSongs(songs, q).map((s) => s.id);

for (const q of ["이름에게 / 아이유", "Dear Name / IU", "Dear Name / 아이유", "이름에게 / IU", "dear name iu", "DEAR-NAME"]) {
  test(`alias: ${q}`, () => assert.ok(ids(q).includes("1"), q));
}
test("artist mismatch excludes", () => assert.ok(!ids("Dear Name / IU").includes("3")));
test("japanese original vs english/korean", () => {
  assert.ok(ids("YOASOBI").includes("4"));
  assert.ok(ids("ヨアソビ").includes("4"));
  assert.ok(ids("요아소비").includes("4"));
  assert.ok(ids("夜に駆ける / 요아소비").includes("4"));
});
test("per-song alias", () => assert.deepEqual(ids("커스텀별칭"), ["5"]));
test("choseong", () => assert.ok(ids("ㅇㄹㅇㄱ").includes("1")));
test("NFKC", () => assert.equal(normalizeForSearch("ＤＥＡＲ　Ｎame"), "dearname"));
test("choseong fn", () => assert.equal(toChoseong("이름"), "ㅇㄹ"));
test("empty query returns all", () => assert.equal(ids("").length, songs.length));
