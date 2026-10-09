import { Star } from "lucide-react";

interface FavoriteButtonProps {
  active: boolean;
  onToggle: () => void;
  size?: "sm" | "md";
  /** 비활성 상태 아이콘 색상을 오버라이드 (배경 대비 자동 조정용). 생략하면 기존 기본값(text-white/60) 사용 */
  colorClassName?: string;
}

export function FavoriteButton({
  active,
  onToggle,
  size = "md",
  colorClassName,
}: FavoriteButtonProps) {
  const iconSize = size === "sm" ? "h-3.5 w-3.5" : "h-5 w-5";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={`p-2 hover:text-amber-400 transition ${colorClassName ?? "text-white/60"}`}
      aria-label="즐겨찾기 토글"
      title="즐겨찾기"
    >
      <Star className={`${iconSize} ${active ? "fill-amber-400 text-amber-400" : ""}`} />
    </button>
  );
}
