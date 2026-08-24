import { Music2 } from "lucide-react";

interface EmptyStateProps {
  query?: string;
}

export function EmptyState({ query }: EmptyStateProps) {
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
          <p className="text-[15px] text-white/70">아직 등록된 곡이 없어요</p>
          <p className="text-[13px] text-white/35 mt-1">
            오른쪽 아래 + 버튼으로 첫 곡을 추가해보세요
          </p>
        </>
      )}
    </div>
  );
}
