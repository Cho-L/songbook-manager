import { useState } from "react";
import { confirmAsync, notify } from "../components/ui/feedback";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Plus, Trash2, ListMusic } from "lucide-react";
import { usePlaylists } from "../hooks/usePlaylists";
import { useAuth } from "../hooks/useAuth";
import { useBookDesign } from "../hooks/useBookDesign";
import { canManageBook } from "../utils/permissions";
import { getChromeCssVars } from "../utils/color";
import { EmptyNotice } from "../components/song/EmptyState";

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
      notify(e instanceof Error ? e.message : "플레이리스트를 만들지 못했어요. 잠시 후 다시 시도해주세요.", "error");
    } finally {
      setCreating(false);
    }
  }

  async function handleRemove(id: string, name: string) {
    const ok = await confirmAsync({
      title: `"${name}" 플레이리스트를 삭제할까요?`,
      message: "플레이리스트만 사라져요. 안에 담긴 노래 자체는 삭제되지 않아요.",
      confirmLabel: "플레이리스트 삭제",
      tone: "danger",
    });
    if (!ok) return;
    await removePlaylist(id);
    notify(`"${name}" 플레이리스트를 삭제했어요.`);
  }

  return (
    <div className="book-focus max-w-md lg:max-w-5xl mx-auto pb-16 min-h-screen" style={bookStyle}>
      <div className="px-5 lg:px-8 pt-5">
        <button
          onClick={() => navigate(`/books/${ownerId}`)}
          className="flex items-center gap-1 py-1.5 text-[13px]"
          style={{ color: "var(--book-chrome-muted, rgba(255,255,255,0.4))" }}
        >
          <ChevronLeft className="h-4 w-4" /> 노래책으로
        </button>
      </div>

      <div className="px-5 lg:px-8 pt-3 pb-4">
        <h1 className="text-[22px] lg:text-[26px] font-semibold font-serif">플레이리스트</h1>
        <p
          className="text-[13px] mt-1"
          style={{ color: "var(--book-chrome-muted, rgba(255,255,255,0.45))" }}
        >
          연습곡/공연곡처럼 곡을 묶어서 관리해요
        </p>
      </div>

      {isOwner && (
        <div className="px-5 lg:px-8 flex gap-2 mb-2 lg:max-w-md">
          <input
            aria-label="새 플레이리스트 이름"
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
            aria-label="플레이리스트 만들기"
            title={newName.trim() ? "플레이리스트 만들기" : "이름을 입력하면 만들 수 있어요"}
            className="px-3 rounded-lg disabled:opacity-40"
            style={{ backgroundColor: "var(--book-accent, #fbbf24)", color: "#14161F" }}
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </div>
      )}

      {loading && (
        <p className="px-5 lg:px-8 text-sm mt-6" style={{ color: "var(--book-chrome-muted, rgba(255,255,255,0.4))" }}>
          불러오는 중...
        </p>
      )}

      {!loading && playlists.length === 0 && (
        <EmptyNotice
          icon={<ListMusic className="h-5 w-5" strokeWidth={1.5} />}
          title="아직 플레이리스트가 없어요"
          description={
            isOwner
              ? "위 입력창에 이름을 적고 + 버튼을 눌러 첫 플레이리스트를 만들어보세요"
              : "공개된 플레이리스트가 아직 없어요"
          }
        />
      )}

      {!loading && playlists.length > 0 && (
        <div className="px-5 lg:px-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-2">
          {playlists.map((p) => (
            <div
              key={p.id}
              onClick={() => navigate(`/books/${ownerId}/playlists/${p.id}`)}
              className="group rounded-xl border pl-4 pr-2 py-3 flex items-center gap-3 min-w-0 cursor-pointer transition-[filter] duration-150 hover:brightness-110 active:brightness-95"
              style={{
                backgroundColor: "var(--book-chrome-surface, rgba(255,255,255,0.04))",
                borderColor: "var(--book-chrome-border, rgba(255,255,255,0.06))",
              }}
            >
              <ListMusic className="h-4 w-4 shrink-0" style={{ color: "var(--book-chrome-muted, rgba(255,255,255,0.4))" }} />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/books/${ownerId}/playlists/${p.id}`);
                }}
                className="text-left flex-1 min-w-0"
              >
                <span className="text-[15px] font-medium truncate block">{p.name}</span>
              </button>
              {isOwner && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemove(p.id, p.name);
                  }}
                  className="p-2 hover:text-red-400 shrink-0"
                  style={{ color: "var(--book-chrome-muted, rgba(255,255,255,0.4))" }}
                  aria-label="플레이리스트 삭제"
                  title="플레이리스트 삭제 (확인 후 삭제)"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
              <ChevronRight className="h-4 w-4 shrink-0 mr-1" style={{ color: "var(--book-chrome-muted, rgba(255,255,255,0.3))" }} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
