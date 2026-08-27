import { useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, Mic, Pencil, Trash2, ListPlus } from "lucide-react";
import type { Song } from "../types/song";
import { FavoriteButton } from "../components/song/FavoriteButton";
import { LinkifiedText } from "../components/song/LinkifiedText";
import { useAuth } from "../hooks/useAuth";
import { useFavorites } from "../hooks/useFavorites";
import { usePlaylists } from "../hooks/usePlaylists";
import { playlistRepository } from "../services/playlistRepository";
import { canManageBook } from "../utils/permissions";

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
  const isOwner = canManageBook(currentUser, ownerId);
  const { playlists } = usePlaylists(isOwner ? ownerId : undefined);

  if (!song) {
    return (
      <div className="max-w-md mx-auto px-5 pt-10 text-center text-white/50">
        <p>곡을 찾을 수 없어요.</p>
        <button
          onClick={() => navigate(`/books/${ownerId}`)}
          className="mt-3 text-amber-300 text-sm"
        >
          목록으로 돌아가기
        </button>
      </div>
    );
  }

  function handleDelete() {
    if (!song) return;
    if (confirm(`정말 "${song.title}"을(를) 삭제하시겠습니까?`)) {
      onRemove(song.id);
      navigate(`/books/${ownerId}`);
    }
  }

  function handleFavoriteClick() {
    if (!currentUser) {
      alert("즐겨찾기는 로그인 후 이용할 수 있어요.");
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
      alert("플레이리스트에 추가했어요.");
    } catch (err) {
      alert(err instanceof Error ? err.message : "추가에 실패했어요.");
    }
  }

  return (
    <div className="max-w-md mx-auto pb-16">
      <div className="flex items-center justify-between px-4 pt-5 pb-2">
        <button
          onClick={() => navigate(`/books/${ownerId}`)}
          className="p-2 -ml-2 text-white/60 hover:text-white"
          aria-label="뒤로가기"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-1">
          <FavoriteButton
            active={currentUser ? favoriteIds.has(song.id) : false}
            onToggle={handleFavoriteClick}
          />
          {isOwner && (
            <>
              <button
                onClick={() => navigate(`/books/${ownerId}/songs/${song.id}/edit`)}
                className="p-2 text-white/60 hover:text-white"
                aria-label="수정"
              >
                <Pencil className="h-[18px] w-[18px]" />
              </button>
              <button
                onClick={handleDelete}
                className="p-2 text-white/60 hover:text-red-400"
                aria-label="삭제"
              >
                <Trash2 className="h-[18px] w-[18px]" />
              </button>
            </>
          )}
        </div>
      </div>

      <div className="px-5 pt-2">
        <h1 className="text-2xl font-semibold font-serif">{song.title}</h1>
        <p className="text-white/50 text-sm mt-1">{song.artist}</p>

        <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-4 text-[13px] text-white/50">
          {song.composer && <span>작곡 {song.composer}</span>}
          {song.lyricist && <span>작사 {song.lyricist}</span>}
          {song.genre && <span>{song.genre}</span>}
          {song.key && <span>Key {song.key}</span>}
          {song.bpm && <span>{song.bpm} BPM</span>}
          {song.difficulty && (
            <span>난이도 {"★".repeat(song.difficulty)}{"☆".repeat(5 - song.difficulty)}</span>
          )}
        </div>

        {song.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {song.tags.map((t) => (
              <span
                key={t}
                className="text-[11px] px-2 py-1 rounded-full bg-white/[0.06] text-white/50"
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

        <button
          onClick={() => navigate(`/books/${ownerId}/songs/${song.id}/sing`)}
          className="mt-5 w-full flex items-center justify-center gap-2 rounded-xl bg-amber-400 text-[#14161F] font-medium py-3 text-[15px]"
        >
          <Mic className="h-4 w-4" /> 노래 부르기 모드
        </button>

        {isOwner && playlists.length > 0 && (
          <div className="mt-3 relative">
            <select
              defaultValue=""
              onChange={handleAddToPlaylist}
              className="w-full appearance-none rounded-xl bg-white/[0.06] border border-white/10 py-2.5 pl-9 pr-3 text-[13px] text-white/70 outline-none"
            >
              <option value="" disabled>
                플레이리스트에 추가...
              </option>
              {playlists.map((p) => (
                <option key={p.id} value={p.id} className="bg-[#14161F]">
                  {p.name}
                </option>
              ))}
            </select>
            <ListPlus className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40 pointer-events-none" />
          </div>
        )}

        {song.memo && (
          <div className="mt-5 rounded-lg bg-white/[0.04] border border-white/[0.06] px-3.5 py-3 text-[13px] text-white/60">
            {song.memo}
          </div>
        )}

        {song.chords && (
          <div className="mt-5">
            <div className="text-xs text-white/40 mb-1.5">코드</div>
            <pre className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-emerald-300/90 bg-white/[0.03] rounded-lg p-3 font-mono">
              {song.chords}
            </pre>
          </div>
        )}

        {song.lyrics && (
          <div className="mt-5">
            <div className="text-xs text-white/40 mb-1.5">가사</div>
            <div className="text-[14.5px] leading-[1.9] text-white/85">
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
  );
}
