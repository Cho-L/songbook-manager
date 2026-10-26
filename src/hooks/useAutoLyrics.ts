import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Song } from "../types/song";
import { hasTimestamps, parseLyrics, stripLyricTracks } from "../utils/lyrics";
import { getSongAliases } from "../utils/songAliases";
import { notify } from "../components/ui/feedback";
import { describeLyricsError, isAbort } from "../lyrics/errors";
import { buildPreview, clearLyricsBackup, readLyricsBackup, textForApply, writeLyricsBackup, type ApplyMode, type CandidatePreview } from "../lyrics/apply";
import { learnArtistAliases } from "../lyrics/artist";
import { deleteEntry, isAutoLyricsEnabled, isExpired, readEntry, writeEntry } from "../lyrics/cache";
import { LrclibProvider } from "../lyrics/providers/lrclib";
import { MusicBrainzAliasProvider } from "../lyrics/providers/musicbrainz";
import { appliesToLyrics, buildResolvedLyrics, getWarp, isEntryValid, resolveLyricsDetailed, searchRanked } from "../lyrics/pipeline";
import { clampWarp, compareDurations, isIdentity, nudgeOffset, warpFromAnchors } from "../lyrics/warp";
import type { Anchor } from "../lyrics/warp";
import type { AliasProvider, ArtistCatalog, LyricsProvider, ScoredCandidate, SyncEntry } from "../lyrics/types";

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
  /** 기술적인 세부 정보(출처, 일치도). 기본 화면에는 숨기고 "자세히 보기"에서만 보여준다 */
  detail?: string;
}

let provider: LyricsProvider = new LrclibProvider();
const defaultMb = new MusicBrainzAliasProvider(undefined, undefined, 1000);
let aliasProvider: AliasProvider | undefined = defaultMb;
let catalog: ArtistCatalog | undefined = defaultMb;
/** 테스트/다른 provider 연결용 (alias 가 아티스트 검색도 지원하면 그대로 아티스트 탐색에도 쓴다) */
export function setLyricsProvider(p: LyricsProvider, alias?: AliasProvider, cat?: ArtistCatalog): void {
  provider = p;
  aliasProvider = alias;
  catalog = cat ?? (alias && "searchArtists" in alias ? (alias as unknown as ArtistCatalog) : undefined);
}
export function getArtistCatalog(): ArtistCatalog | undefined {
  return catalog;
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
  if (searching) return { kind: "searching", text: "🎤 가사를 찾고 있어요...", notes: ["곡 제목과 가수 정보로 검색하고 있어요. 잠시만 기다려주세요."] };
  if (error) return { kind: "failed", text: `❌ 자동 싱크에 실패했어요 — ${error}`, notes: ["잠시 후 \"다시 찾기\"를 눌러주세요."] };
  if (!enabled && !entry) return { kind: "off", text: "", notes: [] };
  if (!entry) return { kind: "off", text: "", notes: [] };
  const notes = [...entry.warnings];
  const detail = [entry.source ? `출처 ${entry.source}` : "", entry.confidence !== undefined ? `일치 근거 ${entry.confidence >= 0.75 ? "충분" : entry.confidence >= 0.5 ? "확인 필요" : "부족"}` : ""].filter(Boolean).join(" · ") || undefined;
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
      return { kind: "partial", text: `⚠️ 일부 가사의 싱크를 찾지 못했어요 (${matched}/${total}줄)`, notes, detail };
    }
    return { kind: "synced", text: "✓ 가사를 찾아 싱크를 맞췄어요", notes, detail };
  }
  if (entry.outcome === "lyrics-only") return { kind: "lyrics-only", text: "가사만 찾았어요 — 싱크 정보가 없어 자동으로 따라가지는 않아요", notes };
  if (entry.outcome === "no-sync") return { kind: "no-sync", text: "싱크 정보를 찾지 못해 저장된 가사를 그대로 보여줘요", notes };
  if (entry.outcome === "needs-choice") return { kind: "needs-choice", text: "후보가 여러 개예요 — 맞는 곡을 골라 주세요", notes };
  if (entry.outcome === "mismatch") return { kind: "mismatch", text: "찾은 가사가 저장된 가사와 많이 달라서 적용하지 않았어요", notes };
  return { kind: "not-found", text: "가사를 찾지 못했어요", notes: [...notes, "곡 제목과 가수가 정확한지 확인한 뒤 \"다시 찾기\"를 눌러보세요."] };
}

/**
 * 곡의 가사를 자동으로 찾고 싱크해서, 기존 SongMode/ConcertMode/OBS 가 그대로 읽을 수 있는 song 을 돌려준다.
 * - 저장된 가사에 이미 [mm:ss] 타임스탬프가 있으면 아무것도 하지 않는다 (기존 LRC 그대로)
 * - 저장된 Song 데이터는 절대 수정하지 않는다. 결과는 별도 캐시에만 저장된다.
 * - 곡이 바뀌거나 느린 응답이 늦게 도착해도 이전 곡의 결과가 적용되지 않는다 (요청 번호로 폐기)
 */
export interface AutoLyricsOptions {
  /** 곡 가사를 DB 에 저장한다 (관리자만 넘긴다). 없으면 "곡에 저장" 적용은 쓸 수 없고 이 브라우저 임시 적용만 된다 */
  save?: (lyrics: string) => Promise<void>;
  /** 현재 MR 길이(초) — 후보와 길이 차이를 미리보기에 보여 준다 */
  mrDuration?: number;
}

export function useAutoLyrics(rawSong: Song | undefined, hookOpts: AutoLyricsOptions = {}) {
  const saveFn = hookOpts.save;
  const mrDurationOpt = hookOpts.mrDuration;
  const [pool, setPool] = useState<ScoredCandidate[]>([]);
  const poolRef = useRef<ScoredCandidate[]>([]);
  const [listing, setListing] = useState(false);
  const [applyMsg, setApplyMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [applying, setApplying] = useState(false);
  const [entry, setEntry] = useState<SyncEntry | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(isAutoLyricsEnabled());
  const reqRef = useRef(0);

  const rawLyrics = rawSong?.lyrics ?? "";
  // 발음/번역 보조 줄은 가사 줄 정렬·캐시 키에서 제외한다 (원문 기준)
  const ownLyrics = useMemo(() => stripLyricTracks(rawLyrics), [rawLyrics]);
  const aliasKey = JSON.stringify([rawSong?.titleAliases ?? [], rawSong?.artistAliases ?? []]);
  const known = useMemo(
    () => getSongAliases({ title: rawSong?.title ?? "", artist: rawSong?.artist ?? "", titleAliases: rawSong?.titleAliases, artistAliases: rawSong?.artistAliases }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rawSong?.title, rawSong?.artist, aliasKey]
  );
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
        const { entry: result, pool: found } = await resolveLyricsDetailed(
          { songId, title, artist, ownLyrics, titleAliases: known.titles, artistAliases: known.artists },
          provider,
          { candidateId: opts.candidateId, aliasProvider, pool: opts.candidateId ? poolRef.current : undefined }
        );
        if (id !== reqRef.current) return; // 곡이 바뀌었거나 더 새로운 요청이 있음 → 이 결과는 버린다
        poolRef.current = found;
        setPool(found);
        writeEntry(result);
        setEntry(result);
        // 사용자가 직접 확인한 후보면 아티스트 표기(예: 아이유 ↔ IU)를 별칭으로 기억해 다음 검색부터 바로 맞춘다
        if (opts.candidateId && result.candidate) learnArtistAliases(artist, result.candidate.artist);
      } catch (e) {
        if (id !== reqRef.current || isAbort(e)) return;
        setError(describeLyricsError(e)); // 일시적 실패는 캐시하지 않는다 (오류 종류별 문구)
      } finally {
        if (id === reqRef.current) setSearching(false);
      }
    },
    [songId, title, artist, ownLyrics, known]
  );

  // 곡이 바뀌면: 캐시 확인 → 없거나 무효면 검색
  useEffect(() => {
    const myReq = ++reqRef.current;
    setError(null);
    setSearching(false);
    poolRef.current = [];
    setPool([]);
    setApplyMsg(null);
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

  // Reject stale results during the render before the cache-reset effect runs, too.
  const applied = Boolean(entry && isEntryValid(entry, { title, artist, ownLyrics }) && appliesToLyrics(entry, ownLyrics));
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

  /** 후보 목록만 새로 받아 온다 (자동 선택/캐시와 무관, 사용자가 누를 때만). 본문까지 받으므로 미리보기에 추가 요청이 필요 없다 */
  const loadCandidates = useCallback(async () => {
    if (!songId) return;
    setListing(true);
    setError(null);
    try {
      const ranked = await searchRanked({ songId, title, artist, ownLyrics, titleAliases: known.titles, artistAliases: known.artists }, provider, { aliasProvider });
      poolRef.current = ranked;
      setPool(ranked);
    } catch (e) {
      if (!isAbort(e)) setError(describeLyricsError(e));
    } finally {
      setListing(false);
    }
  }, [songId, title, artist, ownLyrics, known]);

  /**
   * 아티스트 곡 목록(MusicBrainz)에서 사용자가 직접 고른 곡으로 가사 후보를 다시 찾는다 (LRCLIB).
   * 이 곡의 원어 제목·MusicBrainz 가 알려 준 다른 표기로 찾고, 결과를 후보 목록(pool)으로 바꾼다. 자동 선택은 하지 않는다.
   * 돌려주는 값은 이번 검색에서 나온 후보 id 들 (화면에서 이 후보만 보여 주려고).
   */
  const searchForRecording = useCallback(
    async (rec: { title: string; altTitles: string[]; artist: string; artistAliases: string[] }): Promise<string[]> => {
      if (!songId) return [];
      setListing(true);
      setError(null);
      try {
        const ranked = await searchRanked(
          { songId, title: rec.title, artist: rec.artist, ownLyrics, titleAliases: rec.altTitles, artistAliases: rec.artistAliases },
          provider
        );
        poolRef.current = ranked;
        setPool(ranked);
        return ranked.map((c) => c.id);
      } catch (e) {
        if (!isAbort(e)) setError(describeLyricsError(e));
        return [];
      } finally {
        setListing(false);
      }
    },
    [songId, ownLyrics]
  );

  const previewOf = useCallback(
    (candidateId: string, mrDuration?: number): CandidatePreview | null => {
      const c = poolRef.current.find((x) => x.id === candidateId) ?? pool.find((x) => x.id === candidateId);
      return c ? buildPreview(c, { ownLyrics: rawLyrics, mrDuration: mrDuration ?? mrDurationOpt }) : null;
    },
    [pool, rawLyrics, mrDurationOpt]
  );

  /**
   * 후보 가사를 곡에 저장하고 적용한다. 저장이 실패하면 아무것도 바꾸지 않는다(기존 가사 유지).
   * 덮어쓰기 전에 기존 가사를 이 브라우저에 1회 백업한다 (undoApply 로 되돌릴 수 있다).
   */
  const applyCandidate = useCallback(
    async (candidateId: string, mode: ApplyMode, textOverride?: string): Promise<boolean> => {
      if (!songId || !saveFn) return false;
      const preview = previewOf(candidateId);
      const text = preview ? (textOverride && textOverride.trim() ? textOverride : textForApply(preview, mode)) : null;
      if (!preview || !text) {
        setApplyMsg({ kind: "error", text: "적용할 가사를 만들지 못했어요" });
        return false;
      }
      setApplying(true);
      setApplyMsg(null);
      try {
        if (rawLyrics.trim()) writeLyricsBackup(songId, rawLyrics);
        await saveFn(text);
        deleteEntry(songId); // 저장된 가사가 바뀌었으니 임시 자동 결과는 필요 없다
        setEntry(null);
        const okText = preview.synced ? "가사를 저장했어요 — 싱크가 바로 적용돼요" : "가사를 저장했어요 (싱크 없음)";
        setApplyMsg({ kind: "ok", text: okText });
        notify(okText); // 저장된 싱크 가사가 생기면 이 패널은 사라지므로 토스트로도 알린다
        return true;
      } catch (e) {
        setApplyMsg({ kind: "error", text: `저장하지 못했어요 — 기존 가사는 그대로예요${e instanceof Error && e.message ? ` (${e.message})` : ""}` });
        return false;
      } finally {
        setApplying(false);
      }
    },
    [songId, saveFn, previewOf, rawLyrics]
  );

  /** 가사 텍스트를 그대로 저장한다 (발음 저장 등). 기존 가사는 1회 백업하고, 저장 실패 시 아무것도 바꾸지 않는다 */
  const saveLyricsText = useCallback(
    async (text: string, okMessage: string): Promise<boolean> => {
      if (!songId || !saveFn) return false;
      setApplying(true);
      setApplyMsg(null);
      try {
        if (rawLyrics.trim()) writeLyricsBackup(songId, rawLyrics);
        await saveFn(text);
        setApplyMsg({ kind: "ok", text: okMessage });
        notify(okMessage);
        return true;
      } catch (e) {
        setApplyMsg({ kind: "error", text: `저장하지 못했어요 — 기존 가사는 그대로예요${e instanceof Error && e.message ? ` (${e.message})` : ""}` });
        return false;
      } finally {
        setApplying(false);
      }
    },
    [songId, saveFn, rawLyrics]
  );

  const undoApply = useCallback(async (): Promise<boolean> => {
    if (!songId || !saveFn) return false;
    const b = readLyricsBackup(songId);
    if (!b) return false;
    try {
      await saveFn(b.lyrics);
      clearLyricsBackup(songId);
      setApplyMsg({ kind: "ok", text: "이전 가사로 되돌렸어요" });
      return true;
    } catch {
      setApplyMsg({ kind: "error", text: "되돌리지 못했어요" });
      return false;
    }
  }, [songId, saveFn]);

  return {
    candidates: pool,
    listing,
    loadCandidates,
    searchForRecording,
    previewOf,
    applyCandidate,
    undoApply,
    saveLyricsText,
    canSave: Boolean(saveFn),
    hasBackup: songId ? readLyricsBackup(songId) !== null : false,
    applyMsg,
    applying,
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
    /** MR 싱크 보정: direction +1 = 가사 늦게(offset 증가), -1 = 가사 빠르게(offset 감소). 간격은 0.1초(=1) ~ 1.0초(=10) */
    nudge: (stepTenths: number, direction: 1 | -1) => {
      if (!entry) return;
      const cur = getWarp(entry, videoId);
      saveWarp({ ...cur, offset: nudgeOffset(cur.offset, stepTenths, direction) });
    },
    resetWarp: () => saveWarp({ offset: 0, ratio: 1 }),
    /** "현재 부분이 싱크 시작" (자동 찾은 가사): 화면에 보이는 줄 시간(보정 포함)을 nowSec 로 옮기도록 기존 보정에 차이만큼 더한다 */
    shiftWarp: (deltaSec: number): boolean => {
      if (!entry || !Number.isFinite(deltaSec)) return false;
      const cur = getWarp(entry, videoId);
      const next = clampWarp({ ...cur, offset: Math.round((cur.offset + deltaSec) * 10) / 10 });
      if (Math.abs(cur.offset + deltaSec - next.offset) > 0.05) return false; // 한도 초과
      saveWarp(next);
      return true;
    },
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
