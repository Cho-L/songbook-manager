/** 한국어/영어 모두에 쓸 수 있는 가벼운 텍스트 비교 유틸 (외부 라이브러리 없음) */

import { hasLyricsVersion } from "./versions";

import { crossScriptSimilarity, hasHangul, hasLatin } from "./phonetic";

/** 같은 글자의 다른 자형(구자체·이체자) — 제목 비교에서 같은 글자로 본다 (聴/聞은 노래 제목에서 같은 표기로 흔히 섞여 쓰인다) */
const KANJI_VARIANTS: Record<string, string> = {
  聴: "聞", 聽: "聞", 戀: "恋", 來: "来", 國: "国", 體: "体", 變: "変", 學: "学", 會: "会", 戰: "戦", 對: "対", 當: "当", 邊: "辺", 驛: "駅", 繪: "絵",
  廣: "広", 齋: "斎", 澤: "沢", 櫻: "桜", 讀: "読", 臺: "台", 眞: "真", 觀: "観", 關: "関", 氣: "気", 實: "実", 擔: "担", 點: "点", 夢: "夢", 發: "発",
  龍: "竜", 靈: "霊", 舊: "旧", 兩: "両", 圓: "円", 縣: "県", 經: "経", 傳: "伝", 歡: "歓", 勸: "勧", 壞: "壊", 屬: "属", 歸: "帰", 險: "険", 號: "号",
};

/** 비교용 정규화: 악센트 제거(é→e), 소문자, 기호/공백 제거, 한글·영문·숫자·가나·한자만 남긴다 */
export function normalizeText(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[聴聽戀來國體變學會戰對當邊驛繪廣齋澤櫻讀臺眞觀關氣實擔點發龍靈舊兩圓縣經傳歡勸壞屬歸險號]/g, (ch) => KANJI_VARIANTS[ch] ?? ch)
    .replace(/[\u30A1-\u30F6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60)) // 가타카나 → 히라가나 (アイ ↔ あい)
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** 제목/가수 비교용: (…) [...] 같은 부가 표기와 feat. 뒷부분을 제거한 뒤 정규화 */
export function normalizeTitle(s: string): string {
  return normalizeText(
    s
      .replace(/[([{（【][^)\]}）】]*[)\]}）】]/g, " ")
      .replace(/\b(feat|ft)\.?\s.*$/i, " ")
  );
}

export function hasVersionWord(s: string): boolean {
  return hasLyricsVersion(s);
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** 글자 bigram Dice 계수 (0~1). 띄어쓰기/조사 차이에 강하고 한글에도 잘 동작한다. */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) ?? 0);
  return (2 * inter) / (a.length - 1 + (b.length - 1));
}

/**
 * 제목 유사도: Dice 와 "한쪽이 다른 쪽을 포함" 중 큰 값 (예: "밤편지" vs "밤편지 (Live)").
 * - 포함 관계는 짧은 쪽이 4글자 이상일 때만 인정한다 ("APT" 가 "Aptitude" 에 포함된다고 같은 곡으로 보지 않는다)
 * - 한글 제목 ↔ 영문 제목("아파트" ↔ "APT")은 소리 비교로 보되, 짧으면 약한 근거(상한)로만 쓴다
 * "APT." / "APT" / "APT!" / "apt." 는 기호 제거 후 모두 같다.
 */
export function titleSimilarityScore(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const dice = similarity(na, nb);
  const shorter = Math.min(na.length, nb.length);
  const contains = shorter >= 4 && (na.includes(nb) || nb.includes(na)) ? 0.9 : 0;
  let cross = 0;
  if ((hasHangul(na) && !hasLatin(na) && hasLatin(nb) && !hasHangul(nb)) || (hasHangul(nb) && !hasLatin(nb) && hasLatin(na) && !hasHangul(na))) {
    cross = crossScriptSimilarity(na, nb);
  }
  return Math.max(dice, contains, cross);
}

/** (이전 이름 유지) 제목/가수 공용으로 쓰이던 유사도 — 제목에는 titleSimilarityScore 를 쓴다 */
export const nameSimilarity = titleSimilarityScore;

/** 검색어용 제목: 끝의 기호와 (…) 부가 표기를 제거 ("APT." → "APT") */
export function queryTitle(s: string): string {
  const t = s.replace(/[([{（【][^)\]}）】]*[)\]}）】]/g, " ").replace(/[\s.!?~,·]+$/g, "").replace(/\s+/g, " ").trim();
  return t || s.trim();
}

/** FNV-1a 32bit — 캐시 무효화용 짧은 해시 (보안 용도 아님) */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
