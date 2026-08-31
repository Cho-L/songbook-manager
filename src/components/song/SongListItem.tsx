import { Star, Check, Play } from "lucide-react";
import type { Song } from "../../types/song";
import { DifficultyDots } from "./DifficultyDots";

interface SongListItemProps {
  song: Song;
  isFavorite: boolean;
  onClick: () => void;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  /** 노래책 디자인 설정의 곡 표시 방식 - 기본은 지금까지의 리스트형 */
  displayMode?: "list" | "card";
  /** 제공하면 리스트/카드에 재생(▶) 바로가기 버튼이 노출됨 */
  onPlayClick?: () => void;
  /** 제공하면 즐겨찾기 별이 실제로 클릭 가능해짐 (선택 모드에서는 항상 숨김) */
  onFavoriteClick?: () => void;
}

function SelectCheckbox({ selected }: { selected: boolean }) {
  return (
    <span
      className="shrink-0 h-5 w-5 rounded-md border flex items-center justify-center"
      style={
        selected
          ? { backgroundColor: "var(--book-accent, #fbbf24)", borderColor: "var(--book-accent, #fbbf24)" }
          : { borderColor: "rgba(255,255,255,0.25)" }
      }
      aria-hidden="true"
    >
      {selected && <Check className="h-3.5 w-3.5 text-[#14161F]" strokeWidth={3} />}
    </span>
  );
}

interface FavoriteStarProps {
  isFavorite: boolean;
  onFavoriteClick?: () => void;
  size: "sm" | "md";
}

/** 즐겨찾기 별 - onFavoriteClick이 있으면 실제 클릭 가능한 토글 버튼, 없으면(예: 미리보기) 읽기전용 표시 */
function FavoriteStar({ isFavorite, onFavoriteClick, size }: FavoriteStarProps) {
  const iconCls = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  const style = isFavorite
    ? { fill: "var(--book-accent, #fbbf24)", color: "var(--book-accent, #fbbf24)" }
    : { color: "rgba(255,255,255,0.3)" };

  if (!onFavoriteClick) {
    // 읽기전용(예: 클릭 핸들러를 안 넘기는 미리보기) - 즐겨찾기 아니면 아무것도 안 그림
    return isFavorite ? <Star className={iconCls} style={style} /> : null;
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onFavoriteClick();
      }}
      aria-label={isFavorite ? "즐겨찾기 해제" : "즐겨찾기 추가"}
      aria-pressed={isFavorite}
      className="p-0.5 -m-0.5"
    >
      <Star className={iconCls} style={style} />
    </button>
  );
}

export function SongListItem({
  song,
  isFavorite,
  onClick,
  selectionMode = false,
  selected = false,
  onToggleSelect,
  displayMode = "list",
  onPlayClick,
  onFavoriteClick,
}: SongListItemProps) {
  const selectedStyle =
    selectionMode && selected
      ? {
          backgroundColor: "color-mix(in srgb, var(--book-accent, #fbbf24) 10%, transparent)",
          borderColor: "color-mix(in srgb, var(--book-accent, #fbbf24) 40%, transparent)",
        }
      : undefined;

  function handlePlayClick(e: React.MouseEvent) {
    e.stopPropagation();
    onPlayClick?.();
  }

  // 카드형: 세로로 쌓인 독립된 표면 — 정보 밀도보다 개별 곡의 존재감을 우선한다.
  // 제목/아티스트/메타(난이도)/액션(즐겨찾기·재생) 영역이 시각적으로 분리되어 있다.
  if (displayMode === "card") {
    return (
      <div
        onClick={selectionMode ? onToggleSelect : onClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && (selectionMode ? onToggleSelect?.() : onClick())}
        aria-pressed={selectionMode ? selected : undefined}
        className="text-left rounded-2xl border flex flex-col gap-4 transition w-full h-full p-5 cursor-pointer"
        style={
          selectedStyle ?? {
            backgroundColor: "color-mix(in srgb, var(--book-surface, #ffffff) 6%, transparent)",
            borderColor: "color-mix(in srgb, var(--book-surface, #ffffff) 10%, transparent)",
          }
        }
      >
        {/* 상단: 선택 체크박스 또는 장르 태그 */}
        <div className="flex items-start justify-between gap-2">
          {selectionMode ? (
            <SelectCheckbox selected={selected} />
          ) : (
            <span className="text-[11px] uppercase tracking-wide text-white/30">
              {song.genre || "곡"}
            </span>
          )}
        </div>

        {/* 제목/아티스트 영역 */}
        <div>
          <div className="text-[17px] font-semibold leading-snug break-words">{song.title}</div>
          <div className="text-[13px] text-white/50 truncate mt-1">{song.artist}</div>
        </div>

        {/* 메타데이터 영역 */}
        <div className="flex items-center gap-3 text-[11px] text-white/35">
          <DifficultyDots value={song.difficulty} />
          {song.key && <span>Key {song.key}</span>}
        </div>

        {/* 구분선 + 액션 영역 */}
        <div
          className="flex items-center justify-between pt-3 mt-auto border-t"
          style={{ borderColor: "color-mix(in srgb, var(--book-surface, #ffffff) 12%, transparent)" }}
        >
          {!selectionMode ? (
            <FavoriteStar isFavorite={isFavorite} onFavoriteClick={onFavoriteClick} size="md" />
          ) : (
            <span />
          )}
          {onPlayClick && (
            <button
              type="button"
              onClick={handlePlayClick}
              aria-label="노래 부르기"
              className="h-7 w-7 rounded-full flex items-center justify-center"
              style={{ backgroundColor: "var(--book-accent, #fbbf24)", color: "#14161F" }}
            >
              <Play className="h-3.5 w-3.5" fill="currentColor" />
            </button>
          )}
        </div>
      </div>
    );
  }

  // 리스트형: 한 줄, 정보 밀도 우선 — 제목/가수가 왼쪽, 난이도·즐겨찾기·재생이 오른쪽 액션 클러스터
  return (
    <div
      onClick={selectionMode ? onToggleSelect : onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && (selectionMode ? onToggleSelect?.() : onClick())}
      aria-pressed={selectionMode ? selected : undefined}
      className="text-left rounded-xl border px-4 py-3.5 flex items-center gap-3 transition w-full cursor-pointer"
      style={selectedStyle ?? { backgroundColor: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.06)" }}
    >
      {selectionMode && <SelectCheckbox selected={selected} />}
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-medium truncate">{song.title}</div>
        <div className="text-[12.5px] text-white/45 truncate mt-0.5">
          {song.artist}
          {song.genre ? ` · ${song.genre}` : ""}
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <DifficultyDots value={song.difficulty} />
        {!selectionMode && (
          <FavoriteStar isFavorite={isFavorite} onFavoriteClick={onFavoriteClick} size="sm" />
        )}
        {onPlayClick && (
          <button
            type="button"
            onClick={handlePlayClick}
            aria-label="노래 부르기"
            className="h-6 w-6 rounded-full flex items-center justify-center"
            style={{ backgroundColor: "var(--book-accent, #fbbf24)", color: "#14161F" }}
          >
            <Play className="h-3 w-3" fill="currentColor" />
          </button>
        )}
      </div>
    </div>
  );
}
