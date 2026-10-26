import type { Song } from "../types/song";
import { ARTIST_ALIAS_GROUPS, TITLE_ALIAS_ENTRIES } from "../data/aliasSeed";
import { normalizeForSearch } from "./searchNormalize";

/** 정규화된 가수 표기 → 같은 가수의 모든 표기 */
const ARTIST_INDEX = new Map<string, string[]>();
for (const group of ARTIST_ALIAS_GROUPS) for (const name of group) ARTIST_INDEX.set(normalizeForSearch(name), group);

/** 정규화된 제목 → (가수 그룹 키 | "")별 별칭 목록 */
const TITLE_INDEX = new Map<string, { artistKey: string; titles: string[] }[]>();
for (const e of TITLE_ALIAS_ENTRIES) {
  const artistKey = e.artist ? normalizeForSearch(ARTIST_INDEX.get(normalizeForSearch(e.artist))?.[0] ?? e.artist) : "";
  for (const t of e.titles) {
    const k = normalizeForSearch(t);
    const list = TITLE_INDEX.get(k) ?? [];
    list.push({ artistKey, titles: e.titles });
    TITLE_INDEX.set(k, list);
  }
}

export interface SongAliases {
  titles: string[];
  artists: string[];
}

const uniq = (xs: string[]): string[] => {
  const seen = new Set<string>();
  return xs.filter((x) => {
    const k = normalizeForSearch(x);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

/** 가수 이름 하나에서 알려진 다른 표기들 (자기 자신 제외). "로제, 브루노마스" 같은 목록도 쉼표/&/feat 로 나눠 각각 찾는다. */
export function artistAliasesOf(artist: string): string[] {
  const names = artist.split(/\s*(?:,|&|\/|feat\.?|ft\.?|featuring|x|×|와|과)\s*/i).filter(Boolean);
  const out: string[] = [];
  for (const n of [artist, ...names]) {
    const g = ARTIST_INDEX.get(normalizeForSearch(n));
    if (g) out.push(...g);
  }
  return out.filter((a) => normalizeForSearch(a) !== normalizeForSearch(artist));
}

/** 이 곡의 제목/가수 별칭 = 곡에 직접 입력한 별칭 + 기본 사전(제목은 가수가 맞을 때만) */
export function getSongAliases(song: Pick<Song, "title" | "artist" | "titleAliases" | "artistAliases">): SongAliases {
  const artistAliases = uniq([...(song.artistAliases ?? []), ...artistAliasesOf(song.artist ?? "")]);
  const artistKeys = new Set([song.artist, ...artistAliases].map((a) => normalizeForSearch(a)));
  const seedTitles: string[] = [];
  for (const hit of TITLE_INDEX.get(normalizeForSearch(song.title)) ?? []) {
    const artistOk = !hit.artistKey || [...artistKeys].some((k) => ARTIST_INDEX.get(k)?.some((n) => normalizeForSearch(n) === hit.artistKey));
    if (artistOk) seedTitles.push(...hit.titles);
  }
  // Preserve symbol spellings for provider lookup even when browse-search normalization considers them equal.
  const spelling = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
  const seenTitles = new Set<string>([spelling(song.title)]);
  const titles = [...(song.titleAliases ?? []), ...seedTitles].filter((t) => {
    const key = spelling(t);
    if (!key || seenTitles.has(key)) return false;
    seenTitles.add(key);
    return true;
  });
  return { titles, artists: artistAliases };
}

/** 폼 입력("a, b; c") → 별칭 배열 */
export function parseAliasInput(raw: string): string[] {
  return uniq(
    raw
      .split(/[,;\n，、]/)
      .map((s) => s.trim().slice(0, 100))
      .filter(Boolean)
  ).slice(0, 10);
}
