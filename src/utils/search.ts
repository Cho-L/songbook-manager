import type { Song } from "../types/song";

/** 검색 비교용 정규화: Unicode 정규화, 대소문자, 공백·기호 차이를 무시한다.
 * 한글/일본어/영문 제목의 표기 차이를 줄이되 원본 표시 문자열은 바꾸지 않는다.
 */
function normalize(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

/**
 * 제목/가수/작곡가/작사가/장르/태그 전체를 대상으로 검색한다.
 * 한글/일본어 IME 입력은 SearchBar에서 조합 완료 후 전달한다.
 * Unicode 표기와 공백·문장부호 차이도 무시한다.
 */
export function searchSongs(songs: Song[], query: string): Song[] {
  const q = normalize(query);
  if (!q) return songs;

  return songs.filter((song) => {
    const fields = [
      song.title,
      song.artist,
      song.composer,
      song.lyricist,
      song.genre,
      ...song.tags,
    ];
    return fields.some((field) => normalize(field).includes(q));
  });
}
