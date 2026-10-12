import { supabase, isSupabaseConfigured } from "./supabaseClient";
import { sanitizeStudioConfig, toStoredConfig, type OverlayKind, type StudioConfig } from "../utils/overlayStudio";

/**
 * Overlay Studio 설정 저장소 (노래책 × 오버레이 종류).
 * - 관리자(로그인): Supabase overlay_configs 테이블(RLS: 주인만). 테이블이 아직 없으면(마이그레이션 미적용) 이 브라우저에만 저장하고 알려준다.
 * - OBS(공개): /api/overlay-config (Worker → service_role RPC). 로그인/토큰 없음.
 * - Supabase 가 없는 로컬 개발: localStorage (같은 브라우저에서만 공유).
 * 어떤 경로로 읽든 sanitizeStudioConfig 를 거쳐서 항상 안전한 값만 화면에 닿는다.
 */
export type ConfigSource = "server" | "local";
export interface LoadedConfig {
  config: StudioConfig | null;
  rev: number;
  source: ConfigSource;
}
export interface SaveResult {
  source: ConfigSource;
  /** 서버 저장을 하지 못한 이유 (null = 서버에 저장됨) */
  serverIssue: null | "not_configured" | "missing_table" | "error";
  message?: string;
}

export const CONFIG_CHANGED_CHANNEL = "songbook-overlay-config";
const localKey = (book: string, kind: OverlayKind) => `songbook:overlay-config:${book}:${kind}`;

function readLocal(book: string, kind: OverlayKind): StudioConfig | null {
  try {
    const raw = localStorage.getItem(localKey(book, kind));
    return raw ? sanitizeStudioConfig(kind, JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
function writeLocal(book: string, kind: OverlayKind, c: StudioConfig): void {
  try {
    localStorage.setItem(localKey(book, kind), JSON.stringify(toStoredConfig(c)));
  } catch {
    /* 저장 공간 문제는 무시 (서버 저장이 우선) */
  }
}
function isMissingTable(e: { code?: string; message?: string }): boolean {
  const m = (e.message ?? "").toLowerCase();
  return e.code === "42P01" || e.code === "PGRST205" || m.includes("does not exist") || m.includes("schema cache");
}

/** 같은 브라우저에서 열려 있는 OBS/미리보기에게 "설정이 바뀌었어요"를 즉시 알린다 */
function announce(book: string, kind: OverlayKind) {
  try {
    const bc = new BroadcastChannel(CONFIG_CHANGED_CHANNEL);
    bc.postMessage({ book, kind });
    bc.close();
  } catch {
    /* 미지원 환경 */
  }
}

export const adminOverlayConfigs = {
  async load(book: string, kind: OverlayKind): Promise<LoadedConfig> {
    if (supabase) {
      const { data, error } = await supabase.from("overlay_configs").select("config,rev").eq("book_id", book).eq("kind", kind).maybeSingle();
      if (!error) {
        if (data) return { config: sanitizeStudioConfig(kind, (data as { config: unknown }).config), rev: (data as { rev: number }).rev, source: "server" };
        return { config: readLocal(book, kind), rev: 0, source: readLocal(book, kind) ? "local" : "server" };
      }
      if (!isMissingTable(error)) throw new Error(error.message || "설정을 불러오지 못했어요.");
    }
    return { config: readLocal(book, kind), rev: 0, source: "local" };
  },

  async save(book: string, kind: OverlayKind, config: StudioConfig): Promise<SaveResult> {
    const safe = sanitizeStudioConfig(kind, toStoredConfig(config));
    writeLocal(book, kind, safe); // 같은 브라우저 백업 + 서버가 없을 때의 저장소
    let result: SaveResult;
    if (!supabase || !isSupabaseConfigured) {
      result = { source: "local", serverIssue: "not_configured" };
    } else {
      const { error } = await supabase.from("overlay_configs").upsert({ book_id: book, kind, config: toStoredConfig(safe) }, { onConflict: "book_id,kind" });
      if (!error) result = { source: "server", serverIssue: null };
      else if (isMissingTable(error)) result = { source: "local", serverIssue: "missing_table" };
      else result = { source: "local", serverIssue: "error", message: error.message };
    }
    announce(book, kind);
    return result;
  },
};

/** OBS/공개 화면용: 저장된 설정을 읽는다. 없으면 null (호출한 쪽이 URL 설정/기본값으로 대체). 네트워크 실패는 throw → 호출한 쪽이 마지막 정상값 유지. */
export async function fetchPublicOverlayConfig(book: string, kind: OverlayKind): Promise<{ config: StudioConfig | null; rev: number }> {
  if (!isSupabaseConfigured) return { config: readLocal(book, kind), rev: 0 };
  const res = await fetch(`/api/overlay-config?book=${encodeURIComponent(book)}&kind=${kind}`);
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok || !data || typeof data !== "object") throw new Error("overlay-config unavailable");
  const d = data as { config?: unknown; rev?: unknown };
  return { config: d.config ? sanitizeStudioConfig(kind, d.config) : null, rev: typeof d.rev === "number" ? d.rev : 0 };
}
