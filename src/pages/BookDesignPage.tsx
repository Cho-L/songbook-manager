import { useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, Star } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { useBookDesign } from "../hooks/useBookDesign";
import { canManageBook } from "../utils/permissions";
import { BOOK_DESIGN_PRESETS } from "../types/bookDesign";
import type { BookDesignPreset, SongDisplayMode } from "../types/bookDesign";

const PRESET_OPTIONS: { value: BookDesignPreset; label: string }[] = [
  { value: "default", label: "기본" },
  { value: "dark", label: "다크" },
  { value: "light", label: "라이트" },
  { value: "minimal", label: "미니멀" },
  { value: "modern", label: "모던" },
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
    <div className="max-w-md mx-auto min-h-screen px-5 pt-8 pb-16">
      <button
        onClick={() => navigate(`/books/${ownerId}`)}
        className="flex items-center gap-1 text-[13px] text-white/40 hover:text-white/70"
      >
        <ChevronLeft className="h-4 w-4" /> 노래책으로
      </button>
      <h1 className="text-xl font-semibold font-serif mt-4">노래책 꾸미기</h1>
      <p className="text-white/40 text-[13px] mt-1.5">
        여기서 바꾼 디자인은 이 노래책을 보는 모든 사람에게 똑같이 보여요 (SongMode
        개인 설정과는 별개예요).
      </p>

      {error && (
        <p className="text-[13px] text-red-400 mt-3">
          {error} — 값은 화면에만 보이고 저장은 안 됐을 수 있어요.
        </p>
      )}

      {/* 실시간 미리보기 */}
      <div
        className="mt-5 rounded-2xl border overflow-hidden"
        style={{ backgroundColor: design.backgroundColor, borderColor: "rgba(255,255,255,0.1)" }}
      >
        <div className="px-4 pt-4 pb-3">
          <p className="text-[15px] font-semibold font-serif" style={{ color: design.textColor }}>
            {design.title || `${currentUser?.name ?? "나"}의 노래책`}
          </p>
          {design.description && (
            <p className="text-[11px] mt-1 opacity-70" style={{ color: design.textColor }}>
              {design.description}
            </p>
          )}
        </div>
        <div className="px-4 pb-4 flex flex-col gap-2">
          <div
            className={`flex items-center gap-2 px-3 py-2.5 border ${
              design.songDisplay === "card" ? "rounded-xl" : "rounded-lg"
            }`}
            style={{ borderColor: "rgba(255,255,255,0.1)" }}
          >
            <span className="text-[13px] flex-1" style={{ color: design.textColor }}>
              밤편지
            </span>
            <Star className="h-3.5 w-3.5" style={{ fill: design.accentColor, color: design.accentColor }} />
          </div>
          <button
            className="text-[12px] px-3 py-1.5 rounded-full self-start"
            style={{ backgroundColor: design.accentColor, color: "#14161F" }}
          >
            버튼 예시
          </button>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-5">
        <div>
          <label className={labelCls}>디자인 프리셋</label>
          <select
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
            프리셋을 고르면 아래 색상 4개가 한 번에 바뀌어요. 그 다음 색상은 자유롭게
            다시 조정할 수 있어요.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>강조색</label>
            <input
              type="color"
              value={design.accentColor}
              onChange={(e) => update({ accentColor: e.target.value })}
              className="w-full h-10 rounded-lg bg-white/[0.06] border border-white/10 cursor-pointer"
            />
          </div>
          <div>
            <label className={labelCls}>배경색</label>
            <input
              type="color"
              value={design.backgroundColor}
              onChange={(e) => update({ backgroundColor: e.target.value })}
              className="w-full h-10 rounded-lg bg-white/[0.06] border border-white/10 cursor-pointer"
            />
          </div>
        </div>

        <div>
          <label className={labelCls}>텍스트 색상</label>
          <input
            type="color"
            value={design.textColor}
            onChange={(e) => update({ textColor: e.target.value })}
            className="w-full h-10 rounded-lg bg-white/[0.06] border border-white/10 cursor-pointer"
          />
        </div>

        <div>
          <label className={labelCls}>노래책 제목 (비워두면 "OO의 노래책" 기본값)</label>
          <input
            className={inputCls}
            value={design.title ?? ""}
            onChange={(e) => update({ title: e.target.value || null })}
            placeholder={`${currentUser?.name ?? "나"}의 노래책`}
          />
        </div>

        <div>
          <label className={labelCls}>소개 문구 (선택)</label>
          <input
            className={inputCls}
            value={design.description ?? ""}
            onChange={(e) => update({ description: e.target.value || null })}
            placeholder="예: 매주 화요일 밴드 연습곡 모음"
          />
        </div>

        <div>
          <label className={labelCls}>곡 표시 방식</label>
          <select
            className={selectCls}
            value={design.songDisplay}
            onChange={(e) => update({ songDisplay: e.target.value as SongDisplayMode })}
          >
            <option value="list" className="bg-[#14161F]">
              리스트형
            </option>
            <option value="card" className="bg-[#14161F]">
              카드형
            </option>
          </select>
        </div>
      </div>
    </div>
  );
}
