export interface YouTubeSearchResult {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl?: string;
}

/**
 * 서버(Netlify Function)를 통해 YouTube를 검색한다.
 * API Key는 프론트엔드에 전혀 노출되지 않는다.
 */
export async function searchYouTube(query: string): Promise<YouTubeSearchResult[]> {
  const res = await fetch(
    `/.netlify/functions/youtube-search?q=${encodeURIComponent(query)}`
  );

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? "YouTube 검색에 실패했습니다. 잠시 후 다시 시도해주세요.");
  }

  const data = await res.json();
  return data.results as YouTubeSearchResult[];
}
