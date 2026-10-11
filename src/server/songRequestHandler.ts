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

function json(status: number, payload: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra },
  });
}

function fail(code: string, extra: Record<string, string> = {}): Response {
  const e = SUBMIT_ERRORS[code] ?? SUBMIT_ERRORS.server_error;
  return json(e.status, { ok: false, code, error: e.message }, extra);
}

async function rpc(env: SongRequestEnv, fetchImpl: typeof fetch, name: string, args: Record<string, unknown>): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RPC_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${env.SUPABASE_URL!.replace(/\/+$/, "")}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY!}`,
      },
      body: JSON.stringify(args),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`rpc ${name} failed: ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function handleSongRequests(request: Request, env: SongRequestEnv, fetchImpl: typeof fetch = fetch): Promise<Response> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return fail("not_configured");
  const url = new URL(request.url);

  if (request.method === "GET") {
    const book = url.searchParams.get("book");
    if (!isUuid(book)) return fail("bad_request");
    try {
      const data = await rpc(env, fetchImpl, "get_public_request_queue", { p_book_id: book });
      return json(200, data, { "Cache-Control": "public, max-age=3" });
    } catch {
      return fail("server_error");
    }
  }

  if (request.method !== "POST") return json(405, { ok: false, code: "bad_request", error: "허용되지 않는 방식이에요." }, { Allow: "GET, POST" });

  // 다른 사이트의 페이지가 시청자 브라우저로 몰래 신청을 보내는 것을 막는다 (Origin 이 있으면 이 사이트여야 함)
  const origin = request.headers.get("Origin");
  if (origin) {
    let host = "";
    try {
      host = new URL(origin).host;
    } catch {
      /* 잘못된 Origin */
    }
    if (host !== url.host) return fail("forbidden");
  }
  if (!(request.headers.get("Content-Type") ?? "").toLowerCase().includes("application/json")) return fail("bad_request");

  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return fail("too_large");
  let body: unknown;
  try {
    body = JSON.parse(text);
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
  } catch {
    return fail("server_error");
  }
  if (result?.ok) return json(200, { ok: true, id: result.id, position: result.position });
  const code = typeof result?.code === "string" && SUBMIT_ERRORS[result.code] ? result.code : "server_error";
  return fail(code, code === "cooldown" ? { "Retry-After": "20" } : {});
}
