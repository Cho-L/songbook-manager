interface DifficultyDotsProps {
  value?: number;
}

/**
 * 난이도 점 — accent 색은 재생 버튼/즐겨찾기 같은 "행동"에 아끼고,
 * 난이도는 중립 크롬 톤의 농도 차이로만 표현한다(밝은 배경에서도 자동으로 어두운 톤).
 */
export function DifficultyDots({ value = 0 }: DifficultyDotsProps) {
  return (
    <div className="flex gap-1" role="img" aria-label={`난이도 ${value}/5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className="h-1.5 w-1.5 rounded-full"
          style={{
            backgroundColor:
              n <= value
                ? "color-mix(in srgb, var(--book-chrome-text, #ffffff) 55%, transparent)"
                : "color-mix(in srgb, var(--book-chrome-text, #ffffff) 14%, transparent)",
          }}
        />
      ))}
    </div>
  );
}
