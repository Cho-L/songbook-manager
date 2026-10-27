/**
 * 자동 가사 검색 + 자동 싱크 공통 타입.
 * 기존 LRC 시스템(utils/lyrics.ts)과 호환된다: 결과는 "[mm:ss.xx] 가사" 텍스트로 변환되어 기존 파서/SongMode/ConcertMode/OBS 전송 경로를 그대로 탄다.
 */

/** 단어(또는 음절/글자) 단위 타이밍 — 지금은 비어 있을 수 있고, 나중에 karaoke 하이라이트에 쓴다. */
export interface SyncedWord {
  time: number;
  text: string;
}

export interface SyncedLyricLine {
  /** 기준(reference) 녹음 기준 초. matched=false 인 줄은 null — 시간을 지어내지 않는다 */
  time: number | null;
  text: string;
  /** 신뢰할 수 있는 소스에서 이 줄의 시간을 얻었는가 */
  matched: boolean;
  /** 줄 단위 신뢰도 0~1 (정렬 유사도 등). 모르면 생략 */
  confidence?: number;
  words?: SyncedWord[];
}

export interface LyricsCandidate {
  id: string;
  title: string;
  artist: string;
  album?: string;
  /** 기준 녹음 길이(초) */
  duration?: number;
  plainLyrics?: string;
  /** LRC 형식 싱크 가사 */
  syncedLyrics?: string;
  instrumental?: boolean;
  source: string;
}

/** 후보가 왜 이 순위인지 보여 주는 근거. 퍼센트는 실제 확률이 아니라 정렬용 점수라서 화면에는 이 근거와 등급을 쓴다 */
export interface MatchEvidence {
  title: "exact" | "close" | "alias" | "loanword" | "unverified" | "different";
  artist: "exact" | "close" | "different" | "unknown";
  /** 높음: 자동 선택 가능한 수준 / 보통: 후보로 보여 주고 확인받음 / 낮음: 근거 부족 */
  level: "high" | "medium" | "low";
  /** 예: "아티스트 일치 · 제목 확인 불가 (표기 언어가 달라요)" */
  label: string;
  notes: string[];
}

export interface ScoredCandidate extends LyricsCandidate {
  /** 곡 정보(제목/가수) 일치 신뢰도 0~1 */
  confidence: number;
  titleSimilarity: number;
  artistSimilarity: number;
  /** 라이브/리믹스 등 다른 버전으로 보이는가 */
  versionMismatch: boolean;
  evidence?: MatchEvidence;
}

export interface LyricsLookupMetadata {
  /** Reference recording duration only. Never substitute a YouTube MR duration. */
  duration?: number;
  album?: string;
}

export const LYRICS_SEARCH_REVISION = 4;
export type LyricsSearchStopReason = "matched" | "completed" | "rate-limit" | "retry-after" | "server-error-limit" | "server-recovery-limit" | "network" | "invalid" | "unauthorized" | "service-error" | "request-limit" | "aborted";
export interface DiscoverySummary {
  stopReason?: LyricsSearchStopReason;
  requests: number;
  records: number;
  withLyrics: number;
  failures: number;
  budgetExhausted: boolean;
}

/** Opt-in, memory-only diagnostics. No URLs, headers, account IDs or lyric bodies. */
export interface LyricsRequestDiagnostic {
  endpoint: "search" | "get";
  title?: string;
  artist?: string;
  query?: string;
  httpStatus?: number;
  records?: number;
  cached: boolean;
  source?: "network" | "cache" | "shared";
  outcome: "results" | "empty" | "not-found" | "error";
  errorKind?: import("./errors").LyricsErrorKind;
}
export interface LyricsSearchConclusion {
  endpoint: "plan";
  outcome: "stopped";
  stopReason: LyricsSearchStopReason;
}
export type LyricsDiagnosticEvent = LyricsRequestDiagnostic | LyricsSearchConclusion;
export type LyricsRequestObserver = (request: LyricsDiagnosticEvent) => void;
export interface RecordingLyricsResult {
  status: "found" | "empty" | "incomplete" | "failed";
  ids: string[];
  message?: string;
}

export interface LyricsProvider {
  readonly name: string;
  search(title: string, artist: string, signal?: AbortSignal, observe?: LyricsRequestObserver): Promise<LyricsCandidate[]>;
  /** 자유 검색어(제목·가수·앨범 어디든 포함) 검색. 지원하는 provider 만 구현한다 */
  searchQuery?(query: string, signal?: AbortSignal, observe?: LyricsRequestObserver): Promise<LyricsCandidate[]>;
  get?(title: string, artist: string, metadata?: LyricsLookupMetadata, signal?: AbortSignal, observe?: LyricsRequestObserver): Promise<LyricsCandidate[]>;
}

/**
 * 같은 곡/가수의 다른 언어 표기. 한글로 적은 곡이 가사 DB 에는 영문 표기로만 있을 때(예: 꽃길 ↔ Flower Way)
 * 번역기로 만들어 낸 값이 아니라 외부 메타데이터(MusicBrainz 등)가 알려 준 표기만 담는다.
 */
export interface TitleArtistAliases {
  /** A transient metadata failure is not evidence that no alias exists. */
  lookupUnavailable?: boolean;
  artists: string[];
  titles: string[];
  /** 사용자가 직접 입력했거나 기본 사전에 있는 표기. 가수 정보가 없는 곡에서도 제목 별칭으로 인정한다 */
  trusted?: boolean;
}

export interface AliasProvider {
  readonly name: string;
  /** 실패하거나 확실한 정보가 없으면 빈 값을 돌려준다(검색 자체를 막지 않는다) */
  lookup(title: string, artist: string, signal?: AbortSignal): Promise<TitleArtistAliases>;
}

/** MusicBrainz 가 알려 주는 아티스트 한 명 (이름이 같은 다른 사람을 구분하는 데 쓴다 — mbid 가 같아야 같은 아티스트) */
export interface ArtistHit {
  mbid: string;
  name: string;
  sortName?: string;
  disambiguation?: string;
  country?: string;
  type?: string;
  /** MusicBrainz 에 등록된 다른 표기(원어/로마자/한글 등) */
  aliases: string[];
  /** 검색 점수 0~100 (정렬용) */
  score: number;
}

/** MusicBrainz 에 등록된 녹음(곡) 하나 */
export interface ArtistRecording {
  mbid: string;
  title: string;
  /** 초 */
  length?: number;
  disambiguation?: string;
  /** 같은 곡의 다른 표기 (로마자 별칭, 수록 릴리스 제목 등 — MusicBrainz 가 알려 준 값만) */
  altTitles: string[];
  /** 크레딧에 적힌 아티스트 표기 */
  credit: string;
  /** 라이브/리믹스/인스트루멘탈 등 다른 버전으로 보이는가 */
  isVersion: boolean;
}

export interface RecordingPage {
  /** MusicBrainz 가 알려 준 이 아티스트의 전체 녹음 수 (등록된 범위) */
  total: number;
  offset: number;
  /** 이번에 받은 원본 개수 (다음 offset 계산용) */
  rawCount: number;
  items: ArtistRecording[];
}

/** 아티스트 검색 + 아티스트별 곡 목록 (MusicBrainz) */
export interface ArtistCatalog {
  searchArtists(name: string, signal?: AbortSignal): Promise<ArtistHit[]>;
  browseRecordings(mbid: string, offset: number, signal?: AbortSignal): Promise<RecordingPage>;
}

// ---------------------------------------------------------------- 싱크 엔진 추상화

export interface ReferenceAudio {
  /** 사용자가 합법적으로 제공한 보컬 포함 오디오(파일 업로드 등). YouTube에서 오디오를 내려받지 않는다. */
  url: string;
  durationSec?: number;
}

export interface SyncInput {
  title: string;
  artist: string;
  /** 저장된/사용할 평문 가사 */
  lyrics?: string;
  /** provider 가 준 LRC (기준 녹음 타임라인) */
  syncedLyrics?: string;
  referenceAudio?: ReferenceAudio;
  language?: string;
}

export type SyncStatus = "synced" | "partially-synced" | "unsynced" | "failed";

export interface SyncResult {
  status: SyncStatus;
  lines: SyncedLyricLine[];
  confidence?: number;
  /** 시간을 얻은 줄의 비율 0~1 */
  coverage?: number;
  source?: string;
  generatedAt?: string;
  message?: string;
}

export interface LyricsSynchronizer {
  readonly name: string;
  synchronize(input: SyncInput): Promise<SyncResult>;
}

// ---------------------------------------------------------------- MR 타임라인 변환

/** 기준 녹음 시간 t → MR 재생 시간: offset + ratio * t */
export interface Warp {
  offset: number;
  ratio: number;
}
export const IDENTITY_WARP: Warp = { offset: 0, ratio: 1 };

// ---------------------------------------------------------------- 캐시 항목

export type SyncOutcome =
  | "synced"
  | "partial"
  | "lyrics-only"
  | "no-sync"
  | "needs-choice"
  | "mismatch"
  | "not-found";

export interface CandidateSummary {
  id: string;
  title: string;
  artist: string;
  duration?: number;
  hasSynced: boolean;
  confidence: number;
}

export interface SyncEntry {
  v: 1;
  songId: string;
  /** 무효화 판단용: 제목/가수/저장된 가사가 바뀌면 이 항목은 버린다 */
  titleKey: string;
  artistKey: string;
  lyricsHash: string;
  createdAt: number;
  outcome: SyncOutcome;
  searchRevision?: number;
  discovery?: DiscoverySummary;
  source?: string;
  candidate?: { id: string; title: string; artist: string; duration?: number };
  confidence?: number;
  coverage?: number;
  /** 기준 타임라인의 줄 (저장된 가사가 있으면 그 줄 순서, 없으면 provider 줄) */
  lines: SyncedLyricLine[];
  /** lyrics-only 일 때 표시할 평문 */
  plainLyrics?: string;
  options?: CandidateSummary[];
  /** 영상(MR) 별 보정값. key = youtubeVideoId (없으면 "") */
  warps: Record<string, Warp>;
  warnings: string[];
}
