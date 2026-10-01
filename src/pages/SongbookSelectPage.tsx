import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogIn, LogOut, ShieldCheck, ChevronRight, Music2, Search } from "lucide-react";
import type { Profile } from "../types/user";
import { profileRepository } from "../services/profileRepository";
import { songRepository } from "../services/songRepository";
import { bookDesignRepository } from "../services/bookDesignRepository";
import { useAuth } from "../hooks/useAuth";
import { isSuperAdmin } from "../utils/permissions";
import { SortSelect } from "../components/layout/SortSelect";
import { EmptyNotice, EmptyActionButton } from "../components/song/EmptyState";

interface BookCardData {
  profile: Profile;
  songCount: number;
  accentColor: string;
  title: string | null;
  description: string | null;
  /** 이 노래책의 곡 중 가장 최근에 수정된 시각 (곡이 없으면 null) */
  lastUpdatedAt: string | null;
}

function displayName(book: BookCardData): string {
  return book.title || `${book.profile.name}의 노래책`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" }).format(d);
}

type BookSortOption = "recentUpdate" | "nameAsc" | "nameDesc" | "recentCreated" | "songCountDesc" | "songCountAsc";

const BOOK_SORT_OPTIONS: { value: BookSortOption; label: string }[] = [
  { value: "recentUpdate", label: "최근 수정순" },
  { value: "nameAsc", label: "이름순" },
  { value: "nameDesc", label: "이름 역순" },
  { value: "recentCreated", label: "최근 생성순" },
  { value: "songCountDesc", label: "곡 수 많은순" },
  { value: "songCountAsc", label: "곡 수 적은순" },
];

function sortBooks(books: BookCardData[], sortBy: BookSortOption): BookCardData[] {
  const arr = [...books];
  switch (sortBy) {
    case "nameAsc":
      return arr.sort((a, b) => displayName(a).localeCompare(displayName(b), "ko"));
    case "nameDesc":
      return arr.sort((a, b) => displayName(b).localeCompare(displayName(a), "ko"));
    case "recentCreated":
      return arr.sort((a, b) => b.profile.createdAt.localeCompare(a.profile.createdAt));
    case "songCountDesc":
      return arr.sort((a, b) => b.songCount - a.songCount);
    case "songCountAsc":
      return arr.sort((a, b) => a.songCount - b.songCount);
    case "recentUpdate":
    default:
      return arr.sort((a, b) => {
        const av = a.lastUpdatedAt ?? a.profile.createdAt;
        const bv = b.lastUpdatedAt ?? b.profile.createdAt;
        return bv.localeCompare(av);
      });
  }
}

export function SongbookSelectPage() {
  const navigate = useNavigate();
  const { profile: currentUser, logout } = useAuth();
  const [books, setBooks] = useState<BookCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<BookSortOption>("recentUpdate");

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
            const lastUpdatedAt =
              songs.length > 0
                ? songs.reduce((max, s) => (s.updatedAt > max ? s.updatedAt : max), songs[0].updatedAt)
                : null;
            return {
              profile,
              songCount: songs.length,
              accentColor: design.accentColor,
              title: design.title,
              description: design.description,
              lastUpdatedAt,
            };
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

  const visibleBooks = useMemo(() => {
    const filtered = query.trim()
      ? books.filter((b) => displayName(b).toLowerCase().includes(query.trim().toLowerCase()))
      : books;
    return sortBooks(filtered, sortBy);
  }, [books, query, sortBy]);

  return (
    <div className="min-h-screen bg-[#0b0c12]">
      <div className="max-w-md lg:max-w-6xl mx-auto px-5 lg:px-8 pt-6 pb-14">
        {/* 앱 헤더: 브랜드 + 로그인/계정 */}
        <div className="flex items-center justify-between gap-3 pb-5 lg:pb-6 border-b border-white/[0.06]">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="h-7 w-7 shrink-0 rounded-lg bg-amber-400/10 flex items-center justify-center" aria-hidden="true">
              <Music2 className="h-3.5 w-3.5 text-amber-400" />
            </span>
            <span className="text-[14px] font-semibold text-white/80 tracking-tight truncate">Songbook Manager</span>
          </div>
          {currentUser ? (
            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              {isSuperAdmin(currentUser) && (
                <button
                  onClick={() => navigate("/admin")}
                  className="flex items-center gap-1.5 text-[13px] text-amber-300 hover:text-amber-200 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-400/50 rounded-full px-1"
                >
                  <ShieldCheck className="h-3.5 w-3.5" /> <span className="hidden sm:inline">관리자 페이지</span>
                  <span className="sm:hidden">관리자</span>
                </button>
              )}
              <span className="hidden sm:inline text-[13px] text-white/40 truncate max-w-[10rem]">
                {currentUser.name}님
              </span>
              <button
                onClick={() => logout()}
                className="flex items-center gap-1.5 text-[13px] text-white/55 hover:text-white/80 px-3 py-1.5 rounded-full border border-white/10 bg-white/[0.03] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-400/50"
              >
                <LogOut className="h-3.5 w-3.5" /> 로그아웃
              </button>
            </div>
          ) : (
            <button
              onClick={() => navigate("/admin/login")}
              className="shrink-0 flex items-center gap-1.5 text-[13px] font-medium px-3.5 py-1.5 rounded-full border transition-[filter,border-color] duration-150 hover:brightness-110 active:brightness-95 focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-400/50"
              style={{
                color: "#fbbf24",
                borderColor: "rgba(251,191,36,0.4)",
                backgroundColor: "rgba(251,191,36,0.08)",
              }}
            >
              <LogIn className="h-3.5 w-3.5" /> 로그인
            </button>
          )}
        </div>

        {/* 페이지 제목 */}
        <div className="max-w-xl pt-8 lg:pt-10">
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

        {/* 검색 + 정렬 — 노래책이 여러 개일 때만 노출 */}
        {!loading && !error && books.length > 1 && (
          <div className="mt-6 flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-3">
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/30" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="노래책 검색"
                className="w-full rounded-lg bg-white/[0.05] border border-white/10 pl-8 pr-3 py-2 text-[13px] text-white/80 placeholder-white/30 outline-none transition-colors focus:border-amber-400/60"
              />
            </div>
            <SortSelect value={sortBy} onChange={setSortBy} options={BOOK_SORT_OPTIONS} ariaLabel="노래책 정렬 기준" />
          </div>
        )}

        {/* 노래책이 없을 때 */}
        {!loading && !error && books.length === 0 && (
          <EmptyNotice
            className="py-20"
            icon={<Music2 className="h-5 w-5" strokeWidth={1.5} />}
            title="아직 등록된 노래책이 없어요"
            description="관리자 계정이 만들어지면 노래책이 이곳에 표시돼요"
            action={
              !currentUser && <EmptyActionButton onClick={() => navigate("/admin/login")}>로그인</EmptyActionButton>
            }
          />
        )}

        {/* 검색 결과 없음 */}
        {!loading && !error && books.length > 0 && visibleBooks.length === 0 && (
          <EmptyNotice
            icon={<Search className="h-5 w-5" strokeWidth={1.5} />}
            title={`"${query}"에 맞는 노래책을 찾지 못했어요`}
            description="노래책 이름을 다시 확인해보세요"
            action={<EmptyActionButton onClick={() => setQuery("")}>검색 초기화</EmptyActionButton>}
          />
        )}

        {/* 노래책 카드 그리드 */}
        {!loading && !error && visibleBooks.length > 0 && (
          <div className="mt-8 lg:mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {visibleBooks.map((book) => (
              <button
                key={book.profile.id}
                onClick={() => navigate(`/books/${book.profile.id}`)}
                className="group text-left rounded-2xl border border-white/[0.07] bg-white/[0.03] hover:bg-white/[0.045] hover:border-[color:color-mix(in_srgb,var(--book-accent,#fbbf24)_35%,transparent)] transition-colors duration-150 p-5 flex flex-col gap-5 min-h-[9.5rem] focus:outline-none focus-visible:border-[color:var(--book-accent,#fbbf24)]"
                style={{ "--book-accent": book.accentColor } as React.CSSProperties}
              >
                <div className="flex items-center justify-between">
                  <span
                    className="h-10 w-10 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: `color-mix(in srgb, ${book.accentColor} 16%, transparent)` }}
                  >
                    <Music2 className="h-[18px] w-[18px]" style={{ color: book.accentColor }} />
                  </span>
                  <ChevronRight className="h-4 w-4 text-white/20 group-hover:text-white/60 transition-colors" />
                </div>
                <div className="min-w-0 flex-1 flex flex-col">
                  <div className="text-[17px] font-semibold text-white truncate leading-snug">{displayName(book)}</div>
                  {book.description && (
                    <div className="text-[13px] text-white/50 truncate mt-1">{book.description}</div>
                  )}
                  <div className="text-[12px] text-white/35 mt-auto pt-3 tabular-nums">
                    {book.songCount}곡
                    {book.lastUpdatedAt && ` · 최근 수정 ${formatDate(book.lastUpdatedAt)}`}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
