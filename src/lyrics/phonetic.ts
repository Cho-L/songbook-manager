/**
 * 한글 ↔ 영문 표기를 "사전 없이" 비교하기 위한 음운 골격(consonant skeleton).
 * 한글 외래어 표기와 원어 표기는 자음이 대체로 비슷한 소리로 대응한다는 점만 이용한다:
 *   레이디 가가 → R D G G,  Lady Gaga → R D G G
 *   브루노 마스 → B R N M S,  Bruno Mars → B R N M R S
 * 번역 사전이 아니라 소리 비교라서 100% 정확하지 않다(짧은 이름은 약한 근거로만 취급한다).
 */

const INITIAL = ["G", "G", "N", "D", "D", "R", "M", "B", "B", "S", "S", "", "S", "S", "S", "G", "D", "B", "H"];
const FINAL = ["", "G", "G", "G", "N", "N", "N", "D", "R", "R", "M", "R", "R", "R", "R", "R", "M", "B", "B", "S", "S", "N", "S", "S", "G", "D", "B", ""];

export function hasHangul(s: string): boolean {
  return /[\uAC00-\uD7A3]/.test(s);
}
export function hasLatin(s: string): boolean {
  return /[a-z]/i.test(s);
}

function hangulSkeleton(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (code < 0xac00 || code > 0xd7a3) continue;
    const idx = code - 0xac00;
    out += INITIAL[Math.floor(idx / 588)] + FINAL[idx % 28];
  }
  return out;
}

function latinSkeleton(input: string): string {
  // 악센트 제거(é → e), 소문자, 알파벳만
  const s = input
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .replace(/(.)\1+/g, "$1") // ss, ll, tt …
    .replace(/ch|sh/g, "S")
    .replace(/ph/g, "B")
    .replace(/th/g, "D")
    .replace(/ck/g, "G")
    .replace(/ng/g, "N")
    .replace(/qu/g, "G");
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c >= "A" && c <= "Z") {
      out += c; // 위에서 만든 자음 클래스 그대로
      continue;
    }
    switch (c) {
      case "b": case "p": case "f": case "v": out += "B"; break;
      case "d": case "t": out += "D"; break;
      case "g": case "k": case "q": out += "G"; break;
      case "c": out += "eiy".includes(s[i + 1] ?? "") ? "S" : "G"; break;
      case "j": case "s": case "z": out += "S"; break;
      case "x": out += "GS"; break;
      case "l": case "r": out += "R"; break;
      case "m": out += "M"; break;
      case "n": out += "N"; break;
      case "h": out += "H"; break;
      default: break; // 모음, y, w 는 건너뛴다
    }
  }
  return out;
}

/** 한글/영문 문자열의 자음 골격. 다른 문자가 섞여 있으면 둘 다 합친다. */
export function phoneticKey(s: string): string {
  return hangulSkeleton(s) + latinSkeleton(s.replace(/[\uAC00-\uD7A3]/g, ""));
}

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** 짧은 골격(2글자)은 우연히 같을 확률이 높아서 상한을 둔다 */
export const WEAK_PHONETIC_CAP = 0.55;

/**
 * 한글 문자열과 영문 문자열이 "비슷한 소리"인지 0~1 로 평가한다.
 * - 첫 자음과 마지막 자음 클래스가 같아야 한다 (Bruno Mars ≠ Bruno Major: 마지막이 S ↔ R)
 * - 골격 편집거리 비율이 0.75 이상일 때만 점수를 준다
 * - 골격이 3 미만이면 WEAK_PHONETIC_CAP 로 제한한다 (단독으로는 자동 선택 근거가 못 된다)
 */
export function crossScriptSimilarity(a: string, b: string): number {
  const ka = phoneticKey(a);
  const kb = phoneticKey(b);
  const minLen = Math.min(ka.length, kb.length);
  if (minLen < 2) return 0;
  if (ka[0] !== kb[0] || ka[ka.length - 1] !== kb[kb.length - 1]) return 0;
  const ratio = 1 - levenshtein(ka, kb) / Math.max(ka.length, kb.length);
  if (ratio < 0.75) return 0;
  return minLen < 3 ? Math.min(ratio, WEAK_PHONETIC_CAP) : ratio;
}
