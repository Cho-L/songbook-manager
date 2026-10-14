import { CHO, JONG, JUNG } from "./pronunciation/hangul";
import { kanaToHangul } from "./pronunciation/kana";

/**
 * 한글 제목 ↔ 일본어 제목 사이의 "외래어 일치" 근거.
 * 번역된 제목(너는 록을 듣지 않아 ↔ 君はロックを聞かない)은 글자로 비교할 수 없지만, 제목 속 가타카나 외래어(ロック)는
 * 한글 표기(록)와 소리가 이어진다. 사전/번역기 없이 가타카나를 한글 발음으로 바꿔 한글 단어와 음절 골격이 같은지만 본다.
 * 약한 근거라서 점수에는 상한(0.5)을 두고, 자동 선택에는 쓰지 않는다.
 */
const JOSA_TAIL = "은는이가을를의에도로과와만";

/** 음절 → (초성, 중성) 골격. 받침은 버린다 */
function skeleton(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.charCodeAt(0) - 0xac00;
    if (code < 0 || code > 11171) continue;
    out += CHO[Math.floor(code / 588)] + JUNG[Math.floor((code % 588) / 28)];
  }
  return out;
}

/** 일본어식 표기(롯쿠)를 한국 외래어 표기(록)처럼 접는다: ㅅ받침 + ㅋ행 → ㄱ받침 */
function foldSokuon(h: string): string {
  const cs = [...h];
  const out: string[] = [];
  for (let i = 0; i < cs.length; i++) {
    const code = cs[i].charCodeAt(0) - 0xac00;
    const next = cs[i + 1]?.charCodeAt(0) - 0xac00;
    const isSFinal = code >= 0 && code <= 11171 && JONG[code % 28] === "ㅅ";
    const nextIsK = next >= 0 && next <= 11171 && CHO[Math.floor(next / 588)] === "ㅋ";
    if (isSFinal && nextIsK) {
      out.push(String.fromCharCode(0xac00 + code - 19 + 1)); // ㅅ(19) → ㄱ(1)
      i++;
    } else out.push(cs[i]);
  }
  return out.join("");
}

export interface LoanwordMatch {
  ja: string;
  ko: string;
}

export function loanwordMatches(a: string, b: string): LoanwordMatch[] {
  const hangulSide = /[가-힣]/.test(a) ? a : /[가-힣]/.test(b) ? b : "";
  const jaSide = hangulSide === a ? b : a;
  if (!hangulSide || !/[゠-ヿ]/.test(jaSide) || /[가-힣]/.test(jaSide)) return [];
  const koWords = (hangulSide.match(/[가-힣]+/g) ?? []).map((w) => (w.length >= 2 && JOSA_TAIL.includes(w[w.length - 1]) ? w.slice(0, -1) : w));
  const runs = jaSide.match(/[ァ-ヺー]{2,}/g) ?? [];
  const out: LoanwordMatch[] = [];
  for (const run of runs) {
    const sk = skeleton(foldSokuon(kanaToHangul(run)));
    if (!sk) continue;
    const hit = koWords.find((w) => skeleton(w) === sk);
    if (hit) out.push({ ja: run, ko: hit });
  }
  return out;
}

/** 외래어 일치로 줄 수 있는 제목 점수 (한 개 0.3, 하나 늘 때마다 +0.1, 최대 0.5) */
export function loanwordScore(a: string, b: string): { score: number; matches: LoanwordMatch[] } {
  const matches = loanwordMatches(a, b);
  return { score: matches.length === 0 ? 0 : Math.min(0.5, 0.3 + 0.1 * (matches.length - 1)), matches };
}
