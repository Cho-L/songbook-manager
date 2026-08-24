import type { ReactNode } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { canManageBook } from "../utils/permissions";

interface RequireOwnerProps {
  children: ReactNode;
}

/**
 * 관리자 전용 페이지(노래 추가/수정)를 감싼다.
 * - 로그인 안 한 방문자: /admin/login으로 이동
 * - 로그인했지만 이 노래책의 소유자도 아니고 super_admin도 아니면: 해당 노래책 홈으로 이동
 * 실제 데이터 보호는 Supabase RLS가 하지만, 화면 단에서도 같은 기준으로
 * 애초에 접근 자체를 막아 지시서 5·6번 요구사항을 충족한다.
 */
export function RequireOwner({ children }: RequireOwnerProps) {
  const { ownerId } = useParams();
  const { profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="max-w-md mx-auto px-5 pt-10 text-center text-white/40 text-sm">
        확인 중...
      </div>
    );
  }

  if (!profile) {
    return <Navigate to="/admin/login" replace />;
  }

  if (!canManageBook(profile, ownerId)) {
    return <Navigate to={`/books/${ownerId}`} replace />;
  }

  return <>{children}</>;
}
