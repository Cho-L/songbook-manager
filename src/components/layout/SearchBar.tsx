import { useEffect, useRef, useState, type ReactNode } from "react";
import { Search, X } from "lucide-react";

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
  // URL 쿼리를 매 글자마다 갱신하는 부모와 분리해 입력 중인 값을 보존한다.
  // 한글/일본어 IME 조합 중에는 부모 검색을 갱신하지 않고, 조합 완료 시 최종 문자열을 한 번 전달한다.
  const [draft, setDraft] = useState(value);
  const composing = useRef(false);

  useEffect(() => {
    if (!composing.current) setDraft(value);
  }, [value]);

  function handleChange(next: string) {
    setDraft(next);
    if (!composing.current) onChange(next);
  }

  function handleCompositionEnd(next: string) {
    composing.current = false;
    setDraft(next);
    onChange(next);
  }

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
          value={draft}
          onChange={(e) => handleChange(e.target.value)}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={(e) => handleCompositionEnd(e.currentTarget.value)}
          placeholder="제목, 가수, 장르, 태그 검색"
          className="book-input w-full rounded-xl pl-9 pr-9 py-2.5 text-sm outline-none transition-colors border border-[color:var(--book-chrome-border,rgba(255,255,255,0.1))] focus:border-[color:var(--book-accent,#fbbf24)]"
          style={{
            backgroundColor: "var(--book-chrome-surface, rgba(255,255,255,0.06))",
            color: "var(--book-text, #ffffff)",
          }}
        />
        {draft && (
          <button
            type="button"
            onClick={() => {
              setDraft("");
              onChange("");
            }}
            aria-label="검색어 지우기"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[color:var(--book-chrome-muted,rgba(255,255,255,0.3))] hover:text-[color:var(--book-chrome-text,rgba(255,255,255,0.6))]"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {/* 검색 아래 도구 줄: 필터 칩 + 선택/정렬 도구 */}
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
