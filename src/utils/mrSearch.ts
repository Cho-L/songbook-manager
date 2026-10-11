import { splitArtists } from "../lyrics/artist";
import { normalizeText } from "../lyrics/text";
import type { YouTubeSearchResult } from "../services/youtubeService";

/**
 * CSV/JSON 가져오기에서 MR(반주) 영상이 비어 있는 곡을 YouTube 검색 결과로 채우는 로직 (화면과 무관한 순수 로직).
 *
 * 점수/임계값은 "경험칙"으로 정한 값이고 실제 검색 결과로 정확도를 측정한 적이 없다.
 * 그래서 확신이 높은 경우에만 자동 연결하고, 애매하면 항상 사용자가 고르게 한다.
 */

export interface MrCandidate {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl?: string;
  /** 0~1 경험칙 점수 (정확도가 검증된 확률이 아니다) */
  score: number;
  /** 화면에 보여 줄 판단 근거 */
  reasons: string[];
  /** 아래 중 하나라도 있으면 MR이 아닐 가능성이 높아 자동 연결하지 않는다 */
  flags: string[];
}

export type MrDecision =
  | { status: "auto"; best: MrCandidate; candidates: MrCandidate[] }
  | { status: "review"; candidates: MrCandidate[] }
  | { status: "none"; candidates: MrCandidate[] };

/** 이 점수 이상이고 조건을 모두 만족하면 자동 연결 */
export const MR_AUTO_SCORE = 0.8;
/** 1등과 2등의 점수 차가 이 이상이어야 자동 연결 (비슷한 후보가 여럿이면 사용자가 고른다) */
export const MR_AUTO_MARGIN = 0.08;
/** 이 점수 미만의 후보는 목록에 올리지 않는다 */
export const MR_MIN_LISTED_SCORE = 0.3;
export const MR_MAX_LISTED = 5;

const MR_KEYWORDS = /(?:^|[^a-z0-9])(mr|inst|instrumental|karaoke|off\s*vocal)(?:[^a-z0-9]|$)|반주|노래방|멜로디\s*없|무보컬/i;
// 원곡/라이브/커버/보컬만 있는 영상 등 "반주가 아닐" 가능성이 큰 표시
const BAD_PATTERNS: Array<[RegExp, string]> = [
  [/m\/?v(?:[^a-z0-9]|$)|뮤직\s*비디오|official\s*(?:video|music)/i, "뮤직비디오"],
  [/live|라이브|콘서트|concert|직캠|fancam/i, "라이브/직캠"],
  [/cover|커버|리액션|reaction/i, "커버/리액션"],
  [/remix|리믹스|nightcore|sped\s*up|slowed|1\s*hour|1시간/i, "리믹스/변형"],
  [/acapella|a\s*cappella|아카펠라|vocal\s*only|보컬만|mr\s*제거|제거/i, "보컬만 있는 영상"],
];
const KARAOKE_CHANNEL = /karaoke|노래방|\btj\b|tj미디어|금영|\bky\b|반주|\bmr\b|inst/i;

export function hasEnoughInfoForMrSearch(title: string, artist: string): boolean {
  return normalizeText(title).length > 0 && normalizeText(artist).length > 0;
}

/** 곡 하나에 쓸 검색어. 첫 검색어로 확신이 없을 때만 다음 검색어를 쓴다 (할당량 절약). */
export function buildMrQueries(title: string, artist: string): string[] {
  const t = title.trim();
  const a = splitArtists(artist).slice(0, 2).join(" ") || artist.trim();
  return [`${t} ${a} MR`, `${t} ${a} 노래방 반주`];
}

export function scoreMrCandidate(song: { title: string; artist: string }, r: YouTubeSearchResult): MrCandidate {
  const text = normalizeText(`${r.title} ${r.channelTitle}`);
  const reasons: string[] = [];
  const flags: string[] = [];

  const titleKey = normalizeText(song.title.replace(/[([{（【][^)\]}）】]*[)\]}）】]/g, " ")) || normalizeText(song.title);
  const titleMatch = titleKey.length > 0 && normalizeText(r.title).includes(titleKey);
  if (titleMatch) reasons.push("제목 포함");

  const names = splitArtists(song.artist).map(normalizeText).filter(Boolean);
  const artistMatch = names.length > 0 && names.some((n) => text.includes(n));
  if (artistMatch) reasons.push("가수 포함");

  const mrKeyword = MR_KEYWORDS.test(r.title);
  if (mrKeyword) reasons.push("MR/반주 표시");

  const karaokeChannel = KARAOKE_CHANNEL.test(r.channelTitle);
  if (karaokeChannel) reasons.push("노래방/MR 채널");

  // 곡 제목에 이미 들어 있는 표시(예: 제목이 "Live in Seoul")는 감점하지 않는다
  for (const [re, label] of BAD_PATTERNS) if (re.test(r.title) && !re.test(song.title)) flags.push(label);

  let score = 0.4 * Number(titleMatch) + 0.15 * Number(artistMatch) + 0.35 * Number(mrKeyword) + 0.1 * Number(karaokeChannel);
  score -= 0.5 * Math.min(1, flags.length);
  score = Math.max(0, Math.min(1, Math.round(score * 100) / 100));
  return { videoId: r.videoId, title: r.title, channelTitle: r.channelTitle, thumbnailUrl: r.thumbnailUrl, score, reasons, flags };
}

/** 후보를 점수순으로 정리한다 (같은 videoId 중복 제거, 너무 낮은 점수 제외) */
export function rankMrCandidates(song: { title: string; artist: string }, results: YouTubeSearchResult[]): MrCandidate[] {
  const byId = new Map<string, MrCandidate>();
  for (const r of results) {
    if (!r.videoId) continue;
    const c = scoreMrCandidate(song, r);
    const prev = byId.get(c.videoId);
    if (!prev || c.score > prev.score) byId.set(c.videoId, c);
  }
  return [...byId.values()]
    .filter((c) => c.score >= MR_MIN_LISTED_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, MR_MAX_LISTED);
}

/** 자동 연결 조건: 점수·제목·MR 표시를 모두 갖추고 경고가 없고, 2등과 충분히 차이가 날 것 */
export function decideMr(candidates: MrCandidate[]): MrDecision {
  if (candidates.length === 0) return { status: "none", candidates };
  const [best, second] = candidates;
  const confident =
    best.score >= MR_AUTO_SCORE &&
    best.flags.length === 0 &&
    best.reasons.includes("제목 포함") &&
    best.reasons.includes("MR/반주 표시") &&
    (!second || best.score - second.score >= MR_AUTO_MARGIN);
  return confident ? { status: "auto", best, candidates } : { status: "review", candidates };
}

// ---------------------------------------------------------------- 곡 목록 일괄 검색

export type MrRowResult =
  | { kind: "decision"; decision: MrDecision }
  | { kind: "error"; message: string };

export interface MrSearchProgress {
  done: number;
  total: number;
}

export interface MrBatchOptions {
  search: (query: string, signal?: AbortSignal) => Promise<YouTubeSearchResult[]>;
  signal?: AbortSignal;
  onProgress?: (p: MrSearchProgress) => void;
  /** 한 행의 결과가 나올 때마다 호출 — 취소/중단되어도 그때까지의 결과는 화면에 남는다 */
  onResult?: (row: number, result: MrRowResult) => void;
  /** 이 횟수만큼 연속으로 실패하면 나머지를 중단한다 (일일 할당량 초과/서버 설정 문제일 가능성) */
  maxConsecutiveFailures?: number;
  wait?: (ms: number) => Promise<void>;
  /** 여러 번 나눠 호출(10곡 단위 등)해도 같은 (제목, 가수)를 다시 검색하지 않도록 공유하는 결과 캐시. 오류 결과는 캐시하지 않는다 */
  cache?: Map<string, MrRowResult>;
}

export interface MrBatchSummary {
  results: Map<number, MrRowResult>;
  cancelled: boolean;
  /** 연속 실패 등으로 중간에 멈춘 이유 */
  abortedReason?: string;
  /** 실제로 보낸 YouTube 검색 요청 수 (할당량 계산용) */
  requests: number;
}

function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}
function statusOf(e: unknown): number | undefined {
  return typeof (e as { status?: unknown })?.status === "number" ? (e as { status: number }).status : undefined;
}

/**
 * MR이 없는 행들을 순서대로 검색한다.
 * - 같은 (제목, 가수)는 한 번만 검색한다
 * - 곡당 첫 검색어로 자동 연결이 되면 두 번째 검색어는 쓰지 않는다
 * - 개별 곡의 검색 실패는 그 행만 "error"로 두고 계속한다. 연속 실패가 이어지면 전체를 멈춘다
 * - 취소하면 즉시 멈추고, 그때까지의 결과는 그대로 돌려준다
 * 이 함수는 저장소를 전혀 건드리지 않는다 — 결과는 호출한 쪽이 사용자 확인 뒤에 반영한다.
 */
export async function searchMrForRows(
  rows: Array<{ row: number; title: string; artist: string }>,
  opts: MrBatchOptions
): Promise<MrBatchSummary> {
  const maxFail = opts.maxConsecutiveFailures ?? 3;
  const wait = opts.wait ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const results = new Map<number, MrRowResult>();
  const byKey = opts.cache ?? new Map<string, MrRowResult>();
  let requests = 0;
  let consecutiveFailures = 0;
  let abortedReason: string | undefined;
  let cancelled = false;

  const searchOnce = async (query: string): Promise<YouTubeSearchResult[]> => {
    requests++;
    try {
      return await opts.search(query, opts.signal);
    } catch (e) {
      // 서버에 닿지 못한 일시적 네트워크 오류만 한 번 재시도한다 (서버가 준 오류는 재시도해도 할당량만 쓴다)
      if (isAbort(e) || statusOf(e) !== 0) throw e;
      await wait(800);
      if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      requests++;
      return await opts.search(query, opts.signal);
    }
  };

  let done = 0;
  opts.onProgress?.({ done, total: rows.length });
  for (const r of rows) {
    if (opts.signal?.aborted) {
      cancelled = true;
      break;
    }
    const key = `${normalizeText(r.title)}|${normalizeText(r.artist)}`;
    let result = byKey.get(key);
    if (!result) {
      try {
        const collected: YouTubeSearchResult[] = [];
        let decision: MrDecision = { status: "none", candidates: [] };
        for (const q of buildMrQueries(r.title, r.artist)) {
          collected.push(...(await searchOnce(q)));
          decision = decideMr(rankMrCandidates(r, collected));
          if (decision.status === "auto") break;
        }
        result = { kind: "decision", decision };
        consecutiveFailures = 0;
      } catch (e) {
        if (isAbort(e)) {
          cancelled = true;
          break;
        }
        consecutiveFailures++;
        const msg = e instanceof Error ? e.message : "검색에 실패했어요";
        result = { kind: "error", message: msg };
        if (statusOf(e) === 500 && /API_KEY/i.test(msg)) {
          abortedReason = "서버에 YouTube API 키가 설정되어 있지 않아 검색할 수 없어요.";
        } else if (consecutiveFailures >= maxFail) {
          abortedReason = `검색이 ${maxFail}번 연속 실패해서 멈췄어요. YouTube API 일일 할당량을 넘었거나 서버 문제일 수 있어요.`;
        }
      }
      if (result.kind !== "error") byKey.set(key, result);
    }
    results.set(r.row, result);
    opts.onResult?.(r.row, result);
    done++;
    opts.onProgress?.({ done, total: rows.length });
    if (abortedReason) break;
  }
  return { results, cancelled, abortedReason, requests };
}

// ---------------------------------------------------------------- 할당량 추정

/** search.list 1회의 YouTube Data API 할당량 비용(공식 문서 기준 100). 프로젝트 설정에 따라 다를 수 있어 "추정"으로만 표시한다 */
export const YT_SEARCH_COST_UNITS = 100;
/** 기본 일일 할당량(공식 기본값 10,000). 실제 프로젝트의 할당량은 다를 수 있다 */
export const YT_DEFAULT_DAILY_QUOTA = 10000;

export interface MrQuotaEstimate {
  /** 곡당 첫 검색어로 자동 연결되면 1번, 아니면 2번까지 */
  minRequests: number;
  maxRequests: number;
  minUnits: number;
  maxUnits: number;
}

export function estimateMrQuota(songCount: number): MrQuotaEstimate {
  const n = Math.max(0, Math.floor(songCount));
  return { minRequests: n, maxRequests: n * 2, minUnits: n * YT_SEARCH_COST_UNITS, maxUnits: n * 2 * YT_SEARCH_COST_UNITS };
}
