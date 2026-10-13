import { englishToHangul, type CmuDict } from "./english";
import { isKana, isKanji, japaneseToHangul, type PronStatus } from "./kana";

export type { PronStatus } from "./kana";
export type { CmuDict } from "./english";

/**
 * 가사 줄별 한글 발음 생성 (1:1). 입력 줄 수 = 출력 줄 수, 시간 정보는 호출하는 쪽 줄에 그대로 남는다.
 * 결과는 "초안"이다 — 화면에서 미리 보고 고친 뒤에만 저장한다. 실패한 줄은 pron 이 비어 있고 원문은 건드리지 않는다.
 */
export type LineLang = "ja" | "en" | "ko" | "none";

export interface PronLine {
  text: string;
  lang: LineLang;
  /** 생성한 발음. 생성하지 않았거나 못 했으면 빈 문자열 */
  pron: string;
  status: PronStatus | "skipped";
  notes: string[];
}

const SECTION = /^\s*(\[[^\]]*\]|\([^)]*\))\s*$/;

export function detectLineLang(text: string): LineLang {
  const t = text.trim();
  if (!t || SECTION.test(t)) return "none";
  for (const ch of t) if (isKana(ch) || isKanji(ch)) return "ja";
  if (/[A-Za-z]/.test(t)) return "en";
  if (/[가-힣]/.test(t)) return "ko";
  return "none";
}

/** 영어 줄이 하나라도 있는가 (사전을 불러올지 판단) */
export function needsEnglishDict(lines: string[]): boolean {
  return lines.some((l) => {
    const lang = detectLineLang(l);
    return lang === "en" || (lang === "ja" && /[A-Za-z]{2,}/.test(l));
  });
}

export function generatePronunciation(lines: string[], opts: { dict?: CmuDict } = {}): PronLine[] {
  return lines.map((text) => {
    const lang = detectLineLang(text);
    try {
      if (lang === "ja") {
        let r = japaneseToHangul(text);
        // 일본어 줄 속 영어 단어(Love 등)는 사전이 있을 때 한글로
        if (opts.dict && /[A-Za-z]{2,}/.test(r.text)) {
          const e = englishToHangul(r.text, opts.dict);
          r = { text: e.text, status: r.status === "ok" ? (e.status === "unsupported" ? "review" : e.status) : r.status, notes: [...r.notes, ...e.notes] };
        }
        return { text, lang, pron: r.text, status: r.status, notes: r.notes };
      }
      if (lang === "en") {
        if (!opts.dict) return { text, lang, pron: "", status: "unsupported" as const, notes: ["영어 발음 사전을 불러오지 못했어요"] };
        const r = englishToHangul(text, opts.dict);
        return { text, lang, pron: r.status === "unsupported" ? "" : r.text, status: r.status, notes: r.notes };
      }
    } catch {
      return { text, lang, pron: "", status: "unsupported" as const, notes: ["이 줄은 변환하지 못했어요 (원문은 그대로예요)"] };
    }
    return { text, lang, pron: "", status: "skipped" as const, notes: [] };
  });
}

let dictPromise: Promise<CmuDict> | null = null;
/** 영어 발음 사전(약 4.7MB)은 필요할 때만 따로 내려받는다 (초기 로딩에 포함되지 않는다) */
export function loadCmuDict(): Promise<CmuDict> {
  dictPromise ??= import("cmu-pronouncing-dictionary").then((m) => m.dictionary as CmuDict).catch((e) => {
    dictPromise = null;
    throw e;
  });
  return dictPromise;
}
