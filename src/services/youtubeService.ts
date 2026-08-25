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
export async function searchYouTube(query: string): Promise<YouTubeSearchResult[]> {
  const res = await fetch(`/api/youtube-search?q=${encodeURIComponent(query)}`);

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? "YouTube 검색에 실패했습니다. 잠시 후 다시 시도해주세요.");
  }

  const data = await res.json();
  return data.results as YouTubeSearchResult[];
}
