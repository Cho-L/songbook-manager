import type { LyricsRequestDiagnostic } from "../../lyrics/types";

/** Explicit opt-in: ephemeral query metadata only, never localStorage/console/server logs. */
export function LyricsSearchDiagnostics({ enabled, requests, onToggle }: {
  enabled: boolean; requests: LyricsRequestDiagnostic[]; onToggle: (enabled: boolean) => void;
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
        {requests.map((request, i) => <li key={i}>
          {request.endpoint} · {request.query ? `q=${request.query}` : `${request.title ?? ""} / ${request.artist ?? ""}`} · {request.httpStatus !== undefined ? `HTTP ${request.httpStatus}` : "HTTP 응답 없음"}
          {` · ${request.outcome}${request.errorKind ? ` (${request.errorKind})` : ""}${request.records !== undefined ? ` · 후보 ${request.records}개` : ""}${request.cached ? " · 공유/캐시" : ""}`}
        </li>)}
      </ol>}
      {enabled && requests.some((r) => r.errorKind === "network") && <p>브라우저에서 응답을 읽지 못했어요. CORS·DNS·프록시 등 원인은 개발자 도구 Network/Console에서 확인하세요.</p>}
    </details>
  );
}
