import { Star, Check } from "lucide-react";
import type { Song } from "../../types/song";
import { DifficultyDots } from "./DifficultyDots";

interface SongListItemProps {
  song: Song;
  isFavorite: boolean;
  onClick: () => void;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  /** 노래책 디자인 설정의 곡 표시 방식 - 기본은 지금까지의 리스트형 */
  displayMode?: "list" | "card";
}

export function SongListItem({
  song,
  isFavorite,
  onClick,
  selectionMode = false,
  selected = false,
  onToggleSelect,
  displayMode = "list",
}: SongListItemProps) {
  const isCard = displayMode === "card";
  return (
    <button
      type="button"
      onClick={selectionMode ? onToggleSelect : onClick}
      aria-pressed={selectionMode ? selected : undefined}
      className={`text-left border flex items-center gap-3 transition w-full ${
        isCard ? "rounded-2xl px-4 py-5 shadow-sm" : "rounded-xl px-4 py-3.5"
      } ${selectionMode && selected ? "" : "bg-white/[0.04] hover:bg-white/[0.07] border-white/[0.06]"}`}
      style={
        selectionMode && selected
          ? {
              backgroundColor: "color-mix(in srgb, var(--book-accent, #fbbf24) 10%, transparent)",
              borderColor: "color-mix(in srgb, var(--book-accent, #fbbf24) 40%, transparent)",
            }
          : undefined
      }
    >
      {selectionMode && (
        <span
          className="shrink-0 h-5 w-5 rounded-md border flex items-center justify-center"
          style={
            selected
              ? { backgroundColor: "var(--book-accent, #fbbf24)", borderColor: "var(--book-accent, #fbbf24)" }
              : { borderColor: "rgba(255,255,255,0.25)" }
          }
          aria-hidden="true"
        >
          {selected && <Check className="h-3.5 w-3.5 text-[#14161F]" strokeWidth={3} />}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={`font-medium truncate ${isCard ? "text-[16px]" : "text-[15px]"}`}>
            {song.title}
          </span>
          {isFavorite && (
            <Star
              className="h-3.5 w-3.5 shrink-0"
              style={{ fill: "var(--book-accent, #fbbf24)", color: "var(--book-accent, #fbbf24)" }}
            />
          )}
        </div>
        <div className="text-[12.5px] text-white/45 truncate mt-0.5">
          {song.artist}
          {song.genre ? ` · ${song.genre}` : ""}
        </div>
      </div>
      <DifficultyDots value={song.difficulty} />
    </button>
  );
}
