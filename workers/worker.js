/**
 * Cloudflare Worker 진입점.
 *
 * 역할 두 가지뿐이다:
 * 1. /api/youtube-search 요청 → YouTube Data API를 서버 사이드에서 호출해 JSON으로 응답
 *    (netlify/functions/youtube-search.js와 완전히 동일한 로직 — 플랫폼만 다름)
 * 2. 그 외 모든 요청 → Vite가 빌드한 정적 파일(dist/)을 그대로 서빙 (SPA)
 *
 * YOUTUBE_API_KEY는 Cloudflare 대시보드(또는 wrangler secret)로 설정한 환경변수이며,
 * 이 파일 안에서만 서버 사이드로 쓰이고 브라우저에는 절대 노출되지 않는다.
 */
export default {
  async fetch(request, env, _ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/youtube-search") {
      return handleYoutubeSearch(url, env);
    }

    // SPA: 나머지는 정적 자산으로 서빙. 없는 경로(react-router 하위 경로 등)는
    // Cloudflare Static Assets의 not_found_handling(= "single-page-application",
    // wrangler.toml에서 설정)이 index.html로 대체해준다.
    return env.ASSETS.fetch(request);
  },
};

async function handleYoutubeSearch(url, env) {
  const apiKey = env.YOUTUBE_API_KEY;

  const json = (statusCode, payload) =>
    new Response(JSON.stringify(payload), {
      status: statusCode,
      headers: { "Content-Type": "application/json" },
    });

  if (!apiKey) {
    return json(500, { error: "서버에 YOUTUBE_API_KEY가 설정되지 않았습니다." });
  }

  const query = url.searchParams.get("q");
  if (!query || !query.trim()) {
    return json(400, { error: "검색어(q)가 필요합니다." });
  }

  const ytUrl = new URL("https://www.googleapis.com/youtube/v3/search");
  ytUrl.searchParams.set("part", "snippet");
  ytUrl.searchParams.set("type", "video");
  ytUrl.searchParams.set("maxResults", "8");
  ytUrl.searchParams.set("q", query);
  ytUrl.searchParams.set("key", apiKey);

  try {
    const ytRes = await fetch(ytUrl.toString());
    if (!ytRes.ok) {
      return json(502, { error: "YouTube 검색에 실패했습니다. 잠시 후 다시 시도해주세요." });
    }
    const data = await ytRes.json();
    const results = (data.items ?? []).map((item) => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      channelTitle: item.snippet.channelTitle,
      thumbnailUrl: item.snippet.thumbnails?.medium?.url ?? item.snippet.thumbnails?.default?.url,
    }));
    return json(200, { results });
  } catch {
    return json(502, { error: "YouTube 검색에 실패했습니다. 잠시 후 다시 시도해주세요." });
  }
}
