import { useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { usePreferences } from "../hooks/usePreferences";
import type { FontFamily, FontSize, PageSize, Theme } from "../types/preferences";

const FONT_SIZE_OPTIONS: { value: FontSize; label: string }[] = [
  { value: "sm", label: "작게" },
  { value: "md", label: "보통" },
  { value: "lg", label: "크게" },
  { value: "xl", label: "아주 크게" },
];
const FONT_FAMILY_OPTIONS: { value: FontFamily; label: string }[] = [
  { value: "system", label: "기본 (산세리프)" },
  { value: "serif", label: "세리프" },
  { value: "mono", label: "고정폭" },
];
const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: "dark", label: "어두운 테마" },
  { value: "light", label: "밝은 테마" },
];
const PAGE_SIZE_OPTIONS: PageSize[] = [20, 30, 50];

export function SettingsPage() {
  const navigate = useNavigate();
  const { profile: currentUser } = useAuth();
  const { preferences, error, update } = usePreferences(currentUser?.id);

  if (!currentUser) {
    return (
      <div className="max-w-md mx-auto px-5 pt-10 text-center text-white/50 text-sm">
        로그인 후 이용할 수 있어요.
      </div>
    );
  }

  const labelCls = "text-xs text-white/45 mb-1.5 block";
  const selectCls =
    "w-full rounded-lg bg-white/[0.06] border border-white/10 px-3 py-2.5 text-[14px] text-white outline-none focus:border-amber-400/50";

  return (
    <div className="max-w-md mx-auto min-h-screen px-5 pt-8 pb-16">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1 text-[13px] text-white/40 hover:text-white/70"
      >
        <ChevronLeft className="h-4 w-4" /> 뒤로가기
      </button>
      <h1 className="text-xl font-semibold font-serif mt-4">내 설정</h1>
      <p className="text-white/40 text-[13px] mt-1.5">
        이 설정은 이 계정에만 적용되고, 다른 사용자에게는 영향을 주지 않아요.
      </p>

      {error && (
        <p className="text-[13px] text-red-400 mt-3">
          {error} — 값은 화면에만 보이고 저장은 안 됐을 수 있어요.
        </p>
      )}

      <div className="mt-6 flex flex-col gap-5">
        <div>
          <label className={labelCls}>가사 글자 크기 (노래 부르기 화면 기본값)</label>
          <select
            className={selectCls}
            value={preferences.lyricsFontSize}
            onChange={(e) => update({ lyricsFontSize: e.target.value as FontSize })}
          >
            {FONT_SIZE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value} className="bg-[#14161F]">
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelCls}>코드 글자 크기</label>
          <select
            className={selectCls}
            value={preferences.chordsFontSize}
            onChange={(e) => update({ chordsFontSize: e.target.value as FontSize })}
          >
            {FONT_SIZE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value} className="bg-[#14161F]">
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelCls}>폰트</label>
          <select
            className={selectCls}
            value={preferences.fontFamily}
            onChange={(e) => update({ fontFamily: e.target.value as FontFamily })}
          >
            {FONT_FAMILY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value} className="bg-[#14161F]">
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelCls}>테마</label>
          <select
            className={selectCls}
            value={preferences.theme}
            onChange={(e) => update({ theme: e.target.value as Theme })}
          >
            {THEME_OPTIONS.map((o) => (
              <option key={o.value} value={o.value} className="bg-[#14161F]">
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>배경색</label>
            <input
              type="color"
              value={preferences.backgroundColor}
              onChange={(e) => update({ backgroundColor: e.target.value })}
              className="w-full h-10 rounded-lg bg-white/[0.06] border border-white/10 cursor-pointer"
            />
          </div>
          <div>
            <label className={labelCls}>가사 색상</label>
            <input
              type="color"
              value={preferences.lyricsColor}
              onChange={(e) => update({ lyricsColor: e.target.value })}
              className="w-full h-10 rounded-lg bg-white/[0.06] border border-white/10 cursor-pointer"
            />
          </div>
          <div>
            <label className={labelCls}>코드 색상</label>
            <input
              type="color"
              value={preferences.chordsColor}
              onChange={(e) => update({ chordsColor: e.target.value })}
              className="w-full h-10 rounded-lg bg-white/[0.06] border border-white/10 cursor-pointer"
            />
          </div>
        </div>

        {/* 즉시 미리보기 */}
        <div
          className="rounded-xl border border-white/10 p-4"
          style={{ backgroundColor: preferences.backgroundColor }}
        >
          <p
            className="text-[11px] mb-2 opacity-50"
            style={{ color: preferences.lyricsColor }}
          >
            미리보기
          </p>
          <p
            className="font-mono text-sm mb-1"
            style={{ color: preferences.chordsColor }}
          >
            C  G  Am  F
          </p>
          <p style={{ color: preferences.lyricsColor }}>이 밤 그날의 반딧불을</p>
        </div>

        <div>
          <label className={labelCls}>노래 목록 페이지당 곡 수</label>
          <select
            className={selectCls}
            value={preferences.pageSize}
            onChange={(e) => update({ pageSize: Number(e.target.value) as PageSize })}
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n} className="bg-[#14161F]">
                {n}곡
              </option>
            ))}
          </select>
        </div>

        <p className="text-[12px] text-white/30 leading-relaxed">
          여기서 정한 글자 크기는 노래 부르기 화면을 열 때 기본값으로 쓰여요. 노래
          부르기 화면 안에서 그때그때 크기를 바꾸는 건 그 세션에서만 잠깐
          적용되는 임시 조정이고, 여기 설정은 안 바뀌어요.
        </p>
      </div>
    </div>
  );
}
