import { Star } from "lucide-react";

interface FavoriteButtonProps {
  active: boolean;
  onToggle: () => void;
  size?: "sm" | "md";
}

export function FavoriteButton({
  active,
  onToggle,
  size = "md",
}: FavoriteButtonProps) {
  const iconSize = size === "sm" ? "h-3.5 w-3.5" : "h-5 w-5";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className="p-2 text-white/60 hover:text-amber-300 transition"
      aria-label="즐겨찾기 토글"
    >
      <Star className={`${iconSize} ${active ? "fill-amber-400 text-amber-400" : ""}`} />
    </button>
  );
}
