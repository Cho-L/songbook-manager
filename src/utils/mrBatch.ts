import type { Song } from "../types/song";
import { hasEnoughInfoForMrSearch } from "./mrSearch";

/**
 * MR(youtubeVideoId)이 "실제로 비어 있는가".
 * 비어 있음: null / undefined / 빈 문자열 / 공백만 있는 문자열.
 * 값이 하나라도 있으면(형식이 이상해도, "null" 같은 글자여도) 비어 있지 않은 것으로 보고 절대 건드리지 않는다.
 */
export function isMrEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  return typeof value === "string" && value.trim() === "";
}

export const MR_BATCH_SIZE = 10;

export interface BookMrStats {
  total: number;
  withMr: number;
  withoutMr: number;
  /** MR이 없지만 제목 또는 가수가 없어 검색할 수 없는 곡 */
  insufficient: number;
  /** 실제 검색 대상 */
  targets: Song[];
}

export function classifyBookSongs(songs: Song[]): BookMrStats {
  const without = songs.filter((s) => isMrEmpty(s.youtubeVideoId));
  const targets = without.filter((s) => hasEnoughInfoForMrSearch(s.title ?? "", s.artist ?? ""));
  return {
    total: songs.length,
    withMr: songs.length - without.length,
    withoutMr: without.length,
    insufficient: without.length - targets.length,
    targets,
  };
}

export type MrSetResult = "updated" | "conflict" | "not-found";

export type MrSaveStatus =
  | { kind: "saved" }
  /** 저장 직전(또는 저장 순간) 이미 MR이 들어 있어 건너뜀 — 기존 값은 그대로 */
  | { kind: "conflict" }
  | { kind: "not-found" }
  | { kind: "failed"; message: string };

export interface MrSaveDeps {
  /** 저장 직전의 최신 노래 목록 */
  fetchLatest: () => Promise<Song[]>;
  /** 저장소 수준의 "MR이 비어 있을 때만" 갱신 */
  setIfEmpty: (songId: string, videoId: string) => Promise<MrSetResult>;
}

/**
 * 사용자가 확인한 MR을 저장한다.
 *  1) 최신 데이터를 다시 읽어, 그 사이 MR이 생긴 곡은 쓰지 않는다
 *  2) 남은 곡은 setIfEmpty(저장소의 조건부 갱신)로 쓴다 — 1)과 2) 사이에 바뀌어도 저장소가 거부한다
 *  3) 곡마다 결과를 따로 돌려준다 (일부 실패해도 나머지는 계속, 실패한 곡만 다시 시도할 수 있다)
 * 최신 목록을 읽지 못하면 아무것도 쓰지 않고 전부 실패로 돌려준다.
 */
export async function saveMrChoices(
  choices: Array<{ songId: string; videoId: string }>,
  deps: MrSaveDeps
): Promise<Map<string, MrSaveStatus>> {
  const out = new Map<string, MrSaveStatus>();
  let latest: Song[];
  try {
    latest = await deps.fetchLatest();
  } catch (e) {
    const message = e instanceof Error ? e.message : "최신 노래 목록을 확인하지 못했어요";
    for (const c of choices) out.set(c.songId, { kind: "failed", message });
    return out;
  }
  const byId = new Map(latest.map((s) => [s.id, s]));
  for (const c of choices) {
    const cur = byId.get(c.songId);
    if (!cur) {
      out.set(c.songId, { kind: "not-found" });
      continue;
    }
    if (!isMrEmpty(cur.youtubeVideoId)) {
      out.set(c.songId, { kind: "conflict" });
      continue;
    }
    try {
      const r = await deps.setIfEmpty(c.songId, c.videoId);
      out.set(c.songId, r === "updated" ? { kind: "saved" } : { kind: r });
    } catch (e) {
      out.set(c.songId, { kind: "failed", message: e instanceof Error ? e.message : "저장하지 못했어요" });
    }
  }
  return out;
}
