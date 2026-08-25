import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, ChevronLeft, LogOut, Trash2, ListMusic, Download, Upload } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import type { SortOption, SongFormInput } from "../types/song";
import type { Profile } from "../types/user";
import { Header } from "../components/layout/Header";
import { SearchBar } from "../components/layout/SearchBar";
import { SortSelect } from "../components/layout/SortSelect";
import { SongListItem } from "../components/song/SongListItem";
import { EmptyState } from "../components/song/EmptyState";
import { searchSongs } from "../utils/search";
import { useSongs } from "../hooks/useSongs";
import { useAuth } from "../hooks/useAuth";
import { useFavorites } from "../hooks/useFavorites";
import { profileRepository } from "../services/profileRepository";
import { canManageBook } from "../utils/permissions";
import { songsToJSON, songsToCSV, downloadTextFile, parseSongsJSON, BackupParseError } from "../utils/backup";
import type { Song } from "../types/song";

function sortSongs(
  songs: Song[],
  sortBy: SortOption,
  favoriteIds: Set<string>
): Song[] {
  const sorted = [...songs];
  switch (sortBy) {
    case "title":
      return sorted.sort((a, b) => a.title.localeCompare(b.title, "ko"));
    case "artist":
      return sorted.sort((a, b) => a.artist.localeCompare(b.artist, "ko"));
    case "difficulty":
      return sorted.sort((a, b) => (b.difficulty ?? 0) - (a.difficulty ?? 0));
    case "favorite":
      return sorted.sort((a, b) => {
        const af = favoriteIds.has(a.id) ? 1 : 0;
        const bf = favoriteIds.has(b.id) ? 1 : 0;
        return bf - af;
      });
    case "recent":
    default:
      return sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

export function HomePage() {
  const { ownerId } = useParams();
  const navigate = useNavigate();
  const { profile: currentUser, logout } = useAuth();
  const { songs, loading, error, addSong, removeAllSongs } = useSongs(ownerId);
  // 개별 ⭐ 버튼/즐겨찾기 필터/정렬: 현재 로그인한 뷰어 기준 (기존 그대로 유지)
  const { favoriteIds } = useFavorites(currentUser?.id);
  // 노래책 상단 "즐겨찾기 N곡" 통계: 지금 보고 있는 노래책 "소유자" 기준 (뷰어와 다른 개념)
  const { favoriteIds: ownerFavoriteIds } = useFavorites(ownerId);

  const [bookOwner, setBookOwner] = useState<Profile | null>(null);
  const [query, setQuery] = useState("");
  const [favOnly, setFavOnly] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>("recent");
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isOwner = canManageBook(currentUser, ownerId);

  useEffect(() => {
    if (!ownerId) return;
    profileRepository.getById(ownerId).then(setBookOwner);
  }, [ownerId]);

  const favoriteCount = songs.filter((s) => ownerFavoriteIds.has(s.id)).length;

  const filtered = useMemo(() => {
    const base = favOnly ? songs.filter((s) => favoriteIds.has(s.id)) : songs;
    const searched = searchSongs(base, query);
    return sortSongs(searched, sortBy, favoriteIds);
  }, [songs, query, favOnly, sortBy, favoriteIds]);

  const emptyQueryLabel = query || (favOnly ? "즐겨찾기" : "");

  async function handleLogout() {
    await logout();
    navigate("/");
  }

  async function handleDeleteBook() {
    const confirmed = confirm(
      `노래책을 삭제하시겠습니까?\n\n현재 등록된 ${songs.length}곡이 모두 삭제됩니다.\n이 작업은 되돌릴 수 없습니다.`
    );
    if (!confirmed) return;
    try {
      await removeAllSongs();
    } catch (e) {
      alert(e instanceof Error ? e.message : "노래책 삭제에 실패했어요.");
    }
  }

  function handleExportJSON() {
    downloadTextFile(
      `songbook-${ownerId}.json`,
      songsToJSON(songs),
      "application/json"
    );
  }

  function handleExportCSV() {
    downloadTextFile(`songbook-${ownerId}.csv`, songsToCSV(songs), "text/csv");
  }

  function handleImportClick() {
    fileInputRef.current?.click();
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setImporting(true);
    try {
      const text = await file.text();
      const parsed: SongFormInput[] = parseSongsJSON(text);
      if (!confirm(`${parsed.length}곡을 이 노래책에 추가할까요?`)) return;
      for (const input of parsed) {
        await addSong(input);
      }
      alert(`${parsed.length}곡을 가져왔어요.`);
    } catch (err) {
      if (err instanceof BackupParseError) {
        alert(err.message);
      } else {
        alert(err instanceof Error ? err.message : "가져오기에 실패했어요.");
      }
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="max-w-md mx-auto pb-24 relative min-h-screen">
      <div className="px-5 pt-5 flex items-center justify-between">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-1 text-[13px] text-white/40 hover:text-white/70"
        >
          <ChevronLeft className="h-4 w-4" /> 노래책 선택으로
        </button>
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate(`/books/${ownerId}/playlists`)}
            className="flex items-center gap-1 text-[13px] text-white/40 hover:text-white/70"
          >
            <ListMusic className="h-3.5 w-3.5" /> 플레이리스트
          </button>
          {currentUser && (
            <button
              onClick={handleLogout}
              className="flex items-center gap-1 text-[13px] text-white/40 hover:text-white/70"
            >
              <LogOut className="h-3.5 w-3.5" /> 로그아웃
            </button>
          )}
        </div>
      </div>

      <Header
        title={bookOwner ? `${bookOwner.name}의 노래책` : "노래책"}
        totalCount={songs.length}
        favoriteCount={favoriteCount}
      />

      <SearchBar
        value={query}
        onChange={setQuery}
        favOnly={favOnly}
        onToggleFavOnly={() => setFavOnly((v) => !v)}
      />
      <div className="px-5 mt-3 mb-2 flex justify-end">
        <SortSelect value={sortBy} onChange={setSortBy} />
      </div>

      {loading && <p className="px-5 text-white/40 text-sm mt-6">불러오는 중...</p>}
      {error && <p className="px-5 text-red-400 text-sm mt-6">{error}</p>}

      {!loading && !error && filtered.length === 0 ? (
        <EmptyState
          query={songs.length > 0 ? emptyQueryLabel : ""}
          onAddClick={
            songs.length === 0 && isOwner
              ? () => navigate(`/books/${ownerId}/songs/new`)
              : undefined
          }
        />
      ) : (
        <div className="px-5 flex flex-col gap-2 mt-1">
          {filtered.map((song) => (
            <SongListItem
              key={song.id}
              song={song}
              isFavorite={favoriteIds.has(song.id)}
              onClick={() => navigate(`/books/${ownerId}/songs/${song.id}`)}
            />
          ))}
        </div>
      )}

      {isOwner && songs.length > 0 && (
        <div className="px-5 mt-8">
          <p className="text-[11px] text-white/30 mb-2">데이터 백업</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleExportJSON}
              className="flex items-center gap-1.5 text-[12.5px] px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/10 text-white/60 hover:bg-white/[0.07]"
            >
              <Download className="h-3.5 w-3.5" /> JSON 내보내기
            </button>
            <button
              type="button"
              onClick={handleExportCSV}
              className="flex items-center gap-1.5 text-[12.5px] px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/10 text-white/60 hover:bg-white/[0.07]"
            >
              <Download className="h-3.5 w-3.5" /> CSV 내보내기
            </button>
            <button
              type="button"
              onClick={handleImportClick}
              disabled={importing}
              className="flex items-center gap-1.5 text-[12.5px] px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/10 text-white/60 hover:bg-white/[0.07] disabled:opacity-50"
            >
              <Upload className="h-3.5 w-3.5" /> {importing ? "가져오는 중..." : "JSON 가져오기"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              onChange={handleImportFile}
              className="hidden"
            />
          </div>
        </div>
      )}

      {isOwner && songs.length > 0 && (
        <div className="px-5 mt-6 pt-5 border-t border-white/[0.06]">
          <button
            type="button"
            onClick={handleDeleteBook}
            className="flex items-center gap-1.5 text-[12.5px] text-red-400/70 hover:text-red-400"
          >
            <Trash2 className="h-3.5 w-3.5" /> 노래책 삭제
          </button>
        </div>
      )}

      {isOwner && (
        <button
          type="button"
          onClick={() => navigate(`/books/${ownerId}/songs/new`)}
          aria-label="곡 추가"
          className="fixed bottom-20 right-5 h-14 w-14 flex items-center justify-center rounded-full bg-amber-400 text-[#14161F] shadow-lg shadow-amber-400/20 z-40"
          style={{ maxWidth: "28rem" }}
        >
          <Plus className="h-6 w-6" strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}
