/**
 * 일본어 형태소 분석기(@patdx/kuromoji, IPAdic) 지연 로더.
 * - 라이브러리와 사전(gz 12개 파일, 약 18MB)은 일본어 발음을 처음 만들 때만 내려받는다 (초기 로딩에 포함되지 않음).
 * - 사전은 CDN이 아니라 같은 사이트의 `${BASE_URL}kuromoji-dict/` 에서 받는다 (vite.config.ts 의 플러그인이 빌드 산출물에 넣는다).
 * - 실패하면 캐시를 비워서 다음 호출에서 다시 시도한다 (중복 다운로드 방지: 진행 중인 요청은 하나만 공유).
 */
export interface JaToken {
  surface_form: string;
  pos: string;
  pos_detail_1: string;
  pos_detail_2?: string;
  reading?: string;
  pronunciation?: string;
  basic_form?: string;
  word_type?: string;
}
export interface JaTokenizer {
  tokenize(text: string): JaToken[];
}

export function dictBaseUrl(): string {
  const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/";
  return `${base.endsWith("/") ? base : base + "/"}kuromoji-dict/`;
}

/** gzip 매직(1f 8b)이면 직접 풀고, 서버가 이미 풀어 보냈으면 그대로 쓴다 */
export async function maybeGunzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const u = new Uint8Array(buf);
  if (u.length > 2 && u[0] === 0x1f && u[1] === 0x8b) {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
    return await new Response(stream).arrayBuffer();
  }
  return buf;
}

/** 사전 다운로드 진행 (받은 파일 수 / 전체 12개) — 처음 한 번만 약 18MB 라서 화면에 진행 상황을 보여 준다 */
export const DICT_FILE_COUNT = 12;
type ProgressFn = (done: number, total: number) => void;
const listeners = new Set<ProgressFn>();
let filesDone = 0;
export function subscribeDictProgress(fn: ProgressFn): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const CACHE_NAME = "songbook-kuromoji-dict-v1";
/**
 * Cache Storage 에 사전 파일을 보관해서 재방문 때 다시 내려받지 않는다 (서버 캐시 헤더와 무관하게 동작).
 * 저장소를 못 쓰는 환경(시크릿 모드 등)에서는 조용히 일반 fetch 로 대체한다. 같은 파일을 두 번 받지는 않는다.
 */
async function cachedFetch(url: string, doFetch: typeof fetch): Promise<Response> {
  let cache: Cache | undefined;
  try {
    if (typeof caches !== "undefined") {
      cache = await caches.open(CACHE_NAME);
      const hit = await cache.match(url);
      if (hit) return hit;
    }
  } catch {
    cache = undefined;
  }
  const res = await doFetch(url);
  if (cache && res.ok) {
    try {
      await cache.put(url, res.clone());
    } catch {
      // 용량 부족 등: 캐시만 포기한다
    }
  }
  return res;
}

let pending: Promise<JaTokenizer> | null = null;
export function loadJaTokenizer(opts: { fetchImpl?: typeof fetch; base?: string } = {}): Promise<JaTokenizer> {
  if (pending) return pending;
  const doFetch = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const base = opts.base ?? dictBaseUrl();
  filesDone = 0;
  const p = (async () => {
    const mod = await import("@patdx/kuromoji");
    const loader = {
      async loadArrayBuffer(file: string): Promise<ArrayBufferLike> {
        const res = await cachedFetch(base + file, doFetch);
        if (!res.ok) throw new Error(`사전 파일을 받지 못했어요 (${file}, ${res.status})`);
        const out = await maybeGunzip(await res.arrayBuffer());
        filesDone++;
        listeners.forEach((fn) => fn(Math.min(filesDone, DICT_FILE_COUNT), DICT_FILE_COUNT));
        return out;
      },
    };
    const tk = await new mod.TokenizerBuilder({ loader }).build();
    return tk as unknown as JaTokenizer;
  })();
  pending = p;
  p.catch(() => {
    if (pending === p) pending = null;
  });
  return p;
}
