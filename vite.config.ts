import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { createReadStream, existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { handleYoutubeSearch } from './src/server/youtubeSearchHandler.ts'

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

/** 개발 서버에서도 Worker와 같은 입력 검증과 JSON 응답을 사용한다. */
function youtubeSearchDevMiddleware() {
  return {
    name: 'youtube-search-dev-middleware',
    apply: 'serve' as const,
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use('/api/youtube-search', async (req, res) => {
        const request = new Request(new URL(req.url ?? '', 'http://localhost'), { method: req.method })
        const response = await handleYoutubeSearch(request, { YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY })
        res.statusCode = response.status
        response.headers.forEach((value, name) => res.setHeader(name, value))
        res.end(await response.text())
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
