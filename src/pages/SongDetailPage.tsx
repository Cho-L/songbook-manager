import { useNavigate, useParams } from "react-router-dom";
import { confirmAsync, notify } from "../components/ui/feedback";
import { DifficultyDots } from "../components/song/DifficultyDots";
import { useAutoLyrics } from "../hooks/useAutoLyrics";
import { AutoLyricsBar } from "../components/song/AutoLyricsBar";
import { ChevronLeft, Mic, Pencil, Trash2, ListPlus } from "lucide-react";
import type { Song } from "../types/song";
import { FavoriteButton } from "../components/song/FavoriteButton";
import { LinkifiedText } from "../components/song/LinkifiedText";
import { useAuth } from "../hooks/useAuth";
import { useFavorites } from "../hooks/useFavorites";
import { usePlaylists } from "../hooks/usePlaylists";
import { useBookDesign } from "../hooks/useBookDesign";
import { playlistRepository } from "../services/playlistRepository";
import { canManageBook } from "../utils/permissions";
import { getChromeCssVars, isLightBackground } from "../utils/color";

interface SongDetailPageProps {
  songs: Song[];
  onRemove: (id: string) => void;
}

export function SongDetailPage({ songs, onRemove }: SongDetailPageProps) {
  const { ownerId, id } = useParams();
  const navigate = useNavigate();
  const { profile: currentUser } = useAuth();
  const { favoriteIds, toggle: toggleFavorite } = useFavorites(currentUser?.id);
  const song = songs.find((s) => s.id === id);
  // 소유자에게만 "자동 가사/싱크" 관리 패널을 보여준다 (후보 선택, 다시 찾기, 결과 지우기, 켜기/끄기). 화면에 보이는 저장된 가사는 바꾸지 않는다.
  const isOwner = canManageBook(currentUser, ownerId);
  const isOwnerForAuto = isOwner && Boolean(song);
  const auto = useAutoLyrics(isOwnerForAuto ? song : undefined);
  const { playlists } = usePlaylists(isOwner ? ownerId : undefined);
  const { design } = useBookDesign(ownerId);
  const bookStyle = {
    "--book-accent": design.accentColor,
    "--book-background": design.backgroundColor,
    "--book-surface": design.surfaceColor,
    "--book-text": design.textColor,
    ...getChromeCssVars(design.backgroundColor),
    backgroundColor: design.backgroundColor,
    color: design.textColor,
  } as React.CSSProperties;

  if (!song) {
    return (
      <div className="book-focus max-w-md lg:max-w-5xl mx-auto px-5 lg:px-8 pt-10 pb-10 min-h-screen text-center" style={bookStyle}>
        <p style={{ color: "var(--book-chrome-muted, rgba(255,255,255,0.5))" }}>
          곡을 찾을 수 없어요.
        </p>
        <button
          onClick={() => navigate(`/books/${ownerId}`)}
          className="mt-3 text-sm"
          style={{ color: "var(--book-accent, #fbbf24)" }}
        >
          목록으로 돌아가기
        </button>
      </div>
    );
  }

  async function handleDelete() {
    if (!song) return;
    const ok = await confirmAsync({
      title: `"${song.title}" 노래를 삭제할까요?`,
      message: "가사, 코드, MR 정보가 모두 사라지고 되돌릴 수 없어요.",
      confirmLabel: "노래 삭제",
      tone: "danger",
    });
    if (ok) {
      onRemove(song.id);
      navigate(`/books/${ownerId}`);
    }
  }

  function handleFavoriteClick() {
    if (!currentUser) {
      notify("즐겨찾기는 로그인 후에 쓸 수 있어요.", "info");
      return;
    }
    toggleFavorite(song!.id);
  }

  async function handleAddToPlaylist(e: React.ChangeEvent<HTMLSelectElement>) {
    const playlistId = e.target.value;
    e.target.value = "";
    if (!playlistId || !song) return;
    try {
      await playlistRepository.addSong(playlistId, song.id);
      const name = playlists.find((p) => p.id === playlistId)?.name;
      notify(name ? `"${name}" 플레이리스트에 추가했어요.` : "플레이리스트에 추가했어요.");
    } catch (err) {
      notify(err instanceof Error ? err.message : "플레이리스트에 추가하지 못했어요. 잠시 후 다시 시도해주세요.", "error");
    }
  }

  return (
    <div className="book-focus max-w-md lg:max-w-5xl mx-auto pb-16 min-h-screen" style={bookStyle}>
      <div className="flex items-center justify-between px-4 lg:px-8 pt-5 pb-2">
        <button
          onClick={() => navigate(`/books/${ownerId}`)}
          className="p-2 -ml-2"
          style={{ color: "var(--book-chrome-muted, rgba(255,255,255,0.6))" }}
          aria-label="뒤로가기"
          title="노래책으로 돌아가기"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-1">
          <FavoriteButton
            active={currentUser ? favoriteIds.has(song.id) : false}
            onToggle={handleFavoriteClick}
            colorClassName="text-[color:var(--book-chrome-muted,rgba(255,255,255,0.6))]"
          />
          {isOwner && (
            <>
              <button
                onClick={() => navigate(`/books/${ownerId}/songs/${song.id}/edit`)}
                className="flex items-center gap-1.5 px-3 min-h-[40px] rounded-lg text-[13px] hover:brightness-125"
                style={{ color: "var(--book-chrome-text, rgba(255,255,255,0.75))" }}
                aria-label="수정"
                title="가사·MR·코드 등 이 노래의 정보를 고쳐요"
              >
                <Pencil className="h-4 w-4" /> 수정
              </button>
              <button
                onClick={handleDelete}
                className="flex items-center gap-1.5 px-3 min-h-[40px] rounded-lg text-[13px] text-red-400/80 hover:text-red-400"
                aria-label="삭제"
                title="이 노래를 삭제해요 (확인 후 삭제)"
              >
                <Trash2 className="h-4 w-4" /> 삭제
              </button>
            </>
          )}
        </div>
      </div>

      <div className="px-5 lg:px-8 pt-2 lg:grid lg:grid-cols-[340px_1fr] lg:gap-10 lg:items-start">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold font-serif break-words">{song.title}</h1>
          <p
            className="text-sm mt-1 break-words"
            style={{ color: "var(--book-chrome-muted, rgba(255,255,255,0.5))" }}
          >
            {song.artist}
          </p>

          <div
            className="flex flex-wrap gap-x-4 gap-y-1.5 mt-4 text-[13px]"
            style={{ color: "var(--book-chrome-muted, rgba(255,255,255,0.5))" }}
          >
            {song.composer && <span>작곡 {song.composer}</span>}
            {song.lyricist && <span>작사 {song.lyricist}</span>}
            {song.genre && <span>{song.genre}</span>}
            {song.key && <span>Key {song.key}</span>}
            {song.bpm && <span>{song.bpm} BPM</span>}
            {song.difficulty && (
              <span className="flex items-center gap-2">
                난이도 <DifficultyDots value={song.difficulty} />
              </span>
            )}
          </div>

          {song.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {song.tags.map((t) => (
                <span
                  key={t}
                  className="text-[11px] px-2 py-1 rounded-full"
                  style={{
                    backgroundColor: "var(--book-chrome-surface, rgba(255,255,255,0.06))",
                    color: "var(--book-chrome-muted, rgba(255,255,255,0.5))",
                  }}
                >
                  #{t}
                </span>
              ))}
            </div>
          )}

          {song.youtubeVideoId && (
            <div className="mt-5 aspect-video rounded-lg overflow-hidden bg-black">
              <iframe
                className="w-full h-full"
                src={`https://www.youtube.com/embed/${song.youtubeVideoId}`}
                title="YouTube MR"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          )}
        </div>

        <div className="mt-5 lg:mt-0 min-w-0">
          <button
            onClick={() => navigate(`/books/${ownerId}/songs/${song.id}/sing`)}
            className="w-full flex items-center justify-center gap-2 rounded-xl font-medium py-3 text-[15px]"
            style={{ backgroundColor: "var(--book-accent, #fbbf24)", color: "#14161F" }}
          >
            <Mic className="h-4 w-4" /> 노래 부르기
          </button>
          <p className="text-[12px] mt-1.5 text-center" style={{ color: "var(--book-chrome-muted, rgba(255,255,255,0.45))" }}>
            가사와 MR을 보면서 이 노래를 부르는 화면이에요
          </p>

          {isOwner && playlists.length > 0 && (
            <div className="mt-3 relative">
              <select
                defaultValue=""
                onChange={handleAddToPlaylist}
                className="w-full appearance-none rounded-xl border py-2.5 pl-9 pr-3 text-[13px] outline-none"
                style={{
                  backgroundColor: "var(--book-chrome-surface, rgba(255,255,255,0.06))",
                  borderColor: "var(--book-chrome-border, rgba(255,255,255,0.1))",
                  color: "var(--book-chrome-text, rgba(255,255,255,0.7))",
                }}
              >
                <option value="" disabled>
                  플레이리스트에 추가...
                </option>
                {playlists.map((p) => (
                  <option
                    key={p.id}
                    value={p.id}
                    style={{ backgroundColor: design.backgroundColor, color: design.textColor }}
                  >
                    {p.name}
                  </option>
                ))}
              </select>
              <ListPlus
                className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none"
                style={{ color: "var(--book-chrome-muted, rgba(255,255,255,0.4))" }}
              />
            </div>
          )}

          {song.memo && (
            <div
              className="mt-5 rounded-lg border px-3.5 py-3 text-[13px]"
              style={{
                backgroundColor: "var(--book-chrome-surface, rgba(255,255,255,0.04))",
                borderColor: "var(--book-chrome-border, rgba(255,255,255,0.06))",
                color: "var(--book-chrome-muted, rgba(255,255,255,0.6))",
              }}
            >
              {song.memo}
            </div>
          )}

          {song.chords && (
            <div className="mt-5">
              <div
                className="text-xs mb-1.5"
                style={{ color: "var(--book-chrome-muted, rgba(255,255,255,0.4))" }}
              >
                코드
              </div>
              <pre
                className="whitespace-pre-wrap text-[13.5px] leading-relaxed rounded-lg p-3 font-mono"
                style={{
                  backgroundColor: "var(--book-chrome-surface, rgba(255,255,255,0.03))",
                  // 밝은 노래책에서는 연한 민트가 배경에 묻혀서, SongMode 밝은 테마와 같은 진한 청록을 쓴다.
                  color: isLightBackground(design.backgroundColor) ? "#0f766e" : "rgba(110,231,183,0.9)",
                }}
              >
                {song.chords}
              </pre>
            </div>
          )}

          {isOwnerForAuto && (
            <div className="mt-5">
              <div className="text-xs mb-1.5" style={{ color: "var(--book-chrome-muted, rgba(255,255,255,0.4))" }}>
                가사 자동 찾기
              </div>
              <AutoLyricsBar auto={auto} currentTime={0} mrDuration={0} showManage />
            </div>
          )}

          {song.lyrics && (
            <div className="mt-5">
              <div
                className="text-xs mb-1.5"
                style={{ color: "var(--book-chrome-muted, rgba(255,255,255,0.4))" }}
              >
                가사
              </div>
              <div
                className="text-[14.5px] leading-[1.9]"
                style={{ color: "var(--book-text, #ffffff)", opacity: 0.85 }}
              >
                {song.lyrics.split(/\r?\n/).map((line, i) =>
                  line === "" ? (
                    <div key={i} className="h-4" aria-hidden="true" />
                  ) : (
                    <p key={i} className="break-words">
                      <LinkifiedText text={line} />
                    </p>
                  )
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
