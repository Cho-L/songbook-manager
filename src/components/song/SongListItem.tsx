import { Star } from "lucide-react";
import type { Song } from "../../types/song";
import { DifficultyDots } from "./DifficultyDots";

interface SongListItemProps {
  song: Song;
  isFavorite: boolean;
  onClick: () => void;
}

export function SongListItem({ song, isFavorite, onClick }: SongListItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left rounded-xl bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.06] px-4 py-3.5 flex items-center justify-between transition w-full"
    >
      <div className="min-w-0">
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
