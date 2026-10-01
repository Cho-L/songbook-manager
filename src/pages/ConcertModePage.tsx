import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Music2, RotateCcw, Maximize, Lock, LockOpen } from "lucide-react";
import { parseLyrics, hasTimestamps, findCurrentLyricIndex } from "../utils/lyrics";
import { transposeChordsText } from "../utils/transpose";
import { useYouTubePlayer } from "../hooks/useYouTubePlayer";
import { useAuth } from "../hooks/useAuth";
import { usePlaylistSongIds } from "../hooks/usePlaylists";
import { useWakeLock } from "../hooks/useWakeLock";
import { usePreferences } from "../hooks/usePreferences";
import { useBookDesign } from "../hooks/useBookDesign";
import { getChromeCssVars } from "../utils/color";
import { LinkifiedText } from "../components/song/LinkifiedText";
import { useLivePublisher } from "../hooks/useLivePublisher";
import { buildLiveLyrics, buildLiveQueue, toLiveSong, type LiveStateInput } from "../utils/liveBroadcast";
import type { Song } from "../types/song";

interface ConcertModePageProps {
  songs: Song[];
  loading?: boolean;
}

// index 0~3 = sm/md/lg/xl. SongModePage와 동일한 순서를 쓰되, 공연 화면은
// 가사 가독성이 최우선이라 한 단계 더 큰 스케일을 쓴다 (기존 preferences 값은 그대로 baseline).
const FONT_SIZE_ORDER = ["sm", "md", "lg", "xl"] as const;
const CONCERT_LYRICS_SCALE = ["text-2xl", "text-3xl", "text-4xl", "text-5xl"];
const CONCERT_CHORDS_SCALE = ["text-base", "text-lg", "text-xl", "text-2xl"];
const LYRICS_FONT_FAMILY_CLASS: Record<string, string> = {
  system: "",
  serif: "font-serif",
  mono: "font-mono",
};

function clampIndex(i: number): number {
  return Math.max(0, Math.min(FONT_SIZE_ORDER.length - 1, i));
}

const CHROME_MUTED = "var(--book-chrome-muted, rgba(255,255,255,0.5))";
const CHROME_TEXT = "var(--book-chrome-text, rgba(255,255,255,0.85))";
const CHROME_BORDER = "var(--book-chrome-border, rgba(255,255,255,0.1))";
const CHROME_SURFACE = "var(--book-chrome-surface, rgba(255,255,255,0.05))";
const ACCENT = "var(--book-accent, #fbbf24)";

/**
 * 개인 콘서트 모드 — 플레이리스트를 실제 공연 세트리스트처럼 사용하는 전용 화면.
 * 일반 SongMode(SongModePage.tsx)는 그대로 두고, 이 페이지는 별도로 추가된 것이다.
 * 가사/코드/YouTube 재생/Wake Lock은 전부 기존 훅과 유틸을 그대로 재사용하고,
 * 색상은 user_preferences가 아니라 현재 노래책의 Book Design(getChromeCssVars 포함)을 쓴다.
 * user_preferences는 글자 크기/폰트의 baseline을 읽어오는 용도로만 쓰고 저장(update)은 절대 하지 않는다.
 */
export function ConcertModePage({ songs, loading }: ConcertModePageProps) {
  const { ownerId, playlistId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { profile: currentUser } = useAuth();
  const { songIds: playlistSongIds, loading: playlistLoading } = usePlaylistSongIds(playlistId);
  const { design } = useBookDesign(ownerId);
  const { preferences } = usePreferences(currentUser?.id);
  const wakeLock = useWakeLock();

  const startSongId = searchParams.get("start") ?? undefined;
  const [index, setIndex] = useState(0);
  const [restartKey, setRestartKey] = useState(0);
  const startedRef = useRef(false);

  // playlistSongIds가 비동기로 도착한 뒤, 처음 한 번만 ?start= 로 넘어온 곡의 위치로 맞춘다.
  useEffect(() => {
    if (startedRef.current || playlistSongIds.length === 0) return;
    if (startSongId) {
      const idx = playlistSongIds.indexOf(startSongId);
      if (idx >= 0) setIndex(idx);
    }
    startedRef.current = true;
  }, [playlistSongIds, startSongId]);

  const total = playlistSongIds.length;
  const finished = total > 0 && index >= total;
  const currentSongId = !finished ? playlistSongIds[index] : undefined;
  const song = songs.find((s) => s.id === currentSongId);
  const nextSongId = !finished && index + 1 < total ? playlistSongIds[index + 1] : undefined;
  const nextSong = nextSongId ? songs.find((s) => s.id === nextSongId) : undefined;

  const bookStyle = {
    "--book-accent": design.accentColor,
    "--book-background": design.backgroundColor,
    "--book-surface": design.surfaceColor,
    "--book-text": design.textColor,
    ...getChromeCssVars(design.backgroundColor),
    backgroundColor: design.backgroundColor,
    color: design.textColor,
  } as React.CSSProperties;

  const goPrev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);
  const goNext = useCallback(() => setIndex((i) => Math.min(total, i + 1)), [total]);
  const restart = useCallback(() => setRestartKey((k) => k + 1), []);

  const exitConcert = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    navigate(playlistId ? `/books/${ownerId}/playlists/${playlistId}` : `/books/${ownerId}`);
  }, [navigate, ownerId, playlistId]);

  // 키보드: ← 이전 / → 다음 / Esc 종료. 기존 YouTube 훅이 play/pause를 노출하지 않아서
  // (새로운 플레이어 제어를 만들지 않기 위해) Space 재생/일시정지는 구현하지 않는다.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
      else if (e.key === "Escape") exitConcert();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goPrev, goNext, exitConcert]);

  const lyricLines = useMemo(() => parseLyrics(song?.lyrics), [song?.lyrics]);
  const isSynced = hasTimestamps(lyricLines) && Boolean(song?.youtubeVideoId);

  const playerContainerId = song
    ? `concertmode-yt-player-${song.id}-${restartKey}`
    : "concertmode-yt-player";
  // 기존 SongMode와 동일한 IFrame Player 훅 재사용. onEnded로 다음 곡 자동 진행(연속 공연).
  const { currentTime, playbackError } = useYouTubePlayer(
    playerContainerId,
    song?.youtubeVideoId,
    Boolean(song?.youtubeVideoId),
    goNext
  );
  const currentLineIndex = isSynced ? findCurrentLyricIndex(lyricLines, currentTime) : -1;

  // 방송 오버레이로 현재 공연 상태 내보내기. 공연이 끝나면 mode="finished"로 알려 종료 화면을 띄울 수 있게 한다.
  const liveState = useMemo<LiveStateInput | null>(() => {
    if (!ownerId || total === 0) return null;
    const queue = buildLiveQueue(playlistSongIds, songs);
    if (finished) {
      return { bookId: ownerId, mode: "finished", lines: [], lineIndex: -1, synced: false, index: total, total, queue };
    }
    if (!song) return null;
    const { lines, lineIndex } = buildLiveLyrics(isSynced ? lyricLines : [], currentLineIndex);
    return {
      bookId: ownerId,
      mode: "concert",
      song: toLiveSong(song),
      lines,
      lineIndex,
      synced: isSynced,
      index,
      total,
      queue,
    };
  }, [ownerId, total, finished, song, playlistSongIds, songs, lyricLines, isSynced, currentLineIndex, index]);
  useLivePublisher(liveState);

  const lineRefs = useRef<Array<HTMLParagraphElement | null>>([]);
  useEffect(() => {
    if (!isSynced || currentLineIndex < 0) return;
    lineRefs.current[currentLineIndex]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [isSynced, currentLineIndex]);

  // 임베드 재생 불가 영상: 기존 SongMode와 동일하게 감지해서 새 탭으로 연다.
  // 다만 공연은 계속 이어가야 하므로 상세 페이지로 나가지 않고 다음 곡으로 자동 진행한다.
  useEffect(() => {
    if (playbackError && song?.youtubeVideoId) {
      window.open(
        `https://www.youtube.com/watch?v=${song.youtubeVideoId}`,
        "_blank",
        "noopener,noreferrer"
      );
      goNext();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playbackError, song?.youtubeVideoId]);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // 브라우저가 거부하거나 지원하지 않는 경우 — 조용히 무시 (치명적 오류로 취급 안 함)
    }
  }

  const lyricsIndex = clampIndex(FONT_SIZE_ORDER.indexOf(preferences.lyricsFontSize));
  const chordsIndex = clampIndex(FONT_SIZE_ORDER.indexOf(preferences.chordsFontSize));
  const displayedChords = transposeChordsText(song?.chords, 0);

  if (loading || playlistLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm" style={bookStyle}>
        <span style={{ color: CHROME_MUTED }}>불러오는 중...</span>
      </div>
    );
  }

  if (total === 0) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center text-center px-6"
        style={bookStyle}
      >
        <p className="text-sm mb-3" style={{ color: CHROME_MUTED }}>
          이 플레이리스트에는 곡이 없어요.
        </p>
        <button onClick={exitConcert} className="text-sm px-3 py-2" style={{ color: ACCENT }}>
          돌아가기
        </button>
      </div>
    );
  }

  if (finished) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center text-center px-6"
        style={bookStyle}
      >
        <p className="text-2xl font-semibold font-serif mb-2">🎉 공연이 끝났습니다</p>
        <p className="text-sm mb-8" style={{ color: CHROME_MUTED }}>
          {total}곡을 모두 불렀어요.
        </p>
        <div className="flex flex-col gap-2.5 w-full max-w-xs">
          <button
            onClick={() => setIndex(0)}
            className="rounded-xl font-medium py-3"
            style={{ backgroundColor: ACCENT, color: "#14161F" }}
          >
            처음부터 다시
          </button>
          <button
            onClick={exitConcert}
            className="rounded-xl py-3 border"
            style={{ borderColor: CHROME_BORDER, color: CHROME_TEXT }}
          >
            노래책으로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  if (!song) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm" style={bookStyle}>
        <span style={{ color: CHROME_MUTED }}>곡을 찾을 수 없어요.</span>
      </div>
    );
  }

  return (
    <div className="book-focus min-h-screen flex flex-col" style={bookStyle}>
      {/* 상단 바 */}
      <div className="flex items-center justify-between px-5 lg:px-8 pt-5 pb-2 shrink-0">
        <button
          onClick={exitConcert}
          className="flex items-center gap-1 text-[13px] py-1.5 pr-2"
          style={{ color: CHROME_MUTED }}
        >
          <ChevronLeft className="h-4 w-4" /> 종료
        </button>
        <div className="flex items-center gap-3">
          {wakeLock.isSupported && (
            <button
              type="button"
              onClick={wakeLock.toggle}
              aria-pressed={wakeLock.enabled}
              title={wakeLock.enabled ? "화면 유지 중" : "화면 유지"}
              className="p-1.5"
              style={{ color: wakeLock.enabled ? ACCENT : CHROME_MUTED }}
            >
              {wakeLock.enabled ? <LockOpen className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
            </button>
          )}
          <button
            type="button"
            onClick={toggleFullscreen}
            title="전체화면 전환"
            className="p-1.5 hidden sm:block"
            style={{ color: CHROME_MUTED }}
          >
            <Maximize className="h-4 w-4" />
          </button>
          <span className="text-[13px]" style={{ color: CHROME_MUTED }}>
            {index + 1} / {total}
          </span>
        </div>
      </div>

      {/* 본문: PC에서는 좌(가사/영상) + 우(공연 큐) 2단 레이아웃, 모바일은 1단 */}
      <div className="flex-1 w-full max-w-7xl mx-auto px-5 lg:px-10 pb-40 lg:pb-10 lg:grid lg:grid-cols-[1fr_320px] lg:gap-12">
        <div className="min-w-0">
          <h1 className="text-2xl lg:text-3xl font-semibold font-serif break-words">
            {song.title}
          </h1>
          <p className="text-sm mt-0.5 mb-1 break-words" style={{ color: CHROME_MUTED }}>
            {song.artist}
          </p>

          {nextSong && (
            <p className="text-[12.5px] mb-4 break-words" style={{ color: CHROME_MUTED }}>
              다음 곡 · {nextSong.title}
            </p>
          )}

          {song.youtubeVideoId ? (
            playbackError ? (
              <div
                className="aspect-video w-full max-w-3xl rounded-lg mb-6 border flex items-center justify-center text-center px-6"
                style={{ borderColor: CHROME_BORDER, backgroundColor: CHROME_SURFACE }}
              >
                <p className="text-[13px]" style={{ color: CHROME_MUTED }}>
                  이 영상은 여기서 재생할 수 없어 새 탭으로 열었어요. 다음 곡으로 넘어갑니다...
                </p>
              </div>
            ) : (
              <div className="aspect-video w-full max-w-3xl rounded-lg overflow-hidden mb-6">
                <div id={playerContainerId} className="w-full h-full" />
              </div>
            )
          ) : null}

          {song.chords && (
            <pre
              className={`whitespace-pre-wrap break-words font-mono mb-5 leading-relaxed ${CONCERT_CHORDS_SCALE[chordsIndex]}`}
              style={{ color: ACCENT }}
            >
              {displayedChords}
            </pre>
          )}

          {lyricLines.length > 0 ? (
            <div
              className={`max-w-3xl leading-[2.1] ${CONCERT_LYRICS_SCALE[lyricsIndex]} ${
                LYRICS_FONT_FAMILY_CLASS[preferences.fontFamily] ?? ""
              }`}
            >
              {lyricLines.map((line, i) => {
                if (line.text === "") return <div key={i} className="h-5" aria-hidden="true" />;
                const isCurrent = isSynced && i === currentLineIndex;
                const isPast = isSynced && currentLineIndex >= 0 && i < currentLineIndex;
                return (
                  <p
                    key={i}
                    ref={(el) => {
                      lineRefs.current[i] = el;
                    }}
                    className="break-words transition-all duration-300 font-semibold"
                    style={{
                      color: isCurrent ? ACCENT : "var(--book-text, #ffffff)",
                      opacity: isCurrent ? 1 : isPast ? 0.4 : isSynced ? 0.7 : 0.92,
                    }}
                  >
                    <LinkifiedText text={line.text} />
                  </p>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center text-center py-10">
              <Music2 className="h-7 w-7 mb-2" strokeWidth={1.5} style={{ color: CHROME_MUTED }} />
              <p className="text-sm" style={{ color: CHROME_MUTED }}>
                등록된 가사가 없어요
              </p>
              <p className="text-[12.5px] mt-1" style={{ color: CHROME_MUTED, opacity: 0.8 }}>
                곡 정보에 가사를 추가하면 이곳에 표시돼요
              </p>
            </div>
          )}
        </div>

        {/* PC 전용 공연 큐 사이드바 — 모바일에서는 공간을 아끼기 위해 숨긴다 */}
        <div className="hidden lg:block">
          <div className="sticky top-8">
            <div className="text-xs mb-2" style={{ color: CHROME_MUTED }}>
              공연 큐
            </div>
            <div className="flex flex-col gap-1 max-h-[70vh] overflow-y-auto pr-1">
              {playlistSongIds.map((sid, i) => {
                const s = songs.find((x) => x.id === sid);
                if (!s) return null;
                const isCurrent = i === index;
                return (
                  <button
                    key={sid}
                    type="button"
                    onClick={() => setIndex(i)}
                    className="text-left rounded-lg px-3 py-2 text-[13px] truncate"
                    style={{
                      backgroundColor: isCurrent ? CHROME_SURFACE : "transparent",
                      color: isCurrent ? "var(--book-text, #ffffff)" : CHROME_MUTED,
                      opacity: i < index && !isCurrent ? 0.5 : 1,
                      fontWeight: isCurrent ? 600 : 400,
                    }}
                  >
                    {i + 1}. {s.title}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 하단 컨트롤 바 — 모바일/PC 공통, 큰 터치 영역 */}
      <div
        className="fixed bottom-0 left-0 right-0 border-t px-5 py-3 flex items-center justify-center gap-3"
        style={{ backgroundColor: design.backgroundColor, borderColor: CHROME_BORDER }}
      >
        <button
          type="button"
          onClick={goPrev}
          disabled={index === 0}
          className="flex-1 max-w-[160px] rounded-xl py-3.5 border disabled:opacity-30 flex items-center justify-center gap-1.5"
          style={{ borderColor: CHROME_BORDER, color: CHROME_TEXT }}
          aria-label="이전 곡"
        >
          <ChevronLeft className="h-4 w-4" /> 이전
        </button>
        <button
          type="button"
          onClick={restart}
          className="rounded-full p-3.5"
          style={{ backgroundColor: CHROME_SURFACE, color: CHROME_TEXT }}
          aria-label="현재 곡 다시 시작"
          title="현재 곡 다시 시작"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={goNext}
          className="flex-1 max-w-[160px] rounded-xl py-3.5 flex items-center justify-center gap-1.5 font-medium"
          style={{ backgroundColor: ACCENT, color: "#14161F" }}
          aria-label={index + 1 >= total ? "공연 마치기" : "다음 곡"}
        >
          {/* 마지막 곡에서 누르면 "공연 종료" 화면으로 넘어가므로, 실수로 누르지 않게 라벨로 알려준다 */}
          {index + 1 >= total ? "마치기" : "다음"} <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
