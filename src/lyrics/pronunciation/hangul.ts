/** 한글 음절 조합 도우미 (초성/중성/종성 인덱스 → 완성형 글자) */
export const CHO = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"] as const;
export const JUNG = ["ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅘ", "ㅙ", "ㅚ", "ㅛ", "ㅜ", "ㅝ", "ㅞ", "ㅟ", "ㅠ", "ㅡ", "ㅢ", "ㅣ"] as const;
export const JONG = ["", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"] as const;

export type Cho = (typeof CHO)[number];
export type Jung = (typeof JUNG)[number];
export type Jong = (typeof JONG)[number];

export function compose(cho: Cho, jung: Jung, jong: Jong = ""): string {
  return String.fromCharCode(0xac00 + (CHO.indexOf(cho) * 21 + JUNG.indexOf(jung)) * 28 + JONG.indexOf(jong));
}

/** 완성형 글자에 받침을 붙인다 (이미 받침이 있으면 그대로) */
export function withFinal(syllable: string, jong: Jong): string {
  const code = syllable.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171 || code % 28 !== 0) return syllable;
  return String.fromCharCode(0xac00 + code + JONG.indexOf(jong));
}

export function hasFinal(syllable: string): boolean {
  const code = syllable.charCodeAt(0) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 !== 0;
}
