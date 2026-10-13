import { normalizeArtist, splitArtists } from "../artist";
import { hasHangul, hasLatin } from "../phonetic";
import { normalizeTitle } from "../text";
import { classifyHttpStatus } from "../errors";
import type { AliasProvider, TitleArtistAliases } from "../types";

/**
 * MusicBrainz (https://musicbrainz.org) — 공개 음악 메타데이터 DB (API 키 없음, 브라우저 CORS 허용).
 * 한글로 적은 곡/가수가 가사 DB(LRCLIB)에는 영문 표기로만 올라 있을 때("꽃길 - 김세정" ↔ "Flower Way - Kim Sejeong"),
 * 번역하거나 소리로 지어내지 않고 MusicBrainz 가 가진 "공식 별칭/앨범명"만 가져와서 검색에 쓴다.
 *
 * 확실한 경우에만 값을 돌려준다:
 *  - 가수: 이름(또는 별칭)이 입력과 정확히 같은 아티스트만 채택한다 (비슷한 이름은 쓰지 않는다)
 *  - 제목: 그 아티스트의 녹음 중 제목이 입력과 정확히 같은 것의 별칭/수록 릴리스 제목 가운데 영문(라틴 문자)인 것만 채택한다
 * 요청은 곡당 최대 2번이고 결과는 메모리에 캐시한다 (MusicBrainz 는 초당 1회 이내 사용을 요청한다).
 */
interface MbAlias {
  name?: string;
  locale?: string | null;
}
interface MbArtist {
  id?: string;
  name?: string;
  "sort-name"?: string;
  score?: number;
  aliases?: MbAlias[];
}
interface MbRecording {
  title?: string;
  aliases?: MbAlias[];
  releases?: { title?: string }[];
}

const EMPTY: TitleArtistAliases = { artists: [], titles: [] };

/** 가사 DB 검색에 쓸 수 있는 "원어/영문 표기"인가: 한글이 없고, 라틴 문자나 일본어(가나/한자)가 있어야 한다 */
function isUsableAlias(s: string): boolean {
  return !hasHangul(s) && (hasLatin(s) || /[\u3040-\u30FF\u4E00-\u9FFF]/.test(s));
}
function pushUnique(list: string[], seen: Set<string>, value: string | undefined, keyFn: (v: string) => string) {
  const v = (value ?? "").trim();
  if (!v || !isUsableAlias(v)) return;
  const k = keyFn(v);
  if (!k || seen.has(k)) return;
  seen.add(k);
  list.push(v);
}

export class MusicBrainzAliasProvider implements AliasProvider {
  readonly name = "MusicBrainz";
  private cache = new Map<string, Promise<TitleArtistAliases>>();
  private baseUrl: string;
  private fetchImpl: typeof fetch;
  constructor(baseUrl: string = "https://musicbrainz.org", fetchImpl: typeof fetch = (...a) => fetch(...a)) {
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
  }

  lookup(title: string, artist: string, signal?: AbortSignal): Promise<TitleArtistAliases> {
    const key = `${normalizeTitle(title)}|${normalizeArtist(artist)}`;
    let p = this.cache.get(key);
    if (!p) {
      p = this.doLookup(title, artist, signal).catch((e) => {
        this.cache.delete(key); // 일시적 실패는 캐시하지 않는다
        if (e instanceof DOMException && e.name === "AbortError") throw e;
        return EMPTY;
      });
      this.cache.set(key, p);
    }
    return p;
  }

  private async getJson<T>(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<T> {
    const url = new URL(path, this.baseUrl);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("fmt", "json");
    const res = await this.fetchImpl(url.toString(), { signal, headers: { Accept: "application/json" } });
    if (!res.ok) throw classifyHttpStatus("MusicBrainz", res.status);
    return (await res.json()) as T;
  }

  private async doLookup(title: string, artist: string, signal?: AbortSignal): Promise<TitleArtistAliases> {
    const first = splitArtists(artist)[0];
    if (!first) return EMPTY;
    const wanted = normalizeArtist(first);
    const q = (s: string) => `"${s.replace(/["\\]/g, " ")}"`;

    const artistRes = await this.getJson<{ artists?: MbArtist[] }>(
      "/ws/2/artist",
      { query: `artist:${q(first)}`, limit: "5" },
      signal
    );
    const exact = (artistRes.artists ?? []).filter((a) => {
      const names = [a.name, ...(a.aliases ?? []).map((x) => x.name)];
      return names.some((n) => n && normalizeArtist(n) === wanted);
    });
    if (exact.length === 0) return EMPTY;
    exact.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const best = exact[0];
    // 점수가 같은 동명이인이 둘 이상이면 어느 쪽인지 알 수 없다 → 쓰지 않는다
    if (exact.length > 1 && (exact[1].score ?? 0) === (best.score ?? 0)) return EMPTY;

    const artistNames: string[] = [];
    const seenArtists = new Set<string>();
    pushUnique(artistNames, seenArtists, best.name, normalizeArtist);
    for (const al of best.aliases ?? []) pushUnique(artistNames, seenArtists, al.name, normalizeArtist);
    pushUnique(artistNames, seenArtists, best["sort-name"]?.split(",").reverse().join(" "), normalizeArtist);

    const titles: string[] = [];
    if (best.id) {
      try {
        const recRes = await this.getJson<{ recordings?: MbRecording[] }>(
          "/ws/2/recording",
          { query: `arid:${best.id} AND recording:${q(title)}`, limit: "10" },
          signal
        );
        const wantedTitle = normalizeTitle(title);
        const seenTitles = new Set<string>();
        for (const r of recRes.recordings ?? []) {
          if (!r.title || normalizeTitle(r.title) !== wantedTitle) continue;
          pushUnique(titles, seenTitles, r.title, normalizeTitle);
          for (const al of r.aliases ?? []) pushUnique(titles, seenTitles, al.name, normalizeTitle);
          for (const rel of r.releases ?? []) pushUnique(titles, seenTitles, rel.title, normalizeTitle);
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") throw e;
        // 가수 별칭만으로도 검색은 계속할 수 있다
      }
    }
    return { artists: artistNames, titles };
  }
}
