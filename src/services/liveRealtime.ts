import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";

/**
 * 방송 오버레이 실시간 전송(Supabase Realtime Broadcast)에 쓸 클라이언트.
 * 기존 앱과 같은 클라이언트(anon key)를 그대로 쓰며, 새 테이블/서버는 필요 없다.
 * Supabase가 설정되지 않은 환경(로컬 데모)에서는 null → 실시간 전송은 꺼지고 같은 브라우저 안에서만 동작한다.
 */
export function getRealtimeClient(): SupabaseClient | null {
  return supabase;
}
