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
}

export function SongListItem({
  song,
  isFavorite,
  onClick,
  selectionMode = false,
  selected = false,
  onToggleSelect,
}: SongListItemProps) {
  return (
    <button
      type="button"
      onClick={selectionMode ? onToggleSelect : onClick}
      aria-pressed={selectionMode ? selected : undefined}
      className={`text-left rounded-xl border px-4 py-3.5 flex items-center gap-3 transition w-full ${
        selectionMode && selected
          ? "bg-amber-400/10 border-amber-400/40"
          : "bg-white/[0.04] hover:bg-white/[0.07] border-white/[0.06]"
      }`}
    >
      {selectionMode && (
        <span
          className={`shrink-0 h-5 w-5 rounded-md border flex items-center justify-center ${
            selected ? "bg-amber-400 border-amber-400" : "border-white/25"
          }`}
          aria-hidden="true"
        >
          {selected && <Check className="h-3.5 w-3.5 text-[#14161F]" strokeWidth={3} />}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[15px] font-medium truncate">{song.title}</span>
          {isFavorite && (
            <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" />
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
