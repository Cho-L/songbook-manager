import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePageParam, parseSortParam } from "../src/utils/listParams";

test("page 파라미터 검증", () => {
  assert.equal(parsePageParam("3"), 3);
  assert.equal(parsePageParam(null), 1);
  for (const bad of ["0", "-2", "abc", "2.5", ""]) assert.equal(parsePageParam(bad), 1);
});

test("sort 파라미터 검증", () => {
  assert.equal(parseSortParam("title"), "title");
  assert.equal(parseSortParam("zzz"), "recent");
  assert.equal(parseSortParam(null), "recent");
});
