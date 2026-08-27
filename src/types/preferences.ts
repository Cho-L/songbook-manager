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
