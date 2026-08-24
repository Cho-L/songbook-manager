import type { SortOption } from "../../types/song";

interface SortSelectProps {
  value: SortOption;
  onChange: (value: SortOption) => void;
}

const options: { value: SortOption; label: string }[] = [
  { value: "recent", label: "최근 등록순" },
  { value: "title", label: "제목순" },
  { value: "artist", label: "가수순" },
  { value: "difficulty", label: "난이도순" },
  { value: "favorite", label: "즐겨찾기순" },
];

export function SortSelect({ value, onChange }: SortSelectProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as SortOption)}
      className="min-w-[104px] w-auto text-xs bg-white/[0.06] border border-white/10 rounded-lg pl-2.5 pr-6 py-1.5 text-white/60 outline-none focus:border-amber-400/50 whitespace-nowrap"
      aria-label="정렬 기준"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value} className="bg-[#14161F]">
          {opt.label}
        </option>
      ))}
    </select>
  );
}
