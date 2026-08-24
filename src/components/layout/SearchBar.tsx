import { Search, X } from "lucide-react";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  favOnly: boolean;
  onToggleFavOnly: () => void;
}

export function SearchBar({
  value,
  onChange,
  favOnly,
  onToggleFavOnly,
}: SearchBarProps) {
  return (
    <div className="px-5 sticky top-0 z-10 bg-[#14161F]/95 backdrop-blur pb-3 pt-1">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="제목, 가수, 장르, 태그 검색"
          className="w-full rounded-xl bg-white/[0.06] border border-white/10 pl-9 pr-9 py-2.5 text-sm placeholder-white/30 outline-none focus:border-amber-400/50 transition"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="검색어 지우기"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-white/30 hover:text-white/60"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onToggleFavOnly}
        className={`mt-2.5 text-xs px-3 py-1.5 rounded-full border transition ${
          favOnly
            ? "bg-amber-400/15 border-amber-400/40 text-amber-300"
            : "bg-white/[0.04] border-white/10 text-white/50"
        }`}
      >
        ★ 즐겨찾기만 보기
      </button>
    </div>
  );
}
