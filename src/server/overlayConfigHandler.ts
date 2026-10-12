import { RpcError, json, rpc, type SongRequestEnv } from "./songRequestHandler";
import { isUuid } from "../utils/songRequest";
import { OVERLAY_KINDS } from "../utils/overlayStudio";

/**
 * /api/overlay-config?book=<노래책 id>&kind=song|lyrics|queue  (GET, 로그인 없음)
 * OBS 브라우저 소스가 저장된 Overlay Studio 설정을 읽는 공개 API.
 * 돌려주는 것은 {config, rev} 뿐이다 — 표시 설정(색/크기/표시 여부)만 들어 있고 비밀값은 없다.
 * DB 의 get_public_overlay_config RPC 는 service_role 전용이라 키는 Worker 비밀 환경변수에만 있다.
 */
export async function handleOverlayConfig(request: Request, env: SongRequestEnv, fetchImpl: typeof fetch = fetch): Promise<Response> {
  if (request.method !== "GET") return json(405, { ok: false, error: "허용되지 않는 방식이에요." }, { Allow: "GET" });
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error(JSON.stringify({ evt: "overlay_config_failure", stage: "config", reason: "env_missing" }));
    return json(503, { ok: false, code: "not_configured" });
  }
  const url = new URL(request.url);
  const book = url.searchParams.get("book");
  const kind = url.searchParams.get("kind");
  if (!isUuid(book) || !kind || !(OVERLAY_KINDS as readonly string[]).includes(kind)) return json(400, { ok: false, code: "bad_request" });
  try {
    const data = await rpc(env, fetchImpl, "get_public_overlay_config", { p_book_id: book, p_kind: kind });
    return json(200, data, { "Cache-Control": "public, max-age=5" });
  } catch (e) {
    const reason = e instanceof RpcError ? e.reason : "unexpected";
    console.error(JSON.stringify({ evt: "overlay_config_failure", stage: "get", reason, status: e instanceof RpcError ? e.status : undefined, pg_code: e instanceof RpcError ? e.pgCode : undefined }));
    return json(502, { ok: false, code: "server_error", reason });
  }
}
