import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, ChevronUp, ChevronDown, GripVertical, Play, X, Plus, Check } from "lucide-react";
import { usePlaylistSongIds } from "../hooks/usePlaylists";
import { useSongs } from "../hooks/useSongs";
import { useAuth } from "../hooks/useAuth";
import { useBookDesign } from "../hooks/useBookDesign";
import { canManageBook } from "../utils/permissions";
import { getChromeCssVars } from "../utils/color";
import { playlistRepository } from "../services/playlistRepository";
import type { Playlist } from "../types/playlist";

export function PlaylistDetailPage() {
  const { ownerId, playlistId } = useParams();
  const navigate = useNavigate();
  const { profile: currentUser } = useAuth();
  const { songs } = useSongs(ownerId);
  const { songIds, loading, saving, removeSong, reorder, reload } = usePlaylistSongIds(playlistId);
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [showAddPicker, setShowAddPicker] = useState(false);
  const [picking, setPicking] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
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

  async function startConcert() {
    if (orderedSongs.length === 0) return;
    try {
      await document.documentElement.requestFullscreen?.();
    } catch {
      // 전체화면 진입 실패는 치명적이지 않음 — 그냥 일반 화면으로 진행
    }
    navigate(`/books/${ownerId}/playlists/${playlistId}/concert`);
  }

  async function moveSong(fromIndex: number, toIndex: number) {
    if (toIndex < 0 || toIndex >= songIds.length || fromIndex === toIndex) return;
    const newOrder = [...songIds];
    const [moved] = newOrder.splice(fromIndex, 1);
    newOrder.splice(toIndex, 0, moved);
    try {
      await reorder(newOrder);
    } catch (e) {
      console.error("플레이리스트 순서 저장 실패:", e);
      alert("순서를 저장하지 못했어요. 이전 순서로 되돌립니다.");
    }
  }

  function handleDragStart(index: number) {
    if (!isOwner || saving) return;
    setDraggedIndex(index);
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    if (draggedIndex === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverIndex !== index) setDragOverIndex(index);
  }

  function handleDrop(e: React.DragEvent, index: number) {
    e.preventDefault();
    if (draggedIndex !== null) {
      moveSong(draggedIndex, index);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  }

  function handleDragEnd() {
    setDraggedIndex(null);
    setDragOverIndex(null);
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
    <div className="max-w-md lg:max-w-4xl mx-auto pb-16 min-h-screen" style={bookStyle}>
      <div className="px-5 lg:px-8 pt-5">
        <button
          onClick={() => navigate(`/books/${ownerId}/playlists`)}
          className="flex items-center gap-1 text-[13px]"
          style={{ color: "var(--book-chrome-muted, rgba(255,255,255,0.4))" }}
        >
          <ChevronLeft className="h-4 w-4" /> 플레이리스트 목록으로
        </button>
      </div>

      <div className="px-5 lg:px-8 pt-3 pb-4 lg:grid lg:grid-cols-[280px_1fr] lg:gap-10 lg:items-start">
        {/* 좌측(PC): 제목/설명/주요 액션/곡 추가. 모바일: 기존처럼 맨 위에 세로로 쌓임 */}
        <div className="lg:sticky lg:top-8">
          <div className="flex items-start justify-between gap-3 lg:block">
            <div>
              <h1 className="text-[22px] lg:text-[26px] font-semibold font-serif break-words">
                {playlist?.name ?? "플레이리스트"}
              </h1>
              <p
                className="text-[13px] mt-1"
                style={{ color: "var(--book-chrome-muted, rgba(255,255,255,0.45))" }}
              >
                {orderedSongs.length}곡
              </p>
            </div>
            {isOwner && (
              <button
                type="button"
                onClick={() => setShowAddPicker((v) => !v)}
                className="flex items-center gap-1 text-[12.5px] px-3 py-1.5 rounded-full border shrink-0 lg:hidden"
                style={{
                  backgroundColor: "var(--book-chrome-surface, rgba(255,255,255,0.06))",
                  borderColor: "var(--book-chrome-border, rgba(255,255,255,0.1))",
                  color: "var(--book-chrome-text, rgba(255,255,255,0.6))",
                }}
              >
                <Plus className="h-3.5 w-3.5" /> 곡 추가
              </button>
            )}
          </div>

          {orderedSongs.length > 0 && (
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={startConcert}
                className="w-full flex items-center justify-center gap-2 rounded-xl font-medium py-3"
                style={{ backgroundColor: "var(--book-accent, #fbbf24)", color: "#14161F" }}
              >
                🎤 공연 시작
              </button>
              <button
                type="button"
                onClick={startPlaylist}
                className="w-full flex items-center justify-center gap-2 rounded-xl font-medium py-3 border"
                style={{
                  borderColor: "var(--book-chrome-border, rgba(255,255,255,0.1))",
                  color: "var(--book-chrome-text, rgba(255,255,255,0.8))",
                }}
              >
                <Play className="h-4 w-4" strokeWidth={2.5} /> 이어서 부르기
              </button>
            </div>
          )}

          {isOwner && (
            <button
              type="button"
              onClick={() => setShowAddPicker((v) => !v)}
              className="hidden lg:flex mt-2 w-full items-center justify-center gap-1.5 text-[13px] px-3 py-2.5 rounded-xl border"
              style={{
                backgroundColor: "var(--book-chrome-surface, rgba(255,255,255,0.06))",
                borderColor: "var(--book-chrome-border, rgba(255,255,255,0.1))",
                color: "var(--book-chrome-text, rgba(255,255,255,0.6))",
              }}
            >
              <Plus className="h-3.5 w-3.5" /> 곡 추가
            </button>
          )}

          {showAddPicker && (
            <div className="mt-3">
              {availableSongs.length === 0 ? (
                <p className="text-[13px]" style={{ color: "var(--book-chrome-muted, rgba(255,255,255,0.4))" }}>
                  추가할 수 있는 곡이 없어요 (전부 이미 포함됨).
                </p>
              ) : (
                <>
                  <div
                    className="flex flex-col gap-1.5 max-h-64 lg:max-h-[50vh] overflow-y-auto rounded-lg border p-2"
                    style={{ borderColor: "var(--book-chrome-border, rgba(255,255,255,0.06))" }}
                  >
                    {availableSongs.map((song) => (
                      <button
                        key={song.id}
                        type="button"
                        onClick={() => togglePick(song.id)}
                        className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left ${
                          picking.has(song.id)
                            ? "bg-amber-400/10"
                            : "hover:bg-[var(--book-chrome-surface,rgba(255,255,255,0.04))]"
                        }`}
                      >
                        <span
                          className={`shrink-0 h-4.5 w-4.5 rounded border flex items-center justify-center ${
                            picking.has(song.id) ? "bg-amber-400 border-amber-400" : ""
                          }`}
                          style={
                            picking.has(song.id)
                              ? undefined
                              : { borderColor: "var(--book-chrome-border, rgba(255,255,255,0.25))" }
                          }
                        >
                          {picking.has(song.id) && (
                            <Check className="h-3 w-3 text-[#14161F]" strokeWidth={3} />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="text-[13.5px] block truncate">{song.title}</span>
                          <span
                            className="text-[11.5px] block truncate"
                            style={{ color: "var(--book-chrome-muted, rgba(255,255,255,0.4))" }}
                          >
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
                    className="mt-2 w-full rounded-lg font-medium py-2 text-[13px] disabled:opacity-40"
                    style={{ backgroundColor: "var(--book-accent, #fbbf24)", color: "#14161F" }}
                  >
                    {adding ? "추가하는 중..." : `${picking.size}곡 추가`}
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* 우측(PC) / 본문(모바일): 곡 목록 */}
        <div className="mt-5 lg:mt-0">
          {loading && (
            <p className="text-sm" style={{ color: "var(--book-chrome-muted, rgba(255,255,255,0.4))" }}>
              불러오는 중...
            </p>
          )}

          {!loading && orderedSongs.length === 0 && (
            <p
              className="text-[13px]"
              style={{ color: "var(--book-chrome-muted, rgba(255,255,255,0.4))" }}
            >
              아직 곡이 없어요. "곡 추가" 버튼으로 넣어보세요.
            </p>
          )}

          {!loading && orderedSongs.length > 0 && (
            <div className="flex flex-col gap-2">
              {orderedSongs.map((song, i) => {
                const isDragging = draggedIndex === i;
                const isDragOver = dragOverIndex === i && draggedIndex !== null && draggedIndex !== i;
                return (
                  <div
                    key={song.id}
                    draggable={isOwner && !saving}
                    onDragStart={() => handleDragStart(i)}
                    onDragOver={(e) => handleDragOver(e, i)}
                    onDrop={(e) => handleDrop(e, i)}
                    onDragEnd={handleDragEnd}
                    className="rounded-xl border px-4 py-3 flex items-center gap-2"
                    style={{
                      backgroundColor: isDragOver
                        ? "color-mix(in srgb, var(--book-accent, #fbbf24) 15%, var(--book-chrome-surface, rgba(255,255,255,0.04)))"
                        : "var(--book-chrome-surface, rgba(255,255,255,0.04))",
                      borderColor: isDragOver
                        ? "var(--book-accent, #fbbf24)"
                        : "var(--book-chrome-border, rgba(255,255,255,0.06))",
                      opacity: isDragging ? 0.4 : 1,
                    }}
                  >
                    {isOwner && (
                      <span
                        className="shrink-0 cursor-grab active:cursor-grabbing hidden sm:block"
                        style={{ color: "var(--book-chrome-muted, rgba(255,255,255,0.3))" }}
                        aria-hidden="true"
                      >
                        <GripVertical className="h-4 w-4" />
                      </span>
                    )}
                    <span
                      className="text-[12px] w-4 shrink-0"
                      style={{ color: "var(--book-chrome-muted, rgba(255,255,255,0.3))" }}
                    >
                      {i + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => navigate(`/books/${ownerId}/songs/${song.id}`)}
                      className="flex-1 min-w-0 text-left"
                    >
                      <div className="text-[14.5px] font-medium truncate">{song.title}</div>
                      <div
                        className="text-[12px] truncate"
                        style={{ color: "var(--book-chrome-muted, rgba(255,255,255,0.45))" }}
                      >
                        {song.artist}
                      </div>
                    </button>
                    {isOwner && (
                      <div className="flex items-center shrink-0">
                        <div className="flex flex-col">
                          <button
                            type="button"
                            onClick={() => moveSong(i, i - 1)}
                            disabled={i === 0 || saving}
                            className="p-1 disabled:opacity-25"
                            style={{ color: "var(--book-chrome-muted, rgba(255,255,255,0.4))" }}
                            aria-label="곡을 위로 이동"
                          >
                            <ChevronUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveSong(i, i + 1)}
                            disabled={i === orderedSongs.length - 1 || saving}
                            className="p-1 disabled:opacity-25"
                            style={{ color: "var(--book-chrome-muted, rgba(255,255,255,0.4))" }}
                            aria-label="곡을 아래로 이동"
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeSong(song.id)}
                          className="p-1.5 hover:text-red-400 shrink-0"
                          style={{ color: "var(--book-chrome-muted, rgba(255,255,255,0.3))" }}
                          aria-label="플레이리스트에서 제거"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
