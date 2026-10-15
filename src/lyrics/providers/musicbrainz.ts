import { normalizeArtist, splitArtists } from "../artist";
import { hasHangul, hasLatin } from "../phonetic";
import { normalizeTitle } from "../text";
import { classifyHttpStatus, isAbort, toLyricsError } from "../errors";
import { hasVersionWord } from "../text";
import type { AliasProvider, ArtistCatalog, ArtistHit, ArtistRecording, RecordingPage, TitleArtistAliases } from "../types";

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
  disambiguation?: string;
  country?: string;
  type?: string;
  score?: number;
  aliases?: MbAlias[];
}
interface MbRecording {
  id?: string;
  title?: string;
  length?: number | null;
  disambiguation?: string;
  aliases?: MbAlias[];
  releases?: { title?: string }[];
  "artist-credit"?: { name?: string; joinphrase?: string; artist?: { id?: string; name?: string } }[];
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

const BROWSE_PAGE = 100;

export class MusicBrainzAliasProvider implements AliasProvider, ArtistCatalog {
  readonly name = "MusicBrainz";
  private cache = new Map<string, Promise<TitleArtistAliases>>();
  private artistCache = new Map<string, Promise<ArtistHit[]>>();
  private pageCache = new Map<string, Promise<RecordingPage>>();
  private baseUrl: string;
  private fetchImpl: typeof fetch;
  private minGapMs: number;
  private lastAt = 0;
  private gate: Promise<void> = Promise.resolve();
  /** 테스트용: 실제 호출 횟수 */
  requestCount = 0;
  /** minGapMs: MusicBrainz 는 초당 1회 이내 사용을 요청한다. 앱에서는 1000 을 넘겨 요청 사이 간격을 둔다(기본 0 = 간격 없음) */
  constructor(baseUrl: string = "https://musicbrainz.org", fetchImpl: typeof fetch = (...a) => fetch(...a), minGapMs = 0) {
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
    this.minGapMs = minGapMs;
  }

  /** 요청 사이에 최소 간격을 둔다 (동시에 여러 요청이 들어와도 한 줄로 세운다) */
  private async throttle(): Promise<void> {
    if (this.minGapMs <= 0) return;
    const prev = this.gate;
    let release!: () => void;
    this.gate = new Promise<void>((r) => (release = r));
    await prev;
    const wait = this.lastAt + this.minGapMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastAt = Date.now();
    release();
  }

  /** 아티스트 검색: 이름/별칭에 입력이 들어간 후보를 mbid 와 함께 돌려준다 (동명이인은 구분 정보로 보여 준다). 실패하면 throw */
  searchArtists(name: string, signal?: AbortSignal): Promise<ArtistHit[]> {
    const key = normalizeArtist(name);
    if (!key) return Promise.resolve([]);
    let p = this.artistCache.get(key);
    if (!p) {
      p = this.doSearchArtists(name.trim(), signal).catch((e) => {
        this.artistCache.delete(key);
        throw isAbort(e) ? e : toLyricsError(e, "MusicBrainz");
      });
      this.artistCache.set(key, p);
    }
    return p;
  }

  private async doSearchArtists(name: string, signal?: AbortSignal): Promise<ArtistHit[]> {
    const q = `"${name.replace(/["\\]/g, " ")}"`;
    const res = await this.getJson<{ artists?: MbArtist[] }>("/ws/2/artist", { query: `artist:${q} OR alias:${q}`, limit: "8" }, signal);
    const out: ArtistHit[] = [];
    const seen = new Set<string>();
    for (const a of res.artists ?? []) {
      if (!a.id || !a.name || seen.has(a.id)) continue;
      seen.add(a.id);
      const aliases: string[] = [];
      const seenAl = new Set<string>([normalizeArtist(a.name)]);
      for (const al of a.aliases ?? []) {
        const v = (al.name ?? "").trim();
        const k = normalizeArtist(v);
        if (!v || !k || seenAl.has(k)) continue;
        seenAl.add(k);
        aliases.push(v);
      }
      out.push({ mbid: a.id, name: a.name, sortName: a["sort-name"], disambiguation: a.disambiguation || undefined, country: a.country || undefined, type: a.type || undefined, aliases, score: a.score ?? 0 });
    }
    return out.sort((x, y) => y.score - x.score);
  }

  /**
   * 아티스트의 녹음 목록 한 페이지(최대 100개). offset 으로 다음 페이지를 이어서 받는다.
   * 이 아티스트가 크레딧에 있는 녹음만 돌려준다(다른 아티스트의 곡이 섞이지 않게 다시 거른다). MusicBrainz 에 등록된 범위일 뿐 전체 디스코그래피를 보장하지 않는다.
   */
  browseRecordings(mbid: string, offset = 0, signal?: AbortSignal): Promise<RecordingPage> {
    const key = `${mbid}|${offset}`;
    let p = this.pageCache.get(key);
    if (!p) {
      p = this.doBrowse(mbid, offset, signal).catch((e) => {
        this.pageCache.delete(key);
        throw isAbort(e) ? e : toLyricsError(e, "MusicBrainz");
      });
      this.pageCache.set(key, p);
    }
    return p;
  }

  private async doBrowse(mbid: string, offset: number, signal?: AbortSignal): Promise<RecordingPage> {
    const res = await this.getJson<{ recordings?: MbRecording[]; "recording-count"?: number }>(
      "/ws/2/recording",
      { artist: mbid, inc: "aliases+artist-credits+releases", limit: String(BROWSE_PAGE), offset: String(offset) },
      signal
    );
    const raw = res.recordings ?? [];
    const items: ArtistRecording[] = [];
    for (const r of raw) {
      if (!r.id || !r.title?.trim()) continue;
      // 이 아티스트가 크레딧에 없는 녹음은 버린다 (크레딧 정보가 없으면 browse 결과를 믿는다)
      const credits = r["artist-credit"];
      if (credits && credits.length > 0 && !credits.some((c) => c.artist?.id === mbid)) continue;
      const title = r.title.trim();
      const alt: string[] = [];
      const seen = new Set<string>([normalizeTitle(title)]);
      const add = (v?: string) => {
        const t = (v ?? "").trim();
        const k = normalizeTitle(t);
        if (!t || !k || seen.has(k) || !isUsableAlias(t)) return;
        seen.add(k);
        alt.push(t);
      };
      for (const al of r.aliases ?? []) add(al.name);
      for (const rel of r.releases ?? []) add(rel.title);
      items.push({
        mbid: r.id,
        title,
        length: typeof r.length === "number" && r.length > 0 ? Math.round(r.length / 1000) : undefined,
        disambiguation: r.disambiguation?.trim() || undefined,
        altTitles: alt.slice(0, 4),
        credit: (credits ?? []).map((c) => (c.name ?? c.artist?.name ?? "") + (c.joinphrase ?? "")).join("").trim(),
        isVersion: hasVersionWord(title) || hasVersionWord(r.disambiguation ?? ""),
      });
    }
    return { total: typeof res["recording-count"] === "number" ? res["recording-count"] : offset + raw.length, offset, rawCount: raw.length, items };
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
    await this.throttle();
    this.requestCount++;
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
        // 검색으로 못 찾았고 입력 제목이 원어/로마자라면: 이 아티스트의 등록된 곡 목록(첫 페이지)에서 제목·별칭이 "정확히" 같은 곡을 찾는다
        // (예: 로마자 제목 Odoriko → 등록된 원어 제목 踊り子). 한글 제목은 번역으로 연결하지 않는다.
        if (titles.length === 0 && isUsableAlias(title)) {
          const wantedTitle = normalizeTitle(title);
          const seenTitles = new Set<string>();
          const page = await this.browseRecordings(best.id, 0, signal);
          for (const r of page.items) {
            const all = [r.title, ...r.altTitles];
            if (!all.some((t) => normalizeTitle(t) === wantedTitle)) continue;
            for (const t of all) pushUnique(titles, seenTitles, t, normalizeTitle);
          }
        }
      } catch (e) {
        if (isAbort(e)) throw e;
        // 가수 별칭만으로도 검색은 계속할 수 있다
      }
    }
    return { artists: artistNames, titles };
  }
}
