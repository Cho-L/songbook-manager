import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { createReadStream, existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 일본어 형태소 분석 사전(@patdx/kuromoji/dict, gz 12개)을 같은 사이트의 /kuromoji-dict/ 로 내보낸다.
 * CDN에 의존하지 않고, node_modules 에서 복사하므로 저장소에는 사전 파일을 넣지 않는다.
 * dev: 미들웨어로 제공 / build: 산출물(dist/kuromoji-dict/)에 포함. 일본어 발음을 처음 만들 때만 내려받는다.
 */
function kuromojiDictPlugin() {
  const dir = join(process.cwd(), 'node_modules', '@patdx', 'kuromoji', 'dict')
  return {
    name: 'kuromoji-dict',
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        const m = /\/kuromoji-dict\/([\w.]+\.dat\.gz)(?:\?.*)?$/.exec(req.url ?? '')
        if (!m || !existsSync(join(dir, m[1]))) return next()
        res.setHeader('Content-Type', 'application/octet-stream')
        createReadStream(join(dir, m[1])).pipe(res)
      })
    },
    generateBundle(this: { emitFile(f: { type: 'asset'; fileName: string; source: Uint8Array }): string }) {
      if (!existsSync(dir)) return
      for (const f of readdirSync(dir).filter((n) => n.endsWith('.dat.gz'))) {
        this.emitFile({ type: 'asset', fileName: `kuromoji-dict/${f}`, source: readFileSync(join(dir, f)) })
      }
    },
  }
}

/**
 * 개발 서버(vite dev) 전용 미들웨어.
 *
 * 문제: `npm run dev`는 순수 Vite 서버만 띄우는데, Vite는 /.netlify/functions/*
 * 경로를 모르기 때문에 SPA fallback으로 index.html을 돌려준다. 그래서
 * 프론트가 그 HTML을 JSON으로 파싱하려다 "Unexpected token '<'" 에러가 났다.
 *
 * 해결: 실배포에서 쓰는 netlify/functions/youtube-search.js와 완전히 같은 로직을
 * 이 미들웨어가 그대로 수행해서, 로컬 개발 중에도 같은 경로(/.netlify/functions/youtube-search)가
 * 실제로 JSON을 반환하게 만든다. 프로덕션 빌드(`vite build`)에는 포함되지 않고,
 * 개발 서버에서만 동작한다 (configureServer는 dev 전용 훅).
 */
function youtubeSearchDevMiddleware() {
  return {
    name: 'youtube-search-dev-middleware',
    apply: 'serve' as const,
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use('/api/youtube-search', async (req, res) => {
        const apiKey = process.env.YOUTUBE_API_KEY

        const sendJson = (statusCode: number, payload: unknown) => {
          res.statusCode = statusCode
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(payload))
        }

        if (!apiKey) {
          sendJson(500, { error: '서버에 YOUTUBE_API_KEY가 설정되지 않았습니다. (.env에 YOUTUBE_API_KEY 추가 필요)' })
          return
        }

        const reqUrl = new URL(req.url ?? '', 'http://localhost')
        const query = reqUrl.searchParams.get('q')
        if (!query || !query.trim()) {
          sendJson(400, { error: '검색어(q)가 필요합니다.' })
          return
        }

        const ytUrl = new URL('https://www.googleapis.com/youtube/v3/search')
        ytUrl.searchParams.set('part', 'snippet')
        ytUrl.searchParams.set('type', 'video')
        ytUrl.searchParams.set('maxResults', '8')
        ytUrl.searchParams.set('q', query)
        ytUrl.searchParams.set('key', apiKey)

        try {
          const ytRes = await fetch(ytUrl.toString())
          if (!ytRes.ok) {
            sendJson(502, { error: 'YouTube 검색에 실패했습니다. 잠시 후 다시 시도해주세요.' })
            return
          }
          const data = (await ytRes.json()) as {
            items?: Array<{
              id: { videoId: string }
              snippet: {
                title: string
                channelTitle: string
                thumbnails?: { medium?: { url: string }; default?: { url: string } }
              }
            }>
          }
          const results = (data.items ?? []).map((item) => ({
            videoId: item.id.videoId,
            title: item.snippet.title,
            channelTitle: item.snippet.channelTitle,
            thumbnailUrl: item.snippet.thumbnails?.medium?.url ?? item.snippet.thumbnails?.default?.url,
          }))
          sendJson(200, { results })
        } catch {
          sendJson(502, { error: 'YouTube 검색에 실패했습니다. 잠시 후 다시 시도해주세요.' })
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Vite는 기본적으로 VITE_ 접두사 없는 변수를 process.env에 노출하지 않는다.
  // YOUTUBE_API_KEY는 의도적으로 VITE_ 접두사 없이 만들어졌으므로(프론트에 노출되면 안 되니까)
  // 이 미들웨어(서버 사이드, Node 컨텍스트)에서만 명시적으로 .env를 읽어 사용한다.
  const env = loadEnv(mode, process.cwd(), '')
  if (env.YOUTUBE_API_KEY) {
    process.env.YOUTUBE_API_KEY = env.YOUTUBE_API_KEY
  }

  return {
    plugins: [react(), youtubeSearchDevMiddleware(), kuromojiDictPlugin()],
  }
})
