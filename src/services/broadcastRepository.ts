import { cleanProfileName, sanitizeOverlaySettings, type OverlaySettings } from "../types/overlay";
import { isValidLiveKey } from "../utils/liveBroadcast";
import { getBroadcastDb } from "./broadcastDb";

/**
 * 방송 프로필(계정 단위 오버레이 설정 묶음)과 계정 방송 키 저장소.
 * - Supabase가 있으면 broadcast_profiles / broadcast_keys 테이블(소유자만 접근, RLS)을 쓴다.
 * - Supabase가 없거나 테이블이 아직 만들어지지 않았다면(schema.sql 미적용) 이 브라우저(localStorage)에 저장하는 방식으로
 *   조용히 대체하고, 호출한 쪽이 source 로 알 수 있게 한다.
 */
export interface BroadcastProfile {
  id: string;
  name: string;
  settings: OverlaySettings;
  createdAt: string;
  updatedAt: string;
}

export type ProfileSource = "server" | "local";

const LOCAL_PREFIX = "songbook:broadcast-profiles:";

interface ProfileRow {
  id: string;
  name: string;
  settings: unknown;
  created_at: string;
  updated_at: string;
}

function rowToProfile(row: ProfileRow): BroadcastProfile {
  return {
    id: row.id,
    name: cleanProfileName(String(row.name ?? "")),
    // 어떤 값이 저장돼 있어도 안전하게 보정한다 (옛 버전, 손상된 값 등)
    settings: sanitizeOverlaySettings(row.settings),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 테이블이 아직 없을 때 나오는 오류인지 (schema.sql 미적용) */
function isMissingTable(error: { code?: string; message?: string }): boolean {
  const msg = (error.message ?? "").toLowerCase();
  return error.code === "42P01" || error.code === "PGRST205" || msg.includes("does not exist") || msg.includes("schema cache");
}

function readLocal(userId: string): BroadcastProfile[] {
  try {
    const raw = localStorage.getItem(LOCAL_PREFIX + userId);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((p): p is ProfileRow & { createdAt: string; updatedAt: string } => !!p && typeof p === "object" && typeof (p as { id?: unknown }).id === "string")
      .map((p) => ({
        id: p.id,
        name: cleanProfileName(String(p.name ?? "")),
        settings: sanitizeOverlaySettings(p.settings),
        createdAt: String(p.createdAt ?? ""),
        updatedAt: String(p.updatedAt ?? ""),
      }));
  } catch {
    return [];
  }
}

function writeLocal(userId: string, profiles: BroadcastProfile[]): void {
  localStorage.setItem(LOCAL_PREFIX + userId, JSON.stringify(profiles));
}

function newId(): string {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// 테이블이 없다고 한 번 확인되면 이 세션 동안은 서버를 다시 찌르지 않고 로컬로 처리한다
let serverUnavailable = false;

function useServer(): ReturnType<typeof getBroadcastDb> {
  return serverUnavailable ? null : getBroadcastDb();
}

export const broadcastRepository = {
  async list(userId: string): Promise<{ profiles: BroadcastProfile[]; source: ProfileSource }> {
    const db = useServer();
    if (db) {
      const { data, error } = await db
        .from("broadcast_profiles")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: true });
      if (!error) return { profiles: (data as ProfileRow[]).map(rowToProfile), source: "server" };
      if (!isMissingTable(error)) throw error;
      serverUnavailable = true;
    }
    return { profiles: readLocal(userId), source: "local" };
  },

  async create(userId: string, name: string, settings: OverlaySettings): Promise<BroadcastProfile> {
    const clean = cleanProfileName(name);
    const safe = sanitizeOverlaySettings(settings);
    const db = useServer();
    if (db) {
      const { data, error } = await db
        .from("broadcast_profiles")
        .insert({ user_id: userId, name: clean, settings: safe })
        .select()
        .single();
      if (!error) return rowToProfile(data as ProfileRow);
      if (!isMissingTable(error)) throw error;
      serverUnavailable = true;
    }
    const now = new Date().toISOString();
    const profile: BroadcastProfile = { id: newId(), name: clean, settings: safe, createdAt: now, updatedAt: now };
    writeLocal(userId, [...readLocal(userId), profile]);
    return profile;
  },

  async update(userId: string, id: string, patch: { name?: string; settings?: OverlaySettings }): Promise<BroadcastProfile> {
    const row: Record<string, unknown> = {};
    if (patch.name !== undefined) row.name = cleanProfileName(patch.name);
    if (patch.settings !== undefined) row.settings = sanitizeOverlaySettings(patch.settings);
    const db = useServer();
    if (db) {
      const { data, error } = await db.from("broadcast_profiles").update(row).eq("id", id).eq("user_id", userId).select().single();
      if (!error) return rowToProfile(data as ProfileRow);
      if (!isMissingTable(error)) throw error;
      serverUnavailable = true;
    }
    const all = readLocal(userId);
    const idx = all.findIndex((p) => p.id === id);
    if (idx < 0) throw new Error("프로필을 찾을 수 없어요");
    const next: BroadcastProfile = {
      ...all[idx],
      ...(row.name !== undefined ? { name: row.name as string } : {}),
      ...(row.settings !== undefined ? { settings: row.settings as OverlaySettings } : {}),
      updatedAt: new Date().toISOString(),
    };
    all[idx] = next;
    writeLocal(userId, all);
    return next;
  },

  async remove(userId: string, id: string): Promise<void> {
    const db = useServer();
    if (db) {
      const { error } = await db.from("broadcast_profiles").delete().eq("id", id).eq("user_id", userId);
      if (!error) return;
      if (!isMissingTable(error)) throw error;
      serverUnavailable = true;
    }
    writeLocal(userId, readLocal(userId).filter((p) => p.id !== id));
  },

  /** 계정에 저장된 방송 키. 없거나 서버를 쓸 수 없으면 null. */
  async getLiveKey(userId: string): Promise<string | null> {
    const db = useServer();
    if (!db) return null;
    const { data, error } = await db.from("broadcast_keys").select("live_key").eq("user_id", userId).maybeSingle();
    if (error) {
      if (isMissingTable(error)) {
        serverUnavailable = true;
        return null;
      }
      throw error;
    }
    const key = (data as { live_key?: string } | null)?.live_key;
    return isValidLiveKey(key) ? key : null;
  },

  async saveLiveKey(userId: string, key: string): Promise<void> {
    if (!isValidLiveKey(key)) return;
    const db = useServer();
    if (!db) return;
    const { error } = await db.from("broadcast_keys").upsert({ user_id: userId, live_key: key }, { onConflict: "user_id" });
    if (error) {
      if (isMissingTable(error)) {
        serverUnavailable = true;
        return;
      }
      throw error;
    }
  },
};
