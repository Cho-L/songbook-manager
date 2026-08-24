import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogIn, LogOut, ShieldCheck } from "lucide-react";
import type { Profile } from "../types/user";
import { profileRepository } from "../services/profileRepository";
import { useAuth } from "../hooks/useAuth";
import { isSuperAdmin } from "../utils/permissions";

export function SongbookSelectPage() {
  const navigate = useNavigate();
  const { profile: currentUser, logout } = useAuth();
  const [admins, setAdmins] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    profileRepository
      .listAdmins()
      .then(setAdmins)
      .catch((e) => setError(e instanceof Error ? e.message : "목록을 불러오지 못했어요."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-md mx-auto min-h-screen px-5 pt-10 pb-10">
      <h1 className="text-2xl font-semibold font-serif">🎵 MY SONGBOOK</h1>
      <p className="text-white/45 text-sm mt-1.5">노래책을 선택해주세요</p>

      {loading && <p className="text-white/40 text-sm mt-8">불러오는 중...</p>}
      {error && <p className="text-red-400 text-sm mt-8">{error}</p>}

      {!loading && !error && (
        <div className="mt-6 flex flex-col gap-2">
          {admins.map((admin) => (
            <button
              key={admin.id}
              onClick={() => navigate(`/books/${admin.id}`)}
              className="text-left rounded-xl bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.06] px-4 py-3.5 transition"
            >
              <div className="text-[15px] font-medium">{admin.name}의 노래책</div>
            </button>
          ))}
        </div>
      )}

      {currentUser ? (
        <div className="mt-10 flex flex-col items-start gap-3">
          {isSuperAdmin(currentUser) && (
            <button
              onClick={() => navigate("/admin")}
              className="flex items-center gap-1.5 text-[13px] text-amber-300 hover:text-amber-200"
            >
              <ShieldCheck className="h-3.5 w-3.5" /> 관리자 페이지
            </button>
          )}
          <button
            onClick={() => logout()}
            className="flex items-center gap-1.5 text-[13px] text-white/40 hover:text-white/70"
          >
            <LogOut className="h-3.5 w-3.5" /> {currentUser.name}님 로그아웃
          </button>
        </div>
      ) : (
        <button
          onClick={() => navigate("/admin/login")}
          className="mt-10 flex items-center gap-1.5 text-[13px] text-white/40 hover:text-white/70"
        >
          <LogIn className="h-3.5 w-3.5" /> 관리자 로그인
        </button>
      )}
    </div>
  );
}
