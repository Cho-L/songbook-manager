import type { ReactNode } from "react";
import { Search, X } from "lucide-react";
import { useImeSafeInput } from "../../hooks/useImeSafeInput";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  favOnly: boolean;
  onToggleFavOnly: () => void;
  /** 즐겨찾기 필터와 같은 줄(오른쪽)에 놓을 보조 도구 — 선택/정렬처럼 목록을 다루는 컨트롤 */
  actions?: ReactNode;
}

export function SearchBar({
  value,
  onChange,
  favOnly,
  onToggleFavOnly,
  actions,
}: SearchBarProps) {
  // 한글 조합 중에는 URL/목록 상태를 건드리지 않는다 (입력이 밀리는 문제 방지)
  const input = useImeSafeInput(value, onChange);
  return (
    <div
      className="px-5 sticky top-0 z-10 backdrop-blur pb-3 pt-1"
      style={{ backgroundColor: "color-mix(in srgb, var(--book-background, #14161F) 95%, transparent)" }}
    >
      <div className="relative">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4"
          style={{ color: "var(--book-chrome-muted, rgba(255,255,255,0.3))" }}
        />
        <input
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          data-testid="song-search"
          value={input.value}
          {...input.inputProps}
          placeholder="제목, 가수, 장르, 태그 검색"
          className="book-input w-full rounded-xl pl-9 pr-9 py-2.5 text-sm outline-none transition-colors border border-[color:var(--book-chrome-border,rgba(255,255,255,0.1))] focus:border-[color:var(--book-accent,#fbbf24)]"
          style={{
            backgroundColor: "var(--book-chrome-surface, rgba(255,255,255,0.06))",
            color: "var(--book-text, #ffffff)",
          }}
        />
        {input.value && (
          <button
            type="button"
            onClick={input.clear}
            aria-label="검색어 지우기"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[color:var(--book-chrome-muted,rgba(255,255,255,0.3))] hover:text-[color:var(--book-chrome-text,rgba(255,255,255,0.6))]"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {/* 검색 아래 "도구 줄": 필터 칩(왼쪽) + 선택/정렬(오른쪽)을 한 줄로 묶는다 */}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-2">
      <button
        type="button"
        onClick={onToggleFavOnly}
        aria-pressed={favOnly}
        className="text-xs px-3 py-1.5 rounded-full border transition-[filter] duration-150 hover:brightness-110 active:brightness-95"
        style={
          favOnly
            ? {
                backgroundColor: "color-mix(in srgb, var(--book-accent, #fbbf24) 15%, transparent)",
                borderColor: "color-mix(in srgb, var(--book-accent, #fbbf24) 40%, transparent)",
                color: "var(--book-accent, #fbbf24)",
              }
            : {
                backgroundColor: "var(--book-chrome-surface, rgba(255,255,255,0.04))",
                borderColor: "var(--book-chrome-border, rgba(255,255,255,0.1))",
                color: "var(--book-chrome-muted, rgba(255,255,255,0.5))",
              }
        }
      >
        ★ 즐겨찾기만 보기
      </button>
      {actions}
      </div>
    </div>
  );
}
