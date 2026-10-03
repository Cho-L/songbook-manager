import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Song } from "../types/song";
import { hasTimestamps, parseLyrics } from "../utils/lyrics";
import { deleteEntry, isAutoLyricsEnabled, isExpired, readEntry, writeEntry } from "../lyrics/cache";
import { LrclibProvider } from "../lyrics/providers/lrclib";
import { appliesToLyrics, buildResolvedLyrics, getWarp, isEntryValid, resolveLyrics } from "../lyrics/pipeline";
import { clampWarp, compareDurations, isIdentity, warpFromAnchors } from "../lyrics/warp";
import type { Anchor } from "../lyrics/warp";
import type { LyricsProvider, SyncEntry } from "../lyrics/types";

/** 화면에 보여 줄 자동 가사/싱크 상태 */
export type AutoStatusKind =
  | "off" //       자동 기능이 필요 없거나 꺼져 있음 (저장된 싱크 가사가 있음 등)
  | "searching"
  | "synced"
  | "partial"
  | "lyrics-only"
  | "no-sync"
  | "needs-choice"
  | "mismatch"
  | "not-found"
  | "failed";

export interface AutoStatus {
  kind: AutoStatusKind;
  text: string;
  /** 부가 안내(경고) */
  notes: string[];
}

let provider: LyricsProvider = new LrclibProvider();
/** 테스트/다른 provider 연결용 */
export function setLyricsProvider(p: LyricsProvider): void {
  provider = p;
}

export function describeStatus(args: {
  searching: boolean;
  error: string | null;
  entry: SyncEntry | null;
  ownSynced: boolean;
  enabled: boolean;
  mrDuration?: number;
  videoId?: string;
}): AutoStatus {
  const { searching, error, entry, ownSynced, enabled, mrDuration, videoId } = args;
  if (ownSynced) return { kind: "off", text: "", notes: [] };
  if (searching) return { kind: "searching", text: "🎤 가사 찾는 중...", notes: [] };
  if (error) return { kind: "failed", text: `❌ 자동 싱크 실패 — ${error}`, notes: [] };
  if (!enabled && !entry) return { kind: "off", text: "", notes: [] };
  if (!entry) return { kind: "off", text: "", notes: [] };
  const notes = [...entry.warnings];
  const conf = entry.confidence !== undefined ? ` · 신뢰도 ${Math.round(entry.confidence * 100)}%` : "";
  const src = entry.source ? `${entry.source}` : "";
  if (entry.outcome === "synced" || entry.outcome === "partial") {
    const cmp = compareDurations(entry.candidate?.duration, mrDuration);
    const warp = getWarp(entry, videoId);
    if (cmp && !cmp.similar && isIdentity(warp)) {
      const sign = cmp.diff > 0 ? "길어요" : "짧아요";
      notes.push(`MR이 원곡보다 약 ${Math.abs(Math.round(cmp.diff))}초 ${sign} — 가사가 어긋나면 아래 "싱크 보정"으로 맞춰 주세요`);
    }
    if (entry.outcome === "partial") {
      const matched = entry.lines.filter((l) => l.matched).length;
      const total = entry.lines.filter((l) => l.text.trim()).length;
      return { kind: "partial", text: `⚠️ 일부 가사 싱크를 찾지 못했습니다 (${matched}/${total}줄)${conf}`, notes };
    }
    return { kind: "synced", text: `✓ 자동 싱크 완료 (${src}${conf})`, notes };
  }
  if (entry.outcome === "lyrics-only") return { kind: "lyrics-only", text: "가사만 찾았어요 — 싱크 정보가 없어 자동으로 따라가지는 않아요", notes };
  if (entry.outcome === "no-sync") return { kind: "no-sync", text: "싱크 정보를 찾지 못해 저장된 가사를 그대로 보여줘요", notes };
  if (entry.outcome === "needs-choice") return { kind: "needs-choice", text: "후보가 여러 개예요 — 맞는 곡을 골라 주세요", notes };
  if (entry.outcome === "mismatch") return { kind: "mismatch", text: "찾은 가사가 저장된 가사와 많이 달라서 적용하지 않았어요", notes };
  return { kind: "not-found", text: "가사를 찾지 못했어요", notes };
}

/**
 * 곡의 가사를 자동으로 찾고 싱크해서, 기존 SongMode/ConcertMode/OBS 가 그대로 읽을 수 있는 song 을 돌려준다.
 * - 저장된 가사에 이미 [mm:ss] 타임스탬프가 있으면 아무것도 하지 않는다 (기존 LRC 그대로)
 * - 저장된 Song 데이터는 절대 수정하지 않는다. 결과는 별도 캐시에만 저장된다.
 * - 곡이 바뀌거나 느린 응답이 늦게 도착해도 이전 곡의 결과가 적용되지 않는다 (요청 번호로 폐기)
 */
export function useAutoLyrics(rawSong: Song | undefined) {
  const [entry, setEntry] = useState<SyncEntry | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(isAutoLyricsEnabled());
  const reqRef = useRef(0);

  const ownLyrics = rawSong?.lyrics ?? "";
  const ownSynced = useMemo(() => hasTimestamps(parseLyrics(ownLyrics)), [ownLyrics]);
  const title = rawSong?.title ?? "";
  const artist = rawSong?.artist ?? "";
  const songId = rawSong?.id;
  const videoId = rawSong?.youtubeVideoId;

  useEffect(() => {
    const sync = () => setEnabled(isAutoLyricsEnabled());
    window.addEventListener("songbook-auto-lyrics-change", sync);
    return () => window.removeEventListener("songbook-auto-lyrics-change", sync);
  }, []);

  const run = useCallback(
    async (opts: { candidateId?: string } = {}) => {
      if (!songId) return;
      const id = ++reqRef.current;
      setSearching(true);
      setError(null);
      try {
        const result = await resolveLyrics({ songId, title, artist, ownLyrics }, provider, { candidateId: opts.candidateId });
        if (id !== reqRef.current) return; // 곡이 바뀌었거나 더 새로운 요청이 있음 → 이 결과는 버린다
        writeEntry(result);
        setEntry(result);
      } catch {
        if (id !== reqRef.current) return;
        setError("가사 서비스에 연결하지 못했어요"); // 일시적 실패는 캐시하지 않는다
      } finally {
        if (id === reqRef.current) setSearching(false);
      }
    },
    [songId, title, artist, ownLyrics]
  );

  // 곡이 바뀌면: 캐시 확인 → 없거나 무효면 검색
  useEffect(() => {
    const myReq = ++reqRef.current;
    setError(null);
    setSearching(false);
    if (!songId || ownSynced) {
      setEntry(null);
      return;
    }
    const cached = readEntry(songId);
    if (cached) {
      if (isEntryValid(cached, { title, artist, ownLyrics }) && !isExpired(cached)) {
        setEntry(cached);
        return;
      }
      deleteEntry(songId); // 곡 정보가 바뀌었거나 만료됨 → 버린다
    }
    setEntry(null);
    if (!enabled) return;
    reqRef.current = myReq - 1; // run()이 새 요청 번호를 받도록
    void run();
    // run 은 위 의존성(곡 정보)이 바뀔 때 새로 만들어지므로 같은 키로 한 번만 실행된다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songId, title, artist, ownLyrics, ownSynced, enabled]);

  const applied = Boolean(entry && appliesToLyrics(entry, ownLyrics));
  const song = useMemo(() => {
    if (!rawSong || !entry || !applied) return rawSong;
    return { ...rawSong, lyrics: buildResolvedLyrics(entry, videoId, ownLyrics) };
  }, [rawSong, entry, applied, videoId, ownLyrics]);

  const saveWarp = useCallback(
    (warp: { offset: number; ratio: number }) => {
      setEntry((cur) => {
        if (!cur) return cur;
        const next = { ...cur, warps: { ...cur.warps, [videoId ?? ""]: clampWarp(warp) } };
        writeEntry(next);
        return next;
      });
    },
    [videoId]
  );

  return {
    song,
    rawSong,
    entry,
    searching,
    error,
    enabled,
    applied,
    ownSynced,
    warp: entry ? getWarp(entry, videoId) : { offset: 0, ratio: 1 },
    refresh: () => {
      if (songId) deleteEntry(songId);
      setEntry(null);
      return run();
    },
    choose: (candidateId: string) => run({ candidateId }),
    clear: () => {
      if (songId) deleteEntry(songId);
      setEntry(null);
      setError(null);
    },
    /** MR 싱크 보정: 전체를 sec 만큼 이동 */
    nudge: (sec: number) => {
      if (!entry) return;
      const cur = getWarp(entry, videoId);
      saveWarp({ ...cur, offset: Math.round((cur.offset + sec) * 100) / 100 });
    },
    resetWarp: () => saveWarp({ offset: 0, ratio: 1 }),
    /** "지금이 첫 소절 시작" — 현재 재생 시간을 첫 싱크 줄의 대응점으로 삼아 오프셋을 맞춘다 */
    anchorFirstLine: (nowSec: number): boolean => {
      if (!entry) return false;
      const first = entry.lines.find((l) => l.matched && l.time !== null);
      if (!first || first.time === null) return false;
      const anchors: Anchor[] = [{ ref: first.time, actual: nowSec }];
      const w = warpFromAnchors(anchors);
      if (!w) return false;
      saveWarp(w);
      return true;
    },
  };
}
