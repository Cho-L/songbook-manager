interface DifficultyDotsProps {
  value?: number;
}

export function DifficultyDots({ value = 0 }: DifficultyDotsProps) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className="h-1.5 w-1.5 rounded-full"
          style={{
            backgroundColor:
              n <= value
                ? "var(--book-accent, #fbbf24)"
                : "var(--book-chrome-muted, rgba(255,255,255,0.15))",
          }}
        />
      ))}
    </div>
  );
}
