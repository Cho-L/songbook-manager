import type { Song } from "../types/song";
import { getSongAliases } from "./songAliases";
import { isChoseongQuery, normalizeForSearch, splitTitleArtistQuery, toChoseong } from "./searchNormalize";

/** 검색 비교를 위해 NFKC·소문자·공백/기호 제거 */
const normalize = normalizeForSearch;

interface SongIndex {
  /** 제목/제목 별칭 */
  titles: string[];
  /** 가수/가수 별칭 */
  artists: string[];
  /** 그 밖의 필드 (작곡가/작사가/장르/태그) */
  others: string[];
  all: string[];
  choseong: string[];
}

const cache = new WeakMap<Song, SongIndex>();

function indexOf(song: Song): SongIndex {
  const hit = cache.get(song);
  if (hit) return hit;
  const al = getSongAliases(song);
  const titles = [song.title, ...al.titles].map(normalize).filter(Boolean);
  const artists = [song.artist, ...al.artists].map(normalize).filter(Boolean);
  const others = [song.composer, song.lyricist, song.genre, ...song.tags].map(normalize).filter(Boolean);
  const all = [...titles, ...artists, ...others];
  const idx = { titles, artists, others, all, choseong: [song.title, song.artist].map((s) => toChoseong(s ?? "").replace(/\s+/g, "")) };
  cache.set(song, idx);
  return idx;
}

const has = (fields: string[], q: string) => fields.some((f) => f.includes(q));

/**
 * 제목/가수/작곡가/작사가/장르/태그 + 다국어 별칭을 대상으로 검색한다.
 * - 대소문자·공백·기호·전각/반각·가타카나/히라가나 차이는 무시
 * - "이름에게 아이유" 처럼 여러 단어면 각 단어가 (서로 다른 필드여도) 모두 맞아야 한다
 * - "이름에게 / 아이유", "Dear Name / IU" 처럼 "제목 / 가수"로 쓰면 제목은 제목(별칭 포함)에, 가수는 가수(별칭 포함)에 맞춘다
 * - 초성만 입력하면("ㅇㅇㅇ") 제목/가수 초성으로 찾는다
 * 예전에 찾던 결과는 그대로 찾는다(검색어 전체가 한 필드에 포함되는 경우 포함).
 */
export function searchSongs(songs: Song[], query: string): Song[] {
  const raw = query.trim();
  const q = normalize(raw);
  if (!q) return songs;

  const pair = splitTitleArtistQuery(raw);
  const pairT = pair ? normalize(pair.title) : "";
  const pairA = pair ? normalize(pair.artist) : "";
  const tokens = raw.split(/\s+/).map(normalize).filter(Boolean);
  const choseong = isChoseongQuery(raw.replace(/\s+/g, ""));

  return songs.filter((song) => {
    const ix = indexOf(song);
    if (has(ix.all, q)) return true;
    if (pair && pairT && pairA && has(ix.titles, pairT) && has(ix.artists, pairA)) return true;
    if (tokens.length > 1 && tokens.every((t) => has(ix.all, t))) return true;
    if (choseong) {
      const c = raw.replace(/\s+/g, "");
      return ix.choseong.some((f) => f.includes(c));
    }
    return false;
  });
}
