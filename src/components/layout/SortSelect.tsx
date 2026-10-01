interface SortOptionItem<T extends string> {
  value: T;
  label: string;
}

interface SortSelectProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: SortOptionItem<T>[];
  ariaLabel?: string;
}

export function SortSelect<T extends string>({
  value,
  onChange,
  options,
  ariaLabel = "정렬 기준",
}: SortSelectProps<T>) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="min-w-[104px] w-auto text-xs rounded-lg pl-2.5 pr-6 py-1.5 outline-none whitespace-nowrap border transition-colors bg-[var(--book-chrome-surface,rgba(255,255,255,0.06))] border-[color:var(--book-chrome-border,rgba(255,255,255,0.1))] text-[color:var(--book-chrome-text,rgba(255,255,255,0.6))] hover:border-[color:color-mix(in_srgb,var(--book-accent,#fbbf24)_35%,transparent)] focus:border-[color:var(--book-accent,#fbbf24)]"
      aria-label={ariaLabel}
    >
      {options.map((opt) => (
        <option
          key={opt.value}
          value={opt.value}
          style={{ backgroundColor: "var(--book-background, #14161F)", color: "var(--book-text, #ffffff)" }}
        >
          {opt.label}
        </option>
      ))}
    </select>
  );
}
