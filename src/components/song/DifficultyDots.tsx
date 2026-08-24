interface DifficultyDotsProps {
  value?: number;
}

export function DifficultyDots({ value = 0 }: DifficultyDotsProps) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={`h-1.5 w-1.5 rounded-full ${
            n <= value ? "bg-amber-400" : "bg-white/15"
          }`}
        />
      ))}
    </div>
  );
}
