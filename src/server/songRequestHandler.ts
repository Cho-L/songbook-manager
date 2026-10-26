import { SUBMIT_ERRORS, makeRequesterKey, parseSubmitBody, isUuid } from "../utils/songRequest";

/**
 * /api/song-requests — Cloudflare Worker 에서 호출되는 공개 신청 API.
 *   GET  ?book=<노래책 id>  → 시청자용 공개 큐 (승인/재생 중인 곡, 신청 대기 수, 접수 여부)
 *   POST {bookId, songId, name} → 신청 접수 (로그인 필요 없음)
 *
 * 보안 구조:
 * - 브라우저는 DB 의 신청 테이블/RPC 에 직접 접근할 수 없다 (RLS + RPC 는 service_role 전용).
 * - service_role 키는 이 서버(Worker)의 비밀 환경변수에만 있고 브라우저로 나가지 않는다.
 * - 입력 검증(형식/길이/허니팟/Origin) → 신청자 해시 생성(IP 원본은 저장하지 않음) → DB RPC 가
 *   노래책 소속 확인, 중복/도배/한도 검사를 한 트랜잭션으로 수행한다.
 */
export interface SongRequestEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  /** 신청자 해시용 비밀 salt. 없으면 service role 키로 대신한다 */
  REQUEST_HASH_SALT?: string;
}

const MAX_BODY_BYTES = 2048;
const RPC_TIMEOUT_MS = 8000;

/** Content-Length 대신 실제 바이트를 센다. 최대 2KB만 보관하고 초과하면 남은 스트림을 취소한다. */
async function readSubmitBody(request: Request): Promise<{ text: string } | { code: "too_large" | "bad_request" }> {
  if (!request.body) return { text: "" };
  const reader = request.body.getReader();
  const bytes = new Uint8Array(MAX_BODY_BYTES);
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return { text: new TextDecoder().decode(bytes.subarray(0, size)) };
      if (value.byteLength > MAX_BODY_BYTES - size) {
        // 취소 완료를 기다리지 않는다: 느리거나 고장 난 송신자가 오류 응답을 지연시키지 못하게 한다.
        void reader.cancel().catch(() => {});
        return { code: "too_large" };
      }
      bytes.set(value, size);
      size += value.byteLength;
    }
  } catch {
    return { code: "bad_request" }; // 전송 중단/스트림 오류도 기존 입력 오류 형식으로 응답한다.
  } finally {
    reader.releaseLock();
  }
}

export function json(status: number, payload: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra },
  });
}

function fail(code: string, extra: Record<string, string> = {}, reason?: string): Response {
  const e = SUBMIT_ERRORS[code] ?? SUBMIT_ERRORS.server_error;
  // reason 은 "어느 단계에서 왜 실패했는지"만 나타내는 고정 분류 문자열이다 (키·URL·내부 메시지는 절대 담지 않는다).
  return json(e.status, reason ? { ok: false, code, error: e.message, reason } : { ok: false, code, error: e.message }, extra);
}

/** DB(RPC) 호출 실패를 분류해서 담는 오류. 응답/로그에는 reason·status·pgCode 만 쓴다. */
export class RpcError extends Error {
  reason: string;
  status?: number;
  pgCode?: string;
  constructor(reason: string, status?: number, pgCode?: string) {
    super(reason);
    this.reason = reason;
    this.status = status;
    this.pgCode = pgCode;
  }
}

/** 로그용 문자열 정리: 길이 제한 + 토큰처럼 보이는 긴 문자열 가림 */
function safeText(v: unknown, max = 160): string {
  if (typeof v !== "string") return "";
  return v
    .replace(/eyJ[\w-]{10,}(\.[\w-]+){0,2}/g, "[jwt]")
    .replace(/\b(sb_|sbp_|sk-)[\w-]{8,}/gi, "[key]")
    .replace(/[\w-]{32,}/g, "[long]")
    .slice(0, max);
}

/** 서버 로그 한 줄 (Cloudflare Workers Logs / wrangler tail 에서 보인다). 비밀값·IP·요청 본문은 남기지 않는다. */
function logFailure(stage: string, err: unknown, extra: Record<string, unknown> = {}) {
  const e = err instanceof RpcError ? err : null;
  console.error(
    JSON.stringify({
      evt: "song_request_failure",
      stage,
      reason: e?.reason ?? "unexpected",
      status: e?.status,
      pg_code: e?.pgCode,
      err_name: !e && err instanceof Error ? err.name : undefined,
      ...extra,
    })
  );
}

export async function rpc(env: SongRequestEnv, fetchImpl: typeof fetch, name: string, args: Record<string, unknown>): Promise<unknown> {
  let endpoint: string;
  try {
    endpoint = `${new URL(env.SUPABASE_URL!.trim()).origin}/rest/v1/rpc/${name}`;
  } catch {
    throw new RpcError("config_url_invalid");
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RPC_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: env.SUPABASE_SERVICE_ROLE_KEY!,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY!}`,
        },
        body: JSON.stringify(args),
        signal: ctrl.signal,
      });
    } catch (e) {
      throw new RpcError(e instanceof Error && e.name === "AbortError" ? "rpc_timeout" : "rpc_network");
    }
    if (!res.ok) {
      // PostgREST 오류 본문({code,message,hint})에서 코드만 읽어 원인을 분류한다.
      const pg = await res
        .json()
        .then((j) => (j && typeof j === "object" ? (j as { code?: unknown }) : null))
        .catch(() => null); // JSON 이 아닌 응답 (예: 잘못된 URL 이 HTML 을 돌려줌)
      const pgCode = typeof pg?.code === "string" ? safeText(pg.code, 12) : undefined;
      let reason = "rpc_http_error";
      if (!pg) reason = res.status === 404 ? "rpc_not_json_404_wrong_url" : "rpc_not_json";
      else if (pgCode === "PGRST202" || (res.status === 404 && pgCode?.startsWith("PGRST"))) reason = "rpc_function_missing_or_not_in_schema_cache";
      else if (pgCode === "42501") reason = "rpc_permission_denied";
      else if (res.status === 401 || res.status === 403) reason = "rpc_auth_rejected";
      else if (pgCode === "42883" || pgCode === "42703" || pgCode === "42P01") reason = "rpc_schema_mismatch";
      else if (res.status >= 500) reason = "rpc_db_error";
      throw new RpcError(reason, res.status, pgCode);
    }
    try {
      return await res.json();
    } catch {
      throw new RpcError("rpc_bad_json", res.status);
    }
  } finally {
    clearTimeout(timer);
  }
}

export async function handleSongRequests(request: Request, env: SongRequestEnv, fetchImpl: typeof fetch = fetch): Promise<Response> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    // 어떤 변수가 비었는지만 기록 (값은 기록하지 않음)
    console.error(JSON.stringify({ evt: "song_request_failure", stage: "config", reason: "env_missing", missing: [!env.SUPABASE_URL && "SUPABASE_URL", !env.SUPABASE_SERVICE_ROLE_KEY && "SUPABASE_SERVICE_ROLE_KEY"].filter(Boolean) }));
    return fail("not_configured");
  }
  const url = new URL(request.url);

  if (request.method === "GET") {
    const book = url.searchParams.get("book");
    if (!isUuid(book)) return fail("bad_request");
    try {
      const data = await rpc(env, fetchImpl, "get_public_request_queue", { p_book_id: book });
      return json(200, data, { "Cache-Control": "public, max-age=3" });
    } catch (e) {
      logFailure("get_queue", e);
      return fail("server_error", {}, e instanceof RpcError ? e.reason : "unexpected");
    }
  }

  if (request.method !== "POST") return json(405, { ok: false, code: "bad_request", error: "허용되지 않는 방식이에요." }, { Allow: "GET, POST" });

  // 다른 사이트의 페이지가 시청자 브라우저로 몰래 신청을 보내는 것을 막는다 (Origin 이 있으면 이 사이트여야 함)
  const origin = request.headers.get("Origin");
  if (origin) {
    let requestOrigin = "";
    try {
      requestOrigin = new URL(origin).origin;
    } catch {
      /* 잘못된 Origin */
    }
    if (requestOrigin !== url.origin) return fail("forbidden");
  }
  if (!(request.headers.get("Content-Type") ?? "").toLowerCase().includes("application/json")) return fail("bad_request");

  const input = await readSubmitBody(request);
  if ("code" in input) return fail(input.code);
  let body: unknown;
  try {
    body = JSON.parse(input.text);
  } catch {
    return fail("bad_request");
  }

  const parsed = parseSubmitBody(body, { requireUuid: true });
  if (parsed.ok === "bot") return json(200, { ok: true }); // 봇에게는 성공한 것처럼 보이게 하고 아무것도 저장하지 않는다
  if (!parsed.ok) return fail(parsed.code);

  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const salt = env.REQUEST_HASH_SALT || env.SUPABASE_SERVICE_ROLE_KEY;
  const key = await makeRequesterKey(ip, parsed.value.bookId, salt);

  let result: { ok?: boolean; code?: string; id?: string; position?: number };
  try {
    result = (await rpc(env, fetchImpl, "submit_song_request", {
      p_book_id: parsed.value.bookId,
      p_song_id: parsed.value.songId,
      p_name: parsed.value.name,
      p_key: key,
    })) as typeof result;
  } catch (e) {
    logFailure("submit", e);
    return fail("server_error", {}, e instanceof RpcError ? e.reason : "unexpected");
  }
  if (result?.ok) return json(200, { ok: true, id: result.id, position: result.position });
  const code = typeof result?.code === "string" && SUBMIT_ERRORS[result.code] ? result.code : "server_error";
  if (code === "server_error") logFailure("submit", new RpcError("rpc_unexpected_result"), { result_code: safeText(result?.code, 40) });
  return fail(code, code === "cooldown" ? { "Retry-After": "20" } : {});
}
