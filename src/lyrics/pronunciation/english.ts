import { compose, withFinal, hasFinal, type Cho, type Jung } from "./hangul";
import type { PronStatus } from "./kana";

/**
 * 영어 → 한글 발음. CMU 발음사전(ARPAbet)의 음소를 한국어 외래어 관례로 바꾼다.
 * 영어 발음을 한글로 옮기는 일은 본질적으로 근사치라서(받침·이중모음·강세·노래의 늘임) "참고용"이다.
 * 사전에 없는 단어는 바꾸지 않고 원문 그대로 둔다.
 */
export type CmuDict = Record<string, string>;

interface VowelInfo {
  v: Jung;
  glide?: "이" | "우";
  short: boolean;
}
const VOWELS: Record<string, VowelInfo> = {
  IY: { v: "ㅣ", short: false }, IH: { v: "ㅣ", short: true }, EH: { v: "ㅔ", short: true }, AE: { v: "ㅐ", short: true },
  AA: { v: "ㅏ", short: false }, AO: { v: "ㅗ", short: false }, AH: { v: "ㅓ", short: true }, UH: { v: "ㅜ", short: true },
  UW: { v: "ㅜ", short: false }, ER: { v: "ㅓ", short: false }, OW: { v: "ㅗ", short: false },
  EY: { v: "ㅔ", glide: "이", short: false }, AY: { v: "ㅏ", glide: "이", short: false },
  AW: { v: "ㅏ", glide: "우", short: false }, OY: { v: "ㅗ", glide: "이", short: false },
};
const Y_VOWEL: Partial<Record<Jung, Jung>> = { ㅏ: "ㅑ", ㅓ: "ㅕ", ㅗ: "ㅛ", ㅜ: "ㅠ", ㅔ: "ㅖ", ㅐ: "ㅒ", ㅣ: "ㅣ" };
const W_VOWEL: Partial<Record<Jung, Jung>> = { ㅏ: "ㅘ", ㅓ: "ㅝ", ㅗ: "ㅝ", ㅔ: "ㅞ", ㅐ: "ㅙ", ㅣ: "ㅟ", ㅜ: "ㅜ" };

const ONSET: Record<string, Cho> = {
  B: "ㅂ", CH: "ㅊ", D: "ㄷ", DH: "ㄷ", F: "ㅍ", G: "ㄱ", HH: "ㅎ", JH: "ㅈ", K: "ㅋ", L: "ㄹ", M: "ㅁ", N: "ㄴ",
  P: "ㅍ", R: "ㄹ", S: "ㅅ", SH: "ㅅ", T: "ㅌ", TH: "ㅅ", V: "ㅂ", Z: "ㅈ", ZH: "ㅈ",
};
/** 모음 없이 남는 자음 → "자음 + ㅡ" 음절 (스, 트, 크 …) */
const STANDALONE: Record<string, string> = {
  B: "브", CH: "치", D: "드", DH: "드", F: "프", G: "그", HH: "흐", JH: "지", K: "크", P: "프", S: "스", SH: "시",
  T: "트", TH: "스", V: "브", Z: "즈", ZH: "지", L: "르", M: "므", N: "느", NG: "응", W: "우", Y: "이",
};

const isVowel = (p?: string): p is string => Boolean(p && VOWELS[p]);

/** 한 단어의 ARPAbet 음소열 → 한글 */
export function arpabetToHangul(raw: string): string {
  const ph = raw.trim().split(/\s+/).map((p) => p.replace(/\d/g, ""));
  const out: string[] = [];
  let lastShort = false; // 직전 모음 음절이 짧은 모음인가
  let lastWasVowel = false; // 직전 음소가 모음이었나
  for (let i = 0; i < ph.length; i++) {
    const p = ph[i];
    if (isVowel(p)) {
      emitVowel(p, null, "ㅇ", false);
      continue;
    }
    // 자음 + (W|Y) + 모음 / W|Y + 모음 / 자음 + 모음
    const n1 = ph[i + 1];
    const n2 = ph[i + 2];
    if ((p === "W" || p === "Y") && isVowel(n1)) {
      emitVowel(n1, p, "ㅇ", false);
      i += 1;
      continue;
    }
    const onset = ONSET[p];
    if (onset && (n1 === "W" || n1 === "Y") && isVowel(n2) && p !== "L" && p !== "R" && p !== "HH") {
      emitVowel(n2, n1, onset, p === "SH");
      i += 2;
      continue;
    }
    if (onset && isVowel(n1)) {
      // L 이 짧은 모음 뒤·모음 앞이면 앞 음절에 ㄹ 받침을 더 붙인다 (헬로, 옐로)
      if (p === "L" && lastWasVowel && lastShort && out.length > 0 && !hasFinal(out[out.length - 1])) {
        out[out.length - 1] = withFinal(out[out.length - 1], "ㄹ");
      }
      emitVowel(n1, null, onset, p === "SH");
      i += 1;
      continue;
    }
    // 모음 앞이 아닌 자음: 받침이 되거나 "ㅡ" 음절
    const atEnd = i === ph.length - 1;
    const beforeConsonant = !isVowel(n1);
    const prev = out.length > 0 ? out[out.length - 1] : "";
    const canCoda = lastWasVowel && prev && !hasFinal(prev);
    if (canCoda && p === "N") out[out.length - 1] = withFinal(prev, "ㄴ");
    else if (canCoda && p === "M") out[out.length - 1] = withFinal(prev, "ㅁ");
    else if (canCoda && p === "NG") out[out.length - 1] = withFinal(prev, "ㅇ");
    else if (canCoda && p === "L") out[out.length - 1] = withFinal(prev, "ㄹ");
    else if (canCoda && lastShort && (atEnd || beforeConsonant) && (p === "K" || p === "P" || p === "T")) {
      out[out.length - 1] = withFinal(prev, p === "K" ? "ㄱ" : p === "P" ? "ㅂ" : "ㅅ");
    } else if (p === "R") {
      // 모음 뒤 R 은 따로 적지 않는다 (car → 카, more → 모어 는 길게 늘이는 소리로)
    } else if (STANDALONE[p]) out.push(STANDALONE[p]);
    lastWasVowel = false;
  }
  return out.join("");

  function emitVowel(v: string, semi: "W" | "Y" | null, onset: Cho, sh: boolean) {
    const info = VOWELS[v];
    let jung: Jung = info.v;
    if (semi === "Y") jung = Y_VOWEL[jung] ?? jung;
    else if (semi === "W") jung = W_VOWEL[jung] ?? jung;
    else if (sh) jung = Y_VOWEL[jung] ?? jung; // she/shop → 시/샵(샤)
    out.push(compose(onset, jung));
    if (info.glide) out.push(compose("ㅇ", info.glide === "이" ? "ㅣ" : "ㅜ"));
    lastShort = info.short && !info.glide;
    lastWasVowel = true;
  }
}

export interface EnglishResult {
  text: string;
  status: PronStatus;
  notes: string[];
}

const WORD = /[A-Za-z]+(?:'[A-Za-z]+)*/g;

/** 한 줄 안의 영어 단어를 한글로 바꾼다. 영어가 아닌 부분(한글·일본어·숫자·기호)은 그대로 둔다. */
export function englishToHangul(line: string, dict: CmuDict): EnglishResult {
  let unknown = 0;
  let known = 0;
  const text = line.replace(WORD, (w) => {
    const key = w.toLowerCase();
    const entry = dict[key] ?? dict[key.replace(/'s$/, "")];
    if (!entry) {
      unknown++;
      return w;
    }
    known++;
    return arpabetToHangul(entry);
  });
  const notes: string[] = [];
  let status: PronStatus = "ok";
  if (known === 0 && unknown > 0) {
    status = "unsupported";
    notes.push("발음 사전에 없는 단어예요");
  } else if (unknown > 0) {
    status = "review";
    notes.push("발음 사전에 없는 단어는 원문 그대로 남겼어요");
  }
  return { text, status, notes };
}
