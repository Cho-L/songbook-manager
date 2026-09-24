/** WCAG 상대 휘도 계산 (0=완전 검정, 1=완전 흰색) */
function relativeLuminance(hex: string): number {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean.split("").map((c) => c + c).join("")
      : clean;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const [rl, gl, bl] = [r, g, b].map((c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  );
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

/** 배경색이 밝은 편(=크롬 UI에 어두운 글자를 써야 함)인지 판단 */
export function isLightBackground(hex: string): boolean {
  try {
    return relativeLuminance(hex) > 0.5;
  } catch {
    return false; // 파싱 실패 시 기존 기본값(어두운 배경 취급)으로 안전하게 폴백
  }
}

/**
 * 배경 밝기에 따라 "사용자가 직접 고르지 않는" UI 크롬(제목/버튼/아이콘/보조텍스트)에
 * 쓸 클래스 묶음을 반환한다. lyricsColor/chordsColor는 절대 여기서 건드리지 않는다.
 */
export interface ChromeTones {
  /** 제목처럼 가장 진하게 보여야 하는 텍스트 */
  strong: string;
  /** 가수명 등 중간 톤 */
  base: string;
  /** Key/BPM, 안내문 등 옅은 보조 텍스트 */
  muted: string;
  /** 컨트롤 칩/버튼 배경 */
  chipBg: string;
  /** 컨트롤 칩/버튼 테두리 */
  chipBorder: string;
  /** 빈 상태 카드 배경 */
  panelBg: string;
  /** 빈 상태 카드 테두리 */
  panelBorder: string;
}

export function getChromeTones(backgroundColor: string): ChromeTones {
  const light = isLightBackground(backgroundColor);
  return light
    ? {
        strong: "text-black/90",
        base: "text-black/60",
        muted: "text-black/45",
        chipBg: "bg-black/[0.05]",
        chipBorder: "border-black/10",
        panelBg: "bg-black/[0.04]",
        panelBorder: "border-black/10",
      }
    : {
        strong: "text-white",
        base: "text-white/60",
        muted: "text-white/40",
        chipBg: "bg-white/[0.06]",
        chipBorder: "border-white/10",
        panelBg: "bg-white/[0.04]",
        panelBorder: "border-white/[0.06]",
      };
}

/**
 * getChromeTones가 Tailwind 클래스를 반환하는 것과 달리, 이 함수는 실제 값을 가진
 * CSS 커스텀 프로퍼티 묶음을 반환한다. HomePage/BookDesignPage처럼 --book-accent /
 * --book-background / --book-surface / --book-text 를 이미 주입하는 컨테이너에
 * 같이 스프레드해서 쓴다.
 *
 * --book-accent / --book-background / --book-surface / --book-text 는
 * 사용자가 직접 고르는 "디자인" 색상이고, 이 4개(--book-chrome-*)는
 * 리스트 보더, 뮤트 텍스트, 미선택 표면처럼 사용자가 고르지 않는
 * 중립 UI 크롬에 쓰는 값이라 서로 이름과 용도가 겹치지 않는다.
 */
export interface ChromeCssVars {
  "--book-chrome-text": string;
  "--book-chrome-muted": string;
  "--book-chrome-border": string;
  "--book-chrome-surface": string;
}

export function getChromeCssVars(backgroundColor: string): ChromeCssVars {
  const light = isLightBackground(backgroundColor);
  const rgb = light ? "0,0,0" : "255,255,255";
  return {
    "--book-chrome-text": light ? "#000000" : "#ffffff",
    "--book-chrome-muted": `rgba(${rgb},0.45)`,
    "--book-chrome-border": `rgba(${rgb},0.12)`,
    "--book-chrome-surface": `rgba(${rgb},0.05)`,
  };
}
