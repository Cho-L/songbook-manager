/**
 * 신청곡 공통 규칙 (브라우저 · Cloudflare Worker · 테스트가 같이 쓰는 순수 함수들).
 * 실제 권위 있는 검증은 서버(Worker → DB의 submit_song_request)가 하고,
 * 여기 규칙은 (1) 서버 입력 형식 검사, (2) 입력 즉시 보여주는 안내, (3) Supabase 없이 쓰는 로컬 모드에서 같은 동작을 흉내 내는 용도다.
 */
export const NAME_MAX = 30;
export const COOLDOWN_SEC = 20;
export const HOURLY_MAX = 10;
export const DEFAULT_MAX_QUEUE = 30;
export const DEFAULT_PER_USER_MAX = 2;

export type RequestStatus = "pending" | "approved" | "playing" | "done" | "rejected" | "canceled";
export type RequestSource = "web" | "chzzk" | "soop" | "admin";
export const ACTIVE_STATUSES: RequestStatus[] = ["pending", "approved", "playing"];

export interface SongRequest {
  id: string;
  bookId: string;
  songId: string | null;
  title: string;
  artist: string;
  requesterName: string;
  source: RequestSource;
  status: RequestStatus;
  position: number;
  requestedAt: string;
  approvedAt: string | null;
  doneAt: string | null;
}

export interface RequestSettings {
  accepting: boolean;
  maxQueue: number;
  perUserMax: number;
}
export const DEFAULT_REQUEST_SETTINGS: RequestSettings = { accepting: false, maxQueue: DEFAULT_MAX_QUEUE, perUserMax: DEFAULT_PER_USER_MAX };

export interface PublicQueueItem {
  id: string;
  /** 노래책의 곡 id (20261012 마이그레이션 적용 후부터 내려온다. 없으면 제목+가수로 비교) */
  songId?: string | null;
  title: string;
  artist: string;
  requesterName: string;
  status: "approved" | "playing";
}
export interface PublicQueue {
  accepting: boolean;
  pendingCount: number;
  /** 확인 대기 중인 곡 id 목록 (신청자 정보 없음). 20261012 마이그레이션 전에는 비어 있다 */
  pendingSongIds?: string[];
  queue: PublicQueueItem[];
}

/** 서버/로컬이 돌려주는 실패 코드 → 사용자 문구 + HTTP 상태 */
export const SUBMIT_ERRORS: Record<string, { message: string; status: number }> = {
  bad_request: { message: "신청 정보가 올바르지 않아요.", status: 400 },
  bad_name: { message: `신청자 이름은 1~${NAME_MAX}자로 입력해주세요.`, status: 400 },
  closed: { message: "지금은 신청곡을 받지 않아요.", status: 403 },
  song_not_found: { message: "이 노래책에 없는 곡이에요.", status: 404 },
  duplicate_song: { message: "이미 대기열에 있는 곡이에요.", status: 409 },
  user_limit: { message: "한 번에 신청할 수 있는 곡 수를 넘었어요. 곡이 처리된 뒤 다시 신청해주세요.", status: 409 },
  queue_full: { message: "대기열이 가득 찼어요. 잠시 후 다시 시도해주세요.", status: 409 },
  cooldown: { message: `너무 빨라요! ${COOLDOWN_SEC}초 뒤에 다시 신청할 수 있어요.`, status: 429 },
  rate_limited: { message: "신청이 너무 많아요. 잠시 후 다시 시도해주세요.", status: 429 },
  server_error: { message: "신청 서버에 문제가 생겼어요. 잠시 후 다시 시도해주세요.", status: 502 },
  not_configured: { message: "신청 서버가 아직 설정되지 않았어요.", status: 503 },
  forbidden: { message: "허용되지 않은 요청이에요.", status: 403 },
  too_large: { message: "요청이 너무 커요.", status: 413 },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

/** 공백 정리 + 길이/제어문자 검사. 올바르면 정리된 이름, 아니면 null */
export function cleanRequesterName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw.replace(/\s/g, " "))) return null;
  const name = raw.replace(/\s+/g, " ").trim();
  return name.length >= 1 && name.length <= NAME_MAX ? name : null;
}

export interface SubmitInput {
  bookId: string;
  songId: string;
  name: string;
}
export type ParsedSubmit = { ok: true; value: SubmitInput } | { ok: false; code: string } | { ok: "bot" };

/** 요청 본문 검사. `website` 는 사람 눈에는 안 보이는 함정 칸(허니팟)이라 채워져 있으면 봇이다. */
export function parseSubmitBody(body: unknown, opts: { requireUuid: boolean }): ParsedSubmit {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, code: "bad_request" };
  const b = body as Record<string, unknown>;
  if (typeof b.website === "string" && b.website.trim() !== "") return { ok: "bot" };
  const idOk = (v: unknown): v is string => (opts.requireUuid ? isUuid(v) : typeof v === "string" && v.length > 0 && v.length <= 80);
  if (!idOk(b.bookId) || !idOk(b.songId)) return { ok: false, code: "bad_request" };
  const name = cleanRequesterName(b.name);
  if (name === null) return { ok: false, code: "bad_name" };
  return { ok: true, value: { bookId: b.bookId, songId: b.songId, name } };
}

/** 신청자 식별 해시: SHA-256(salt | bookId | ip) → 64자 hex. 원본 IP 는 어디에도 저장하지 않는다. */
export async function makeRequesterKey(ip: string, bookId: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}|${bookId}|${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------- 상태 전이 (관리자 화면)

const TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  pending: ["approved", "rejected"],
  approved: ["playing", "rejected", "pending", "canceled"],
  playing: ["done", "approved", "canceled"],
  done: [],
  rejected: ["pending"],
  canceled: [],
};
export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** 승인 목록을 한 칸 위/아래로 옮긴 새 순서(id 배열). 끝이면 그대로. */
export function moveInOrder(ids: string[], id: string, dir: -1 | 1): string[] {
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return ids;
  const next = [...ids];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

// ---------------------------------------------------------------- 로컬 모드 접수 규칙 (DB RPC 와 같은 순서·같은 코드)

export type ExistingRequest = Pick<SongRequest, "songId" | "status" | "requestedAt" | "position"> & { requesterKey: string };

export function evaluateSubmit(
  existing: ExistingRequest[],
  settings: RequestSettings,
  input: { songId: string; key: string; songExists: boolean },
  now: number
): { ok: true; position: number } | { ok: false; code: string } {
  if (!settings.accepting) return { ok: false, code: "closed" };
  if (!input.songExists) return { ok: false, code: "song_not_found" };
  const mine = existing.filter((r) => r.requesterKey === input.key);
  if (mine.some((r) => now - Date.parse(r.requestedAt) < COOLDOWN_SEC * 1000)) return { ok: false, code: "cooldown" };
  if (mine.filter((r) => now - Date.parse(r.requestedAt) < 3600_000).length >= HOURLY_MAX) return { ok: false, code: "rate_limited" };
  if (existing.some((r) => r.songId === input.songId && ACTIVE_STATUSES.includes(r.status))) return { ok: false, code: "duplicate_song" };
  if (mine.filter((r) => r.status === "pending" || r.status === "approved").length >= settings.perUserMax) return { ok: false, code: "user_limit" };
  if (existing.filter((r) => r.status === "pending" || r.status === "approved").length >= settings.maxQueue) return { ok: false, code: "queue_full" };
  return { ok: true, position: existing.reduce((m, r) => Math.max(m, r.position), 0) + 1 };
}
