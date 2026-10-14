import { isKana, isKanji, kanaToHangul, type KanaResult, type PronStatus } from "./kana";
import type { JaToken, JaTokenizer } from "./tokenizer";

/**
 * 일본어 한 줄 → 한글 발음 (형태소 분석 기반).
 * 원문 → 형태소 분석 → 단어별 읽기(가나) → 조사(は·へ·を)/숫자+단위 처리 → 가나 정규화 → 한글 → 검증.
 * 한자를 글자 단위로 치환하지 않고 단어 단위로 읽으며, 분석기가 읽기를 모르는 단어는 "실패"로 표시한다(원문 유지).
 */
export interface JaResult extends KanaResult {
  /** 읽지 못해 원문으로 남긴 단어 */
  failed: string[];
  /** 읽기는 정했지만 문맥에 따라 달라질 수 있어 확인이 필요한 단어 */
  uncertain: string[];
}

const toHira = (s: string) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const isKanaOnly = (s: string) => s.length > 0 && [...s].every((c) => isKana(c) || c === "ー");
const hasKanji = (s: string) => [...s].some(isKanji);

/** 읽기가 문맥에 따라 갈릴 수 있는 흔한 표면형 — 분석기가 한 가지를 골랐더라도 사람이 확인하게 한다 */
const AMBIGUOUS = new Set(["人", "日", "今日", "明日", "昨日", "生", "行", "方", "何", "上", "下", "中", "間", "後", "大人", "辛い", "角", "他", "側", "事", "時", "所", "物", "気"]);

const NUM = "〇一二三四五六七八九";
const toAscii = (s: string) => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

/** "2", "２", "二", "十二", "百" → 숫자. 해석할 수 없으면 null */
export function parseNumber(s: string): number | null {
  const t = toAscii(s);
  if (/^\d+$/.test(t)) return Number(t);
  if (!/^[〇一二三四五六七八九十百千万]+$/.test(t)) return null;
  if ([...t].every((c) => NUM.includes(c))) return Number([...t].map((c) => NUM.indexOf(c)).join(""));
  let total = 0;
  let cur = 0;
  let man = 0;
  for (const c of t) {
    const d = NUM.indexOf(c);
    if (d >= 0) cur = d;
    else if (c === "十") {
      total += (cur || 1) * 10;
      cur = 0;
    } else if (c === "百") {
      total += (cur || 1) * 100;
      cur = 0;
    } else if (c === "千") {
      total += (cur || 1) * 1000;
      cur = 0;
    } else if (c === "万") {
      man += (total + cur || 1) * 10000;
      total = 0;
      cur = 0;
    }
  }
  return man + total + cur;
}

const DIG = ["ぜろ", "いち", "に", "さん", "よん", "ご", "ろく", "なな", "はち", "きゅう"];
/** 0–99999 → 히라가나 (예: 12 → じゅうに) */
export function numberToKana(n: number): string {
  if (n === 0) return DIG[0];
  let out = "";
  const man = Math.floor(n / 10000);
  let r = n % 10000;
  if (man) out += (man === 1 ? "いち" : numberToKana(man)) + "まん";
  const sen = Math.floor(r / 1000);
  r %= 1000;
  if (sen) out += (sen === 1 ? "" : sen === 3 ? "さん" : sen === 8 ? "はっ" : DIG[sen]) + (sen === 3 ? "ぜん" : "せん");
  const hyaku = Math.floor(r / 100);
  r %= 100;
  if (hyaku) out += (hyaku === 1 ? "" : hyaku === 3 ? "さん" : hyaku === 6 ? "ろっ" : hyaku === 8 ? "はっ" : DIG[hyaku]) + (hyaku === 3 ? "びゃく" : hyaku === 6 || hyaku === 8 ? "ぴゃく" : "ひゃく");
  const jyu = Math.floor(r / 10);
  r %= 10;
  if (jyu) out += (jyu === 1 ? "" : DIG[jyu]) + "じゅう";
  if (r) out += DIG[r];
  return out;
}

/** 숫자 + 단위(조수사). 알려진 불규칙 읽기만 따로 두고, 나머지는 숫자 읽기 + 단위 읽기를 이어 붙인다 */
const COUNTERS: Record<string, { kana: string; irregular?: Record<number, string>; review?: boolean }> = {
  人: { kana: "にん", irregular: { 1: "ひとり", 2: "ふたり", 4: "よにん", 7: "ななにん" } },
  つ: { kana: "つ", irregular: { 1: "ひとつ", 2: "ふたつ", 3: "みっつ", 4: "よっつ", 5: "いつつ", 6: "むっつ", 7: "ななつ", 8: "やっつ", 9: "ここのつ", 10: "とお" } },
  回: { kana: "かい", irregular: { 1: "いっかい", 6: "ろっかい", 8: "はっかい", 10: "じゅっかい", 4: "よんかい" } },
  年: { kana: "ねん", irregular: { 4: "よねん", 7: "ななねん", 9: "きゅうねん" } },
  歳: { kana: "さい", irregular: { 1: "いっさい", 8: "はっさい", 10: "じゅっさい" } },
  月: { kana: "がつ", irregular: { 4: "しがつ", 7: "しちがつ", 9: "くがつ" } },
  時: { kana: "じ", irregular: { 4: "よじ", 7: "しちじ", 9: "くじ" } },
  分: { kana: "ふん", irregular: { 1: "いっぷん", 3: "さんぷん", 4: "よんぷん", 6: "ろっぷん", 8: "はっぷん", 10: "じゅっぷん" } },
  個: { kana: "こ", irregular: { 1: "いっこ", 6: "ろっこ", 8: "はっこ", 10: "じゅっこ" } },
  度: { kana: "ど", irregular: { 1: "いちど" } },
  番: { kana: "ばん" },
  秒: { kana: "びょう" },
  日: { kana: "にち", review: true, irregular: { 1: "ついたち", 2: "ふつか", 3: "みっか", 4: "よっか", 5: "いつか", 6: "むいか", 7: "なのか", 8: "ようか", 9: "ここのか", 10: "とおか", 14: "じゅうよっか", 20: "はつか", 24: "にじゅうよっか" } },
  週: { kana: "しゅう" },
  本: { kana: "ほん", review: true },
  枚: { kana: "まい" },
  匹: { kana: "ひき", review: true },
};

function counterReading(n: number, counter: string): { kana: string; review: boolean } | null {
  const c = COUNTERS[counter];
  if (!c) return null;
  if (c.irregular?.[n]) return { kana: c.irregular[n], review: !!c.review };
  return { kana: numberToKana(n) + c.kana, review: !!c.review };
}

const FUNCTION_POS = new Set(["助詞", "助動詞"]);
/** 앞 단어에 붙여 한 덩어리(띄어쓰기 단위)로 만들 형태소인가 */
function attachesToPrev(t: JaToken, prev: JaToken | undefined): boolean {
  if (!prev) return false;
  if (FUNCTION_POS.has(t.pos)) return true;
  if (t.pos === "動詞" && (t.pos_detail_1 === "非自立" || t.pos_detail_1 === "接尾")) return true;
  if (t.pos === "形容詞" && (t.pos_detail_1 === "非自立" || t.pos_detail_1 === "接尾")) return true;
  if (t.pos === "名詞" && t.pos_detail_1 === "接尾") return true;
  if (t.pos === "名詞" && prev.pos === "名詞" && !["非自立", "副詞可能", "代名詞", "接尾"].includes(t.pos_detail_1) && !["代名詞", "非自立", "副詞可能"].includes(prev.pos_detail_1)) return true;
  if (t.pos === "名詞" && t.pos_detail_1 === "数" && prev.pos === "名詞" && prev.pos_detail_1 === "数") return true;
  if (t.pos === "記号" && /^[、。！？!?…・,.]+$/.test(t.surface_form)) return true;
  return false;
}

/** 분석기 읽기(가타카나)가 쓸 만한가: 가나·장음만으로 이루어져 있어야 한다 */
function usableReading(t: JaToken): string | null {
  const r = t.reading;
  if (!r || r === "*") return null;
  return isKanaOnly(r) ? r : null;
}

export function analyzeJapanese(line: string, tk: JaTokenizer): JaResult {
  const notes: string[] = [];
  const failed: string[] = [];
  const uncertain: string[] = [];
  let status: PronStatus = "ok";
  const bump = (s: PronStatus, why?: string) => {
    if (why && !notes.includes(why)) notes.push(why);
    if (s === "unsupported" || (s === "review" && status === "ok")) status = s;
  };

  const src = toAscii(line);
  const tokens = tk.tokenize(src);
  // 덩어리 단위로 모은다 (덩어리 사이는 띄어쓰기)
  const chunks: string[][] = [];
  const push = (t: JaToken, text: string, prev: JaToken | undefined, forceNew = false) => {
    if (!forceNew && chunks.length > 0 && attachesToPrev(t, prev)) chunks[chunks.length - 1].push(text);
    else chunks.push([text]);
  };

  let prev: JaToken | undefined;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const s = t.surface_form;
    // 공백: 덩어리 경계
    if (/^\s+$/.test(s)) {
      prev = undefined;
      continue;
    }
    // 숫자 + 단위
    if (t.pos === "名詞" && t.pos_detail_1 === "数") {
      let numStr = s;
      let j = i;
      while (tokens[j + 1] && tokens[j + 1].pos === "名詞" && tokens[j + 1].pos_detail_1 === "数" && parseNumber(numStr + tokens[j + 1].surface_form) !== null) {
        numStr += tokens[j + 1].surface_form;
        j++;
      }
      const n = parseNumber(numStr);
      const ctr = tokens[j + 1];
      if (n !== null && n < 100000) {
        const cr = ctr ? counterReading(n, ctr.surface_form) : null;
        if (cr) {
          if (cr.review) bump("review", `${numStr}${ctr.surface_form} 읽기는 확인이 필요해요`);
          push(t, cr.kana, prev);
          prev = ctr;
          i = j + 1;
          continue;
        }
        if (/^\d+$/.test(numStr)) {
          bump("review", `숫자 ${numStr} 를 일본어 읽기로 옮겼어요`);
          push(t, numberToKana(n), prev);
          prev = t;
          i = j;
          continue;
        }
      }
    }
    // 조사: は→わ, へ→え, を→お (문맥상 조사일 때만)
    if (t.pos === "助詞" && (s === "は" || s === "へ" || s === "を")) {
      push(t, s === "は" ? "わ" : s === "へ" ? "え" : "お", prev);
      prev = t;
      continue;
    }
    // 가나·한자가 없는 토큰 (영문, 한글, 기호, 숫자 등): 그대로
    if (![...s].some((c) => isKana(c) || isKanji(c))) {
      push(t, s, prev, /[A-Za-z가-힣]/.test(s));
      prev = t;
      continue;
    }
    const r = usableReading(t);
    if (r) {
      push(t, r, prev);
      if (hasKanji(s) && (AMBIGUOUS.has(s) || t.word_type === "UNKNOWN")) {
        bump("review", `「${s}」 읽기는 문맥에 따라 달라질 수 있어요 (${toHira(r)})`);
        if (!uncertain.includes(s)) uncertain.push(s);
      }
    } else if (isKanaOnly(s)) {
      push(t, s, prev);
    } else {
      // 읽기를 알 수 없는 단어: 원문 그대로 남기고 실패로 기록
      push(t, `\u0000${s}\u0000`, prev);
      if (!failed.includes(s)) failed.push(s);
      bump("unsupported", `읽지 못한 단어: ${s}`);
    }
    prev = t;
  }

  const out = chunks
    .map((c) => kanaToHangul(c.join("")).replaceAll("\u0000", ""))
    .filter((x) => x.length > 0)
    .join(" ");
  // 검증: 한글 발음에 가나·한자가 남아 있으면(원문 그대로 남긴 실패 단어) 정상 결과가 아니다
  const leftover = [...out].some((c) => isKana(c) || isKanji(c));
  if (leftover) bump("unsupported", "한자/가나가 변환되지 않고 남았어요");
  return { text: out, status, notes, failed, uncertain };
}
