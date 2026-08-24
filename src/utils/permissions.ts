import type { Profile } from "../types/user";

/**
 * 이 사용자가 ownerId 노래책을 관리(추가/수정/삭제)할 수 있는가.
 * - 본인 소유 노래책이거나
 * - super_admin이면 모든 노래책을 관리할 수 있다.
 * 실제 데이터 보호는 Supabase RLS가 하지만(schema.sql), 화면 단에서도
 * 같은 기준으로 판정해서 UI가 실제 권한과 어긋나지 않게 한다.
 */
export function canManageBook(user: Profile | null, ownerId: string | undefined): boolean {
  if (!user || !ownerId) return false;
  return user.id === ownerId || user.role === "super_admin";
}

export function isSuperAdmin(user: Profile | null): boolean {
  return user?.role === "super_admin";
}
