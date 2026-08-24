import type { Profile, UserRole } from "../types/user";
import { supabase, isSupabaseConfigured } from "./supabaseClient";

interface ProfileRow {
  id: string;
  email: string;
  name: string;
  role: string;
  created_at: string;
}

function toRole(role: string): UserRole {
  if (role === "super_admin") return "super_admin";
  if (role === "admin") return "admin";
  return "user";
}

function rowToProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: toRole(row.role),
    createdAt: row.created_at,
  };
}

// 로컬(데모) 모드에서 사용할 가짜 관리자 한 명 — songRepository.ts의 DEMO_OWNER_ID와 짝을 이룬다.
const DEMO_PROFILE: Profile = {
  id: "demo-owner",
  email: "demo@local",
  name: "데모 노래책",
  role: "admin",
  createdAt: new Date().toISOString(),
};

export const profileRepository = {
  /** 공개 노래책 선택 화면에 표시할 관리자(super_admin 포함) 목록 */
  async listAdmins(): Promise<Profile[]> {
    if (!isSupabaseConfigured || !supabase) {
      return [DEMO_PROFILE];
    }
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .in("role", ["admin", "super_admin"])
      .order("created_at", { ascending: true });

    if (error) throw error;
    return (data as ProfileRow[]).map(rowToProfile);
  },

  async getById(id: string): Promise<Profile | null> {
    if (!isSupabaseConfigured || !supabase) {
      return id === DEMO_PROFILE.id ? DEMO_PROFILE : null;
    }
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    return data ? rowToProfile(data as ProfileRow) : null;
  },

  /** Super Admin 페이지용: 전체 사용자 목록 (role 무관) */
  async listAll(): Promise<Profile[]> {
    if (!isSupabaseConfigured || !supabase) {
      return [DEMO_PROFILE];
    }
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) throw error;
    return (data as ProfileRow[]).map(rowToProfile);
  },
};
