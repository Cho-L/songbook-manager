import { useEffect, useMemo, useRef, useState } from "react";
import { confirmAsync, notify } from "../components/ui/feedback";
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
  Info, Radio } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import type { SortOption } from "../types/song";

const SONG_SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "recent", label: "최근 등록순" },
  { value: "title", label: "제목순" },
  { value: "artist", label: "가수순" },
  { value: "difficulty", label: "난이도순" },
  { value: "favorite", label: "즐겨찾기순" },
];
import type { Profile } from "../types/user";
import { Header } from "../components/layout/Header";
import { SearchBar } from "../components/layout/SearchBar";
import { SortSelect } from "../components/layout/SortSelect";
import { SongListItem, SongListHeader } from "../components/song/SongListItem";
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
import { getChromeCssVars } from "../utils/color";
import { songsToJSON, songsToCSV, downloadTextFile, BackupParseError } from "../utils/backup";
import {
  normalizeImportedCSV,
  normalizeImportedJSON,
  detectImportFormat,
  toExistingSongSummaries,
  describeExistingDiff,
  type FlexibleImportResult,
} from "../utils/importNormalize";
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

/** 상단 내비게이션 링크 공통 스타일 — 조용한 텍스트 링크, hover 때만 선명해진다. */
const NAV_LINK =
  "flex items-center gap-1 py-1.5 text-[13px] transition-colors text-[color:var(--book-chrome-muted,rgba(255,255,255,0.45))] hover:text-[color:var(--book-chrome-text,rgba(255,255,255,0.85))]";

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
  const [importPreview, setImportPreview] = useState<FlexibleImportResult | null>(null);
  const [showImportHelp, setShowImportHelp] = useState(false);
  const [duplicatePolicy, setDuplicatePolicy] = useState<"skip" | "add">("skip");
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
      notify("즐겨찾기는 로그인 후에 쓸 수 있어요.", "info");
      return;
    }
    toggleFavorite(songId);
  }

  async function handleLogout() {
    await logout();
    navigate("/");
  }

  async function handleDeleteBook() {
    const confirmed = await confirmAsync({
      title: "노래책의 모든 노래를 삭제할까요?",
      message: `등록된 ${songs.length}곡이 모두 삭제돼요.\n이 작업은 되돌릴 수 없어요.`,
      confirmLabel: `${songs.length}곡 모두 삭제`,
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await removeAllSongs();
      notify("노래책의 모든 노래를 삭제했어요.");
    } catch (e) {
      notify(e instanceof Error ? e.message : "노래를 삭제하지 못했어요. 잠시 후 다시 시도해주세요.", "error");
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
      const format = detectImportFormat(file.name);
      const existing = toExistingSongSummaries(songs);
      const result = format === "csv" ? normalizeImportedCSV(text, existing) : normalizeImportedJSON(text, existing);
      setDuplicatePolicy("skip");
      setImportPreview(result);
    } catch (err) {
      if (err instanceof BackupParseError) {
        notify(err.message, "error");
      } else {
        notify("파일을 읽지 못했어요. JSON 또는 CSV 파일이 맞는지 확인해주세요.", "error");
      }
    } finally {
      setImporting(false);
    }
  }

  async function confirmImport() {
    if (!importPreview) return;
    const toImport = importPreview.rows.filter((r) => {
      if (r.status === "duplicate-internal") return false; // 파일 내부 중복은 정책과 무관하게 항상 한 번만
      if (r.status === "duplicate-existing") return duplicatePolicy === "add";
      return true;
    });
    const skippedDuplicates = importPreview.rows.length - toImport.length;
    const warnedRows = new Set(importPreview.warnings.map((w) => w.row));
    const importedWithWarnings = toImport.filter((r) => warnedRows.has(r.row)).length;

    setImporting(true);
    let succeeded = 0;
    try {
      for (const row of toImport) {
        await addSong(row.input);
        succeeded++;
      }
      await reload();
      notify(
        `가져오기 완료 — 노래 ${succeeded}곡을 추가했어요.` +
          (skippedDuplicates > 0 ? ` 중복 ${skippedDuplicates}곡은 건너뛰었어요.` : "") +
          (importPreview.errors.length > 0 ? ` 오류가 있는 ${importPreview.errors.length}곡은 제외했어요.` : "") +
          (importedWithWarnings > 0 ? ` (${importedWithWarnings}곡은 일부 값을 보정했어요.)` : "")
      );
    } catch (err) {
      notify(
        `${toImport.length}곡 중 ${succeeded}곡까지 가져온 뒤 멈췄어요: ${err instanceof Error ? err.message : "알 수 없는 오류"}`,
        "error"
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
    const ok = await confirmAsync({
      title: `선택한 노래 ${ids.length}곡을 삭제할까요?`,
      message: "삭제한 노래는 되돌릴 수 없어요.",
      confirmLabel: `${ids.length}곡 삭제`,
      tone: "danger",
    });
    if (!ok) return;
    const result = await removeManySongs(ids);
    setSelectedIds(new Set());
    if (result.failed > 0) {
      notify(`노래 ${ids.length}곡 중 ${result.succeeded}곡을 삭제했고, ${result.failed}곡은 삭제하지 못했어요.`, "error");
    } else {
      notify(`노래 ${result.succeeded}곡을 삭제했어요.`);
    }
  }

  async function handleBulkFavorite(value: boolean) {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    if (!currentUser) {
      notify("즐겨찾기는 로그인 후에 쓸 수 있어요.", "info");
      return;
    }
    const result = await setManyFavorites(ids, value);
    const verb = value ? "즐겨찾기에 추가" : "즐겨찾기에서 해제";
    if (result.failed > 0) {
      notify(`노래 ${ids.length}곡 중 ${result.succeeded}곡을 ${verb}했고, ${result.failed}곡은 처리하지 못했어요.`, "error");
    } else {
      notify(`노래 ${result.succeeded}곡을 ${verb}했어요.`);
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
      notify(`노래 ${ids.length}곡 중 ${succeeded}곡을 플레이리스트에 추가했고, ${failed}곡은 추가하지 못했어요.`, "error");
    } else {
      notify(`노래 ${succeeded}곡을 플레이리스트에 추가했어요.`);
    }
  }

  const selectedCount = selectedIds.size;

  const importDuplicateExistingCount =
    importPreview?.rows.filter((r) => r.status === "duplicate-existing").length ?? 0;
  const importDuplicateInternalCount =
    importPreview?.rows.filter((r) => r.status === "duplicate-internal").length ?? 0;
  const importToImportCount =
    importPreview?.rows.filter(
      (r) => r.status !== "duplicate-internal" && (r.status !== "duplicate-existing" || duplicatePolicy === "add")
    ).length ?? 0;

  return (
    <div
      className="book-focus max-w-md lg:max-w-6xl mx-auto pb-24 relative min-h-screen"
      style={
        {
          "--book-accent": design.accentColor,
          "--book-background": design.backgroundColor,
          "--book-surface": design.surfaceColor,
          "--book-text": design.textColor,
          ...getChromeCssVars(design.backgroundColor),
          backgroundColor: design.backgroundColor,
          color: design.textColor,
        } as React.CSSProperties
      }
    >
      <div className="px-5 lg:px-8 pt-5 flex flex-wrap items-center justify-between gap-y-2">
        <button
          onClick={() => navigate("/")}
          className={NAV_LINK}
        >
          <ChevronLeft className="h-4 w-4" /> 노래책 선택으로
        </button>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {isOwner && (
            <button
              onClick={() => navigate(`/books/${ownerId}/design`)}
              className={NAV_LINK}
              title="이 노래책의 색상과 노래 목록 모양을 꾸며요 (방문자에게도 똑같이 보여요)"
            >
              <Palette className="h-3.5 w-3.5" /> 노래책 꾸미기
            </button>
          )}
          {isOwner && (
            <button
              onClick={() => navigate(`/books/${ownerId}/overlay-settings`)}
              className={NAV_LINK}
              title="OBS에 띄울 방송 화면(오버레이)을 만들고 연결해요"
            >
              <Radio className="h-3.5 w-3.5" /> 방송 오버레이
            </button>
          )}
          <button
            onClick={() => navigate(`/books/${ownerId}/playlists`)}
            className={NAV_LINK}
          >
            <ListMusic className="h-3.5 w-3.5" /> 플레이리스트
          </button>
          {currentUser && (
            <button
              onClick={() => navigate("/settings")}
              className={NAV_LINK}
              title="노래 부르기 화면에서 내가 보는 글자 크기·글꼴·테마를 정해요 (내 계정에만 적용)"
            >
              <Settings className="h-3.5 w-3.5" /> 내 설정
            </button>
          )}
          {currentUser && (
            <button
              onClick={handleLogout}
              className={NAV_LINK}
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
            actions={
              <>
                {isOwner && songs.length > 0 && (
                  <button
                    type="button"
                    onClick={toggleSelectionMode}
                    aria-pressed={selectionMode}
                    title="여러 노래를 골라 한 번에 삭제하거나 즐겨찾기·플레이리스트에 담아요"
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-[filter] duration-150 hover:brightness-110 active:brightness-95"
                    style={
                      selectionMode
                        ? {
                            backgroundColor: "color-mix(in srgb, var(--book-accent, #fbbf24) 15%, transparent)",
                            borderColor: "color-mix(in srgb, var(--book-accent, #fbbf24) 40%, transparent)",
                            color: "var(--book-accent, #fbbf24)",
                          }
                        : {
                            backgroundColor: "var(--book-chrome-surface, rgba(255,255,255,0.05))",
                            borderColor: "var(--book-chrome-border, rgba(255,255,255,0.1))",
                            color: "var(--book-chrome-muted, rgba(255,255,255,0.5))",
                          }
                    }
                  >
                    {selectionMode ? <X className="h-3.5 w-3.5" /> : <CheckSquare className="h-3.5 w-3.5" />}
                    {selectionMode ? "선택 취소" : "여러 곡 선택"}
                  </button>
                )}
                <span className="ml-auto">
                  <SortSelect value={sortBy} onChange={setSortBy} options={SONG_SORT_OPTIONS} />
                </span>
              </>
            }
          />

          {selectionMode && (
            <div className="px-5 mb-2 flex flex-wrap items-center gap-2 text-[12.5px]">
              <span className="text-[color:var(--book-chrome-text,rgba(255,255,255,0.7))]">{selectedCount}곡 선택됨</span>
              <button
                onClick={selectAllOnPage}
                className="hover:brightness-110"
                style={{ color: "var(--book-accent, #fbbf24)" }}
              >
                이 페이지 전체 선택
              </button>
              <button onClick={deselectAllOnPage} className="text-[color:var(--book-chrome-muted,rgba(255,255,255,0.5))] hover:text-[color:var(--book-chrome-text,rgba(255,255,255,0.7))]">
                전체 해제
              </button>
              {selectedCount > 0 && (
                <div className="flex flex-wrap items-center gap-2 w-full">
                  <button
                    onClick={() => handleBulkFavorite(true)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-[var(--book-chrome-surface,rgba(255,255,255,0.05))] border border-[color:var(--book-chrome-border,rgba(255,255,255,0.1))] text-[color:var(--book-chrome-muted,rgba(255,255,255,0.5))]"
                  >
                    <Star className="h-3.5 w-3.5" /> 즐겨찾기
                  </button>
                  <button
                    onClick={() => handleBulkFavorite(false)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-[var(--book-chrome-surface,rgba(255,255,255,0.05))] border border-[color:var(--book-chrome-border,rgba(255,255,255,0.1))] text-[color:var(--book-chrome-muted,rgba(255,255,255,0.5))]"
                  >
                    <StarOff className="h-3.5 w-3.5" /> 즐겨찾기 해제
                  </button>
                  {playlists.length > 0 && (
                    <div className="relative">
                      <button
                        onClick={() => setShowPlaylistPicker((v) => !v)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-[var(--book-chrome-surface,rgba(255,255,255,0.05))] border border-[color:var(--book-chrome-border,rgba(255,255,255,0.1))] text-[color:var(--book-chrome-muted,rgba(255,255,255,0.5))]"
                      >
                        <ListPlus className="h-3.5 w-3.5" /> 플레이리스트
                      </button>
                      {showPlaylistPicker && (
                        <div className="absolute z-10 mt-1 right-0 rounded-lg bg-[var(--book-background,#1c1e2a)] border border-[color:var(--book-chrome-border,rgba(255,255,255,0.1))] py-1 min-w-[140px]">
                          {playlists.map((p) => (
                            <button
                              key={p.id}
                              onClick={() => handleBulkAddToPlaylist(p.id)}
                              className="block w-full text-left px-3 py-2 text-[12.5px] text-[color:var(--book-chrome-text,rgba(255,255,255,0.7))] hover:bg-[var(--book-chrome-surface,rgba(255,255,255,0.05))]"
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

      {loading && <p className="px-5 lg:px-8 text-[color:var(--book-chrome-muted,rgba(255,255,255,0.5))] text-sm mt-6">불러오는 중...</p>}
      {error && <p className="px-5 lg:px-8 text-red-400 text-sm mt-6">{error}</p>}

      {!loading && !error && filtered.length === 0 ? (
        <EmptyState
          query={songs.length > 0 ? emptyQueryLabel : ""}
          onAddClick={
            songs.length === 0 && isOwner
              ? () => navigate(`/books/${ownerId}/songs/new`)
              : undefined
          }
          onClearFilters={() => {
            setQuery("");
            setFavOnly(false);
          }}
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
            {design.songDisplay !== "card" && <SongListHeader selectionMode={selectionMode} />}
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
            <div className="px-5 lg:px-8 mt-6 flex items-center justify-center gap-3 text-[12.5px] text-[color:var(--book-chrome-muted,rgba(255,255,255,0.5))]">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-2.5 py-1.5 rounded-lg bg-[var(--book-chrome-surface,rgba(255,255,255,0.05))] border border-[color:var(--book-chrome-border,rgba(255,255,255,0.1))] disabled:opacity-30"
              >
                이전
              </button>
              <span>
                {currentPage} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-2.5 py-1.5 rounded-lg bg-[var(--book-chrome-surface,rgba(255,255,255,0.05))] border border-[color:var(--book-chrome-border,rgba(255,255,255,0.1))] disabled:opacity-30"
              >
                다음
              </button>
            </div>
          )}
        </>
      )}

      {isOwner && (
        <div className="px-5 lg:px-8 mt-10">
          <div className="flex items-center justify-between mb-2">
            <div className="min-w-0 flex-1 pr-2">
              <p className="text-[12px] font-medium text-[color:var(--book-chrome-text,rgba(255,255,255,0.7))]">노래 가져오기 · 내보내기</p>
              <p className="text-[11px] mt-0.5 text-[color:var(--book-chrome-muted,rgba(255,255,255,0.4))]">
                다른 곳의 노래를 파일로 한꺼번에 옮겨오거나, 지금 노래들을 파일로 백업해요.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowImportHelp((v) => !v)}
              className="shrink-0 whitespace-nowrap py-1.5 flex items-center gap-1 text-[11px] text-[color:var(--book-chrome-muted,rgba(255,255,255,0.4))] hover:text-[color:var(--book-chrome-text,rgba(255,255,255,0.7))]"
            >
              <Info className="h-3 w-3" /> {showImportHelp ? "안내 닫기" : "가져오기 사용법"}
            </button>
          </div>

          {showImportHelp && (
            <div className="rounded-lg bg-[var(--book-chrome-surface,rgba(255,255,255,0.04))] border border-[color:var(--book-chrome-border,rgba(255,255,255,0.08))] p-3 mb-3 text-[12px] text-[color:var(--book-chrome-muted,rgba(255,255,255,0.5))] leading-relaxed space-y-2">
              <p>
                <span className="text-[color:var(--book-chrome-text,rgba(255,255,255,0.7))]">가져오기(Import)</span> — CSV 또는 JSON 파일을 가져올
                수 있어요. CSV는 컬럼명을 기준으로 자동 매핑해서 컬럼 순서가 달라도 정상적으로
                인식하고, 일부 필드가 없거나 모르는 필드가 섞여 있어도 인식 가능한 데이터는 최대한
                가져와요. 인식되지 않은 필드는 미리보기에서 확인할 수 있고, 제목(title)을 확인할 수
                없는 행만 가져오기 대상에서 제외돼요. 단, 컬럼명이 없는 CSV는 순서를 추측해서 읽지
                않으니 첫 줄에 컬럼명을 넣어주세요. JSON은 곡 배열, <code className="text-[color:var(--book-chrome-text,rgba(255,255,255,0.7))]">{`{songs:[...]}`}</code>,{" "}
                <code className="text-[color:var(--book-chrome-text,rgba(255,255,255,0.7))]">{`{data:[...]}`}</code>, 곡 1개짜리 단일 객체를 모두
                지원해요.
              </p>
              <p>
                이미 노래책에 있는 곡(제목+가수가 같은 곡)은 미리보기에서 중복으로 표시돼요. 기본적으로
                중복 곡은 건너뛰고 기존 곡을 자동으로 덮어쓰지 않아요. 원하면 중복도 새 곡으로
                추가하도록 바꿀 수 있어요. 같은 파일 안에 똑같은 곡이 여러 번 들어있으면 한 번만
                가져와요.
              </p>
              <p>
                처리 순서: 파일 선택 → 형식 감지 → 필드 자동 매핑 → 값 정리 → 데이터 검증 → 중복
                검사 → 미리보기 확인 → 저장. 파일을 선택해도 바로 저장되지 않고, 미리보기에서
                확인한 뒤 "가져오기" 버튼을 눌러야 실제로 저장돼요.
              </p>
              <p>
                가져오는 과정에서 변환 가능한 값은 자동으로 정리돼요 (예: "120 BPM"→120,
                "Level 3"→3). 자동 변환이 일어났거나 가수처럼 비어 있는 값이 있으면 미리보기에서
                경고로 표시되지만 Import는 계속 진행돼요. 복구할 수 없는 행(제목을 확인할 수 없는
                경우 등)만 오류로 표시되고 제외되며, 나머지 정상 행은 계속 가져와요.
              </p>
              <p>
                예시 CSV:{" "}
                <code className="text-[color:var(--book-chrome-text,rgba(255,255,255,0.7))]">title,artist,difficulty</code> 또는{" "}
                <code className="text-[color:var(--book-chrome-text,rgba(255,255,255,0.7))]">노래제목,가수,난이도</code>
                {" · "}예시 JSON:{" "}
                <code className="text-[color:var(--book-chrome-text,rgba(255,255,255,0.7))]">{`[{"title":"밤편지","artist":"아이유"}]`}</code>
              </p>
              <p>
                <span className="text-[color:var(--book-chrome-text,rgba(255,255,255,0.7))]">내보내기(Export)</span> — 현재 노래책의 곡 데이터를
                JSON 또는 CSV 파일로 저장할 수 있어요. 내보낸 파일은 나중에 다시 가져오기에 쓸 수
                있어요. 단, 곡 정보만 포함되고 즐겨찾기·플레이리스트·노래책 디자인은 파일에
                포함되지 않아요.
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleExportJSON}
              disabled={songs.length === 0}
              title={songs.length === 0 ? "내보낼 노래가 아직 없어요" : undefined}
              className="disabled:opacity-40 flex items-center gap-1.5 text-[12.5px] px-3 py-1.5 rounded-full bg-[var(--book-chrome-surface,rgba(255,255,255,0.04))] border border-[color:var(--book-chrome-border,rgba(255,255,255,0.1))] text-[color:var(--book-chrome-muted,rgba(255,255,255,0.6))] transition-[filter] duration-150 hover:brightness-125 active:brightness-95"
            >
              <Download className="h-3.5 w-3.5" /> JSON 내보내기
            </button>
            <button
              type="button"
              onClick={handleExportCSV}
              disabled={songs.length === 0}
              title={songs.length === 0 ? "내보낼 노래가 아직 없어요" : undefined}
              className="disabled:opacity-40 flex items-center gap-1.5 text-[12.5px] px-3 py-1.5 rounded-full bg-[var(--book-chrome-surface,rgba(255,255,255,0.04))] border border-[color:var(--book-chrome-border,rgba(255,255,255,0.1))] text-[color:var(--book-chrome-muted,rgba(255,255,255,0.6))] transition-[filter] duration-150 hover:brightness-125 active:brightness-95"
            >
              <Download className="h-3.5 w-3.5" /> CSV 내보내기
            </button>
            <button
              type="button"
              onClick={handleImportClick}
              disabled={importing}
              className="flex items-center gap-1.5 text-[12.5px] px-3 py-1.5 rounded-full bg-[var(--book-chrome-surface,rgba(255,255,255,0.04))] border border-[color:var(--book-chrome-border,rgba(255,255,255,0.1))] text-[color:var(--book-chrome-muted,rgba(255,255,255,0.6))] transition-[filter] duration-150 hover:brightness-125 active:brightness-95 disabled:opacity-50"
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
        <div className="mx-5 lg:mx-8 mt-6 pt-5 border-t border-[color:var(--book-chrome-border,rgba(255,255,255,0.08))]">
          <button
            type="button"
            onClick={handleDeleteBook}
            className="flex items-center gap-1.5 text-[12.5px] text-red-400/70 hover:text-red-400"
          >
            <Trash2 className="h-3.5 w-3.5" /> 노래책의 모든 노래 삭제
          </button>
        </div>
      )}

      {isOwner && !selectionMode && (
        <button
          type="button"
          onClick={() => navigate(`/books/${ownerId}/songs/new`)}
          aria-label="노래 추가"
          className="fixed bottom-20 right-5 h-12 pl-4 pr-5 flex items-center justify-center gap-1.5 rounded-full text-[#14161F] text-[14px] font-semibold shadow-lg z-40 transition-[filter] hover:brightness-110 active:brightness-95"
          style={{ backgroundColor: design.accentColor, maxWidth: "28rem" }}
        >
          <Plus className="h-5 w-5" strokeWidth={2.5} /> 노래 추가
        </button>
      )}

      {importPreview && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-4">
          {/* 모달은 노래책 테마(밝은 배경 포함)와 무관하게 항상 어두운 패널이므로 글자색을 명시한다.
              (명시하지 않으면 밝은 노래책에서 어두운 textColor를 상속해 제목이 안 보인다) */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label="가져오기 미리보기"
            className="w-full max-w-md rounded-2xl bg-[#14161F] border border-white/10 text-white max-h-[85vh] flex flex-col overflow-hidden"
          >
            <div className="px-5 pt-5 pb-4 border-b border-white/10 shrink-0">
              <h2 className="text-[16px] font-semibold text-white">가져오기 미리보기</h2>
              <p className="text-[13px] text-white/60 mt-2">
                감지된 형식: {importPreview.detectedFormat === "csv" ? "CSV" : "JSON"} · 총{" "}
                {importPreview.totalRows}곡
              </p>
              <p className="text-[13px] text-white/60 mt-0.5">
                신규 {importPreview.newCount}곡 · 중복 {importPreview.duplicateCount}곡 · 오류{" "}
                {importPreview.errors.length}곡
                {importPreview.warnings.length > 0 && ` · 경고 ${importPreview.warnings.length}건`}
              </p>
              <p className="text-[12px] text-white/40 mt-1">
                매핑된 필드 {importPreview.mappedFieldCount}개
                {importPreview.unrecognizedFields.length > 0 &&
                  ` · 인식되지 않은 컬럼: ${importPreview.unrecognizedFields.join(", ")}`}
              </p>
            </div>

            <div className="px-5 py-4 overflow-y-auto flex-1 min-h-0 [&>*:first-child]:mt-0">
            {importPreview.duplicateCount > 0 && (
              <div className="mt-3">
                <p className="text-[12px] text-white/50 mb-1.5">중복 처리 방식</p>
                <div className="flex flex-col gap-1.5 text-[12.5px] text-white/70">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      className="accent-[var(--book-accent,#fbbf24)]"
                      name="duplicatePolicy"
                      checked={duplicatePolicy === "skip"}
                      onChange={() => setDuplicatePolicy("skip")}
                    />
                    중복 건너뛰기 (기본값)
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      className="accent-[var(--book-accent,#fbbf24)]"
                      name="duplicatePolicy"
                      checked={duplicatePolicy === "add"}
                      onChange={() => setDuplicatePolicy("add")}
                    />
                    중복도 새 곡으로 추가
                  </label>
                </div>
              </div>
            )}

            {(importDuplicateExistingCount > 0 || importDuplicateInternalCount > 0) && (
              <div className="mt-3 rounded-lg bg-white/[0.04] border border-white/10 p-3 max-h-36 overflow-y-auto">
                {importPreview.rows
                  .filter((r) => r.status !== "new")
                  .map((r, i) => (
                    <p key={i} className="text-[12px] text-white/60">
                      {r.row}번째 행: {r.status === "duplicate-existing" ? "↻ 기존 곡과 중복" : "↻ Import 파일 내 중복"} —{" "}
                      {r.input.title} - {r.input.artist}
                      {r.status === "duplicate-existing" &&
                        r.existingSong &&
                        (() => {
                          const diff = describeExistingDiff(r.existingSong, r.input);
                          return diff ? ` (${diff})` : "";
                        })()}
                    </p>
                  ))}
              </div>
            )}

            {importPreview.warnings.length > 0 && (
              <div className="mt-3 rounded-lg bg-amber-400/5 border border-amber-400/20 p-3 max-h-32 overflow-y-auto">
                {importPreview.warnings.map((w, i) => (
                  <p key={i} className="text-[12px] text-amber-300/90">
                    ⚠ {w.row}번째 행: {w.message}
                  </p>
                ))}
              </div>
            )}

            {importPreview.errors.length > 0 && (
              <div className="mt-3 rounded-lg bg-red-500/5 border border-red-400/20 p-3 max-h-40 overflow-y-auto">
                {importPreview.errors.map((e, i) => (
                  <p key={i} className="text-[12px] text-red-400/90">
                    {e.row}번째 행: {e.message}
                  </p>
                ))}
              </div>
            )}

            {importToImportCount === 0 && (
              <p className="mt-3 text-[12.5px] text-white/40">
                {importPreview.rows.length === 0
                  ? importPreview.totalRows === 0
                    ? "파일에서 곡 데이터를 찾지 못했어요 — 제목 줄 아래에 곡이 한 줄 이상 있어야 해요."
                    : "가져올 수 있는 곡이 없어요 — 모든 행에 오류가 있어요."
                  : "가져올 곡이 없어요 — 모든 곡이 기존 곡과 중복이에요. 새 곡으로 추가하려면 위에서 \"중복도 새 곡으로 추가\"를 선택하세요."}
              </p>
            )}

            </div>

            <div className="px-5 py-4 border-t border-white/10 flex gap-2 shrink-0">
              <button
                onClick={() => setImportPreview(null)}
                className="flex-1 rounded-xl bg-white/[0.06] border border-white/10 text-white/70 py-2.5 text-[14px] transition-[filter] duration-150 hover:brightness-110 active:brightness-95"
              >
                가져오기 취소
              </button>
              <button
                onClick={confirmImport}
                disabled={importing || importToImportCount === 0}
                className="flex-1 rounded-xl bg-[var(--book-accent,#fbbf24)] text-[#14161F] font-medium py-2.5 text-[14px] disabled:opacity-40 transition-[filter] duration-150 hover:brightness-110 active:brightness-95"
              >
                {importing
                  ? "가져오는 중..."
                  : importToImportCount === 0
                  ? "가져올 곡 없음"
                  : `${importToImportCount}곡 가져오기`}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 하단 고정 "노래 추가" 버튼이 마지막 항목을 가리지 않도록 여백 */}
      {isOwner && <div className="h-24" aria-hidden="true" />}
    </div>
  );
}
