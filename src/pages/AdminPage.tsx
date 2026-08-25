import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ChevronLeft, Trash2 } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { isSuperAdmin } from "../utils/permissions";
import { profileRepository } from "../services/profileRepository";
import { songRepository } from "../services/songRepository";
import type { Profile } from "../types/user";

interface UserRow {
  profile: Profile;
  songCount: number;
}

export function AdminPage() {
  const navigate = useNavigate();
  const { profile: currentUser, loading: authLoading } = useAuth();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!isSuperAdmin(currentUser)) return;
    let active = true;
    setLoading(true);
    profileRepository
      .listAll()
      .then(async (profiles) => {
        const withCounts = await Promise.all(
          profiles.map(async (profile) => {
            const songs = await songRepository.getByOwner(profile.id);
            return { profile, songCount: songs.length };
          })
        );
        if (active) setRows(withCounts);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : "목록을 불러오지 못했어요.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [currentUser]);

  async function handleDeleteBook(row: UserRow) {
    const confirmed = confirm(
      `"${row.profile.name}"의 노래책을 삭제하시겠습니까?\n\n등록된 ${row.songCount}곡이 모두 삭제됩니다.\n계정 자체는 삭제되지 않으며, 이 작업은 되돌릴 수 없습니다.`
    );
    if (!confirmed) return;

    setDeletingId(row.profile.id);
    try {
      await songRepository.removeAllByOwner(row.profile.id);
      setRows((prev) =>
        prev.map((r) => (r.profile.id === row.profile.id ? { ...r, songCount: 0 } : r))
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : "노래책 삭제에 실패했어요.");
    } finally {
      setDeletingId(null);
    }
  }

  if (authLoading) {
    return (
      <div className="max-w-md mx-auto px-5 pt-10 text-center text-white/40 text-sm">
        확인 중...
      </div>
    );
  }

  // 화면 접근 자체를 차단 (실제 데이터 보호는 RLS가 별도로 함)
  if (!isSuperAdmin(currentUser)) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="max-w-md mx-auto min-h-screen px-5 pt-8 pb-10">
      <button
        onClick={() => navigate("/")}
        className="flex items-center gap-1 text-[13px] text-white/40 hover:text-white/70"
      >
        <ChevronLeft className="h-4 w-4" /> 홈으로
      </button>
      <h1 className="text-xl font-semibold font-serif mt-4">관리자 페이지</h1>
      <p className="text-white/40 text-[13px] mt-1.5">사용자 관리</p>

      {loading && <p className="text-white/40 text-sm mt-8">불러오는 중...</p>}
      {error && <p className="text-red-400 text-sm mt-8">{error}</p>}

      {!loading && !error && (
        <div className="mt-6 flex flex-col gap-2">
          {rows.map((row) => (
            <div
              key={row.profile.id}
              className="rounded-xl bg-white/[0.04] border border-white/[0.06] px-4 py-3.5"
            >
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <div className="text-[15px] font-medium flex items-center gap-1.5">
                    <span className="truncate">{row.profile.name}</span>
                    {row.profile.role === "super_admin" && (
                      <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-300">
                        super admin
                      </span>
                    )}
                  </div>
                  <div className="text-[12.5px] text-white/40 mt-0.5 truncate">
                    {row.profile.email}
                  </div>
                </div>
                <span className="text-[13px] text-white/50 shrink-0 ml-3">
                  노래 {row.songCount}곡
                </span>
              </div>

              <div className="flex items-center gap-3 mt-3 pt-3 border-t border-white/[0.06]">
                <button
                  type="button"
                  onClick={() => navigate(`/books/${row.profile.id}`)}
                  className="text-[12.5px] text-amber-300 hover:text-amber-200"
                >
                  노래책 보기
                </button>
                {row.songCount > 0 && (
                  <button
                    type="button"
                    onClick={() => handleDeleteBook(row)}
                    disabled={deletingId === row.profile.id}
                    className="flex items-center gap-1 text-[12.5px] text-red-400/70 hover:text-red-400 disabled:opacity-50"
                  >
                    <Trash2 className="h-3 w-3" />
                    {deletingId === row.profile.id ? "삭제 중..." : "노래책 삭제"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
