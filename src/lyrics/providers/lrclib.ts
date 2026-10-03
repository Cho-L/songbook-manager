import type { LyricsCandidate, LyricsProvider } from "../types";

/**
 * LRCLIB (https://lrclib.net) — 공개 API, API 키 없음, 커뮤니티가 기여한 싱크 가사(LRC) 데이터베이스.
 * GET /api/search?track_name=…&artist_name=…  →  [{ id, trackName, artistName, albumName, duration, instrumental, plainLyrics, syncedLyrics }]
 * 가사 자체의 저작권은 각 권리자에게 있으므로, 이 앱은 가사를 사용자의 브라우저에만 캐시하고 DB/서버에 모아 두지 않는다.
 */
interface LrclibRecord {
  id?: number | string;
  trackName?: string;
  name?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

export class LrclibProvider implements LyricsProvider {
  readonly name = "LRCLIB";
  private baseUrl: string;
  private fetchImpl: typeof fetch;
  constructor(baseUrl: string = "https://lrclib.net", fetchImpl: typeof fetch = (...a) => fetch(...a)) {
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
  }

  async search(title: string, artist: string, signal?: AbortSignal): Promise<LyricsCandidate[]> {
    const url = new URL("/api/search", this.baseUrl);
    url.searchParams.set("track_name", title);
    if (artist.trim()) url.searchParams.set("artist_name", artist);
    const res = await this.fetchImpl(url.toString(), { signal });
    if (!res.ok) throw new Error(`LRCLIB ${res.status}`);
    const data: unknown = await res.json();
    if (!Array.isArray(data)) return [];
    const out: LyricsCandidate[] = [];
    for (const r of data as LrclibRecord[]) {
      const title = (r.trackName ?? r.name ?? "").trim();
      if (!title) continue;
      out.push({
        id: String(r.id ?? `${title}:${r.artistName ?? ""}`),
        title,
        artist: (r.artistName ?? "").trim(),
        album: r.albumName ?? undefined,
        duration: typeof r.duration === "number" && r.duration > 0 ? r.duration : undefined,
        instrumental: Boolean(r.instrumental),
        plainLyrics: r.plainLyrics ? String(r.plainLyrics) : undefined,
        syncedLyrics: r.syncedLyrics ? String(r.syncedLyrics) : undefined,
        source: this.name,
      });
    }
    return out;
  }
}
