export type BookDesignPreset = "default" | "light" | "dark" | "minimal" | "modern";
export type SongDisplayMode = "list" | "card";

export interface BookDesign {
  preset: BookDesignPreset;
  accentColor: string;
  backgroundColor: string;
  surfaceColor: string;
  textColor: string;
  title: string | null; // null이면 "OO의 노래책" 기본값 사용
  description: string | null;
  songDisplay: SongDisplayMode;
}

export const DEFAULT_BOOK_DESIGN: BookDesign = {
  preset: "default",
  accentColor: "#fbbf24", // 기존 amber-400
  backgroundColor: "#14161F", // 기존 기본 배경
  surfaceColor: "#ffffff", // 카드 배경 - 항상 낮은 불투명도(surfaceOpacity)와 함께 사용
  textColor: "#f2f0ea",
  title: null,
  description: null,
  songDisplay: "list",
};

interface BookDesignPresetValues {
  accentColor: string;
  backgroundColor: string;
  surfaceColor: string;
  textColor: string;
}

/**
 * 프리셋은 4가지 색상 토큰을 한 번에 적용하는 트리거다 (Phase 8의 SongMode 테마와
 * 같은 방식). 적용 후에는 사용자가 각 색상을 자유롭게 다시 커스텀할 수 있다.
 */
export const BOOK_DESIGN_PRESETS: Record<BookDesignPreset, BookDesignPresetValues> = {
  default: {
    accentColor: "#fbbf24",
    backgroundColor: "#14161F",
    surfaceColor: "#ffffff",
    textColor: "#f2f0ea",
  },
  dark: {
    accentColor: "#f59e0b",
    backgroundColor: "#000000",
    surfaceColor: "#ffffff",
    textColor: "#f2f0ea",
  },
  light: {
    accentColor: "#d97706",
    backgroundColor: "#ffffff",
    surfaceColor: "#000000",
    textColor: "#1a1a1a",
  },
  minimal: {
    accentColor: "#9ca3af",
    backgroundColor: "#0a0a0a",
    surfaceColor: "#ffffff",
    textColor: "#e5e5e5",
  },
  modern: {
    accentColor: "#22d3ee",
    backgroundColor: "#0f1420",
    surfaceColor: "#22d3ee",
    textColor: "#e8f6fa",
  },
};
