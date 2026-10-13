/**
 * 외부 가사/메타데이터 서비스 오류 분류.
 * 화면에는 "왜 안 됐는지"를 알려 주고(네트워크 / 잠시 후 재시도 / 서버 문제 …), 캐시에는 일시적 오류를 남기지 않는다.
 */
export type LyricsErrorKind =
  | "network" //    인터넷/서비스 연결 실패 (CORS·DNS·오프라인 포함)
  | "rate-limit" // 429 — 요청이 너무 많음
  | "server" //     5xx — 서비스 쪽 문제
  | "client" //     그 밖의 4xx — 요청 형식 문제
  | "invalid" //    응답이 예상한 형식이 아님
  | "budget"; //    이 곡에서 쓸 수 있는 검색 횟수를 다 씀

export class LyricsApiError extends Error {
  readonly kind: LyricsErrorKind;
  readonly status?: number;
  constructor(kind: LyricsErrorKind, message: string, status?: number) {
    super(message);
    this.name = "LyricsApiError";
    this.kind = kind;
    this.status = status;
  }
}

export function classifyHttpStatus(service: string, status: number): LyricsApiError {
  if (status === 429) return new LyricsApiError("rate-limit", `${service} 429`, status);
  if (status >= 500) return new LyricsApiError("server", `${service} ${status}`, status);
  return new LyricsApiError("client", `${service} ${status}`, status);
}

export function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

/** 알 수 없는 예외(fetch 의 TypeError 등)를 분류한다 */
export function toLyricsError(e: unknown, service = "가사 서비스"): LyricsApiError {
  if (e instanceof LyricsApiError) return e;
  if (e instanceof SyntaxError) return new LyricsApiError("invalid", `${service} 응답 형식 오류`);
  return new LyricsApiError("network", `${service} 연결 실패`);
}

/** 사용자에게 보여 줄 문장 */
export function describeLyricsError(e: unknown): string {
  const err = toLyricsError(e);
  switch (err.kind) {
    case "rate-limit":
      return "가사 서비스가 요청 제한을 걸었어요. 1~2분 뒤에 다시 시도해 주세요";
    case "server":
      return "가사 서비스에 일시적인 문제가 있어요. 잠시 후 다시 시도해 주세요";
    case "client":
      return "가사 서비스가 요청을 받아들이지 않았어요";
    case "invalid":
      return "가사 서비스의 응답을 읽지 못했어요";
    case "budget":
      return "이 곡에서 쓸 수 있는 검색 횟수를 다 썼어요";
    default:
      return "가사 서비스에 연결하지 못했어요 (인터넷 연결이나 차단 설정을 확인해 주세요)";
  }
}
