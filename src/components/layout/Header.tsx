import { Star } from "lucide-react";

interface HeaderProps {
  title?: string;
  totalCount: number;
  favoriteCount: number;
}

export function Header({ title = "나의 노래책", totalCount, favoriteCount }: HeaderProps) {
  return (
    <div className="px-5 pt-7 pb-4">
      <h1 className="text-2xl font-semibold tracking-tight font-serif">
        {title}
      </h1>
      <div className="flex gap-4 mt-1.5 text-[13px] text-white/45">
        <span>전체 {totalCount}곡</span>
        <span className="flex items-center gap-1">
          <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
          즐겨찾기 {favoriteCount}곡
        </span>
      </div>
    </div>
  );
}
