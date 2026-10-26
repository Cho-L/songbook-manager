import { LyricsApiError, classifyHttpStatus, isAbort } from "../errors";
import { diagnosticText, reportRequest } from "../diagnostics";
import { parseLrc } from "../lrc";
import type { LyricsCandidate, LyricsProvider, LyricsLookupMetadata, LyricsRequestObserver } from "../types";

/** 같은 검색을 짧은 시간 안에 반복하지 않는다 (진행 중인 요청 공유 + 성공 결과 5분 보관) */
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 60;

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
  private memo = new Map<string, { at: number; p: Promise<{ candidates: LyricsCandidate[]; status: number }> }>();
  /** 테스트용: 실제로 네트워크를 호출한 횟수 */
  requestCount = 0;
  constructor(baseUrl: string = "https://lrclib.net", fetchImpl: typeof fetch = (...a) => fetch(...a)) {
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
  }

  async search(title: string, artist: string, signal?: AbortSignal, observe?: LyricsRequestObserver): Promise<LyricsCandidate[]> {
    const url = new URL("/api/search", this.baseUrl);
    url.searchParams.set("track_name", title);
    if (artist.trim()) url.searchParams.set("artist_name", artist);
    return this.fetchCandidates(url, signal, observe);
  }

  /** GET /api/search?q=… — 제목/가수/앨범 어디에 있든 찾는다. 제목이 한글/영문 중 어느 쪽으로 등록됐는지 모를 때의 보조 수단 */
  async searchQuery(query: string, signal?: AbortSignal, observe?: LyricsRequestObserver): Promise<LyricsCandidate[]> {
    const url = new URL("/api/search", this.baseUrl);
    url.searchParams.set("q", query);
    return this.fetchCandidates(url, signal, observe);
  }

  /** Exact metadata lookup bypasses the search index. Album/duration are optional in the public provider implementation. */
  async get(title: string, artist: string, metadata: LyricsLookupMetadata = {}, signal?: AbortSignal, observe?: LyricsRequestObserver): Promise<LyricsCandidate[]> {
    if (!title.trim() || !artist.trim() || (metadata.duration !== undefined &&
      (!Number.isFinite(metadata.duration) || metadata.duration < 1 || metadata.duration > 3600))) {
      throw new LyricsApiError("client", "LRCLIB 조회 metadata 오류");
    }
    const url = new URL("/api/get", this.baseUrl);
    url.searchParams.set("track_name", title);
    url.searchParams.set("artist_name", artist);
    if (metadata.album?.trim()) url.searchParams.set("album_name", metadata.album.trim());
    if (metadata.duration !== undefined) url.searchParams.set("duration", String(metadata.duration));
    return this.fetchCandidates(url, signal, observe);
  }

  private fetchCandidates(url: URL, signal?: AbortSignal, observe?: LyricsRequestObserver): Promise<LyricsCandidate[]> {
    if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
    const key = url.toString();
    const now = Date.now();
    const hit = this.memo.get(key);
    const cached = Boolean(hit && now - hit.at < CACHE_TTL_MS);
    let pending = cached ? hit!.p : undefined;
    if (!pending) {
      // Share the transport, but cancellation and diagnostics belong to each caller.
      pending = this.doFetch(url).catch((e) => {
        this.memo.delete(key);
        throw e;
      });
      this.memo.set(key, { at: now, p: pending });
      if (this.memo.size > CACHE_MAX) this.memo.delete(this.memo.keys().next().value as string);
    }
    const metadata = {
      endpoint: url.pathname === "/api/get" ? "get" as const : "search" as const,
      title: diagnosticText(url.searchParams.get("track_name")),
      artist: diagnosticText(url.searchParams.get("artist_name")),
      query: diagnosticText(url.searchParams.get("q")),
      cached,
    };
    return (signal ? raceAbort(pending, signal) : pending).then(({ candidates, status }) => {
      reportRequest(observe, { ...metadata, httpStatus: status, records: candidates.length,
        outcome: status === 404 ? "not-found" : candidates.length ? "results" : "empty" });
      return candidates;
    }, (e) => {
      if (!isAbort(e)) reportRequest(observe, { ...metadata, outcome: "error",
        httpStatus: e instanceof LyricsApiError ? e.status : undefined,
        errorKind: e instanceof LyricsApiError ? e.kind : "network" });
      throw e;
    });
  }

  private async doFetch(url: URL): Promise<{ candidates: LyricsCandidate[]; status: number }> {
    this.requestCount++;
    let res: Response;
    try {
      res = await this.fetchImpl(url.toString());
    } catch (e) {
      if (isAbort(e)) throw e;
      throw new LyricsApiError("network", "LRCLIB 연결 실패");
    }
    if (url.pathname === "/api/get" && res.status === 404) return { candidates: [], status: 404 };
    if (!res.ok) throw classifyHttpStatus("LRCLIB", res.status);
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      throw new LyricsApiError("invalid", "LRCLIB 응답 형식 오류", res.status);
    }
    if (url.pathname === "/api/get" && (!data || typeof data !== "object" || Array.isArray(data))) {
      throw new LyricsApiError("invalid", "LRCLIB 응답 형식 오류", res.status);
    }
    const records = url.pathname === "/api/get" && data && typeof data === "object" && !Array.isArray(data) ? [data] : data;
    if (!Array.isArray(records)) throw new LyricsApiError("invalid", "LRCLIB 응답 형식 오류", res.status);
    const out: LyricsCandidate[] = [];
    for (const value of records) {
      if (!value || typeof value !== "object") throw new LyricsApiError("invalid", "LRCLIB 응답 형식 오류", res.status);
      const r = value as LrclibRecord;
      if (typeof (r.trackName ?? r.name) !== "string" || (r.artistName != null && typeof r.artistName !== "string")) {
        throw new LyricsApiError("invalid", "LRCLIB 응답 형식 오류", res.status);
      }
      const title = (r.trackName ?? r.name ?? "").trim();
      if (!title) continue;
      // 시간 태그가 실제로 읽히는 싱크 가사만 "싱크 있음"으로 인정한다 (빈 문자열/깨진 LRC 를 싱크 가사로 보여 주지 않는다)
      let synced = r.syncedLyrics ? String(r.syncedLyrics) : undefined;
      if (synced && parseLrc(synced).filter((l) => l.text.trim()).length < 2) synced = undefined;
      const plain = r.plainLyrics && String(r.plainLyrics).trim() ? String(r.plainLyrics) : undefined;
      out.push({
        id: String(r.id ?? `${title}:${r.artistName ?? ""}`),
        title,
        artist: (r.artistName ?? "").trim(),
        album: r.albumName ?? undefined,
        duration: typeof r.duration === "number" && Number.isFinite(r.duration) && r.duration > 0 ? r.duration : undefined,
        instrumental: Boolean(r.instrumental),
        plainLyrics: plain,
        syncedLyrics: synced,
        source: this.name,
      });
    }
    return { candidates: out, status: res.status };
  }
}

function raceAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      }
    );
  });
}
