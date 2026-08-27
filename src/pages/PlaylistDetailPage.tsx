import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, Play, X, Plus, Check } from "lucide-react";
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
  const { songIds, loading, removeSong, reload } = usePlaylistSongIds(playlistId);
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [showAddPicker, setShowAddPicker] = useState(false);
  const [picking, setPicking] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);

  const isOwner = canManageBook(currentUser, ownerId);

  useEffect(() => {
    if (!playlistId) return;
    playlistRepository.getById(playlistId).then(setPlaylist);
  }, [playlistId]);

  const orderedSongs = songIds
    .map((id) => songs.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => Boolean(s));

  const availableSongs = songs.filter((s) => !songIds.includes(s.id));

  function startPlaylist() {
    if (orderedSongs.length === 0) return;
    navigate(`/books/${ownerId}/songs/${orderedSongs[0].id}/sing?playlist=${playlistId}`);
  }

  function togglePick(songId: string) {
    setPicking((prev) => {
      const next = new Set(prev);
      if (next.has(songId)) {
        next.delete(songId);
      } else {
        next.add(songId);
      }
      return next;
    });
  }

  async function handleAddPicked() {
    if (!playlistId) return;
    const ids = [...picking];
    if (ids.length === 0) return;
    setAdding(true);
    let succeeded = 0;
    let failed = 0;
    for (const songId of ids) {
      try {
        await playlistRepository.addSong(playlistId, songId);
        succeeded++;
      } catch (e) {
        console.error("플레이리스트 곡 추가 실패:", e);
        failed++;
      }
    }
    await reload();
    setPicking(new Set());
    setAdding(false);
    setShowAddPicker(false);
    if (failed > 0) {
      alert(`${ids.length}곡 중 ${succeeded}곡 추가 완료, ${failed}곡은 실패했어요.`);
    } else {
      alert(`${succeeded}곡을 추가했어요.`);
    }
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

      <div className="px-5 pt-3 pb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold font-serif break-words">
            {playlist?.name ?? "플레이리스트"}
          </h1>
          <p className="text-white/45 text-[13px] mt-1">{orderedSongs.length}곡</p>
        </div>
        {isOwner && (
          <button
            type="button"
            onClick={() => setShowAddPicker((v) => !v)}
            className="flex items-center gap-1 text-[12.5px] px-3 py-1.5 rounded-full bg-white/[0.06] border border-white/10 text-white/60 shrink-0"
          >
            <Plus className="h-3.5 w-3.5" /> 곡 추가
          </button>
        )}
      </div>

      {showAddPicker && (
        <div className="px-5 mb-4">
          {availableSongs.length === 0 ? (
            <p className="text-white/40 text-[13px]">추가할 수 있는 곡이 없어요 (전부 이미 포함됨).</p>
          ) : (
            <>
              <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto rounded-lg border border-white/[0.06] p-2">
                {availableSongs.map((song) => (
                  <button
                    key={song.id}
                    type="button"
                    onClick={() => togglePick(song.id)}
                    className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left ${
                      picking.has(song.id) ? "bg-amber-400/10" : "hover:bg-white/[0.04]"
                    }`}
                  >
                    <span
                      className={`shrink-0 h-4.5 w-4.5 rounded border flex items-center justify-center ${
                        picking.has(song.id)
                          ? "bg-amber-400 border-amber-400"
                          : "border-white/25"
                      }`}
                    >
                      {picking.has(song.id) && (
                        <Check className="h-3 w-3 text-[#14161F]" strokeWidth={3} />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-[13.5px] block truncate">{song.title}</span>
                      <span className="text-[11.5px] text-white/40 block truncate">
                        {song.artist}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={handleAddPicked}
                disabled={picking.size === 0 || adding}
                className="mt-2 w-full rounded-lg bg-amber-400 text-[#14161F] font-medium py-2 text-[13px] disabled:opacity-40"
              >
                {adding ? "추가하는 중..." : `${picking.size}곡 추가`}
              </button>
            </>
          )}
        </div>
      )}

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
          아직 곡이 없어요. "곡 추가" 버튼으로 넣어보세요.
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
