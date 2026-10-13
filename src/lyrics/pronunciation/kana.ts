import { compose, withFinal, hasFinal, type Cho, type Jung } from "./hangul";

/**
 * 일본어 가나 → 한글 발음 (규칙 기반, 사전 없음).
 * 가나만으로 쓰인 부분은 결정적으로 바뀌지만, 한자는 문맥마다 읽는 법이 달라서 이 모듈은 한자를 읽지 않는다
 * (아주 흔한 단어 몇 개만 COMMON_WORDS 로 추정하고 "검토 필요"로 표시한다).
 * 노래 가사 관례에 맞춰 か행은 항상 카·키·쿠·케·코, が행은 가·기·구·게·고 로 적는다.
 */

type Syl = [Cho, Jung];
const A: Record<string, Syl> = {
  あ: ["ㅇ", "ㅏ"], い: ["ㅇ", "ㅣ"], う: ["ㅇ", "ㅜ"], え: ["ㅇ", "ㅔ"], お: ["ㅇ", "ㅗ"],
  か: ["ㅋ", "ㅏ"], き: ["ㅋ", "ㅣ"], く: ["ㅋ", "ㅜ"], け: ["ㅋ", "ㅔ"], こ: ["ㅋ", "ㅗ"],
  が: ["ㄱ", "ㅏ"], ぎ: ["ㄱ", "ㅣ"], ぐ: ["ㄱ", "ㅜ"], げ: ["ㄱ", "ㅔ"], ご: ["ㄱ", "ㅗ"],
  さ: ["ㅅ", "ㅏ"], し: ["ㅅ", "ㅣ"], す: ["ㅅ", "ㅡ"], せ: ["ㅅ", "ㅔ"], そ: ["ㅅ", "ㅗ"],
  ざ: ["ㅈ", "ㅏ"], じ: ["ㅈ", "ㅣ"], ず: ["ㅈ", "ㅡ"], ぜ: ["ㅈ", "ㅔ"], ぞ: ["ㅈ", "ㅗ"],
  た: ["ㅌ", "ㅏ"], ち: ["ㅊ", "ㅣ"], つ: ["ㅊ", "ㅡ"], て: ["ㅌ", "ㅔ"], と: ["ㅌ", "ㅗ"],
  だ: ["ㄷ", "ㅏ"], ぢ: ["ㅈ", "ㅣ"], づ: ["ㅈ", "ㅡ"], で: ["ㄷ", "ㅔ"], ど: ["ㄷ", "ㅗ"],
  な: ["ㄴ", "ㅏ"], に: ["ㄴ", "ㅣ"], ぬ: ["ㄴ", "ㅜ"], ね: ["ㄴ", "ㅔ"], の: ["ㄴ", "ㅗ"],
  は: ["ㅎ", "ㅏ"], ひ: ["ㅎ", "ㅣ"], ふ: ["ㅎ", "ㅜ"], へ: ["ㅎ", "ㅔ"], ほ: ["ㅎ", "ㅗ"],
  ば: ["ㅂ", "ㅏ"], び: ["ㅂ", "ㅣ"], ぶ: ["ㅂ", "ㅜ"], べ: ["ㅂ", "ㅔ"], ぼ: ["ㅂ", "ㅗ"],
  ぱ: ["ㅍ", "ㅏ"], ぴ: ["ㅍ", "ㅣ"], ぷ: ["ㅍ", "ㅜ"], ぺ: ["ㅍ", "ㅔ"], ぽ: ["ㅍ", "ㅗ"],
  ま: ["ㅁ", "ㅏ"], み: ["ㅁ", "ㅣ"], む: ["ㅁ", "ㅜ"], め: ["ㅁ", "ㅔ"], も: ["ㅁ", "ㅗ"],
  や: ["ㅇ", "ㅑ"], ゆ: ["ㅇ", "ㅠ"], よ: ["ㅇ", "ㅛ"],
  ら: ["ㄹ", "ㅏ"], り: ["ㄹ", "ㅣ"], る: ["ㄹ", "ㅜ"], れ: ["ㄹ", "ㅔ"], ろ: ["ㄹ", "ㅗ"],
  わ: ["ㅇ", "ㅘ"], を: ["ㅇ", "ㅗ"], ゐ: ["ㅇ", "ㅣ"], ゑ: ["ㅇ", "ㅔ"], ゔ: ["ㅂ", "ㅜ"],
};

/** 요음: 앞 글자(い단) + ゃゅょ */
const YOON_BASE: Record<string, [Cho, "ya" | "yu" | "yo", boolean]> = {
  き: ["ㅋ", "ya", true], ぎ: ["ㄱ", "ya", true], し: ["ㅅ", "ya", true], じ: ["ㅈ", "ya", false], ち: ["ㅊ", "ya", false], ぢ: ["ㅈ", "ya", false],
  に: ["ㄴ", "ya", true], ひ: ["ㅎ", "ya", true], び: ["ㅂ", "ya", true], ぴ: ["ㅍ", "ya", true], み: ["ㅁ", "ya", true], り: ["ㄹ", "ya", true],
};
const SMALL_Y: Record<string, "ya" | "yu" | "yo"> = { ゃ: "ya", ゅ: "yu", ょ: "yo" };
const YOON_VOWEL: Record<"ya" | "yu" | "yo", [Jung, Jung]> = { ya: ["ㅑ", "ㅏ"], yu: ["ㅠ", "ㅜ"], yo: ["ㅛ", "ㅗ"] };
/** し/じ/ち 계열은 한글 표기법상 "샤/자/차" (y 없음) */
const PLAIN_YOON = new Set(["ㅈ", "ㅊ"]);

/** 작은 모음이 붙는 외래어 표기 (ファ → 파, ティ → 티 …) */
const SMALL_VOWEL: Record<string, Jung> = { ぁ: "ㅏ", ぃ: "ㅣ", ぅ: "ㅜ", ぇ: "ㅔ", ぉ: "ㅗ" };

/** 가타카나 → 히라가나 (ー 는 그대로) */
function toHiragana(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

export function isKana(ch: string): boolean {
  return /[぀-ゟ゠-ヿ]/.test(ch);
}
export function isKanji(ch: string): boolean {
  return /[一-鿿㐀-䶿々〆]/.test(ch);
}

/**
 * 아주 흔한 한자 단어의 읽기 추정. 문맥에 따라 다르게 읽힐 수 있으므로 사용하면 줄 상태를 "검토 필요"로 올린다.
 * 긴 단어가 먼저 일치한다. 이 목록에 없는 한자는 읽지 않는다(지원 불가 표시).
 */
export const COMMON_WORDS: Record<string, string> = {
  君: "きみ", 僕: "ぼく", 私: "わたし", 俺: "おれ", 貴方: "あなた", あなた: "あなた",
  愛: "あい", 恋: "こい", 好き: "すき", 好: "す", 嫌い: "きらい", 夢: "ゆめ", 心: "こころ", 声: "こえ", 歌: "うた",
  空: "そら", 海: "うみ", 花: "はな", 星: "ほし", 月: "つき", 夜: "よる", 朝: "あさ", 雨: "あめ", 風: "かぜ", 光: "ひかり",
  今日: "きょう", 明日: "あした", 昨日: "きのう", 今: "いま", 世界: "せかい", 時間: "じかん", 未来: "みらい", 永遠: "えいえん",
  人: "ひと", 何: "なに", 言葉: "ことば", 涙: "なみだ", 笑顔: "えがお", 優しい: "やさしい", 強い: "つよい",
  聴: "き", 聞: "き", 見: "み", 思: "おも", 歩: "ある", 走: "はし", 泣: "な", 笑: "わら", 行: "い", 来: "く",
  大好き: "だいすき", 大丈夫: "だいじょうぶ", 一緒: "いっしょ", 一人: "ひとり", 二人: "ふたり", 本当: "ほんとう", 全部: "ぜんぶ",
};
const WORD_KEYS = Object.keys(COMMON_WORDS).sort((a, b) => b.length - a.length);

export type PronStatus = "ok" | "review" | "unsupported";

export interface KanaResult {
  text: string;
  status: PronStatus;
  /** 사람이 확인해야 하는 이유 */
  notes: string[];
}

/**
 * 한 줄 안의 가나/한자를 한글로 바꾼다. 가나·한자가 아닌 글자(영문, 숫자, 기호, 한글)는 그대로 둔다.
 * - 가나만 있는 줄: ok (は·へ 조사 가능성이 있으면 review)
 * - 흔한 한자 단어를 추정해 쓴 줄: review
 * - 읽을 수 없는 한자가 남은 줄: unsupported (그 한자는 원문 그대로 둔다)
 */
export function japaneseToHangul(input: string): KanaResult {
  const notes: string[] = [];
  let status: PronStatus = "ok";
  const bump = (s: PronStatus, why: string) => {
    if (!notes.includes(why)) notes.push(why);
    if (s === "unsupported" || (s === "review" && status === "ok")) status = s;
  };

  // 1) 한자 단어를 가나로 치환 (흔한 단어만)
  let kana = "";
  const chars = [...input];
  for (let i = 0; i < chars.length; ) {
    const rest = chars.slice(i).join("");
    const word = WORD_KEYS.find((w) => rest.startsWith(w) && isKanji(w[0]));
    if (word) {
      kana += COMMON_WORDS[word];
      bump("review", "한자 읽기는 흔한 단어를 추정한 값이에요");
      i += [...word].length;
      continue;
    }
    if (isKanji(chars[i])) {
      kana += `\u0000${chars[i]}\u0000`; // 읽을 수 없는 한자 표식
      bump("unsupported", "읽을 수 없는 한자가 있어 원문 그대로 남겼어요");
      i++;
      continue;
    }
    kana += chars[i];
    i++;
  }

  // 2) 가나 → 한글
  const hira = toHiragana(kana);
  const cs = [...hira];
  const origCs = [...kana];
  const out: string[] = [];
  let sokuon = false;
  const push = (syl: string) => {
    if (sokuon) {
      // っ: 앞 음절의 받침 ㅅ (롯쿠). 앞 음절이 없거나 이미 받침이 있으면 그냥 건너뛴다
      const last = out.length - 1;
      if (last >= 0 && out[last].length === 1 && !hasFinal(out[last])) out[last] = withFinal(out[last], "ㅅ");
      sokuon = false;
    }
    out.push(syl);
  };
  const lastVowelIsO = () => {
    const last = out[out.length - 1];
    if (!last || last.length !== 1) return false;
    const code = last.charCodeAt(0) - 0xac00;
    if (code < 0 || code > 11171) return false;
    const jung = Math.floor((code % 588) / 28);
    return jung === 8; // ㅗ
  };
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (c === "\u0000") {
      push(cs[i + 1] ?? ""); // 읽을 수 없는 한자: 원문 그대로
      i += 2; // 한자 한 글자 + 닫는 표식
      continue;
    }
    if (c === "っ") {
      sokuon = true;
      continue;
    }
    if (c === "ん") {
      const last = out.length - 1;
      if (last >= 0 && out[last].length === 1 && !hasFinal(out[last])) out[last] = withFinal(out[last], "ㄴ");
      else out.push("ㄴ");
      continue;
    }
    if (c === "ー") continue; // 장음은 표기하지 않는다
    // 요음 (きゃ 등)
    const next = cs[i + 1];
    if (next && SMALL_Y[next] && YOON_BASE[c]) {
      const cho = YOON_BASE[c][0];
      const kind = SMALL_Y[next];
      const [withY, plain] = YOON_VOWEL[kind];
      const vowel = PLAIN_YOON.has(cho) ? plain : withY; // じゃ·ちゃ → 자·차 (y 없음), 나머지는 샤·캬 …
      push(compose(cho, vowel));
      i++;
      continue;
    }
    // 작은 모음 (ファ, ティ 등): 앞 글자의 모음을 바꾼다
    if (next && SMALL_VOWEL[next] && A[c]) {
      const [cho] = A[c];
      const special: Record<string, Cho> = { ふ: "ㅍ", つ: "ㅊ", て: "ㅌ", で: "ㄷ", ゔ: "ㅂ", し: "ㅅ", ち: "ㅊ", じ: "ㅈ" };
      push(compose(special[c] ?? cho, SMALL_VOWEL[next]));
      i++;
      continue;
    }
    if (SMALL_Y[c]) {
      // 단독 작은 や행은 일반 や행으로
      push(compose("ㅇ", YOON_VOWEL[SMALL_Y[c]][0]));
      continue;
    }
    if (SMALL_VOWEL[c]) {
      push(compose("ㅇ", SMALL_VOWEL[c]));
      continue;
    }
    const syl = A[c];
    if (syl) {
      // 장음 う: お단 뒤의 う 는 길게 늘이는 소리라서 표기하지 않는다 (ありがとう → 아리가토)
      if (c === "う" && lastVowelIsO()) continue;
      if (c === "は" || c === "へ" || c === "を") {
        if (c !== "を") bump("review", "は/へ는 조사일 때 '와/에'로 읽어요 — 확인이 필요해요");
      }
      push(compose(syl[0], syl[1]));
      continue;
    }
    // 가나가 아닌 글자(영문·숫자·공백·기호·한글)는 그대로
    if (sokuon) sokuon = false;
    out.push(origCs[i] ?? c);
  }
  return { text: out.join("").replace(/\s+/g, " ").trim(), status, notes };
}
