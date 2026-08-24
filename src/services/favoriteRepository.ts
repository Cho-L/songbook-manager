import { supabase, isSupabaseConfigured } from "./supabaseClient";

const LOCAL_KEY = "songbook:favorites"; // { [userId]: string[] }

function readLocal(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeLocal(data: Record<string, string[]>): void {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
}

/**
 * 로그인한 사용자 개인의 즐겨찾기 (다른 사람과 섞이지 않음).
 * Supabase 연결이 없으면(로컬 개발 중) localStorage로 폴백한다.
 */
export const favoriteRepository = {
  async listForUser(userId: string): Promise<Set<string>> {
    if (!isSupabaseConfigured || !supabase) {
      const data = readLocal();
      return new Set(data[userId] ?? []);
    }
    const { data, error } = await supabase
      .from("favorites")
      .select("song_id")
      .eq("user_id", userId);

    if (error) throw error;
    return new Set((data as { song_id: string }[]).map((r) => r.song_id));
  },

  async add(userId: string, songId: string): Promise<void> {
    if (!isSupabaseConfigured || !supabase) {
      const data = readLocal();
      const current = new Set(data[userId] ?? []);
      current.add(songId);
      data[userId] = [...current];
      writeLocal(data);
      return;
    }
    // insert 대신 upsert + ignoreDuplicates: 이미 즐겨찾기된 상태에서
    // (초기 로드가 끝나기 전 클릭 등으로) add가 다시 호출되어도
    // 복합 PK(user_id, song_id) 충돌 에러 없이 그대로 성공 처리된다.
    const { error } = await supabase
      .from("favorites")
      .upsert(
        { user_id: userId, song_id: songId },
        { onConflict: "user_id,song_id", ignoreDuplicates: true }
      );
    if (error) throw error;
  },

  async remove(userId: string, songId: string): Promise<void> {
    if (!isSupabaseConfigured || !supabase) {
      const data = readLocal();
      const current = new Set(data[userId] ?? []);
      current.delete(songId);
      data[userId] = [...current];
      writeLocal(data);
      return;
    }
    const { error } = await supabase
      .from("favorites")
      .delete()
      .eq("user_id", userId)
      .eq("song_id", songId);
    if (error) throw error;
  },
};
