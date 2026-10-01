import type { ReactNode } from "react";
import { Music2, Plus, Search } from "lucide-react";

const CHROME_MUTED = "var(--book-chrome-muted, rgba(255,255,255,0.45))";
const CHROME_TEXT = "var(--book-chrome-text, rgba(255,255,255,0.8))";
const CHROME_SURFACE = "var(--book-chrome-surface, rgba(255,255,255,0.05))";

interface EmptyNoticeProps {
  icon: ReactNode;
  title: string;
  description?: string;
  /** 다음에 할 수 있는 행동 (버튼 등) */
  action?: ReactNode;
  /** 화면 크기에 맞춘 상하 여백 조절용 */
  className?: string;
}

/**
 * 빈 상태 공통 뼈대: 아이콘 → 제목 → 설명 → 행동.
 * 색은 --book-chrome-* 변수를 따라가므로 노래책 테마(밝음/어두움)에 자동으로 맞고,
 * 변수가 없는 화면(노래책 선택)에서는 기본 흰색 계열로 폴백한다.
 */
export function EmptyNotice({ icon, title, description, action, className = "py-16" }: EmptyNoticeProps) {
  return (
    <div className={`flex flex-col items-center justify-center text-center px-6 ${className}`}>
      <span
        className="h-12 w-12 rounded-full flex items-center justify-center mb-4"
        style={{ backgroundColor: CHROME_SURFACE, color: CHROME_MUTED }}
        aria-hidden="true"
      >
        {icon}
      </span>
      <p className="text-[15px] font-medium" style={{ color: CHROME_TEXT }}>
        {title}
      </p>
      {description && (
        <p className="text-[13px] mt-1.5 max-w-xs leading-relaxed" style={{ color: CHROME_MUTED }}>
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** 빈 상태 안의 보조 액션 버튼 (accent를 쓰지 않는 조용한 스타일) */
export function EmptyActionButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border text-[13px] px-4 py-2 transition-[filter] duration-150 hover:brightness-125 active:brightness-95"
      style={{
        backgroundColor: CHROME_SURFACE,
        borderColor: "var(--book-chrome-border, rgba(255,255,255,0.12))",
        color: CHROME_TEXT,
      }}
    >
      {children}
    </button>
  );
}

interface EmptyStateProps {
  query?: string;
  /** 소유자가 자신의 완전히 빈 노래책을 보는 경우에만 전달 — 등록 버튼을 함께 보여준다. */
  onAddClick?: () => void;
  /** 검색/필터 결과가 없을 때 조건을 초기화하는 행동 */
  onClearFilters?: () => void;
}

export function EmptyState({ query, onAddClick, onClearFilters }: EmptyStateProps) {
  if (query !== undefined && query !== "") {
    return (
      <EmptyNotice
        className="py-20"
        icon={<Search className="h-5 w-5" strokeWidth={1.5} />}
        title={`"${query}"에 맞는 곡을 찾지 못했어요`}
        description="제목, 가수, 장르, 태그로 검색해보세요"
        action={onClearFilters && <EmptyActionButton onClick={onClearFilters}>검색 초기화</EmptyActionButton>}
      />
    );
  }
  return (
    <EmptyNotice
      className="py-20"
      icon={<Music2 className="h-5 w-5" strokeWidth={1.5} />}
      title="아직 등록된 노래가 없어요"
      description={onAddClick ? "첫 번째 노래를 등록하면 이곳에 모여요" : "곧 노래가 채워질 거예요"}
      action={
        onAddClick && (
          <button
            type="button"
            onClick={onAddClick}
            className="flex items-center gap-1.5 rounded-full text-[13px] font-medium px-4 py-2 transition-[filter] duration-150 hover:brightness-110 active:brightness-95"
            style={{ backgroundColor: "var(--book-accent, #fbbf24)", color: "#14161F" }}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} /> 첫 번째 노래 등록하기
          </button>
        )
      }
    />
  );
}
