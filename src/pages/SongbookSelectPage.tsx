import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogIn, LogOut, ShieldCheck, ChevronRight, Music2 } from "lucide-react";
import type { Profile } from "../types/user";
import { profileRepository } from "../services/profileRepository";
import { songRepository } from "../services/songRepository";
import { bookDesignRepository } from "../services/bookDesignRepository";
import { useAuth } from "../hooks/useAuth";
import { isSuperAdmin } from "../utils/permissions";

interface BookCardData {
  profile: Profile;
  songCount: number;
  accentColor: string;
  title: string | null;
}

export function SongbookSelectPage() {
  const navigate = useNavigate();
  const { profile: currentUser, logout } = useAuth();
  const [books, setBooks] = useState<BookCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    profileRepository
      .listAdmins()
      .then(async (admins) => {
        const withDetails = await Promise.all(
          admins.map(async (profile) => {
            const [songs, design] = await Promise.all([
              songRepository.getByOwner(profile.id),
              bookDesignRepository.get(profile.id),
            ]);
            return { profile, songCount: songs.length, accentColor: design.accentColor, title: design.title };
          })
        );
        if (active) setBooks(withDetails);
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
  }, []);

  return (
    <div className="min-h-screen bg-[#0b0c12]">
      <div className="max-w-md lg:max-w-6xl mx-auto px-5 lg:px-8 pt-14 lg:pt-20 pb-14">
        {/* Hero */}
        <div className="max-w-xl">
          <p className="text-[11px] tracking-[0.2em] text-amber-400/80 uppercase">
            Personal Music Library
          </p>
          <h1 className="text-3xl lg:text-4xl font-semibold font-serif mt-2 text-white">
            MY SONGBOOK
          </h1>
          <p className="text-white/45 text-[14px] lg:text-[15px] mt-2 leading-relaxed">
            나만의 노래를 모으고, 부르고, 기록하세요.
          </p>
          {!loading && !error && books.length > 0 && (
            <p className="text-white/30 text-[12.5px] mt-4">노래책 {books.length}개</p>
          )}
        </div>

        {loading && <p className="text-white/40 text-sm mt-10">불러오는 중...</p>}
        {error && <p className="text-red-400 text-sm mt-10">{error}</p>}

        {/* 노래책 카드 그리드 */}
        {!loading && !error && (
          <div className="mt-8 lg:mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {books.map(({ profile, songCount, accentColor, title }) => (
              <button
                key={profile.id}
                onClick={() => navigate(`/books/${profile.id}`)}
                className="group text-left rounded-2xl border border-white/[0.07] bg-white/[0.03] hover:bg-white/[0.05] hover:border-white/[0.14] hover:-translate-y-0.5 transition-all p-5 flex flex-col gap-4"
              >
                <div className="flex items-center justify-between">
                  <span
                    className="h-10 w-10 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: `color-mix(in srgb, ${accentColor} 18%, transparent)` }}
                  >
                    <Music2 className="h-4.5 w-4.5" style={{ color: accentColor }} />
                  </span>
                  <ChevronRight className="h-4 w-4 text-white/20 group-hover:text-white/50 transition" />
                </div>
                <div>
                  <div className="text-[16px] font-semibold text-white truncate">
                    {title || `${profile.name}의 노래책`}
                  </div>
                  <div className="text-[12.5px] text-white/40 mt-1">{songCount}곡</div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* 계정 영역 */}
        <div className="mt-14 pt-6 border-t border-white/[0.06]">
          {currentUser ? (
            <div className="flex flex-wrap items-center gap-5">
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
              className="flex items-center gap-1.5 text-[13px] text-white/40 hover:text-white/70"
            >
              <LogIn className="h-3.5 w-3.5" /> 관리자 로그인
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
