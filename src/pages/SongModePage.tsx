import { useEffect, useMemo, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, Music2 } from "lucide-react";
import type { Song } from "../types/song";
import { parseLyrics, hasTimestamps, findCurrentLyricIndex } from "../utils/lyrics";
import { useYouTubePlayer } from "../hooks/useYouTubePlayer";
import { useAuth } from "../hooks/useAuth";
import { useFavorites } from "../hooks/useFavorites";
import { FavoriteButton } from "../components/song/FavoriteButton";

interface SongModePageProps {
  songs: Song[];
  loading?: boolean;
}

export function SongModePage({ songs, loading }: SongModePageProps) {
  const { ownerId, id } = useParams();
  const navigate = useNavigate();
  const song = songs.find((s) => s.id === id);
  const { profile: currentUser } = useAuth();
  const { favoriteIds, toggle: toggleFavorite } = useFavorites(currentUser?.id);

  const lyricLines = useMemo(() => parseLyrics(song?.lyrics), [song?.lyrics]);
  const isSynced = hasTimestamps(lyricLines) && Boolean(song?.youtubeVideoId);

  // 타임스탬프 가사 + 영상이 둘 다 있을 때만 IFrame Player API로 재생시간을 추적한다.
  // 그 외의 경우(일반 가사, 영상 없음)는 훅을 비활성 상태로 두고 기존 정적 iframe을 그대로 쓴다.
  const playerContainerId = song ? `songmode-yt-player-${song.id}` : "songmode-yt-player";
  const currentTime = useYouTubePlayer(playerContainerId, song?.youtubeVideoId, isSynced);
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

  return (
    <div className="min-h-screen bg-black text-white overflow-x-hidden">
      <div className="flex items-center justify-between px-5 pt-6 pb-2 gap-3">
        <button
          onClick={() => navigate(`/books/${ownerId}/songs/${song.id}`)}
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
      <div className="px-6 pt-3 pb-24 max-w-3xl mx-auto w-full">
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
            {isSynced ? (
              // IFrame Player API가 이 div를 실제 iframe으로 교체한다 (재생시간 추적용)
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

        {song.chords && (
          <pre className="whitespace-pre-wrap break-words font-mono text-emerald-300/90 text-base mb-6 leading-relaxed max-w-xl mx-auto">
            {song.chords}
          </pre>
        )}

        {lyricLines.length > 0 ? (
          <div className="text-lg leading-[2.1] text-white/95 max-w-xl mx-auto">
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
                        ? "text-amber-300 font-semibold text-xl scale-[1.03] origin-left"
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
