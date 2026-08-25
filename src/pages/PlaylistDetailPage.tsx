import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, Play, X } from "lucide-react";
import { usePlaylistSongIds } from "../hooks/usePlaylists";
import { useSongs } from "../hooks/useSongs";
import { useAuth } from "../hooks/useAuth";
import { canManageBook } from "../utils/permissions";
import { playlistRepository } from "../services/playlistRepository";
import type { Playlist } from "../types/playlist";

export function PlaylistDetailPage() {
  const { ownerId, playlistId } = useParams();
  const navigate = useNavigate();
  const { profile: currentUser } = useAuth();
  const { songs } = useSongs(ownerId);
  const { songIds, loading, removeSong } = usePlaylistSongIds(playlistId);
  const [playlist, setPlaylist] = useState<Playlist | null>(null);

  const isOwner = canManageBook(currentUser, ownerId);

  useEffect(() => {
    if (!playlistId) return;
    playlistRepository.getById(playlistId).then(setPlaylist);
  }, [playlistId]);

  const orderedSongs = songIds
    .map((id) => songs.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => Boolean(s));

  function startPlaylist() {
    if (orderedSongs.length === 0) return;
    navigate(`/books/${ownerId}/songs/${orderedSongs[0].id}/sing?playlist=${playlistId}`);
  }

  return (
    <div className="max-w-md mx-auto pb-16">
      <div className="px-5 pt-5">
        <button
          onClick={() => navigate(`/books/${ownerId}/playlists`)}
          className="flex items-center gap-1 text-[13px] text-white/40 hover:text-white/70"
        >
          <ChevronLeft className="h-4 w-4" /> 플레이리스트 목록으로
        </button>
      </div>

      <div className="px-5 pt-3 pb-4">
        <h1 className="text-[22px] font-semibold font-serif break-words">
          {playlist?.name ?? "플레이리스트"}
        </h1>
        <p className="text-white/45 text-[13px] mt-1">{orderedSongs.length}곡</p>
      </div>

      {orderedSongs.length > 0 && (
        <div className="px-5 mb-3">
          <button
            type="button"
            onClick={startPlaylist}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-amber-400 text-[#14161F] font-medium py-3"
          >
            <Play className="h-4 w-4" strokeWidth={2.5} /> 이어서 부르기
          </button>
        </div>
      )}

      {loading && <p className="px-5 text-white/40 text-sm mt-6">불러오는 중...</p>}

      {!loading && orderedSongs.length === 0 && (
        <p className="px-5 text-white/40 text-[13px] mt-6">
          아직 곡이 없어요. 곡 상세 화면에서 "플레이리스트에 추가"로 넣어보세요.
        </p>
      )}

      {!loading && orderedSongs.length > 0 && (
        <div className="px-5 flex flex-col gap-2">
          {orderedSongs.map((song, i) => (
            <div
              key={song.id}
              className="rounded-xl bg-white/[0.04] border border-white/[0.06] px-4 py-3 flex items-center gap-3"
            >
              <span className="text-white/30 text-[12px] w-4 shrink-0">{i + 1}</span>
              <button
                type="button"
                onClick={() => navigate(`/books/${ownerId}/songs/${song.id}`)}
                className="flex-1 min-w-0 text-left"
              >
                <div className="text-[14.5px] font-medium truncate">{song.title}</div>
                <div className="text-[12px] text-white/45 truncate">{song.artist}</div>
              </button>
              {isOwner && (
                <button
                  type="button"
                  onClick={() => removeSong(song.id)}
                  className="p-1.5 text-white/30 hover:text-red-400 shrink-0"
                  aria-label="플레이리스트에서 제거"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
