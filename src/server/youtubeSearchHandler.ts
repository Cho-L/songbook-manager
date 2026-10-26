/** Public search proxy. No persistent cache or plan-dependent rate-limit binding is assumed. */
export async function handleYoutubeSearch(
  request: Request,
  env: { YOUTUBE_API_KEY?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const json = (status: number, payload: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
    });

  if (request.method !== "GET") return json(405, { error: "허용되지 않는 방식이에요." }, { Allow: "GET" });

  const queries = new URL(request.url).searchParams.getAll("q");
  const raw = queries[0] ?? "";
  const query = raw.trim().replace(/\s+/gu, " ");
  if (!query) return json(400, { error: "검색어(q)가 필요합니다." });
  // Count Unicode code points, not UTF-16 units. Reject controls and decoding replacement characters.
  if (queries.length !== 1 || /[\p{Cc}\p{Cs}\uFFFD]/u.test(raw) || [...query].length > 100) {
    return json(400, { error: "검색어(q)는 제어문자 없이 100자 이내로 입력해주세요." });
  }

  const apiKey = env.YOUTUBE_API_KEY;
  if (!apiKey) return json(500, { error: "서버에 YOUTUBE_API_KEY가 설정되지 않았습니다." });

  const ytUrl = new URL("https://www.googleapis.com/youtube/v3/search");
  ytUrl.searchParams.set("part", "snippet");
  ytUrl.searchParams.set("type", "video");
  ytUrl.searchParams.set("maxResults", "8");
  ytUrl.searchParams.set("q", query);
  ytUrl.searchParams.set("key", apiKey);

  try {
    const ytRes = await fetchImpl(ytUrl.toString());
    if (!ytRes.ok) throw new Error("upstream_http_error");
    const data = (await ytRes.json()) as {
      items?: Array<{
        id: { videoId: string };
        snippet: {
          title: string;
          channelTitle: string;
          thumbnails?: { medium?: { url: string }; default?: { url: string } };
        };
      }>;
    };
    const results = (data.items ?? []).map((item) => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      channelTitle: item.snippet.channelTitle,
      thumbnailUrl: item.snippet.thumbnails?.medium?.url ?? item.snippet.thumbnails?.default?.url,
    }));
    return json(200, { results });
  } catch {
    // Do not expose upstream responses, URLs or API keys in responses/logs.
    return json(502, { error: "YouTube 검색에 실패했습니다. 잠시 후 다시 시도해주세요." });
  }
}
