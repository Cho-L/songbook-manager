import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// import.meta.env 는 Vite 밖(단위 테스트 등)에서는 없을 수 있어 옵셔널 체이닝으로 읽는다 — 앱 동작은 동일하다.
const supabaseUrl = import.meta.env?.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env?.VITE_SUPABASE_ANON_KEY as
  | string
  | undefined;

/**
 * Supabase 연결 정보가 설정되어 있는지 여부.
 * 값이 없으면(로컬 개발 중, 계정 준비 전) SupabaseSongRepository 대신
 * LocalSongRepository로 자동 폴백한다 (services/songRepository.ts 참고).
 */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

// anon key는 공개 키라 프론트엔드에 노출되어도 안전하다 (RLS가 실제 보안 경계).
// service_role key는 절대 프론트엔드 코드에 넣지 않는다.
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl as string, supabaseAnonKey as string)
  : null;
