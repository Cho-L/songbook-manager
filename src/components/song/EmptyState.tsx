import { Music2, Plus } from "lucide-react";

interface EmptyStateProps {
  query?: string;
  /** 소유자가 자신의 완전히 빈 노래책을 보는 경우에만 전달 — 등록 버튼을 함께 보여준다. */
  onAddClick?: () => void;
}

export function EmptyState({ query, onAddClick }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center px-6">
      <Music2 className="h-9 w-9 text-white/20 mb-3" strokeWidth={1.5} />
      {query ? (
        <>
          <p className="text-[15px] text-white/70">
            "{query}"에 맞는 곡을 찾지 못했어요
          </p>
          <p className="text-[13px] text-white/35 mt-1">
            제목, 가수, 장르, 태그로 검색해보세요
          </p>
        </>
      ) : (
        <>
          <p className="text-[15px] text-white/70">아직 등록된 노래가 없어요</p>
          <p className="text-[13px] text-white/35 mt-1">
            {onAddClick ? "첫 번째 노래를 등록해보세요" : "곧 노래가 채워질 거예요"}
          </p>
          {onAddClick && (
            <button
              type="button"
              onClick={onAddClick}
              className="mt-4 flex items-center gap-1.5 rounded-full bg-amber-400 text-[#14161F] text-[13px] font-medium px-4 py-2"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.5} /> 첫 번째 노래 등록하기
            </button>
          )}
        </>
      )}
    </div>
  );
}
