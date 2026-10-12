import { supabase, isSupabaseConfigured } from "./supabaseClient";
import { LocalSongRepository } from "./songRepository";
import {
  DEFAULT_REQUEST_SETTINGS,
  SUBMIT_ERRORS,
  cleanRequesterName,
  evaluateSubmit,
  parseSubmitBody,
  type ExistingRequest,
  type PublicQueue,
  type RequestSettings,
  type RequestSource,
  type RequestStatus,
  type SongRequest,
  type SubmitInput,
  canTransition,
} from "../utils/songRequest";

/**
 * 신청곡 데이터 접근.
 * - 시청자(공개): 서버 API(/api/song-requests, Cloudflare Worker)로만 신청/조회한다. DB 에 직접 쓰지 않는다.
 * - 관리자: 로그인한 Supabase 세션 + RLS 로 자기 노래책의 신청곡을 읽고/수정한다. (Supabase 가 없으면 이 브라우저 localStorage — 개발/데모용)
 */
export type SubmitResult = { ok: true; id?: string; position?: number } | { ok: false; code: string; message: string };

export interface PublicRequestClient {
  getQueue(bookId: string): Promise<PublicQueue>;
  submit(input: SubmitInput): Promise<SubmitResult>;
}

export class RequestConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestConflictError";
  }
}
export class RequestSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestSetupError";
  }
}

export interface AdminRequestRepository {
  list(bookId: string): Promise<SongRequest[]>;
  get(id: string): Promise<SongRequest | null>;
  getSettings(bookId: string): Promise<RequestSettings>;
  saveSettings(bookId: string, settings: RequestSettings): Promise<void>;
  setStatus(id: string, status: RequestStatus): Promise<void>;
  /** 이 곡을 "재생 중"으로 만든다. 이미 재생 중이던 신청곡은 완료 처리한다. */
  startPlaying(bookId: string, id: string): Promise<void>;
  /** 주어진 순서대로 position 을 1..n 으로 다시 매긴다 */
  reorder(orderedIds: string[]): Promise<void>;
  /** 건너뛰기: 승인된 곡/재생 중인 곡을 대기열 맨 뒤로 보낸다 (재생 중이면 다시 "대기"로 돌아감) */
  skip(bookId: string, id: string): Promise<void>;
  /** 처리가 끝난(완료/거절) 기록 삭제 */
  clearFinished(bookId: string): Promise<void>;
}

// ================================================================ 공개 클라이언트

class HttpPublicClient implements PublicRequestClient {
  async getQueue(bookId: string): Promise<PublicQueue> {
    const res = await fetch(`/api/song-requests?book=${encodeURIComponent(bookId)}`);
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || typeof data !== "object") throw new Error("신청 현황을 불러오지 못했어요.");
    const d = data as Partial<PublicQueue>;
    return {
      accepting: Boolean(d.accepting),
      pendingCount: Number(d.pendingCount) || 0,
      pendingSongIds: Array.isArray(d.pendingSongIds) ? d.pendingSongIds.filter((x): x is string => typeof x === "string") : [],
      queue: Array.isArray(d.queue) ? d.queue : [],
    };
  }

  async submit(input: SubmitInput & { website?: string }): Promise<SubmitResult> {
    let res: Response;
    try {
      res = await fetch("/api/song-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId: input.bookId, songId: input.songId, name: input.name, website: input.website ?? "" }),
      });
    } catch {
      return { ok: false, code: "server_error", message: "신청 서버에 연결하지 못했어요. 인터넷 연결을 확인해주세요." };
    }
    const data = (await res.json().catch(() => null)) as { ok?: boolean; id?: string; position?: number; code?: string } | null;
    if (res.ok && data?.ok) return { ok: true, id: data.id, position: data.position };
    if (!data) return { ok: false, code: "not_configured", message: "이 사이트에서는 아직 신청곡 서버가 켜져 있지 않아요." };
    const code = data.code && SUBMIT_ERRORS[data.code] ? data.code : "server_error";
    return { ok: false, code, message: SUBMIT_ERRORS[code].message };
  }
}

// ================================================================ 로컬(개발/데모) 구현 — 서버가 없으므로 같은 규칙을 이 브라우저 안에서 흉내 낸다

interface LocalRow extends SongRequest {
  requesterKey: string;
}
const LOCAL_REQ = (b: string) => `songbook:song-requests:${b}`;
const LOCAL_SET = (b: string) => `songbook:song-request-settings:${b}`;
const LOCAL_KEY = "songbook:local-requester-key";

function readRows(bookId: string): LocalRow[] {
  try {
    const arr: unknown = JSON.parse(localStorage.getItem(LOCAL_REQ(bookId)) ?? "[]");
    return Array.isArray(arr) ? (arr as LocalRow[]) : [];
  } catch {
    return [];
  }
}
function writeRows(bookId: string, rows: LocalRow[]): void {
  localStorage.setItem(LOCAL_REQ(bookId), JSON.stringify(rows));
}
function readLocalSettings(bookId: string): RequestSettings {
  try {
    const s = JSON.parse(localStorage.getItem(LOCAL_SET(bookId)) ?? "null") as Partial<RequestSettings> | null;
    return normalizeSettings(s);
  } catch {
    return DEFAULT_REQUEST_SETTINGS;
  }
}
export function normalizeSettings(s: Partial<RequestSettings> | null | undefined): RequestSettings {
  const clamp = (n: unknown, min: number, max: number, d: number) => (typeof n === "number" && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : d);
  return {
    accepting: s?.accepting === true,
    maxQueue: clamp(s?.maxQueue, 1, 200, DEFAULT_REQUEST_SETTINGS.maxQueue),
    perUserMax: clamp(s?.perUserMax, 1, 10, DEFAULT_REQUEST_SETTINGS.perUserMax),
  };
}
function localKey(): string {
  try {
    let k = localStorage.getItem(LOCAL_KEY);
    if (!k || !/^[0-9a-f]{64}$/.test(k)) {
      k = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
      localStorage.setItem(LOCAL_KEY, k);
    }
    return k;
  } catch {
    return "0".repeat(64);
  }
}
function newId(): string {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `r-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function stripKey(r: LocalRow): SongRequest {
  const { requesterKey: _k, ...rest } = r;
  void _k;
  return rest;
}

class LocalPublicClient implements PublicRequestClient {
  async getQueue(bookId: string): Promise<PublicQueue> {
    const rows = readRows(bookId);
    const queue = rows
      .filter((r) => r.status === "approved" || r.status === "playing")
      .sort((a, b) => Number(b.status === "playing") - Number(a.status === "playing") || a.position - b.position)
      .map((r) => ({ id: r.id, songId: r.songId, title: r.title, artist: r.artist, requesterName: r.requesterName, status: r.status as "approved" | "playing" }));
    const pend = rows.filter((r) => r.status === "pending");
    return { accepting: readLocalSettings(bookId).accepting, pendingCount: pend.length, pendingSongIds: pend.map((r) => r.songId).filter((x): x is string => !!x), queue };
  }

  async submit(input: SubmitInput & { website?: string }): Promise<SubmitResult> {
    const parsed = parseSubmitBody({ ...input }, { requireUuid: false });
    if (parsed.ok === "bot") return { ok: true };
    if (!parsed.ok) return { ok: false, code: parsed.code, message: SUBMIT_ERRORS[parsed.code].message };
    const { bookId, songId } = parsed.value;
    const name = cleanRequesterName(parsed.value.name)!;
    const songs = await new LocalSongRepository().getByOwner(bookId);
    const song = songs.find((s) => s.id === songId);
    const rows = readRows(bookId);
    const verdict = evaluateSubmit(rows as ExistingRequest[], readLocalSettings(bookId), { songId, key: localKey(), songExists: Boolean(song) }, Date.now());
    if (!verdict.ok) return { ok: false, code: verdict.code, message: SUBMIT_ERRORS[verdict.code].message };
    const row: LocalRow = {
      id: newId(), bookId, songId, title: song!.title, artist: song!.artist ?? "", requesterName: name, requesterKey: localKey(),
      source: "web", status: "pending", position: verdict.position, requestedAt: new Date().toISOString(), approvedAt: null, doneAt: null,
    };
    writeRows(bookId, [...rows, row]);
    return { ok: true, id: row.id, position: row.position };
  }
}

class LocalAdminRepository implements AdminRequestRepository {
  private findBook(id: string): string | null {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) ?? "";
      if (k.startsWith("songbook:song-requests:") && readRows(k.slice("songbook:song-requests:".length)).some((r) => r.id === id)) return k.slice("songbook:song-requests:".length);
    }
    return null;
  }
  async list(bookId: string) {
    return readRows(bookId).map(stripKey);
  }
  async get(id: string) {
    const b = this.findBook(id);
    const r = b ? readRows(b).find((x) => x.id === id) : undefined;
    return r ? stripKey(r) : null;
  }
  async getSettings(bookId: string) {
    return readLocalSettings(bookId);
  }
  async saveSettings(bookId: string, s: RequestSettings) {
    localStorage.setItem(LOCAL_SET(bookId), JSON.stringify(normalizeSettings(s)));
  }
  private patch(id: string, fn: (r: LocalRow, rows: LocalRow[]) => void) {
    const b = this.findBook(id);
    if (!b) return;
    const rows = readRows(b);
    const r = rows.find((x) => x.id === id);
    if (r) fn(r, rows);
    writeRows(b, rows);
  }
  async setStatus(id: string, status: RequestStatus) {
    this.patch(id, (r, rows) => {
      // 이미 다른 화면에서 처리된 신청을 오래된 화면이 다시 바꾸지 못하게 한다 (승인 중복 방지)
      if (r.status === status) return;
      if (!canTransition(r.status, status)) throw new RequestConflictError("이미 다른 화면에서 처리된 신청이에요. 목록을 새로 고쳤어요.");
      if (["pending", "approved", "playing"].includes(status) && rows.some((x) => x.id !== id && x.songId && x.songId === r.songId && ["pending", "approved", "playing"].includes(x.status))) {
        throw new RequestConflictError("같은 곡이 이미 대기열에 있어서 되돌릴 수 없어요.");
      }
      r.status = status;
      const now = new Date().toISOString();
      if ((status === "approved" || status === "playing") && !r.approvedAt) r.approvedAt = now;
      if (status === "done" || status === "rejected" || status === "canceled") r.doneAt = now;
    });
  }
  async skip(bookId: string, id: string) {
    const rows = readRows(bookId);
    const t = rows.find((r) => r.id === id);
    if (!t || (t.status !== "approved" && t.status !== "playing")) throw new RequestConflictError("이미 다른 화면에서 처리된 신청이에요. 목록을 새로 고쳤어요.");
    t.status = "approved";
    t.position = Math.max(0, ...rows.map((r) => r.position)) + 1;
    writeRows(bookId, rows);
  }
  async startPlaying(bookId: string, id: string) {
    const rows = readRows(bookId);
    const target = rows.find((r) => r.id === id);
    if (!target || (target.status !== "approved" && target.status !== "playing")) throw new RequestConflictError("이미 다른 화면에서 처리된 신청이에요. 목록을 새로 고쳤어요.");
    const now = new Date().toISOString();
    for (const r of rows) if (r.status === "playing" && r.id !== id) { r.status = "done"; r.doneAt = now; }
    const t = rows.find((r) => r.id === id);
    if (t) { t.status = "playing"; t.approvedAt = t.approvedAt ?? now; }
    writeRows(bookId, rows);
  }
  async reorder(orderedIds: string[]) {
    const b = orderedIds[0] ? this.findBook(orderedIds[0]) : null;
    if (!b) return;
    const rows = readRows(b);
    orderedIds.forEach((id, i) => { const r = rows.find((x) => x.id === id); if (r) r.position = i + 1; });
    writeRows(b, rows);
  }
  async clearFinished(bookId: string) {
    writeRows(bookId, readRows(bookId).filter((r) => r.status !== "done" && r.status !== "rejected" && r.status !== "canceled"));
  }
}

// ================================================================ Supabase 관리자 구현 (RLS: 소유자/super_admin 만)

interface ReqRow {
  id: string; book_id: string; song_id: string | null; title: string; artist: string; requester_name: string;
  source: RequestSource; status: RequestStatus; position: number; requested_at: string; approved_at: string | null; done_at: string | null;
}
const COLS = "id,book_id,song_id,title,artist,requester_name,source,status,position,requested_at,approved_at,done_at";
function rowToRequest(r: ReqRow): SongRequest {
  return {
    id: r.id, bookId: r.book_id, songId: r.song_id, title: r.title, artist: r.artist ?? "", requesterName: r.requester_name,
    source: r.source, status: r.status, position: r.position, requestedAt: r.requested_at, approvedAt: r.approved_at, doneAt: r.done_at,
  };
}
function setupError(e: { code?: string; message?: string }): Error {
  const msg = (e.message ?? "").toLowerCase();
  if (e.code === "42P01" || e.code === "PGRST205" || msg.includes("does not exist") || msg.includes("schema cache")) {
    return new RequestSetupError("신청곡 테이블이 아직 만들어지지 않았어요. docs/song-requests-deploy.md 의 SQL 을 먼저 적용해주세요.");
  }
  if (e.code === "23505") return new RequestConflictError("같은 곡이 이미 대기열에 있어서 처리할 수 없어요.");
  return new Error(e.message || "신청곡 처리 중 오류가 났어요.");
}

const CONFLICT_MSG = "이미 다른 화면에서 처리된 신청이에요. 목록을 새로 고쳤어요.";
const STATUS_ORDER: Record<RequestStatus, true> = { pending: true, approved: true, playing: true, done: true, rejected: true, canceled: true };

class SupabaseAdminRepository implements AdminRequestRepository {
  private db() {
    if (!supabase) throw new Error("Supabase 가 설정되지 않았어요.");
    return supabase;
  }
  async list(bookId: string) {
    const { data, error } = await this.db().from("song_requests").select(COLS).eq("book_id", bookId).order("position", { ascending: true }).order("requested_at", { ascending: true }).limit(500);
    if (error) throw setupError(error);
    return (data as ReqRow[]).map(rowToRequest);
  }
  async get(id: string) {
    const { data, error } = await this.db().from("song_requests").select(COLS).eq("id", id).maybeSingle();
    if (error) throw setupError(error);
    return data ? rowToRequest(data as ReqRow) : null;
  }
  async getSettings(bookId: string) {
    const { data, error } = await this.db().from("song_request_settings").select("accepting,max_queue,per_user_max").eq("book_id", bookId).maybeSingle();
    if (error) throw setupError(error);
    if (!data) return DEFAULT_REQUEST_SETTINGS;
    const d = data as { accepting: boolean; max_queue: number; per_user_max: number };
    return normalizeSettings({ accepting: d.accepting, maxQueue: d.max_queue, perUserMax: d.per_user_max });
  }
  async saveSettings(bookId: string, s: RequestSettings) {
    const n = normalizeSettings(s);
    const { error } = await this.db().from("song_request_settings").upsert({ book_id: bookId, accepting: n.accepting, max_queue: n.maxQueue, per_user_max: n.perUserMax });
    if (error) throw setupError(error);
  }
  async setStatus(id: string, status: RequestStatus) {
    // "지금 상태가 이 전이를 허용하는 상태일 때만" 바꾼다 (한 문장으로 조건+변경). 두 화면에서 동시에 승인/거절해도 한 번만 반영된다.
    const allowedFrom = (Object.keys(STATUS_ORDER) as RequestStatus[]).filter((f) => canTransition(f, status));
    const { data, error } = await this.db().from("song_requests").update({ status }).eq("id", id).in("status", allowedFrom).select("id");
    if (error) throw setupError(error);
    if (!data || data.length === 0) throw new RequestConflictError(CONFLICT_MSG);
  }
  async startPlaying(bookId: string, id: string) {
    const db = this.db();
    // 우선 한 트랜잭션짜리 DB 함수(20261012 마이그레이션). 아직 적용 전이면 예전 2단계 방식으로 대신한다.
    const rpc = await db.rpc("start_song_request", { p_id: id });
    if (!rpc.error) {
      if (rpc.data !== true) throw new RequestConflictError(CONFLICT_MSG);
      return;
    }
    if (rpc.error.code !== "PGRST202" && rpc.error.code !== "42883") throw setupError(rpc.error);
    const prev = await db.from("song_requests").update({ status: "done" }).eq("book_id", bookId).eq("status", "playing").neq("id", id);
    if (prev.error) throw setupError(prev.error);
    const { data, error } = await db.from("song_requests").update({ status: "playing" }).eq("id", id).in("status", ["approved", "playing"]).select("id");
    if (error) throw setupError(error);
    if (!data || data.length === 0) throw new RequestConflictError(CONFLICT_MSG);
  }
  async skip(bookId: string, id: string) {
    const db = this.db();
    const { data: max, error: e1 } = await db.from("song_requests").select("position").eq("book_id", bookId).order("position", { ascending: false }).limit(1).maybeSingle();
    if (e1) throw setupError(e1);
    const next = ((max as { position: number } | null)?.position ?? 0) + 1;
    const { data, error } = await db.from("song_requests").update({ status: "approved", position: next }).eq("id", id).in("status", ["approved", "playing"]).select("id");
    if (error) throw setupError(error);
    if (!data || data.length === 0) throw new RequestConflictError(CONFLICT_MSG);
  }
  async reorder(orderedIds: string[]) {
    const db = this.db();
    const results = await Promise.all(orderedIds.map((id, i) => db.from("song_requests").update({ position: i + 1 }).eq("id", id)));
    const bad = results.find((r) => r.error);
    if (bad?.error) throw setupError(bad.error);
  }
  async clearFinished(bookId: string) {
    const { error } = await this.db().from("song_requests").delete().eq("book_id", bookId).in("status", ["done", "rejected", "canceled"]);
    if (error) throw setupError(error);
  }
}

export function getPublicRequestClient(): PublicRequestClient {
  return isSupabaseConfigured ? new HttpPublicClient() : new LocalPublicClient();
}
export function getAdminRequestRepository(): AdminRequestRepository {
  return isSupabaseConfigured ? new SupabaseAdminRepository() : new LocalAdminRepository();
}
