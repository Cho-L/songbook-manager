export type FontSize = "sm" | "md" | "lg" | "xl";
export type FontFamily = "system" | "serif" | "mono";
export type Theme = "dark" | "light";
export type PageSize = 20 | 30 | 50;

export interface UserPreferences {
  lyricsFontSize: FontSize;
  chordsFontSize: FontSize;
  fontFamily: FontFamily;
  lyricsColor: string;
  chordsColor: string;
  backgroundColor: string;
  theme: Theme;
  pageSize: PageSize;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  lyricsFontSize: "md",
  chordsFontSize: "md",
  fontFamily: "system",
  lyricsColor: "#f2f0ea",
  chordsColor: "#6ee7b7",
  backgroundColor: "#000000",
  theme: "dark",
  pageSize: 30,
};

/**
 * 테마는 "프리셋 적용 트리거" 역할을 한다 — 선택하는 순간 배경/가사/코드
 * 색상을 아래 값으로 한 번에 바꿔주고, 그 이후엔 사용자가 각 색상을
 * 자유롭게 다시 바꿀 수 있다 (별도의 "커스텀 모드" 상태를 두지 않는다).
 */
export const THEME_PRESETS: Record<Theme, Pick<UserPreferences, "backgroundColor" | "lyricsColor" | "chordsColor">> = {
  dark: {
    backgroundColor: "#000000",
    lyricsColor: "#f2f0ea",
    chordsColor: "#6ee7b7",
  },
  light: {
    backgroundColor: "#ffffff",
    lyricsColor: "#1a1a1a",
    chordsColor: "#0f766e",
  },
};
