import { MEDIUM_CONFIDENCE, dedupeCandidates, isAutoAccept, isCrossScriptTitleChoice, rankCandidates, summarize } from "./matching";
import { searchCandidates } from "./searchPlan";
import { formatLrc } from "./lrc";
import { hashText, normalizeText, normalizeTitle } from "./text";
import { ProviderLyricsSynchronizer } from "./synchronizers";
import { applyWarp } from "./warp";
import { LYRICS_SEARCH_REVISION, IDENTITY_WARP, type DiscoverySummary, type ScoredCandidate, type AliasProvider, type LyricsProvider, type LyricsSynchronizer, type SyncEntry, type Warp } from "./types";

/**
 * 자동 가사 검색 + 싱크 파이프라인 (화면/저장소와 무관한 순수 로직).
 * 우선순위(호출하는 쪽 = useAutoLyrics 가 1·2번을 먼저 처리한다):
 *   1) 저장된 가사에 이미 타임스탬프가 있으면 이 파이프라인을 아예 쓰지 않는다
 *   2) 유효한 캐시(이전에 만든 자동 싱크 결과)
 *   3) provider 의 싱크 가사 → (저장된 평문 가사가 있으면 줄 정렬)
 *   4) provider 의 평문 가사만 있는 경우 → "가사만 찾음" (싱크 없음)
 *   5) 저장된 가사 그대로
 *   6) 실패
 */
export interface ResolveInput {
  songId: string;
  title: string;
  artist: string;
  ownLyrics: string;
  /** 곡에 입력했거나 기본 사전에 있는 다른 언어 표기 (검색과 점수 계산에 쓴다) */
  titleAliases?: string[];
  artistAliases?: string[];
  referenceDuration?: number;
}

export interface ResolveOptions {
  /** 사용자가 후보 목록에서 직접 고른 곡 — 신뢰도 기준을 건너뛴다 */
  candidateId?: string;
  /** 이전 검색에서 이미 받아 둔 후보(본문 포함). candidateId 가 여기 있으면 다시 검색하지 않는다 */
  pool?: ScoredCandidate[];
  synchronizer?: LyricsSynchronizer;
  /** 한글 곡이 가사 DB 에 영문 표기로만 있을 때 확인된 별칭을 찾아 주는 곳 (없으면 확장 검색의 별칭 단계는 건너뛴다) */
  aliasProvider?: AliasProvider;
  now?: () => number;
  signal?: AbortSignal;
}

export function entryKeys(input: { title: string; artist: string; ownLyrics: string }) {
  return { titleKey: `lyrics-match-v2:${normalizeText(input.title)}`, artistKey: normalizeTitle(input.artist), lyricsHash: hashText(input.ownLyrics.trim()) };
}

/** 이 캐시 항목이 지금의 곡 정보에 대해 여전히 유효한가 (제목/가수/저장된 가사가 그대로인가) */
export function isEntryValid(entry: SyncEntry, input: { title: string; artist: string; ownLyrics: string }): boolean {
  const k = entryKeys(input);
  return entry.v === 1 && entry.titleKey === k.titleKey && entry.artistKey === k.artistKey && entry.lyricsHash === k.lyricsHash;
}

export async function resolveLyrics(input: ResolveInput, provider: LyricsProvider, opts: ResolveOptions = {}): Promise<SyncEntry> {
  return (await resolveLyricsDetailed(input, provider, opts)).entry;
}

/** resolveLyrics + 이번에 받은 후보 전체(본문 포함, 메모리 전용). 후보 미리보기/선택이 같은 데이터를 다시 받지 않고 쓰게 한다 */
export async function resolveLyricsDetailed(
  input: ResolveInput,
  provider: LyricsProvider,
  opts: ResolveOptions = {}
): Promise<{ entry: SyncEntry; pool: ScoredCandidate[] }> {
  const now = opts.now ?? Date.now;
  const synchronizer = opts.synchronizer ?? new ProviderLyricsSynchronizer();
  const base = { v: 1 as const, searchRevision: LYRICS_SEARCH_REVISION, discovery: undefined as DiscoverySummary | undefined, songId: input.songId, ...entryKeys(input), createdAt: now(), lines: [], warps: {}, warnings: [] as string[] };

  // 후보 선택: 이미 받아 둔 후보가 있으면 그대로 쓰고 다시 검색하지 않는다 (검색 횟수 절약 + 같은 후보가 다시 안 나오는 문제 방지)
  let ranked: ScoredCandidate[];
  if (opts.candidateId && opts.pool?.some((c) => c.id === opts.candidateId)) {
    ranked = opts.pool;
  } else {
    // 단계적 검색(엄격 → 느슨, 별칭, 제목만 검색까지). 네트워크 오류는 그대로 throw → 호출한 쪽이 "실패"로 표시 (캐시하지 않음)
    const { candidates, aliases, budgetExhausted, diagnostics } = await searchCandidates(provider, input, opts.signal, opts.aliasProvider);
    ranked = rankCandidates(input, candidates, aliases);
    base.discovery = diagnostics;
    if (diagnostics.failures) base.warnings.push("일부 조회에 실패했어요 — 제공자에 가사가 없다고 단정할 수 없어요");
    if (!diagnostics.withLyrics && diagnostics.records) base.warnings.push("제공자가 반환한 곡 정보에서 사용할 수 있는 가사 본문을 받지 못했어요");
    if (budgetExhausted) base.warnings.push("검색 횟수 상한에 도달해 일부 검색은 건너뛰었어요");
  }
  const entry = await decide(input, ranked, opts, base, synchronizer);
  return { entry, pool: ranked };
}

async function decide(
  input: ResolveInput,
  ranked: ScoredCandidate[],
  opts: ResolveOptions,
  base: { v: 1; songId: string; titleKey: string; artistKey: string; lyricsHash: string; createdAt: number; lines: never[]; warps: Record<string, never>; warnings: string[] },
  synchronizer: LyricsSynchronizer
): Promise<SyncEntry> {
  if (ranked.length === 0) return { ...base, outcome: "not-found" };

  const hasArtist = Boolean(input.artist.trim());
  let chosen = opts.candidateId ? ranked.find((c) => c.id === opts.candidateId) : undefined;
  if (opts.candidateId && !chosen) return { ...base, outcome: "not-found", warnings: ["고른 후보를 다시 찾지 못했어요"] };
  if (!chosen) {
    // high: 자동 선택 / medium: 후보 선택 UI / low: 실패 — 제목만 같은 다른 곡을 조용히 고르지 않는다
    const top = ranked[0];
    // Distinct near-equal provider records can be different recordings even without version labels.
    const contenders = dedupeCandidates(ranked.filter((c) => isAutoAccept(c, hasArtist) &&
      Math.abs(top.titleSimilarity - c.titleSimilarity) <= 0.05 && Math.abs(top.artistSimilarity - c.artistSimilarity) <= 0.05));
    if (!isAutoAccept(top, hasArtist) || contenders.length > 1) {
      const medium = ranked.filter((c) => c.confidence >= MEDIUM_CONFIDENCE);
      // 가수는 확실히 같은데 제목만 한글↔영문이라 비교가 안 되는 후보(꽃길 ↔ Flower Way)는 자동으로 고르지 않고 목록으로만 보여 준다
      const crossScript = hasArtist ? ranked.filter((c) => !medium.includes(c) && isCrossScriptTitleChoice(input, c)) : [];
      if (medium.length === 0 && crossScript.length === 0) {
        return { ...base, outcome: "not-found", confidence: top.confidence, warnings: [...base.warnings, "비슷한 곡이 있었지만 일치도가 낮아 사용하지 않았어요"] };
      }
      const options = dedupeCandidates([...medium, ...crossScript]).slice(0, 8);
      return {
        ...base,
        outcome: "needs-choice",
        options: options.map(summarize),
        confidence: options[0].confidence,
        warnings: [...base.warnings, ...(contenders.length > 1 ? ["비슷한 녹음 후보가 여러 개예요 — 길이와 가사를 확인하고 골라 주세요"] : []), ...(crossScript.length > 0 ? ["제목 표기가 달라서(한글↔원어/영문) 자동으로 고르지 못했어요. 가수는 같은 곡들이에요 — 미리보기로 가사를 확인하고 맞는 곡을 골라 주세요"] : [])],
      };
    }
    chosen = top; // The single unambiguous candidate already passed the version/title/artist gates.
  }

  const candidate = { id: chosen.id, title: chosen.title, artist: chosen.artist, duration: chosen.duration };
  const warnings: string[] = [...base.warnings];
  if (chosen.versionMismatch) warnings.push("찾은 곡이 라이브/리믹스 등 다른 버전일 수 있어요");

  if (!chosen.syncedLyrics) {
    // 싱크 정보가 없다: 시간을 만들어내지 않는다
    if (!input.ownLyrics.trim() && chosen.plainLyrics) {
      return { ...base, outcome: "lyrics-only", source: chosen.source, candidate, confidence: chosen.confidence, plainLyrics: chosen.plainLyrics, warnings };
    }
    return { ...base, outcome: "no-sync", source: chosen.source, candidate, confidence: chosen.confidence, warnings };
  }

  const result = await synchronizer.synchronize({
    title: input.title,
    artist: input.artist,
    lyrics: input.ownLyrics,
    syncedLyrics: chosen.syncedLyrics,
  });

  if (result.status === "failed" || result.status === "unsynced") {
    // 저장된 가사와 거의 안 맞는 경우: 적용하지 않고, 이유를 남긴다
    return {
      ...base,
      outcome: input.ownLyrics.trim() ? "mismatch" : "no-sync",
      source: chosen.source,
      candidate,
      confidence: chosen.confidence,
      coverage: result.coverage,
      warnings: [...warnings, ...(result.message ? [result.message] : [])],
    };
  }
  const confidence = Math.round(chosen.confidence * (0.4 + 0.6 * (result.coverage ?? 1)) * 100) / 100;
  return {
    ...base,
    outcome: result.status === "synced" ? "synced" : "partial",
    source: chosen.source,
    candidate,
    confidence,
    coverage: result.coverage,
    lines: result.lines,
    warnings,
  };
}

// ---------------------------------------------------------------- 결과 → 기존 LRC 텍스트

export function getWarp(entry: SyncEntry, videoId: string | undefined): Warp {
  return entry.warps[videoId ?? ""] ?? IDENTITY_WARP;
}

/** 이 항목이 화면에 적용되는(저장된 가사를 대체하는) 종류인가 */
export function appliesToLyrics(entry: SyncEntry, ownLyrics: string): boolean {
  if (entry.outcome === "synced" || entry.outcome === "partial") return entry.lines.length > 0;
  if (entry.outcome === "lyrics-only") return !ownLyrics.trim() && Boolean(entry.plainLyrics);
  return false;
}

/** 캐시 항목 → SongMode/ConcertMode/OBS 가 읽는 기존 LRC 텍스트 (MR 보정값 적용) */
export function buildResolvedLyrics(entry: SyncEntry, videoId: string | undefined, ownLyrics: string): string {
  if (!appliesToLyrics(entry, ownLyrics)) return ownLyrics;
  if (entry.outcome === "lyrics-only") return entry.plainLyrics ?? ownLyrics;
  const warp = getWarp(entry, videoId);
  return formatLrc(entry.lines, (t) => applyWarp(t, warp));
}

/** 후보 목록만 필요할 때(미리보기/선택 UI): 검색 → 점수 → 중복 정리. 자동 선택은 하지 않는다 */
export async function searchRanked(input: ResolveInput, provider: LyricsProvider, opts: { aliasProvider?: AliasProvider; signal?: AbortSignal } = {}): Promise<ScoredCandidate[]> {
  const { candidates, aliases } = await searchCandidates(provider, input, opts.signal, opts.aliasProvider);
  return dedupeCandidates(rankCandidates(input, candidates, aliases));
}
