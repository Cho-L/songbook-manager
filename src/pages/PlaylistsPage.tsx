import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, Plus, Trash2, ListMusic } from "lucide-react";
import { usePlaylists } from "../hooks/usePlaylists";
import { useAuth } from "../hooks/useAuth";
import { useBookDesign } from "../hooks/useBookDesign";
import { canManageBook } from "../utils/permissions";
import { getChromeCssVars } from "../utils/color";

export function PlaylistsPage() {
  const { ownerId } = useParams();
  const navigate = useNavigate();
  const { profile: currentUser } = useAuth();
  const { playlists, loading, createPlaylist, removePlaylist } = usePlaylists(ownerId);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
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

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const created = await createPlaylist(newName.trim());
      setNewName("");
      navigate(`/books/${ownerId}/playlists/${created.id}`);
    } catch (e) {
      alert(e instanceof Error ? e.message : "플레이리스트 생성에 실패했어요.");
    } finally {
      setCreating(false);
    }
  }

  async function handleRemove(id: string, name: string) {
    if (!confirm(`"${name}" 플레이리스트를 삭제하시겠습니까?\n(안의 곡 목록만 사라지고, 곡 자체는 삭제되지 않아요)`)) {
      return;
    }
    await removePlaylist(id);
  }

  return (
    <div className="max-w-md mx-auto pb-16 min-h-screen" style={bookStyle}>
      <div className="px-5 pt-5">
        <button
          onClick={() => navigate(`/books/${ownerId}`)}
          className="flex items-center gap-1 text-[13px]"
          style={{ color: "var(--book-chrome-muted, rgba(255,255,255,0.4))" }}
        >
          <ChevronLeft className="h-4 w-4" /> 노래책으로
        </button>
      </div>

      <div className="px-5 pt-3 pb-4">
        <h1 className="text-[22px] font-semibold font-serif">플레이리스트</h1>
        <p
          className="text-[13px] mt-1"
          style={{ color: "var(--book-chrome-muted, rgba(255,255,255,0.45))" }}
        >
          연습곡/공연곡처럼 곡을 묶어서 관리해요
        </p>
      </div>

      {isOwner && (
        <div className="px-5 flex gap-2 mb-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            placeholder="새 플레이리스트 이름 (예: 공연곡)"
            className="book-input flex-1 rounded-lg border px-3 py-2.5 text-[14px] outline-none"
            style={{
              backgroundColor: "var(--book-chrome-surface, rgba(255,255,255,0.06))",
              borderColor: "var(--book-chrome-border, rgba(255,255,255,0.1))",
              color: "var(--book-text, #ffffff)",
            }}
          />
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating || !newName.trim()}
            className="px-3 rounded-lg disabled:opacity-40"
            style={{ backgroundColor: "var(--book-accent, #fbbf24)", color: "#14161F" }}
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </div>
      )}

      {loading && (
        <p className="px-5 text-sm mt-6" style={{ color: "var(--book-chrome-muted, rgba(255,255,255,0.4))" }}>
          불러오는 중...
        </p>
      )}

      {!loading && playlists.length === 0 && (
        <div className="flex flex-col items-center text-center py-16 px-6">
          <ListMusic
            className="h-9 w-9 mb-3"
            strokeWidth={1.5}
            style={{ color: "var(--book-chrome-muted, rgba(255,255,255,0.2))" }}
          />
          <p style={{ color: "var(--book-chrome-text, rgba(255,255,255,0.7))" }} className="text-[15px]">
            아직 플레이리스트가 없어요
          </p>
        </div>
      )}

      {!loading && playlists.length > 0 && (
        <div className="px-5 flex flex-col gap-2 mt-2">
          {playlists.map((p) => (
            <div
              key={p.id}
              className="rounded-xl border px-4 py-3.5 flex items-center justify-between"
              style={{
                backgroundColor: "var(--book-chrome-surface, rgba(255,255,255,0.04))",
                borderColor: "var(--book-chrome-border, rgba(255,255,255,0.06))",
              }}
            >
              <button
                type="button"
                onClick={() => navigate(`/books/${ownerId}/playlists/${p.id}`)}
                className="text-left flex-1 min-w-0"
              >
                <span className="text-[15px] font-medium truncate block">{p.name}</span>
              </button>
              {isOwner && (
                <button
                  type="button"
                  onClick={() => handleRemove(p.id, p.name)}
                  className="p-2 -mr-2 hover:text-red-400 shrink-0"
                  style={{ color: "var(--book-chrome-muted, rgba(255,255,255,0.4))" }}
                  aria-label="플레이리스트 삭제"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
