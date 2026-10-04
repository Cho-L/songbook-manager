import { crossScriptSimilarity, hasHangul, hasLatin, levenshtein } from "./phonetic";

/**
 * 아티스트 정규화/목록 분리/매칭.
 * 콜라보 표기 차이("로제,브루노마스" / "ROSÉ, Bruno Mars" / "ROSÉ & Bruno Mars" / "Bruno Mars, ROSÉ" / "ROSÉ feat. Bruno Mars" …)를
 * 곡 하나만의 예외 처리 없이 일반적으로 흡수한다.
 */

/** 악센트 제거 (é → e). 한글은 NFC 로 되돌려 음절을 유지한다. */
export function foldDiacritics(s: string): string {
  return s.normalize("NFKD").replace(/\p{M}/gu, "").normalize("NFC");
}

/** 비교용 단일 이름 정규화: 악센트 제거, 소문자, 글자/숫자만 */
export function normalizeArtist(name: string): string {
  return foldDiacritics(name).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

// 구분자: , ; & + / × ＆ 、 · , 단어 and / with / feat / ft / featuring / vs, 공백으로 둘러싸인 x · 와 · 과
const SEPARATOR =
  /\s*(?:[,;&+/×＆、·]|\s(?:x|와|과)\s|\b(?:and|with|feat|ft|featuring|vs)\b\.?)\s*/giu;

/**
 * "로제,브루노마스" → ["로제","브루노마스"], "ROSÉ feat. Bruno Mars" → ["ROSÉ","Bruno Mars"].
 * "(feat. X)" 는 아티스트로 포함하고, 그 밖의 괄호 부가 표기("(Official)")는 버린다.
 */
export function splitArtists(raw: string): string[] {
  // 전각 기호(，＆ 등)를 일반 기호로 통일한 뒤 나눈다
  const withFeat = raw.normalize("NFKC").replace(/[([{（【]\s*(?:feat|ft|featuring|with)\.?\s+([^)\]}）】]*)[)\]}）】]/gi, ", $1");
  const noBrackets = withFeat.replace(/[([{（【][^)\]}）】]*[)\]}）】]/g, " ");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of noBrackets.split(SEPARATOR)) {
    const name = part.trim();
    const key = normalizeArtist(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** 정규화된 이름 목록 (순서 유지, 중복 제거) */
export function normalizeArtistList(raw: string): string[] {
  return splitArtists(raw).map(normalizeArtist);
}

/** 검색용으로 보기 좋게 정규화한 아티스트 문자열 ("ROSÉ & Bruno Mars" → "Rose, Bruno Mars"는 아니고 구분자만 통일) */
export function canonicalArtistQuery(raw: string): string {
  return splitArtists(raw).map(foldDiacritics).join(", ");
}

// ---------------------------------------------------------------- 별칭(alias) 해석

export interface ArtistAliasResolver {
  /** 정규화된 이름 → 같은 아티스트로 알려진 정규화된 이름들 */
  resolve(normalized: string): string[];
}

const ALIAS_KEY = "songbook:artist-aliases:v1";
const ALIAS_MAX = 500;

function readAliasMap(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(ALIAS_KEY);
    const v = raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/**
 * 사용자가 후보 목록에서 "이게 맞아요"라고 직접 확인한 곡의 아티스트 표기를 별칭으로 기억한다.
 * (번역 사전을 미리 넣어 두는 대신, 확인된 결과만 쌓는다 — 틀린 별칭이 퍼지지 않는다.)
 * 같은 개수의 이름이면 소리/표기가 가장 비슷한 쌍끼리 연결하고, 개수가 다르면 아무것도 기억하지 않는다.
 */
export function learnArtistAliases(songArtist: string, candidateArtist: string): number {
  const a = splitArtists(songArtist);
  const b = splitArtists(candidateArtist);
  if (a.length === 0 || a.length !== b.length) return 0;
  const used = new Set<number>();
  const pairs: [string, string][] = [];
  for (const name of a) {
    let best = -1;
    let bestScore = 0;
    b.forEach((c, j) => {
      if (used.has(j)) return;
      const s = nameMatch(name, c, false);
      if (s > bestScore) {
        bestScore = s;
        best = j;
      }
    });
    // 소리로 짝을 못 찾으면, 이름이 하나뿐일 때만 (A=B) 짝으로 본다
    if (best < 0 && a.length === 1) best = 0;
    if (best < 0) return 0; // 어느 한 이름이라도 확신할 수 없으면 아무것도 저장하지 않는다
    used.add(best);
    pairs.push([normalizeArtist(name), normalizeArtist(b[best])]);
  }
  const map = readAliasMap();
  let added = 0;
  for (const [x, y] of pairs) {
    if (!x || !y || x === y) continue;
    for (const [from, to] of [[x, y], [y, x]]) {
      const list = map[from] ?? [];
      if (!list.includes(to)) {
        list.push(to);
        map[from] = list;
        added++;
      }
    }
  }
  if (added > 0) {
    const keys = Object.keys(map);
    if (keys.length > ALIAS_MAX) for (const k of keys.slice(0, keys.length - ALIAS_MAX)) delete map[k];
    try {
      localStorage.setItem(ALIAS_KEY, JSON.stringify(map));
    } catch {
      // ignore
    }
  }
  return added;
}

const learnedResolver: ArtistAliasResolver = { resolve: (n) => readAliasMap()[n] ?? [] };
const resolvers: ArtistAliasResolver[] = [learnedResolver];

/** 추가 alias 출처(예: 서버 데이터)를 붙일 수 있는 자리 */
export function registerAliasResolver(r: ArtistAliasResolver): void {
  resolvers.push(r);
}

/** 이름과 같은 아티스트로 알려진 정규화된 이름들 (자기 자신 포함) */
export function resolveArtistAliases(name: string): string[] {
  const n = normalizeArtist(name);
  if (!n) return [];
  const set = new Set<string>([n]);
  for (const r of resolvers) for (const a of r.resolve(n)) set.add(a);
  return [...set];
}

// ---------------------------------------------------------------- 매칭

function dice(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return 0;
  const grams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) grams.set(a.slice(i, i + 2), (grams.get(a.slice(i, i + 2)) ?? 0) + 1);
  let inter = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2);
    const c = grams.get(g) ?? 0;
    if (c > 0) {
      inter++;
      grams.set(g, c - 1);
    }
  }
  return (2 * inter) / (a.length - 1 + (b.length - 1));
}

/** 같은 문자 체계끼리의 비교. 비슷한 다른 사람(Bruno Mars ≠ Bruno Major, 아이유 ≠ 아이브)을 같은 사람으로 보지 않도록 엄격하게 */
function sameScriptSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  // 한쪽이 다른 쪽에 통째로 포함되고 충분히 긴 이름일 때만 (예: "taylorswift" ⊂ "taylorswiftband")
  if (short.length >= 6 && long.includes(short)) return 0.85;
  const ratio = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  const d = dice(a, b);
  const s = Math.max(ratio, d);
  return s >= 0.85 ? s : 0; // 오타 수준만 인정
}

/**
 * 두 아티스트 이름이 같은 사람일 가능성 0~1.
 * 1) 정규화 후 동일 → 1   2) 알려진 별칭(사용자가 확인한 것) → 1
 * 3) 같은 문자 체계 → 엄격한 철자 유사도   4) 한글↔영문 → 음운 골격 비교(약한 근거는 상한)
 */
export function nameMatch(a: string, b: string, useAliases = true): number {
  const na = normalizeArtist(a);
  const nb = normalizeArtist(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (useAliases) {
    const aliasesA = resolveArtistAliases(a);
    if (aliasesA.includes(nb)) return 1;
    const aliasesB = resolveArtistAliases(b);
    if (aliasesB.includes(na) || aliasesA.some((x) => aliasesB.includes(x))) return 1;
  }
  const aKo = hasHangul(na);
  const bKo = hasHangul(nb);
  const aLa = hasLatin(na);
  const bLa = hasLatin(nb);
  if ((aKo && !aLa && bLa && !bKo) || (bKo && !bLa && aLa && !aKo)) return crossScriptSimilarity(a, b);
  return sameScriptSimilarity(na, nb);
}

export interface ArtistMatch {
  /** 0~1 최종 점수 */
  score: number;
  /** 곡에 적힌 이름을 후보가 얼마나 덮는가 */
  coverage: number;
}

/**
 * 아티스트 목록 비교: 순서와 구분자 표기("," "&" "and" "feat." "x" …)에 영향을 받지 않는다.
 * 곡에 적힌 이름은 후보의 이름들 중 가장 잘 맞는 것과 짝지어 평균(coverage)을 내고,
 * 후보에만 있는 이름(피처링 등)은 약하게(25%) 반영한다. 밴드 이름처럼 구분자가 이름의 일부인 경우를 위해 전체 문자열 비교도 한다.
 */
/** 토큰 배열을 연속된 k 개의 그룹으로 나누는 모든 방법 (토큰은 최대 8개) */
function partitions(tokens: string[], k: number): string[][] {
  if (k === 1) return [[tokens.join(" ")]];
  const out: string[][] = [];
  for (let i = 1; i <= tokens.length - (k - 1); i++) {
    const head = tokens.slice(0, i).join(" ");
    for (const rest of partitions(tokens.slice(i), k - 1)) out.push([head, ...rest]);
  }
  return out;
}

function listScore(S: string[], C: string[]): ArtistMatch {
  const m = S.map((s) => C.map((c) => nameMatch(s, c)));
  const inCov = m.reduce((acc, row) => acc + Math.max(...row), 0) / S.length;
  const outCov = C.reduce((acc, _, j) => acc + Math.max(...m.map((row) => row[j])), 0) / C.length;
  return { score: 0.75 * inCov + 0.25 * outCov, coverage: inCov };
}

/**
 * 아티스트 목록 비교: 순서와 구분자 표기("," "&" "and" "feat." "x" …)에 영향을 받지 않는다.
 * 곡에 적힌 이름은 후보의 이름들 중 가장 잘 맞는 것과 짝지어 평균(coverage)을 내고,
 * 후보에만 있는 이름(피처링 등)은 약하게(25%) 반영한다. 밴드 이름처럼 구분자가 이름의 일부인 경우를 위해 전체 문자열 비교도 한다.
 * 구분자 없이 공백으로만 이어 쓴 경우("로제 브루노 마스")는, 후보가 여러 명이면 공백 토큰을 연속 그룹으로 묶는 해석도 시도한다.
 */
export function matchArtists(songArtist: string, candidateArtist: string): ArtistMatch {
  const S = splitArtists(songArtist);
  const C = splitArtists(candidateArtist);
  // 전체 문자열 비교는 같은 문자 체계끼리만 한다 (밴드 이름처럼 구분자가 이름의 일부인 경우 보호용).
  // 한글↔영문 전체 문자열을 소리로 비교하면 이름 순서에 따라 점수가 달라지므로 쓰지 않는다.
  const wholeCross = (hasHangul(songArtist) && !hasLatin(songArtist) && hasLatin(candidateArtist) && !hasHangul(candidateArtist)) ||
    (hasHangul(candidateArtist) && !hasLatin(candidateArtist) && hasLatin(songArtist) && !hasHangul(songArtist));
  const whole = wholeCross ? 0 : nameMatch(songArtist, candidateArtist);
  if (S.length === 0 || C.length === 0) return { score: whole, coverage: whole };
  let best = listScore(S, C);
  if (S.length === 1 && C.length >= 2 && C.length <= 4) {
    const tokens = S[0].split(/\s+/).filter(Boolean);
    if (tokens.length >= C.length && tokens.length <= 8) {
      for (const groups of partitions(tokens, C.length)) {
        const r = listScore(groups, C);
        if (r.score > best.score) best = r;
      }
    }
  }
  return { score: Math.max(best.score, whole), coverage: Math.max(best.coverage, whole) };
}
