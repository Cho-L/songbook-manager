import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ChevronLeft, Music2, Minus, Plus, Eye, EyeOff, Sun, SunDim } from "lucide-react";
import type { Song } from "../types/song";
import { parseLyrics, hasTimestamps, findCurrentLyricIndex } from "../utils/lyrics";
import { transposeChordsText } from "../utils/transpose";
import { useYouTubePlayer } from "../hooks/useYouTubePlayer";
import { useAuth } from "../hooks/useAuth";
import { useFavorites } from "../hooks/useFavorites";
import { usePlaylistSongIds } from "../hooks/usePlaylists";
import { useWakeLock } from "../hooks/useWakeLock";
import { FavoriteButton } from "../components/song/FavoriteButton";

interface SongModePageProps {
  songs: Song[];
  loading?: boolean;
}

const FONT_SCALES = [
  { label: "가", lyricsClass: "text-base", chordsClass: "text-sm" },
  { label: "가", lyricsClass: "text-lg", chordsClass: "text-base" },
  { label: "가", lyricsClass: "text-xl", chordsClass: "text-lg" },
  { label: "가", lyricsClass: "text-2xl", chordsClass: "text-xl" },
];
const DEFAULT_FONT_SCALE_INDEX = 1; // 기존 text-lg와 동일한 기본값

export function SongModePage({ songs, loading }: SongModePageProps) {
  const { ownerId, id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const playlistId = searchParams.get("playlist") ?? undefined;
  const song = songs.find((s) => s.id === id);
  const { profile: currentUser } = useAuth();
  const { favoriteIds, toggle: toggleFavorite } = useFavorites(currentUser?.id);
  const { songIds: playlistSongIds } = usePlaylistSongIds(playlistId);
  const wakeLock = useWakeLock();

  const [fontScaleIndex, setFontScaleIndex] = useState(DEFAULT_FONT_SCALE_INDEX);
  const [showChords, setShowChords] = useState(true);
  const [transposeSteps, setTransposeSteps] = useState(0);

  const lyricLines = useMemo(() => parseLyrics(song?.lyrics), [song?.lyrics]);
  const isSynced = hasTimestamps(lyricLines) && Boolean(song?.youtubeVideoId);
  const isInPlaylist = Boolean(playlistId) && playlistSongIds.length > 0;
  // 가사 싱크 또는 플레이리스트 연속재생(영상 종료 감지) 중 하나라도 필요하면 IFrame Player API를 쓴다.
  const usePlayerApi = isSynced || isInPlaylist;

  function goToNextInPlaylist() {
    if (!playlistId || !song) return;
    const idx = playlistSongIds.indexOf(song.id);
    if (idx === -1 || idx + 1 >= playlistSongIds.length) return; // 마지막 곡이면 그대로 멈춤
    navigate(`/books/${ownerId}/songs/${playlistSongIds[idx + 1]}/sing?playlist=${playlistId}`);
  }

  const playerContainerId = song ? `songmode-yt-player-${song.id}` : "songmode-yt-player";
  const currentTime = useYouTubePlayer(
    playerContainerId,
    song?.youtubeVideoId,
    usePlayerApi,
    goToNextInPlaylist
  );
  const currentLineIndex = isSynced ? findCurrentLyricIndex(lyricLines, currentTime) : -1;

  const lineRefs = useRef<Array<HTMLParagraphElement | null>>([]);

  useEffect(() => {
    if (!isSynced || currentLineIndex < 0) return;
    lineRefs.current[currentLineIndex]?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [isSynced, currentLineIndex]);

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white/40 flex items-center justify-center text-sm">
        불러오는 중...
      </div>
    );
  }

  if (!song) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center text-center px-6">
        <p className="text-white/50 text-sm">곡을 찾을 수 없어요.</p>
        <button
          onClick={() => navigate(`/books/${ownerId}`)}
          className="mt-3 text-amber-300 text-sm"
        >
          목록으로 돌아가기
        </button>
      </div>
    );
  }

  const fontScale = FONT_SCALES[fontScaleIndex];
  const displayedChords = transposeChordsText(song.chords, transposeSteps);

  return (
    <div className="min-h-screen bg-black text-white overflow-x-hidden">
      <div className="flex items-center justify-between px-5 pt-6 pb-2 gap-3">
        <button
          onClick={() =>
            navigate(
              playlistId
                ? `/books/${ownerId}/playlists/${playlistId}`
                : `/books/${ownerId}/songs/${song.id}`
            )
          }
          className="p-2 -ml-2 text-white/50 shrink-0"
          aria-label="뒤로가기"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
        <span className="text-[13px] text-white/40 shrink-0">
          {song.key ? `Key ${song.key}` : ""}
          {song.bpm ? ` · ${song.bpm} BPM` : ""}
        </span>
      </div>

      {/* 컨트롤 바: 글자크기 / 코드 표시·숨김 / 화면 꺼짐 방지 */}
      <div className="px-6 max-w-3xl mx-auto w-full flex flex-wrap items-center gap-2 pb-3">
        <div className="flex items-center gap-1 rounded-full bg-white/[0.06] border border-white/10 px-1 py-1">
          <button
            type="button"
            onClick={() => setFontScaleIndex((i) => Math.max(0, i - 1))}
            disabled={fontScaleIndex === 0}
            className="p-1.5 text-white/60 disabled:opacity-30"
            aria-label="글자 작게"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="text-[12px] text-white/50 px-1 w-6 text-center">
            {fontScaleIndex + 1}
          </span>
          <button
            type="button"
            onClick={() => setFontScaleIndex((i) => Math.min(FONT_SCALES.length - 1, i + 1))}
            disabled={fontScaleIndex === FONT_SCALES.length - 1}
            className="p-1.5 text-white/60 disabled:opacity-30"
            aria-label="글자 크게"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        {song.chords && (
          <button
            type="button"
            onClick={() => setShowChords((v) => !v)}
            className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-full bg-white/[0.06] border border-white/10 text-white/60"
          >
            {showChords ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            코드
          </button>
        )}

        {song.chords && (
          <div className="flex items-center gap-1 rounded-full bg-white/[0.06] border border-white/10 px-1 py-1">
            <button
              type="button"
              onClick={() => setTransposeSteps((v) => Math.max(-6, v - 1))}
              className="p-1.5 text-white/60"
              aria-label="반키 내리기"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="text-[12px] text-white/50 px-1 w-8 text-center">
              {transposeSteps > 0 ? `+${transposeSteps}` : transposeSteps}
            </span>
            <button
              type="button"
              onClick={() => setTransposeSteps((v) => Math.min(6, v + 1))}
              className="p-1.5 text-white/60"
              aria-label="반키 올리기"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {wakeLock.isSupported && (
          <button
            type="button"
            onClick={wakeLock.toggle}
            className={`flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-full border ${
              wakeLock.enabled
                ? "bg-amber-400/15 border-amber-400/40 text-amber-300"
                : "bg-white/[0.06] border-white/10 text-white/60"
            }`}
          >
            {wakeLock.enabled ? <Sun className="h-3.5 w-3.5" /> : <SunDim className="h-3.5 w-3.5" />}
            화면 유지
          </button>
        )}

        {isInPlaylist && (
          <span className="text-[11px] text-white/30 ml-auto shrink-0">
            {playlistSongIds.indexOf(song.id) + 1} / {playlistSongIds.length}
          </span>
        )}
      </div>

      <div className="px-6 pt-1 pb-24 max-w-3xl mx-auto w-full">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h1 className="text-[26px] font-semibold font-serif break-words">
            {song.title}
          </h1>
          <div className="shrink-0 -mt-1 -mr-2">
            <FavoriteButton
              active={currentUser ? favoriteIds.has(song.id) : false}
              onToggle={() => {
                if (!currentUser) {
                  alert("즐겨찾기는 로그인 후 이용할 수 있어요.");
                  return;
                }
                toggleFavorite(song.id);
              }}
            />
          </div>
        </div>
        <p className="text-white/40 text-sm mb-6 break-words">{song.artist}</p>

        {song.youtubeVideoId ? (
          <div className="aspect-video w-full max-w-2xl mx-auto rounded-lg overflow-hidden mb-6">
            {usePlayerApi ? (
              // IFrame Player API가 이 div를 실제 iframe으로 교체한다 (재생시간/종료 추적용)
              <div id={playerContainerId} className="w-full h-full" />
            ) : (
              <iframe
                className="w-full h-full"
                src={`https://www.youtube.com/embed/${song.youtubeVideoId}`}
                title="YouTube MR"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            )}
          </div>
        ) : (
          <div className="aspect-video w-full max-w-2xl mx-auto rounded-lg mb-6 bg-white/[0.04] border border-white/[0.06] flex items-center justify-center">
            <p className="text-white/30 text-[13px]">등록된 MR 영상이 없어요</p>
          </div>
        )}

        {song.chords && showChords && (
          <pre
            className={`whitespace-pre-wrap break-words font-mono text-emerald-300/90 mb-6 leading-relaxed max-w-xl mx-auto ${fontScale.chordsClass}`}
          >
            {displayedChords}
          </pre>
        )}

        {lyricLines.length > 0 ? (
          <div className={`leading-[2.1] text-white/95 max-w-xl mx-auto ${fontScale.lyricsClass}`}>
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
                    isSynced
                      ? isCurrent
                        ? "text-amber-300 font-semibold scale-[1.03] origin-left"
                        : isPast
                          ? "text-white/45"
                          : "text-white/60"
                      : ""
                  }`}
                >
                  {line.text}
                </p>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center text-center py-10">
            <Music2 className="h-7 w-7 text-white/15 mb-2" strokeWidth={1.5} />
            <p className="text-white/30 text-sm">등록된 가사가 없어요</p>
          </div>
        )}
      </div>
    </div>
  );
}
