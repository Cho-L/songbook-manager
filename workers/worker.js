/**
 * Cloudflare Worker 진입점.
 *
 * 역할:
 * 1. /api/youtube-search 요청 → YouTube Data API를 서버 사이드에서 호출해 JSON으로 응답
 *    (검증과 응답 처리는 src/server/youtubeSearchHandler.ts 공유)
 * 2. /api/song-requests 요청 → 시청자 신청곡 접수/조회 (src/server/songRequestHandler.ts)
 * 3. 그 외 모든 요청 → Vite가 빌드한 정적 파일(dist/)을 그대로 서빙 (SPA)
 *
 * YOUTUBE_API_KEY는 Cloudflare 대시보드(또는 wrangler secret)로 설정한 환경변수이며,
 * 서버 핸들러에서만 쓰이고 브라우저에는 절대 노출되지 않는다.
 */
import { handleYoutubeSearch } from "../src/server/youtubeSearchHandler";
import { handleSongRequests } from "../src/server/songRequestHandler";
import { handleOverlayConfig } from "../src/server/overlayConfigHandler";

export default {
  async fetch(request, env, _ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/youtube-search") {
      return handleYoutubeSearch(request, env);
    }

    // 시청자 신청곡 접수/조회 (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 는 Worker 비밀 환경변수 — docs/song-requests-deploy.md)
    if (url.pathname === "/api/song-requests") {
      return handleSongRequests(request, env);
    }

    // OBS Overlay Studio 저장 설정 공개 조회 (같은 SUPABASE_* 비밀 환경변수 사용)
    if (url.pathname === "/api/overlay-config") {
      return handleOverlayConfig(request, env);
    }

    // SPA: 나머지는 정적 자산으로 서빙. 없는 경로(react-router 하위 경로 등)는
    // Cloudflare Static Assets의 not_found_handling(= "single-page-application",
    // wrangler.toml에서 설정)이 index.html로 대체해준다.
    return env.ASSETS.fetch(request);
  },
};
