/**
 * 검색용 문자열 정규화.
 * - 유니코드 NFKC (전각/반각, 호환 문자 통일: "ＩＵ" → "IU", "㈜" → "(주)")
 * - 대소문자 무시, 로마자 악센트 제거 (é → e) — 한글은 NFC 로 다시 합쳐서 그대로 둔다
 * - 공백/구두점/기호 제거 ("Dear Name!" ≈ "dearname", "APT." ≈ "apt")
 * - 일본어 가타카나 → 히라가나 (ヨアソビ ≈ よあそび)
 */
export function normalizeForSearch(input: string | undefined | null): string {
  if (!input) return "";
  return (
    input
      .normalize("NFKC")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .normalize("NFC")
      // 가타카나(30A1~30F6) → 히라가나(3041~3096)
      .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
      .replace(/[\s\p{P}\p{S}]+/gu, "")
  );
}

const CHOSEONG = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";

/** 한글 음절의 초성만 뽑는다 ("아이유" → "ㅇㅇㅇ"). 한글이 아닌 글자는 그대로 둔다. */
export function toChoseong(input: string): string {
  let out = "";
  for (const ch of input.normalize("NFC")) {
    const c = ch.charCodeAt(0);
    out += c >= 0xac00 && c <= 0xd7a3 ? CHOSEONG[Math.floor((c - 0xac00) / 588)] : ch;
  }
  return out;
}

/** 초성(자음)만으로 이루어진 검색어인지 ("ㅇㅇㅇ") */
export function isChoseongQuery(q: string): boolean {
  return q.length >= 2 && /^[ㄱ-ㅎ]+$/.test(q);
}

/** 검색어를 "제목 / 가수" 형태로 나눈다. 구분자: " / ", " - ", " | ", "／". 구분자가 없으면 null */
export function splitTitleArtistQuery(raw: string): { title: string; artist: string } | null {
  const parts = raw
    .normalize("NFKC")
    .split(/\s+[/|\-–—]\s+|\s*[/|]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length === 2 ? { title: parts[0], artist: parts[1] } : null;
}
