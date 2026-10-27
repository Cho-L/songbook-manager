import type { LyricsRequestDiagnostic, LyricsSearchStopReason } from "../../lyrics/types";

const STOP_LABELS: Record<LyricsSearchStopReason, string> = {
  matched: "안전한 자동 적용 후보를 찾았어요",
  completed: "계획한 검색을 마쳤어요",
  "rate-limit": "429 요청 제한으로 중단했어요. 잠시 후 다시 시도해 주세요",
  "retry-after": "제공자가 재요청 대기를 요청해 추가 검색을 중단했어요",
  "server-error-limit": "서버 오류가 반복돼 추가 요청을 중단했어요",
  "server-recovery-limit": "일시적 서버 오류 후 다른 조합 2개까지 확인하고 중단했어요",
  network: "네트워크 응답을 읽지 못해 중단했어요",
  invalid: "응답 형식 오류로 중단했어요",
  unauthorized: "접근 거부로 중단했어요",
  "service-error": "서비스 오류로 중단했어요",
  "request-limit": "총 14회 요청 상한으로 남은 검색을 생략했어요",
  aborted: "검색을 취소했어요",
};

/** Explicit opt-in: ephemeral query metadata only, never localStorage/console/server logs. */
export function LyricsSearchDiagnostics({ enabled, requests, stopReason, onToggle }: {
  enabled: boolean; requests: LyricsRequestDiagnostic[]; stopReason?: LyricsSearchStopReason; onToggle: (enabled: boolean) => void;
}) {
  return (
    <details className="mt-2 text-[12px] opacity-75" data-testid="lyrics-search-diagnostics">
      <summary className="cursor-pointer">가사 검색 진단 (개발자용)</summary>
      <label className="flex items-center gap-2 min-h-[36px]">
        <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
        이 화면에서 요청 정보 수집
      </label>
      <p>켜고 다시 찾기 또는 후보 조회를 실행하세요. 최근 검색의 최대 14개 요청만 메모리에 보관하며, 끄거나 곡을 바꾸면 지워요. 가사·계정·키·쿠키는 수집하지 않아요.</p>
      {enabled && requests.length === 0 && <p>아직 수집된 요청이 없어요.</p>}
      {enabled && <ol className="mt-1 space-y-1 break-words">
        {requests.map((request, i) => {
          const source = request.source ?? (request.cached ? "cache" : "network");
          return <li key={i}>
            {source === "network" ? "실제 네트워크 요청" : source === "cache" ? "캐시 결과 (이번 네트워크 요청 아님)" : "진행 중 요청 공유 (별도 네트워크 요청 없음)"}
            {` · ${request.endpoint} · `}{request.query ? `q=${request.query}` : `${request.title ?? ""} / ${request.artist ?? ""}`} · {request.httpStatus !== undefined ? `${source === "cache" ? "저장된 " : ""}HTTP ${request.httpStatus}` : "HTTP 응답 없음"}
            {` · ${request.outcome}${request.errorKind ? ` (${request.errorKind})` : ""}${request.records !== undefined ? ` · 후보 ${request.records}개` : ""}`}
          </li>;
        })}
      </ol>}
      {enabled && stopReason && <p data-testid="lyrics-search-stop">검색 종료: {STOP_LABELS[stopReason]}</p>}
      {enabled && requests.some((r) => r.errorKind === "network") && <p>브라우저에서 응답을 읽지 못했어요. CORS·DNS·프록시 등 원인은 개발자 도구 Network/Console에서 확인하세요.</p>}
    </details>
  );
}
