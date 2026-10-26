import { LYRICS_SEARCH_REVISION, type SyncEntry } from "./types";

/**
 * 자동 싱크 결과 캐시 — 이 브라우저(localStorage)에만 저장한다.
 * 가사는 저작권이 있는 데이터라서 서버/DB에 모아 두지 않는다. 같은 곡을 다시 열면 네트워크/분석 없이 즉시 쓴다.
 * 무효화: 제목·가수·저장된 가사가 바뀌면 isEntryValid 가 false → 항목을 버리고 새로 찾는다.
 */
const PREFIX = "songbook:lyrics-sync:v1:";
const ENABLED_KEY = "songbook:auto-lyrics-enabled";
export const NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000;

export function readEntry(songId: string): SyncEntry | null {
  try {
    const raw = localStorage.getItem(PREFIX + songId);
    if (!raw) return null;
    const e = JSON.parse(raw) as SyncEntry;
    return e && e.v === 1 && e.songId === songId && Array.isArray(e.lines) ? e : null;
  } catch {
    return null;
  }
}

export function writeEntry(entry: SyncEntry): void {
  try {
    localStorage.setItem(PREFIX + entry.songId, JSON.stringify(entry));
  } catch {
    // 저장소가 가득 차도 이번 화면에서는 계속 쓸 수 있다
  }
}

export function deleteEntry(songId: string): void {
  try {
    localStorage.removeItem(PREFIX + songId);
  } catch {
    // ignore
  }
}

/** "못 찾음/후보 선택 필요/안 맞음" 같은 결과는 하루만 기억한다 (그동안 같은 검색을 반복하지 않는다) */
export function isExpired(entry: SyncEntry, now = Date.now()): boolean {
  const negative = entry.outcome === "not-found" || entry.outcome === "needs-choice" || entry.outcome === "mismatch" || entry.outcome === "no-sync";
  return negative && (entry.searchRevision !== LYRICS_SEARCH_REVISION || Boolean(entry.discovery?.failures) ||
    now - entry.createdAt > (entry.discovery?.budgetExhausted ? 60_000 : NEGATIVE_TTL_MS));
}

/** 자동 가사 검색 사용 여부 (기본 켜짐). 켜져 있으면 저장된 싱크 가사가 없는 곡에서만 제목/가수를 외부 가사 서비스로 보내 검색한다. */
export function isAutoLyricsEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setAutoLyricsEnabled(on: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, on ? "1" : "0");
    window.dispatchEvent(new Event("songbook-auto-lyrics-change"));
  } catch {
    // ignore
  }
}
