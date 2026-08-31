import { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  ChevronLeft,
  LogOut,
  Trash2,
  ListMusic,
  Download,
  Upload,
  Settings,
  CheckSquare,
  X,
  Star,
  StarOff,
  ListPlus,
  Palette,
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import type { SortOption } from "../types/song";
import type { Profile } from "../types/user";
import { Header } from "../components/layout/Header";
import { SearchBar } from "../components/layout/SearchBar";
import { SortSelect } from "../components/layout/SortSelect";
import { SongListItem } from "../components/song/SongListItem";
import { EmptyState } from "../components/song/EmptyState";
import { searchSongs } from "../utils/search";
import { useAuth } from "../hooks/useAuth";
import { useFavorites } from "../hooks/useFavorites";
import { usePreferences } from "../hooks/usePreferences";
import { usePlaylists } from "../hooks/usePlaylists";
import { useBookDesign } from "../hooks/useBookDesign";
import { profileRepository } from "../services/profileRepository";
import { playlistRepository } from "../services/playlistRepository";
import { canManageBook } from "../utils/permissions";
import {
  songsToJSON,
  songsToCSV,
  downloadTextFile,
  parseSongsJSON,
  parseSongsCSV,
  BackupParseError,
  type ImportResult,
} from "../utils/backup";
import type { Song, SongFormInput } from "../types/song";

interface HomePageProps {
  songs: Song[];
  loading: boolean;
  error: string | null;
  addSong: (input: SongFormInput) => Promise<Song>;
  removeManySongs: (ids: string[]) => Promise<{ succeeded: number; failed: number }>;
  removeAllSongs: () => Promise<void>;
  reload: () => Promise<void>;
}

function sortSongs(songs: Song[], sortBy: SortOption, favoriteIds: Set<string>): Song[] {
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

export function HomePage({
  songs,
  loading,
  error,
  addSong,
  removeManySongs,
  removeAllSongs,
  reload,
}: HomePageProps) {
  const { ownerId } = useParams();
  const navigate = useNavigate();
  const { profile: currentUser, logout } = useAuth();
  const { favoriteIds, toggle: toggleFavorite, setMany: setManyFavorites } = useFavorites(currentUser?.id);
  const { favoriteIds: ownerFavoriteIds } = useFavorites(ownerId);
  const { preferences } = usePreferences(currentUser?.id);
  const { playlists } = usePlaylists(ownerId);
  const { design } = useBookDesign(ownerId);

  const [bookOwner, setBookOwner] = useState<Profile | null>(null);
  const [query, setQuery] = useState("");
  const [favOnly, setFavOnly] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>("recent");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);

  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showPlaylistPicker, setShowPlaylistPicker] = useState(false);

  const isOwner = canManageBook(currentUser, ownerId);

  useEffect(() => {
    if (!ownerId) return;
    profileRepository.getById(ownerId).then(setBookOwner);
  }, [ownerId]);

  useEffect(() => {
    setPageSize(preferences.pageSize);
  }, [preferences.pageSize]);

  const favoriteCount = songs.filter((s) => ownerFavoriteIds.has(s.id)).length;

  const filtered = useMemo(() => {
    const base = favOnly ? songs.filter((s) => favoriteIds.has(s.id)) : songs;
    const searched = searchSongs(base, query);
    return sortSongs(searched, sortBy, favoriteIds);
  }, [songs, query, favOnly, sortBy, favoriteIds]);

  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set());
  }, [query, favOnly, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => {
    setSelectedIds((prev) => {
      const validIds = new Set(songs.map((s) => s.id));
      const next = new Set([...prev].filter((id) => validIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [songs]);

  const emptyQueryLabel = query || (favOnly ? "즐겨찾기" : "");

  function handleFavoriteClick(songId: string) {
    if (!currentUser) {
      alert("즐겨찾기는 로그인 후 이용할 수 있어요.");
      return;
    }
    toggleFavorite(songId);
  }

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
    downloadTextFile(`songbook-${ownerId}.json`, songsToJSON(songs), "application/json");
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
      const isCSV = file.name.toLowerCase().endsWith(".csv");
      const result = isCSV ? parseSongsCSV(text) : parseSongsJSON(text);
      setImportPreview(result);
    } catch (err) {
      if (err instanceof BackupParseError) {
        alert(err.message);
      } else {
        alert(err instanceof Error ? err.message : "파일을 읽는 데 실패했어요.");
      }
    } finally {
      setImporting(false);
    }
  }

  async function confirmImport() {
    if (!importPreview) return;
    const toImport = importPreview.valid;
    setImporting(true);
    let succeeded = 0;
    try {
      for (const input of toImport) {
        await addSong(input);
        succeeded++;
      }
      await reload();
      alert(`${succeeded}곡을 가져왔어요.`);
    } catch (err) {
      alert(
        `${succeeded}/${toImport.length}곡까지 가져온 뒤 실패했어요: ${
          err instanceof Error ? err.message : "알 수 없는 오류"
        }`
      );
      await reload();
    } finally {
      setImporting(false);
      setImportPreview(null);
    }
  }

  function toggleSelectionMode() {
    setSelectionMode((v) => !v);
    setSelectedIds(new Set());
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function selectAllOnPage() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      paginated.forEach((s) => next.add(s.id));
      return next;
    });
  }

  function deselectAllOnPage() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      paginated.forEach((s) => next.delete(s.id));
      return next;
    });
  }

  async function handleBulkDelete() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    if (!confirm(`선택한 ${ids.length}곡을 삭제하시겠습니까?`)) return;
    const result = await removeManySongs(ids);
    setSelectedIds(new Set());
    if (result.failed > 0) {
      alert(`${ids.length}곡 중 ${result.succeeded}곡 삭제 완료, ${result.failed}곡은 실패했어요.`);
    } else {
      alert(`${result.succeeded}곡을 삭제했어요.`);
    }
  }

  async function handleBulkFavorite(value: boolean) {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    if (!currentUser) {
      alert("즐겨찾기는 로그인 후 이용할 수 있어요.");
      return;
    }
    const result = await setManyFavorites(ids, value);
    if (result.failed > 0) {
      alert(
        `${ids.length}곡 중 ${result.succeeded}곡 ${value ? "추가" : "해제"} 완료, ${result.failed}곡은 실패했어요.`
      );
    } else {
      alert(`${result.succeeded}곡 즐겨찾기 ${value ? "추가" : "해제"} 완료.`);
    }
  }

  async function handleBulkAddToPlaylist(playlistId: string) {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    let succeeded = 0;
    let failed = 0;
    for (const songId of ids) {
      try {
        await playlistRepository.addSong(playlistId, songId);
        succeeded++;
      } catch (e) {
        console.error("플레이리스트 추가 실패:", e);
        failed++;
      }
    }
    setShowPlaylistPicker(false);
    if (failed > 0) {
      alert(`${ids.length}곡 중 ${succeeded}곡 추가 완료, ${failed}곡은 실패했어요.`);
    } else {
      alert(`${succeeded}곡을 플레이리스트에 추가했어요.`);
    }
  }

  const selectedCount = selectedIds.size;

  return (
    <div
      className="max-w-md lg:max-w-6xl mx-auto pb-24 relative min-h-screen"
      style={
        {
          "--book-accent": design.accentColor,
          "--book-background": design.backgroundColor,
          "--book-surface": design.surfaceColor,
          "--book-text": design.textColor,
          backgroundColor: design.backgroundColor,
          color: design.textColor,
        } as React.CSSProperties
      }
    >
      <div className="px-5 lg:px-8 pt-5 flex items-center justify-between">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-1 text-[13px] text-white/40 hover:text-white/70"
        >
          <ChevronLeft className="h-4 w-4" /> 노래책 선택으로
        </button>
        <div className="flex items-center gap-4">
          {isOwner && (
            <button
              onClick={() => navigate(`/books/${ownerId}/design`)}
              className="flex items-center gap-1 text-[13px] text-white/40 hover:text-white/70"
            >
              <Palette className="h-3.5 w-3.5" /> 꾸미기
            </button>
          )}
          <button
            onClick={() => navigate(`/books/${ownerId}/playlists`)}
            className="flex items-center gap-1 text-[13px] text-white/40 hover:text-white/70"
          >
            <ListMusic className="h-3.5 w-3.5" /> 플레이리스트
          </button>
          {currentUser && (
            <button
              onClick={() => navigate("/settings")}
              className="flex items-center gap-1 text-[13px] text-white/40 hover:text-white/70"
            >
              <Settings className="h-3.5 w-3.5" /> 설정
            </button>
          )}
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

      {/* 데스크톱: 노래책 제목/소개/곡수(좌) + 검색·정렬·선택(우) 가로 배치. 모바일: 기존처럼 세로로 쌓임 */}
      <div className="lg:grid lg:grid-cols-[1fr_380px] lg:gap-6 lg:items-start lg:px-3">
        <Header
          title={design.title || (bookOwner ? `${bookOwner.name}의 노래책` : "노래책")}
          description={design.description}
          totalCount={songs.length}
          favoriteCount={favoriteCount}
        />

        <div className="lg:pt-7">
          <SearchBar
            value={query}
            onChange={setQuery}
            favOnly={favOnly}
            onToggleFavOnly={() => setFavOnly((v) => !v)}
          />
          <div className="px-5 mt-3 mb-2 flex items-center justify-between gap-2">
            {isOwner && songs.length > 0 ? (
              <button
                type="button"
                onClick={toggleSelectionMode}
                className={`flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-full border ${
                  selectionMode
                    ? "bg-amber-400/15 border-amber-400/40 text-amber-300"
                    : "bg-white/[0.04] border-white/10 text-white/50"
                }`}
              >
                {selectionMode ? <X className="h-3.5 w-3.5" /> : <CheckSquare className="h-3.5 w-3.5" />}
                {selectionMode ? "선택 취소" : "선택"}
              </button>
            ) : (
              <span />
            )}
            <SortSelect value={sortBy} onChange={setSortBy} />
          </div>

          {selectionMode && (
            <div className="px-5 mb-2 flex flex-wrap items-center gap-2 text-[12.5px]">
              <span className="text-white/60">{selectedCount}곡 선택됨</span>
              <button onClick={selectAllOnPage} className="text-amber-300/90 hover:text-amber-300">
                이 페이지 전체 선택
              </button>
              <button onClick={deselectAllOnPage} className="text-white/40 hover:text-white/60">
                전체 해제
              </button>
              {selectedCount > 0 && (
                <div className="flex flex-wrap items-center gap-2 w-full">
                  <button
                    onClick={() => handleBulkFavorite(true)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-white/[0.06] border border-white/10 text-white/60"
                  >
                    <Star className="h-3.5 w-3.5" /> 즐겨찾기
                  </button>
                  <button
                    onClick={() => handleBulkFavorite(false)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-white/[0.06] border border-white/10 text-white/60"
                  >
                    <StarOff className="h-3.5 w-3.5" /> 즐겨찾기 해제
                  </button>
                  {playlists.length > 0 && (
                    <div className="relative">
                      <button
                        onClick={() => setShowPlaylistPicker((v) => !v)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-white/[0.06] border border-white/10 text-white/60"
                      >
                        <ListPlus className="h-3.5 w-3.5" /> 플레이리스트
                      </button>
                      {showPlaylistPicker && (
                        <div className="absolute z-10 mt-1 right-0 rounded-lg bg-[#1c1e2a] border border-white/10 py-1 min-w-[140px]">
                          {playlists.map((p) => (
                            <button
                              key={p.id}
                              onClick={() => handleBulkAddToPlaylist(p.id)}
                              className="block w-full text-left px-3 py-2 text-[12.5px] text-white/70 hover:bg-white/[0.06]"
                            >
                              {p.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <button
                    onClick={handleBulkDelete}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-red-500/10 border border-red-400/30 text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> 삭제
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {loading && <p className="px-5 lg:px-8 text-white/40 text-sm mt-6">불러오는 중...</p>}
      {error && <p className="px-5 lg:px-8 text-red-400 text-sm mt-6">{error}</p>}

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
        <>
          <div
            className={
              design.songDisplay === "card"
                ? "px-5 lg:px-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mt-2"
                : "px-5 lg:px-8 flex flex-col gap-2 mt-1"
            }
          >
            {paginated.map((song) => (
              <SongListItem
                key={song.id}
                song={song}
                isFavorite={favoriteIds.has(song.id)}
                onClick={() => navigate(`/books/${ownerId}/songs/${song.id}`)}
                selectionMode={selectionMode}
                selected={selectedIds.has(song.id)}
                onToggleSelect={() => toggleSelect(song.id)}
                displayMode={design.songDisplay}
                onPlayClick={() => navigate(`/books/${ownerId}/songs/${song.id}/sing`)}
                onFavoriteClick={() => handleFavoriteClick(song.id)}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="px-5 mt-4 flex items-center justify-center gap-3 text-[12.5px] text-white/50">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/10 disabled:opacity-30"
              >
                이전
              </button>
              <span>
                {currentPage} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/10 disabled:opacity-30"
              >
                다음
              </button>
            </div>
          )}
        </>
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
              <Upload className="h-3.5 w-3.5" /> {importing ? "확인 중..." : "JSON/CSV 가져오기"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.csv,text/csv"
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

      {isOwner && !selectionMode && (
        <button
          type="button"
          onClick={() => navigate(`/books/${ownerId}/songs/new`)}
          aria-label="곡 추가"
          className="fixed bottom-20 right-5 h-14 w-14 flex items-center justify-center rounded-full text-[#14161F] shadow-lg z-40"
          style={{ backgroundColor: design.accentColor, maxWidth: "28rem" }}
        >
          <Plus className="h-6 w-6" strokeWidth={2.5} />
        </button>
      )}

      {importPreview && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-[#14161F] border border-white/10 p-5 max-h-[80vh] overflow-y-auto">
            <h2 className="text-[16px] font-semibold">가져오기 미리보기</h2>
            <p className="text-[13px] text-white/60 mt-2">
              총 {importPreview.totalRows}곡 — 정상 {importPreview.valid.length}곡, 오류{" "}
              {importPreview.errors.length}곡
            </p>

            {importPreview.errors.length > 0 && (
              <div className="mt-3 rounded-lg bg-red-500/5 border border-red-400/20 p-3 max-h-40 overflow-y-auto">
                {importPreview.errors.map((e, i) => (
                  <p key={i} className="text-[12px] text-red-400/90">
                    {e.row}번째 행: {e.message}
                  </p>
                ))}
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setImportPreview(null)}
                className="flex-1 rounded-xl bg-white/[0.06] border border-white/10 text-white/70 py-2.5 text-[14px]"
              >
                가져오기 취소
              </button>
              <button
                onClick={confirmImport}
                disabled={importing || importPreview.valid.length === 0}
                className="flex-1 rounded-xl bg-amber-400 text-[#14161F] font-medium py-2.5 text-[14px] disabled:opacity-40"
              >
                {importing ? "가져오는 중..." : `${importPreview.valid.length}곡 가져오기`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
