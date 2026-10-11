export interface YouTubeSearchResult {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl?: string;
}

/**
 * 서버를 통해 YouTube를 검색한다. API Key는 프론트엔드에 전혀 노출되지 않는다.
 *
 * 배포 환경에 상관없이 항상 같은 경로(/api/youtube-search)를 호출한다.
 * 실제로 이 경로를 처리하는 주체는 배포 플랫폼마다 다르다:
 *   - Netlify: netlify.toml 리다이렉트가 이 경로를 기존
 *     netlify/functions/youtube-search.js로 연결한다.
 *   - Cloudflare Workers: workers/worker.js가 이 경로를 직접 처리한다.
 *   - 로컬(npm run dev): vite.config.ts의 개발 전용 미들웨어가 처리한다.
 * 세 곳 모두 같은 로직(YouTube Data API 서버 사이드 호출)을 수행한다.
 */
export class YouTubeSearchError extends Error {
  /** HTTP 상태. 네트워크 자체가 실패했으면 0 */
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "YouTubeSearchError";
    this.status = status;
  }
}

export async function searchYouTube(query: string, signal?: AbortSignal): Promise<YouTubeSearchResult[]> {
  let res: Response;
  try {
    res = await fetch(`/api/youtube-search?q=${encodeURIComponent(query)}`, { signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new YouTubeSearchError("YouTube 검색 서버에 연결하지 못했어요.", 0);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new YouTubeSearchError(body?.error ?? "YouTube 검색에 실패했습니다. 잠시 후 다시 시도해주세요.", res.status);
  }

  const data = await res.json();
  return data.results as YouTubeSearchResult[];
}
