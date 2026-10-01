import { useNavigate, useParams } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { useBookDesign } from "../hooks/useBookDesign";
import { canManageBook } from "../utils/permissions";
import { getChromeCssVars } from "../utils/color";
import { BOOK_DESIGN_PRESETS } from "../types/bookDesign";
import type { BookDesignPreset, SongDisplayMode } from "../types/bookDesign";
import { SongListItem } from "../components/song/SongListItem";
import type { Song } from "../types/song";

const PRESET_OPTIONS: { value: BookDesignPreset; label: string }[] = [
  { value: "default", label: "기본" },
  { value: "dark", label: "다크" },
  { value: "light", label: "라이트" },
  { value: "minimal", label: "미니멀" },
  { value: "modern", label: "모던" },
];

const SAMPLE_SONGS: Song[] = [
  {
    id: "preview-1",
    ownerId: "preview",
    title: "밤편지",
    artist: "아이유",
    genre: "발라드",
    difficulty: 3,
    tags: [],
    favorite: false,
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "preview-2",
    ownerId: "preview",
    title: "여름 신호",
    artist: "샘플 밴드",
    genre: "팝",
    difficulty: 2,
    tags: [],
    favorite: false,
    createdAt: "",
    updatedAt: "",
  },
];

export function BookDesignPage() {
  const { ownerId } = useParams();
  const navigate = useNavigate();
  const { profile: currentUser } = useAuth();
  const { design, error, update } = useBookDesign(ownerId);

  if (!canManageBook(currentUser, ownerId)) {
    return (
      <div className="max-w-md mx-auto px-5 pt-10 text-center text-white/50 text-sm">
        이 노래책을 관리할 권한이 없어요.
      </div>
    );
  }

  const labelCls = "text-xs text-white/45 mb-1.5 block";
  const inputCls =
    "w-full rounded-lg bg-white/[0.06] border border-white/10 px-3 py-2.5 text-[14px] text-white outline-none focus:border-amber-400/50";
  const selectCls = inputCls;

  return (
    <div className="max-w-md lg:max-w-5xl mx-auto min-h-screen px-5 lg:px-8 pt-8 pb-16">
      <button
        onClick={() => navigate(`/books/${ownerId}`)}
        className="flex items-center gap-1 py-1.5 text-[13px] text-white/40 hover:text-white/70"
      >
        <ChevronLeft className="h-4 w-4" /> 노래책으로
      </button>
      <h1 className="text-xl font-semibold font-serif mt-4">노래책 꾸미기</h1>
      <p className="text-white/40 text-[13px] mt-1.5 max-w-xl">
        여기서 바꾼 디자인은 이 노래책을 보는 모든 사람에게 똑같이 보여요 (SongMode
        개인 설정과는 별개예요).
      </p>

      {error && (
        <p className="text-[13px] text-red-400 mt-3">
          {error} — 값은 화면에만 보이고 저장은 안 됐을 수 있어요.
        </p>
      )}

      {/* 데스크톱: 설정(좌) + 미리보기(우, sticky). 모바일: 설정 → 미리보기 순서로 1열 */}
      <div className="mt-6 lg:grid lg:grid-cols-[1fr_400px] lg:gap-10 lg:items-start">
        <div className="flex flex-col gap-5 order-2 lg:order-1">
          <div>
            <label className={labelCls}>디자인 프리셋</label>
            <select aria-label="디자인 프리셋"
              className={selectCls}
              value={design.preset}
              onChange={(e) => {
                const preset = e.target.value as BookDesignPreset;
                update({ preset, ...BOOK_DESIGN_PRESETS[preset] });
              }}
            >
              {PRESET_OPTIONS.map((o) => (
                <option key={o.value} value={o.value} className="bg-[#14161F]">
                  {o.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-white/30 mt-1.5">
              프리셋을 고르면 아래 색상들이 한 번에 바뀌어요. 그 다음 색상은
              자유롭게 다시 조정할 수 있어요.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className={labelCls}>강조색</label>
              <input aria-label="강조색"
                type="color"
                value={design.accentColor}
                onChange={(e) => update({ accentColor: e.target.value })}
                className="w-full h-10 rounded-lg bg-white/[0.06] border border-white/10 cursor-pointer"
              />
            </div>
            <div>
              <label className={labelCls}>배경색</label>
              <input aria-label="배경색"
                type="color"
                value={design.backgroundColor}
                onChange={(e) => update({ backgroundColor: e.target.value })}
                className="w-full h-10 rounded-lg bg-white/[0.06] border border-white/10 cursor-pointer"
              />
            </div>
            <div>
              <label className={labelCls}>카드 표면색</label>
              <input aria-label="카드 표면색"
                type="color"
                value={design.surfaceColor}
                onChange={(e) => update({ surfaceColor: e.target.value })}
                className="w-full h-10 rounded-lg bg-white/[0.06] border border-white/10 cursor-pointer"
              />
            </div>
            <div>
              <label className={labelCls}>텍스트 색상</label>
              <input aria-label="텍스트 색상"
                type="color"
                value={design.textColor}
                onChange={(e) => update({ textColor: e.target.value })}
                className="w-full h-10 rounded-lg bg-white/[0.06] border border-white/10 cursor-pointer"
              />
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-5">
            <div>
              <label className={labelCls}>노래책 제목 (비워두면 기본값)</label>
              <input aria-label="노래책 제목 (비워두면 기본값)"
                className={inputCls}
                value={design.title ?? ""}
                onChange={(e) => update({ title: e.target.value || null })}
                placeholder={`${currentUser?.name ?? "나"}의 노래책`}
              />
            </div>
            <div>
              <label className={labelCls}>소개 문구 (선택)</label>
              <input aria-label="소개 문구 (선택)"
                className={inputCls}
                value={design.description ?? ""}
                onChange={(e) => update({ description: e.target.value || null })}
                placeholder="예: 매주 화요일 밴드 연습곡 모음"
              />
            </div>
          </div>

          <div>
            <label className={labelCls}>곡 표시 방식</label>
            <select aria-label="곡 표시 방식"
              className={selectCls}
              value={design.songDisplay}
              onChange={(e) => update({ songDisplay: e.target.value as SongDisplayMode })}
            >
              <option value="list" className="bg-[#14161F]">
                리스트형 — 정보 밀도 높은 세로 목록
              </option>
              <option value="card" className="bg-[#14161F]">
                카드형 — 데스크톱에서 그리드로 표시
              </option>
            </select>
          </div>
        </div>

        {/* 실시간 미리보기: 실제 HomePage와 동일한 SongListItem을 그대로 재사용 */}
        <div className="order-1 lg:order-2 mb-8 lg:mb-0 lg:sticky lg:top-8">
          <p className="text-[11px] text-white/30 mb-2">미리보기</p>
          <div
            className="rounded-2xl border overflow-hidden p-4"
            style={
              {
                backgroundColor: design.backgroundColor,
                borderColor: "rgba(255,255,255,0.1)",
                "--book-accent": design.accentColor,
                "--book-background": design.backgroundColor,
                "--book-surface": design.surfaceColor,
                "--book-text": design.textColor,
                ...getChromeCssVars(design.backgroundColor),
                color: design.textColor,
              } as React.CSSProperties
            }
          >
            <p className="text-[15px] font-semibold font-serif">
              {design.title || `${currentUser?.name ?? "나"}의 노래책`}
            </p>
            {design.description && (
              <p className="text-[11px] mt-1 opacity-70">{design.description}</p>
            )}

            <div
              className={
                design.songDisplay === "card"
                  ? "grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4"
                  : "flex flex-col gap-2 mt-4"
              }
            >
              {SAMPLE_SONGS.map((song) => (
                <SongListItem
                  key={song.id}
                  song={song}
                  isFavorite={song.id === "preview-1"}
                  onClick={() => {}}
                  onPlayClick={() => {}}
                  displayMode={design.songDisplay}
                />
              ))}
            </div>

            <button
              className="text-[12px] px-3 py-1.5 rounded-full mt-4"
              style={{ backgroundColor: design.accentColor, color: "#14161F" }}
            >
              버튼 예시
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
