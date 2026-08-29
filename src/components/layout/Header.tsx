import { Star } from "lucide-react";

interface HeaderProps {
  title?: string;
  description?: string | null;
  totalCount: number;
  favoriteCount: number;
}

export function Header({ title = "나의 노래책", description, totalCount, favoriteCount }: HeaderProps) {
  return (
    <div className="px-5 pt-7 pb-4">
      <h1
        className="text-2xl font-semibold tracking-tight font-serif"
        style={{ color: "var(--book-text, #ffffff)" }}
      >
        {title}
      </h1>
      {description && (
        <p
          className="text-[13px] mt-1 opacity-70"
          style={{ color: "var(--book-text, #ffffff)" }}
        >
          {description}
        </p>
      )}
      <div className="flex gap-4 mt-1.5 text-[13px] opacity-60" style={{ color: "var(--book-text, #ffffff)" }}>
        <span>전체 {totalCount}곡</span>
        <span className="flex items-center gap-1">
          <Star className="h-3 w-3" style={{ fill: "var(--book-accent, #fbbf24)", color: "var(--book-accent, #fbbf24)" }} />
          즐겨찾기 {favoriteCount}곡
        </span>
      </div>
    </div>
  );
}
