import { useEffect, useMemo, useRef, useState } from "react";
import { notify } from "../components/ui/feedback";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  Music2,
  Minus,
  Plus,
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  Video,
  ArrowUp,
  GripHorizontal,
  RotateCcw,
} from "lucide-react";
import type { Song } from "../types/song";
import { parseLyrics, hasTimestamps, findCurrentLyricIndex } from "../utils/lyrics";
import { transposeChordsText } from "../utils/transpose";
import { useYouTubePlayer } from "../hooks/useYouTubePlayer";
import { useFloatingPlayerLayout } from "../hooks/useFloatingPlayerLayout";
import { FLOAT_FOOTER_H, FLOAT_HEADER_H, videoHeight } from "../utils/floatingPlayer";
import { useAuth } from "../hooks/useAuth";
import { useFavorites } from "../hooks/useFavorites";
import { usePlaylistSongIds } from "../hooks/usePlaylists";
import { useWakeLock } from "../hooks/useWakeLock";
import { usePreferences } from "../hooks/usePreferences";
import { getChromeTones } from "../utils/color";
import { FavoriteButton } from "../components/song/FavoriteButton";
import { LinkifiedText } from "../components/song/LinkifiedText";
import { useLivePublisher } from "../hooks/useLivePublisher";
import { useAccountLiveKey } from "../hooks/useAccountLiveKey";
import { useAutoLyrics } from "../hooks/useAutoLyrics";
import { AutoLyricsBar } from "../components/song/AutoLyricsBar";
import { buildLiveLyrics, buildLiveQueue, toLiveSong, type LiveStateInput } from "../utils/liveBroadcast";

interface SongModePageProps {
  songs: Song[];
  loading?: boolean;
}

// index 0~3 = sm/md/lg/xl, Settings 페이지의 FontSize와 순서를 맞춘다.
const FONT_SIZE_ORDER = ["sm", "md", "lg", "xl"] as const;
const LYRICS_SCALE_CLASS = ["text-base", "text-lg", "text-xl", "text-2xl"];
const CHORDS_SCALE_CLASS = ["text-sm", "text-base", "text-lg", "text-xl"];
// 코드는 정렬이 중요해서 폰트 설정과 무관하게 항상 고정폭(font-mono)을 쓴다.
// 가사만 사용자가 고른 폰트를 반영한다.
const LYRICS_FONT_FAMILY_CLASS: Record<string, string> = {
  system: "",
  serif: "font-serif",
  mono: "font-mono",
};

function clampIndex(i: number): number {
  return Math.max(0, Math.min(FONT_SIZE_ORDER.length - 1, i));
}

export function SongModePage({ songs, loading }: SongModePageProps) {
  const { ownerId, id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const playlistId = searchParams.get("playlist") ?? undefined;
  const rawSong = songs.find((s) => s.id === id);
  // 저장된 싱크 가사가 없으면 가사를 자동으로 찾아 싱크한 결과를 "song"으로 쓴다 (저장된 데이터는 바뀌지 않고, 이후 흐름은 기존 LRC 경로 그대로)
  const auto = useAutoLyrics(rawSong);
  const song = auto.song;
  const { profile: currentUser } = useAuth();
  const { favoriteIds, toggle: toggleFavorite } = useFavorites(currentUser?.id);
  const { songIds: playlistSongIds } = usePlaylistSongIds(playlistId);
  const wakeLock = useWakeLock();
  const { preferences } = usePreferences(currentUser?.id);
  const tones = getChromeTones(preferences.backgroundColor);

  // 세션 한정 임시 조정치 (+/- 버튼). 저장된 기본값(preferences)에 상대적으로 적용되고,
  // 이 화면을 벗어나면 사라진다 — "내 설정"에서 바꾼 기본값 자체는 건드리지 않는다.
  const [fontStepOffset, setFontStepOffset] = useState(0);
  const [showChords, setShowChords] = useState(true);
  const [transposeSteps, setTransposeSteps] = useState(0);

  const lyricLines = useMemo(() => parseLyrics(song?.lyrics), [song?.lyrics]);
  const isSynced = hasTimestamps(lyricLines) && Boolean(song?.youtubeVideoId);
  const isInPlaylist = Boolean(playlistId) && playlistSongIds.length > 0;

  function goToNextInPlaylist() {
    if (!playlistId || !song) return;
    const idx = playlistSongIds.indexOf(song.id);
    if (idx === -1 || idx + 1 >= playlistSongIds.length) return; // 마지막 곡이면 그대로 멈춤
    navigate(`/books/${ownerId}/songs/${playlistSongIds[idx + 1]}/sing?playlist=${playlistId}`);
  }

  function goToPrevInPlaylist() {
    if (!playlistId || !song) return;
    const idx = playlistSongIds.indexOf(song.id);
    if (idx <= 0) return; // 첫 곡이면 그대로 멈춤
    navigate(`/books/${ownerId}/songs/${playlistSongIds[idx - 1]}/sing?playlist=${playlistId}`);
  }

  // 방송 키를 계정 단위로 맞춘다 (소유자만) — 다른 기기에서 열어도 같은 OBS URL로 방송된다
  useAccountLiveKey(ownerId, Boolean(currentUser && currentUser.id === ownerId));

  // 방송용 단축키: N = 다음 곡, P = 이전 곡 (플레이리스트로 실행 중일 때). 입력창에 타이핑 중이거나 Ctrl/Alt/Cmd와 함께면 무시.
  // Space(재생/일시정지)는 기존 YouTube 훅이 재생 제어를 노출하지 않아서 구현하지 않았다.
  useEffect(() => {
    if (!isInPlaylist) return;
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.key === "n" || e.key === "N") goToNextInPlaylist();
      else if (e.key === "p" || e.key === "P") goToPrevInPlaylist();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // goTo* 는 매 렌더 새로 만들어지므로, 최신 곡/목록을 보도록 의존성에 현재 곡과 목록을 둔다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInPlaylist, song?.id, playlistSongIds, playlistId, ownerId]);

  const playerContainerId = song ? `songmode-yt-player-${song.id}` : "songmode-yt-player";
  // 영상이 있는 곡은 항상 IFrame Player API를 쓴다 — 재생 가능 여부(onError)를
  // 감지하려면 정적 iframe이 아니라 이 방식이어야 한다. 가사 싱크/연속재생 여부와 무관.
  const { currentTime, duration, playbackError } = useYouTubePlayer(
    playerContainerId,
    song?.youtubeVideoId,
    Boolean(song?.youtubeVideoId),
    goToNextInPlaylist
  );
  const currentLineIndex = isSynced ? findCurrentLyricIndex(lyricLines, currentTime) : -1;

  // 방송 오버레이로 현재 상태 내보내기 (곡/가사 줄이 바뀔 때만 전송, 화면을 벗어나면 자동으로 지움)
  const liveState = useMemo<LiveStateInput | null>(() => {
    if (!song || !ownerId) return null;
    const idx = playlistId ? playlistSongIds.indexOf(song.id) : -1;
    const inPlaylist = idx >= 0;
    const { lines, lineIndex } = buildLiveLyrics(isSynced ? lyricLines : [], currentLineIndex);
    return {
      bookId: ownerId,
      mode: "song",
      song: toLiveSong(song),
      lines,
      lineIndex,
      synced: isSynced,
      index: inPlaylist ? idx : 0,
      total: inPlaylist ? playlistSongIds.length : 0,
      queue: inPlaylist ? buildLiveQueue(playlistSongIds, songs) : [],
    };
  }, [song, ownerId, playlistId, playlistSongIds, songs, lyricLines, isSynced, currentLineIndex]);
  useLivePublisher(liveState);

  const lineRefs = useRef<Array<HTMLParagraphElement | null>>([]);

  // 플로팅 플레이어: 원래 영상 자리(slot)가 화면에서 벗어나면, 같은 플레이어 요소를 CSS로 화면 구석에 띄운다.
  // iframe을 DOM에서 옮기거나 복제하지 않으므로 재생 위치/음소거/재생 상태가 그대로 유지되고 영상이 두 번 재생되지 않는다.
  const [slotEl, setSlotEl] = useState<HTMLDivElement | null>(null);
  const [slotVisible, setSlotVisible] = useState(true);
  useEffect(() => {
    if (!slotEl || typeof IntersectionObserver === "undefined") {
      setSlotVisible(true);
      return;
    }
    const io = new IntersectionObserver(([entry]) => setSlotVisible(entry.isIntersecting), { threshold: 0 });
    io.observe(slotEl);
    return () => io.disconnect();
  }, [slotEl]);
  const floating = Boolean(slotEl) && !slotVisible;
  const float = useFloatingPlayerLayout(floating);

  useEffect(() => {
    if (!isSynced || currentLineIndex < 0) return;
    lineRefs.current[currentLineIndex]?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [isSynced, currentLineIndex]);

  // 임베드 재생이 불가능한 영상이면 검은 화면/먹통 상태로 SongMode에 머물지 않는다.
  // 현재 탭은 Songbook Manager에 남기고, YouTube 원본은 새 탭에서 연다.
  // (비동기 콜백에서 호출하는 window.open은 브라우저에 따라 팝업 차단될 수 있어서,
  //  차단됐을 경우를 대비해 화면에 수동으로 누를 수 있는 링크도 함께 보여준다.)
  useEffect(() => {
    if (playbackError && song?.youtubeVideoId && ownerId) {
      const url = `https://www.youtube.com/watch?v=${song.youtubeVideoId}`;
      const opened = window.open(url, "_blank", "noopener,noreferrer");
      if (opened) {
        navigate(`/books/${ownerId}/songs/${song.id}`, { replace: true });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playbackError, song?.youtubeVideoId, ownerId]);

  if (loading) {
    return (
      <div
        className={`min-h-screen flex items-center justify-center text-sm ${tones.muted}`}
        style={{ backgroundColor: preferences.backgroundColor }}
      >
        불러오는 중...
      </div>
    );
  }

  if (!song) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center text-center px-6"
        style={{ backgroundColor: preferences.backgroundColor }}
      >
        <p className={`${tones.base} text-sm`}>곡을 찾을 수 없어요.</p>
        <button
          onClick={() => navigate(`/books/${ownerId}`)}
          className="mt-3 text-amber-500 text-sm"
        >
          목록으로 돌아가기
        </button>
      </div>
    );
  }

  const lyricsIndex = clampIndex(FONT_SIZE_ORDER.indexOf(preferences.lyricsFontSize) + fontStepOffset);
  const chordsIndex = clampIndex(FONT_SIZE_ORDER.indexOf(preferences.chordsFontSize) + fontStepOffset);
  const displayedChords = transposeChordsText(song.chords, transposeSteps);

  return (
    <div
      className="book-focus min-h-screen overflow-x-hidden"
      style={{ backgroundColor: preferences.backgroundColor }}
    >
      <div className="flex items-center justify-between px-5 pt-6 pb-2 gap-3">
        <button
          onClick={() =>
            navigate(
              playlistId
                ? `/books/${ownerId}/playlists/${playlistId}`
                : `/books/${ownerId}/songs/${song.id}`
            )
          }
          className={`p-2 -ml-2 shrink-0 ${tones.base}`}
          aria-label="뒤로가기"
          title="돌아가기"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
        <span className={`text-[13px] shrink-0 ${tones.muted}`}>
          {song.key ? `Key ${song.key}` : ""}
          {song.bpm ? ` · ${song.bpm} BPM` : ""}
          {song.difficulty ? ` · ${"★".repeat(song.difficulty)}${"☆".repeat(5 - song.difficulty)}` : ""}
        </span>
      </div>

      {/* 컨트롤 바: 자주 쓰는 것(글자크기/코드) 먼저, 보조 기능(transpose/화면유지)은 뒤로 */}
      <div className="px-6 max-w-3xl mx-auto w-full flex flex-wrap items-center gap-2 pb-3">
        <div
          className={`flex items-center gap-1 rounded-full border px-1 py-1 ${tones.chipBg} ${tones.chipBorder}`}
          title="글자 크기 (이 화면에서만 임시로 조정, 기본값은 '내 설정'에서 변경)"
        >
          <button
            type="button"
            onClick={() => setFontStepOffset((v) => v - 1)}
            disabled={lyricsIndex === 0}
            className={`p-2 disabled:opacity-30 ${tones.base}`}
            aria-label="글자 작게"
            title="글자 작게"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className={`text-[12px] px-1 w-6 text-center ${tones.muted}`} aria-live="polite">
            {lyricsIndex + 1}/{FONT_SIZE_ORDER.length}
          </span>
          <button
            type="button"
            onClick={() => setFontStepOffset((v) => v + 1)}
            disabled={lyricsIndex === FONT_SIZE_ORDER.length - 1}
            className={`p-2 disabled:opacity-30 ${tones.base}`}
            aria-label="글자 크게"
            title="글자 크게"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        {song.chords && (
          <button
            type="button"
            onClick={() => setShowChords((v) => !v)}
            title={showChords ? "코드 숨기기" : "코드 표시하기"}
            aria-pressed={showChords}
            className={`flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-full border ${
              showChords ? `${tones.chipBg} ${tones.chipBorder} ${tones.base}` : `${tones.muted} border-transparent`
            }`}
          >
            {showChords ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            코드
          </button>
        )}

        {song.chords && (
          <div
            className={`flex items-center gap-1 rounded-full border px-1 py-1 ${tones.chipBg} ${tones.chipBorder}`}
            title="코드 이조 (화면 표시만 바뀌고, MR 실제 음정은 그대로예요)"
          >
            <button
              type="button"
              onClick={() => setTransposeSteps((v) => Math.max(-6, v - 1))}
              className={`p-2 ${tones.base}`}
              aria-label="반키 내리기"
              title="반키 내리기"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className={`text-[12px] px-1 w-8 text-center ${tones.muted}`} aria-live="polite">
              {transposeSteps > 0 ? `+${transposeSteps}` : transposeSteps}
            </span>
            <button
              type="button"
              onClick={() => setTransposeSteps((v) => Math.min(6, v + 1))}
              className={`p-2 ${tones.base}`}
              aria-label="반키 올리기"
              title="반키 올리기"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {wakeLock.isSupported && (
          <button
            type="button"
            onClick={wakeLock.toggle}
            aria-pressed={wakeLock.enabled}
            title={
              wakeLock.enabled
                ? "화면 유지 중 — 노래 부르는 동안 화면이 꺼지지 않아요"
                : "화면 유지 — 켜면 노래 부르는 동안 화면이 자동으로 꺼지지 않아요"
            }
            className={`flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-full border ${
              wakeLock.enabled
                ? "bg-amber-400/15 border-amber-400/40 text-amber-500"
                : `${tones.chipBg} ${tones.chipBorder} ${tones.base}`
            }`}
          >
            {wakeLock.enabled ? (
              <LockOpen className="h-3.5 w-3.5" />
            ) : (
              <Lock className="h-3.5 w-3.5" />
            )}
            {wakeLock.enabled ? "화면 유지 중" : "화면 유지"}
          </button>
        )}

        {isInPlaylist && (
          <div className="flex items-center gap-1.5 ml-auto shrink-0">
            <button
              type="button"
              onClick={goToPrevInPlaylist}
              disabled={playlistSongIds.indexOf(song.id) <= 0}
              className={`p-2 rounded-full border disabled:opacity-30 ${tones.chipBg} ${tones.chipBorder} ${tones.base}`}
              aria-label="이전 곡"
              title="이전 곡"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className={`text-[12px] ${tones.muted}`}>
              {playlistSongIds.indexOf(song.id) + 1} / {playlistSongIds.length}
            </span>
            <button
              type="button"
              onClick={goToNextInPlaylist}
              disabled={playlistSongIds.indexOf(song.id) + 1 >= playlistSongIds.length}
              className={`p-2 rounded-full border disabled:opacity-30 ${tones.chipBg} ${tones.chipBorder} ${tones.base}`}
              aria-label="다음 곡"
              title="다음 곡"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() =>
                navigate(`/books/${ownerId}/playlists/${playlistId}/concert?start=${song.id}`)
              }
              className={`text-[12px] px-3 py-1.5 rounded-full border ${tones.chipBg} ${tones.chipBorder} ${tones.base}`}
              title="이 플레이리스트를 공연 모드로 보기"
            >
              🎤 공연 모드
            </button>
          </div>
        )}
      </div>

      <div className="px-6 pt-1 pb-24 max-w-3xl mx-auto w-full">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h1 className={`text-[26px] font-semibold font-serif break-words min-w-0 ${tones.strong}`}>
            {song.title}
          </h1>
          <div className="shrink-0 -mt-1 -mr-2">
            <FavoriteButton
              active={currentUser ? favoriteIds.has(song.id) : false}
              onToggle={() => {
                if (!currentUser) {
                  notify("즐겨찾기는 로그인 후에 쓸 수 있어요.", "info");
                  return;
                }
                toggleFavorite(song.id);
              }}
              colorClassName={tones.base}
            />
          </div>
        </div>
        <p className={`text-sm mb-6 break-words ${tones.muted}`}>{song.artist}</p>

        {song.youtubeVideoId ? (
          playbackError ? (
            <div
              className={`aspect-video w-full max-w-2xl mx-auto rounded-lg mb-6 border flex flex-col items-center justify-center text-center px-6 gap-3 ${tones.panelBg} ${tones.panelBorder}`}
            >
              <p className={`text-[13px] ${tones.muted}`}>
                이 영상은 여기서 재생할 수 없어요. 새 탭으로 안 열렸다면 아래를 눌러주세요.
              </p>
              <a
                href={`https://www.youtube.com/watch?v=${song.youtubeVideoId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[13px] px-3 py-1.5 rounded-full bg-amber-500 text-black font-medium"
              >
                YouTube에서 열기
              </a>
            </div>
          ) : (
            // slot: 원래 자리를 계속 차지해서(레이아웃이 튀지 않게) 가시성 판단 기준이 된다.
            <div ref={setSlotEl} className="aspect-video w-full max-w-2xl mx-auto mb-6" data-testid="player-slot">
              <div
                data-testid="player-frame"
                data-floating={floating ? "true" : "false"}
                className={
                  floating
                    ? "songmode-player-frame fixed z-50 overflow-hidden rounded-lg bg-black shadow-2xl ring-1 ring-white/20"
                    : "songmode-player-frame w-full h-full rounded-lg overflow-hidden"
                }
                style={floating ? { left: float.layout.x, top: float.layout.y, width: float.layout.w } : undefined}
              >
                {floating && (
                  <div className="flex items-center bg-black/85 text-white/80 select-none" style={{ height: FLOAT_HEADER_H }}>
                    {/* 드래그 핸들: iframe이 아니라 이 막대만 끌 수 있다 (포인터 캡처 + touch-action:none → 드래그 중 스크롤/텍스트 선택 없음) */}
                    <div
                      role="button"
                      tabIndex={0}
                      data-testid="float-drag-handle"
                      aria-label="플레이어 이동 (방향키로도 이동할 수 있어요)"
                      title="끌어서 이동"
                      className="flex-1 min-w-0 h-full flex items-center justify-center cursor-grab active:cursor-grabbing touch-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400"
                      {...float.dragHandlers}
                    >
                      <GripHorizontal className="h-4 w-4" />
                    </div>
                    <button
                      type="button"
                      onClick={() => slotEl?.scrollIntoView({ behavior: "smooth", block: "center" })}
                      className="h-full px-2 flex items-center gap-1 text-[11.5px] hover:text-white"
                      aria-label="영상 원래 위치로 이동"
                      title="원래 위치로"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                      {float.layout.w >= 280 && "원래 위치로"}
                    </button>
                    <button
                      type="button"
                      data-testid="float-reset"
                      onClick={float.reset}
                      className="h-full px-2 flex items-center hover:text-white"
                      aria-label="플레이어 위치와 크기 초기화"
                      title="위치·크기 초기화"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                {/* IFrame Player API가 안쪽 div를 실제 iframe으로 교체한다 (재생시간/종료/오류 추적용).
                    React가 관리하는 wrapper로 한 겹 감싸서, 위 헤더가 생기고 사라질 때 YT가 바꿔치기한 노드를 기준으로 삽입하지 않게 한다. */}
                <div className={floating ? "w-full" : "w-full h-full"} style={floating ? { height: videoHeight(float.layout.w) } : undefined}>
                  <div id={playerContainerId} className="w-full h-full" />
                </div>
                {floating && (
                  <div className="flex justify-end bg-black/85" style={{ height: FLOAT_FOOTER_H }}>
                    {/* 우하단 크기 조절 핸들 (영상 위가 아니라 별도 막대라 YouTube 컨트롤을 가리지 않는다) */}
                    <div
                      data-testid="float-resize-handle"
                      aria-hidden="true"
                      title="끌어서 크기 조절"
                      className="h-full w-6 cursor-nwse-resize touch-none flex items-end justify-end p-0.5"
                      {...float.resizeHandlers}
                    >
                      <span className="block h-2.5 w-2.5 border-r-2 border-b-2 border-white/60" />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        ) : (
          <div
            className={`aspect-video w-full max-w-2xl mx-auto rounded-lg mb-6 border flex items-center justify-center ${tones.panelBg} ${tones.panelBorder}`}
          >
            <div className="flex flex-col items-center text-center px-6">
              <Video className={`h-6 w-6 mb-2 ${tones.muted}`} strokeWidth={1.5} />
              <p className={`text-[13px] ${tones.muted}`}>등록된 MR 영상이 없어요</p>
            </div>
          </div>
        )}

        {song.chords && showChords && (
          <pre
            className={`whitespace-pre-wrap break-words font-mono mb-6 leading-relaxed max-w-2xl mx-auto ${CHORDS_SCALE_CLASS[chordsIndex]}`}
            style={{ color: preferences.chordsColor }}
          >
            {displayedChords}
          </pre>
        )}

        <AutoLyricsBar auto={auto} currentTime={currentTime} mrDuration={duration} />

        {lyricLines.length > 0 ? (
          <div
            className={`leading-[2.1] max-w-2xl mx-auto ${LYRICS_SCALE_CLASS[lyricsIndex]} ${LYRICS_FONT_FAMILY_CLASS[preferences.fontFamily] ?? ""}`}
            style={{ color: preferences.lyricsColor }}
          >
            {lyricLines.map((line, i) => {
              if (line.text === "") {
                return <div key={i} className="h-4" aria-hidden="true" />;
              }
              const isCurrent = isSynced && i === currentLineIndex;
              const isPast = isSynced && currentLineIndex >= 0 && i < currentLineIndex;
              return (
                <p
                  key={i}
                  ref={(el) => {
                    lineRefs.current[i] = el;
                  }}
                  className={`break-words transition-all duration-300 ${
                    isCurrent ? "text-amber-500 font-semibold scale-[1.03] origin-left" : ""
                  }`}
                  style={
                    isCurrent
                      ? undefined
                      : // 지난/다음 줄도 사용자가 고른 lyricsColor를 그대로 쓰고
                        // 투명도만 다르게 줘서 강조 대비를 만든다 — 하드코딩된
                        // 흰색으로 덮어쓰지 않는다 (곡마다 색이 달라지던 버그의 원인).
                        { color: preferences.lyricsColor, opacity: isPast ? 0.45 : isSynced ? 0.75 : 1 }
                  }
                >
                  <LinkifiedText text={line.text} />
                </p>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center text-center py-10">
            <Music2 className={`h-7 w-7 mb-2 ${tones.muted}`} strokeWidth={1.5} />
            <p className={`text-sm ${tones.base}`}>등록된 가사가 없어요</p>
            <p className={`text-[12.5px] mt-1 ${tones.muted}`}>곡 정보에 가사를 추가하면 이곳에 표시돼요</p>
          </div>
        )}
      </div>
    </div>
  );
}
