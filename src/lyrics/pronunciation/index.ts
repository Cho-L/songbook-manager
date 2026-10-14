import { englishToHangul, type CmuDict } from "./english";
import { isKana, isKanji, japaneseToHangul, type PronStatus } from "./kana";
import { analyzeJapanese } from "./japanese";
import { loadJaTokenizer, type JaTokenizer } from "./tokenizer";

export type { PronStatus } from "./kana";
export type { CmuDict } from "./english";
export { loadJaTokenizer, type JaTokenizer } from "./tokenizer";
export { analyzeJapanese } from "./japanese";

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
  /** 읽지 못해 원문으로 남긴 단어 (일본어) */
  failed?: string[];
  /** 읽기를 정했지만 문맥에 따라 달라질 수 있는 단어 (일본어) */
  uncertain?: string[];
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

/** 일본어 줄이 하나라도 있는가 (형태소 분석기를 불러올지 판단) */
export function needsJaTokenizer(lines: string[]): boolean {
  return lines.some((l) => detectLineLang(l) === "ja");
}

/** 영어 줄이 하나라도 있는가 (사전을 불러올지 판단) */
export function needsEnglishDict(lines: string[]): boolean {
  return lines.some((l) => {
    const lang = detectLineLang(l);
    return lang === "en" || (lang === "ja" && /[A-Za-z]{2,}/.test(l));
  });
}

export interface GenOptions {
  dict?: CmuDict;
  /** 일본어 형태소 분석기. 없으면 가나만 변환하고 한자 줄은 "지원 불가"로 둔다 */
  tokenizer?: JaTokenizer;
}

function genLine(text: string, opts: GenOptions): PronLine {
  {
    const lang = detectLineLang(text);
    try {
      if (lang === "ja") {
        let r: { text: string; status: PronStatus; notes: string[]; failed?: string[]; uncertain?: string[] };
        if (opts.tokenizer) r = analyzeJapanese(text, opts.tokenizer);
        else {
          r = japaneseToHangul(text);
          if (r.status !== "ok") r.notes.push("형태소 분석기를 쓰지 못해 가나만 변환했어요");
          // 분석기 없이 한자를 추정한 값은 믿지 않는다 (한자가 있으면 검토 필요로 비워 둔다)
          if ([...text].some(isKanji)) r = { ...r, status: "unsupported", notes: [...r.notes, "한자 읽기를 분석하지 못했어요"], failed: [...new Set([...text].filter(isKanji))] };
        }
        // 일본어 줄 속 영어 단어(Love 등)는 사전이 있을 때 한글로
        if (opts.dict && /[A-Za-z]{2,}/.test(r.text)) {
          const e = englishToHangul(r.text, opts.dict);
          r = { ...r, text: e.text, status: r.status === "ok" ? (e.status === "unsupported" ? "review" : e.status) : r.status, notes: [...r.notes, ...e.notes] };
        }
        return { text, lang, pron: r.text, status: r.status, notes: r.notes, failed: r.failed, uncertain: r.uncertain };
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
  }
}

export function generatePronunciation(lines: string[], opts: GenOptions = {}): PronLine[] {
  return lines.map((text) => genLine(text, opts));
}

/** 긴 가사에서 화면이 멈추지 않게 일정 줄마다 한 번 숨을 돌리며 만든다 */
export async function generatePronunciationAsync(lines: string[], opts: GenOptions = {}, onProgress?: (done: number, total: number) => void): Promise<PronLine[]> {
  const out: PronLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    out.push(genLine(lines[i], opts));
    if ((i + 1) % 20 === 0) {
      onProgress?.(i + 1, lines.length);
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  }
  onProgress?.(lines.length, lines.length);
  return out;
}

export const loadTokenizer = loadJaTokenizer;

let dictPromise: Promise<CmuDict> | null = null;
/** 영어 발음 사전(약 4.7MB)은 필요할 때만 따로 내려받는다 (초기 로딩에 포함되지 않는다) */
export function loadCmuDict(): Promise<CmuDict> {
  dictPromise ??= import("cmu-pronouncing-dictionary").then((m) => m.dictionary as CmuDict).catch((e) => {
    dictPromise = null;
    throw e;
  });
  return dictPromise;
}

/** 발음 문자열에 변환되지 않은 가나·한자가 남아 있는가 (남아 있으면 정상 결과가 아니다) */
export function hasUnconverted(pron: string): boolean {
  return [...pron].some((c) => isKana(c) || isKanji(c));
}

/** 저장해도 되는 발음인가: 비어 있지 않고 변환 안 된 글자가 없어야 한다 */
export function isSavablePron(pron: string): boolean {
  return pron.trim() !== "" && !hasUnconverted(pron);
}

/**
 * 가사 줄들의 발음을 만든다. 필요한 부분만 지연 로드한다:
 * 일본어 줄이 있을 때만 형태소 분석기(사전 포함), 영어가 있을 때만 영어 발음 사전.
 * 로드 실패는 전체 실패가 아니라 경고로 돌려준다 (가능한 줄만 변환).
 */
export async function runPronunciation(texts: string[], onProgress?: (done: number, total: number) => void): Promise<{ rows: PronLine[]; warnings: string[] }> {
  const warnings: string[] = [];
  let tokenizer: JaTokenizer | undefined;
  let dict: CmuDict | undefined;
  if (needsJaTokenizer(texts)) {
    try {
      tokenizer = await loadJaTokenizer();
    } catch {
      warnings.push("일본어 분석 사전을 불러오지 못했어요 — 한자가 있는 줄은 변환하지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
  }
  if (needsEnglishDict(texts)) {
    try {
      dict = await loadCmuDict();
    } catch {
      warnings.push("영어 발음 사전을 불러오지 못했어요 — 영어 줄은 변환하지 못했어요.");
    }
  }
  const rows = await generatePronunciationAsync(texts, { dict, tokenizer }, onProgress);
  return { rows, warnings };
}
