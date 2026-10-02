import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";

/** 방송 프로필/방송 키 저장소가 쓸 DB 클라이언트. Supabase가 설정되지 않은 로컬 환경에서는 null → 이 브라우저(localStorage)에만 저장한다. */
export function getBroadcastDb(): SupabaseClient | null {
  return supabase;
}
