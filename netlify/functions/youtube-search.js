// Netlify Function: /.netlify/functions/youtube-search?q=밤편지 아이유
//
// YOUTUBE_API_KEY는 Netlify 대시보드 환경변수로만 설정한다.
// 절대 프론트엔드 코드나 저장소에 하드코딩하지 않는다.

export const handler = async (event) => {
  const apiKey = process.env.YOUTUBE_API_KEY;

  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "서버에 YOUTUBE_API_KEY가 설정되지 않았습니다." }),
    };
  }

  const query = event.queryStringParameters?.q;
  if (!query || !query.trim()) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "검색어(q)가 필요합니다." }),
    };
  }

  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("maxResults", "8");
  url.searchParams.set("q", query);
  url.searchParams.set("key", apiKey);

  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: "YouTube 검색에 실패했습니다. 잠시 후 다시 시도해주세요." }),
      };
    }
    const data = await res.json();

    const results = (data.items ?? []).map((item) => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      channelTitle: item.snippet.channelTitle,
      thumbnailUrl: item.snippet.thumbnails?.medium?.url ?? item.snippet.thumbnails?.default?.url,
    }));

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ results }),
    };
  } catch {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: "YouTube 검색에 실패했습니다. 잠시 후 다시 시도해주세요." }),
    };
  }
};
