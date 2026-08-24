import type { Song } from "../types/song";

/** 검색 비교를 위해 소문자화 + 공백 제거 */
function normalize(value: string | undefined): string {
  return (value ?? "").toLowerCase().replace(/\s+/g, "");
}

/**
 * 제목/가수/작곡가/작사가/장르/태그 전체를 대상으로
 * 대소문자·공백에 민감하지 않게 검색한다.
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
