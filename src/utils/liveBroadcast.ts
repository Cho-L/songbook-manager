import type { Song } from "../types/song";
import type { LyricLine } from "./lyrics";
import { acquireLink, isRealtimeAvailable, type LinkStatus } from "./liveRealtimeLink";

/**
 * SongMode/ConcertMode → 방송 오버레이로 "지금 무슨 곡, 어느 가사"인지 알려주는 전송 계층.
 *
 * 두 갈래로 동시에 보낸다 (받는 쪽에서 중복 제거):
 *  1) Supabase Realtime Broadcast — 브라우저/기기가 달라도 전달된다 (OBS 브라우저 소스 ↔ 일반 Chrome).
 *     채널 이름은 `songbook-live:{노래책id}:{방송키}`. 방송키는 추측할 수 없는 무작위 값이라, 노래책 id만 아는 사람은
 *     채널에 들어와 가짜 상태를 보낼 수 없다. DB 테이블/RLS는 쓰지 않는다.
 *  2) BroadcastChannel + localStorage — 같은 브라우저 프로필 안에서 즉시 전달 + 나중에 열린 오버레이의 초기 상태.
 *
 * SongMode/ConcertMode/OverlayPage는 이 파일의 publishLive / clearLive / subscribeLive만 쓰고 전송 방식은 모른다.
 *
 * 빈도: 곡/가사 줄이 바뀔 때만 state, 그 사이엔 5초마다 heartbeat(같은 상태 재전송). 재생 시간은 보내지 않는다.
 */
export const LIVE_CHANNEL = "songbook-live";
export const LIVE_STORAGE_KEY = "songbook:live-state";
export const LIVE_KEY_PREFIX = "songbook:live-key:";
export const LIVE_HEARTBEAT_MS = 5000;
/** 이 시간 동안 아무것도 못 받으면 "연결 끊김"으로 본다 (heartbeat 주기의 3배). 수신 시각 기준이라 기기 시계 차이와 무관하다. */
export const LIVE_STALE_MS = 15000;

export type LiveMode = "song" | "concert" | "finished" | "test";

export interface LiveSong {
  id: string;
  title: string;
  artist: string;
  key?: string;
  bpm?: number;
  difficulty?: number;
  youtubeVideoId?: string;
  /** 신청곡이면 신청자 표시 이름. 일반 재생(신청자 없음)이면 비어 있다 — 옛 발신자도 이 필드 없이 정상 동작한다 */
  requester?: string;
}

export interface LiveQueueItem {
  id: string;
  title: string;
  artist: string;
  requester?: string;
}

export interface LiveState {
  v: 1;
  /** 노래책(owner) id */
  bookId: string;
  mode: LiveMode;
  song?: LiveSong;
  /** 타임스탬프가 있는 줄의 텍스트만 (빈 문자열 = 간주 구간). 싱크 가능한 곡이 아니면 빈 배열 */
  lines: string[];
  /** lines 안에서 지금 부르는 줄의 위치. 아직 첫 줄 전이면 -1 */
  lineIndex: number;
  synced: boolean;
  /** 0-based 현재 곡 위치와 전체 곡 수 (플레이리스트가 없으면 0 / 0) */
  index: number;
  total: number;
  queue: LiveQueueItem[];
  /** 재생 상태 (아직 발신 측이 알려주지 않으면 없음 → 오버레이는 상태 표시를 생략) */
  playback?: "playing" | "paused" | "waiting";
  /** 발신 시각 (ms) — 같은 발신자 안에서 항상 증가한다 (중복/순서 판단용) */
  ts: number;
}

export type LiveStateInput = Omit<LiveState, "v" | "ts">;

/** 채널로 오가는 메시지 봉투 */
export type LiveEnvelope =
  | { type: "state" | "heartbeat"; sid: string; ts: number; state: LiveState }
  | { type: "clear"; sid: string; ts: number; bookId: string }
  | { type: "ack"; sid: string; ts: number; bookId: string; testId: string }
  // ---- 오버레이 "설정" 동기화 (곡 상태와 분리된 메시지) ----
  /** 설정 화면 → 오버레이: 현재 오버레이 설정. ver 이 큰 쪽이 최신이다. */
  | { type: "settings"; sid: string; ts: number; bookId: string; ver: number; settings: unknown }
  /** 오버레이 → 설정 화면/방송 중인 화면: "방금 연결됐어요, 현재 설정을 주세요" */
  | { type: "settings-request"; sid: string; ts: number; bookId: string }
  /** 오버레이 → 설정 화면: "ver 설정을 적용했어요 / 아직 살아 있어요" (적용 확인 + 연결된 OBS 수 표시용) */
  | { type: "settings-ack"; sid: string; ts: number; bookId: string; ver: number };

export type { LinkStatus };

/** 오버레이가 어느 노래책의 어떤 채널을 들을지 */
export interface LiveTarget {
  bookId: string;
  key: string;
}

// ---------------- 방송 키 ----------------

const KEY_RE = /^[0-9a-f]{24}$/;
export function isValidLiveKey(key: string | null | undefined): key is string {
  return typeof key === "string" && KEY_RE.test(key);
}

function randomKey(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 이 브라우저에 저장된 노래책 방송 키. 없으면 새로 만든다. */
export function getLiveKey(bookId: string): string {
  try {
    const saved = localStorage.getItem(LIVE_KEY_PREFIX + bookId);
    if (isValidLiveKey(saved)) return saved;
    const fresh = randomKey();
    localStorage.setItem(LIVE_KEY_PREFIX + bookId, fresh);
    return fresh;
  } catch {
    return randomKey(); // 저장소를 못 쓰면 이번 세션 동안만 유효한 키
  }
}

/** 계정에 저장된 방송 키를 이 브라우저에 반영한다 (형식이 올바를 때만). */
export function setLiveKey(bookId: string, key: string): boolean {
  if (!isValidLiveKey(key)) return false;
  try {
    localStorage.setItem(LIVE_KEY_PREFIX + bookId, key);
    return true;
  } catch {
    return false;
  }
}

/** 방송 키를 새로 발급한다 — 이전 오버레이 URL은 더 이상 이 노래책의 방송을 받지 못한다. */
export function regenerateLiveKey(bookId: string): string {
  const fresh = randomKey();
  try {
    localStorage.setItem(LIVE_KEY_PREFIX + bookId, fresh);
  } catch {
    // ignore
  }
  return fresh;
}

export function liveChannelName(t: LiveTarget): string {
  return `songbook-live:${t.bookId}:${t.key}`;
}

// ---------------- 내부 유틸 ----------------

const SESSION_ID = randomKey().slice(0, 12);
let lastTs = 0;
function nextTs(): number {
  lastTs = Math.max(Date.now(), lastTs + 1);
  return lastTs;
}

let localChannel: BroadcastChannel | null | undefined;
function getLocalChannel(): BroadcastChannel | null {
  if (localChannel !== undefined) return localChannel;
  try {
    localChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(LIVE_CHANNEL) : null;
  } catch {
    localChannel = null;
  }
  return localChannel;
}

function isLiveState(value: unknown): value is LiveState {
  if (!value || typeof value !== "object") return false;
  const s = value as Partial<LiveState>;
  return s.v === 1 && typeof s.bookId === "string" && typeof s.ts === "number" && Array.isArray(s.lines);
}

function isEnvelope(value: unknown): value is LiveEnvelope {
  if (!value || typeof value !== "object") return false;
  const e = value as Partial<LiveEnvelope> & { state?: unknown };
  if (typeof e.sid !== "string" || typeof e.ts !== "number") return false;
  if (e.type === "state" || e.type === "heartbeat") return isLiveState(e.state);
  if (e.type === "clear") return typeof (e as { bookId?: unknown }).bookId === "string";
  if (e.type === "ack") return typeof (e as { testId?: unknown }).testId === "string";
  const x = e as { bookId?: unknown; ver?: unknown };
  if (e.type === "settings") return typeof x.bookId === "string" && typeof x.ver === "number";
  if (e.type === "settings-request") return typeof x.bookId === "string";
  if (e.type === "settings-ack") return typeof x.bookId === "string" && typeof x.ver === "number";
  return false;
}

// ---------------- 발행 ----------------

let publisher: { name: string; release: () => void } | null = null;
let publisherIdle: number | null = null;
// 방송 중인 화면(SongMode/ConcertMode)도 오버레이의 "설정 요청"에 답한다 — 설정 화면이 닫혀 있어도 새로 연결된 OBS가 현재 설정을 받을 수 있게
let settingsResponder: { name: string; off: () => void } | null = null;
let lastBookId: string | null = null;

function ensurePublisherLink(bookId: string) {
  if (publisherIdle !== null) {
    window.clearTimeout(publisherIdle);
    publisherIdle = null;
  }
  const name = liveChannelName({ bookId, key: getLiveKey(bookId) });
  if (publisher && publisher.name !== name) {
    publisher.release();
    publisher = null;
  }
  if (!publisher) {
    const acquired = acquireLink(name);
    if (acquired) publisher = { name, release: acquired.release };
  }
  if (!settingsResponder || settingsResponder.name !== name) {
    settingsResponder?.off();
    settingsResponder = {
      name,
      off: subscribeSettingsChannel({ bookId, key: getLiveKey(bookId) }, { onRequest: () => sendCachedSettings(bookId) }),
    };
  }
  return publisher ? name : null;
}

function sendEnvelope(bookId: string, env: LiveEnvelope) {
  const name = ensurePublisherLink(bookId);
  if (name) {
    const acquired = acquireLink(name);
    if (acquired) {
      acquired.link.send(env);
      acquired.release();
    }
  }
  getLocalChannel()?.postMessage(env);
}

export function publishLive(input: LiveStateInput, kind: "state" | "heartbeat" = "state"): void {
  const ts = nextTs();
  const state: LiveState = { ...input, v: 1, ts };
  lastBookId = input.bookId;
  try {
    localStorage.setItem(LIVE_STORAGE_KEY, JSON.stringify({ sid: SESSION_ID, state }));
  } catch {
    // 저장소가 막혀 있어도 전송은 계속한다
  }
  sendEnvelope(input.bookId, { type: kind, sid: SESSION_ID, ts, state });
  // heartbeat(5초)마다 마지막 오버레이 설정도 함께 내보낸다: 늦게 연결된 OBS가 요청 없이도 최신 설정을 받는다 (ver가 같으면 오버레이가 무시)
  if (kind === "heartbeat") sendCachedSettings(input.bookId);
}

export function clearLive(): void {
  try {
    localStorage.removeItem(LIVE_STORAGE_KEY);
  } catch {
    // ignore
  }
  if (lastBookId) {
    sendEnvelope(lastBookId, { type: "clear", sid: SESSION_ID, ts: nextTs(), bookId: lastBookId });
    // 곧바로 다시 게시될 수 있으니(다음 곡 이동 등) 채널은 잠시 유지하고, 한동안 조용하면 놓아준다
    if (publisherIdle !== null) window.clearTimeout(publisherIdle);
    publisherIdle = window.setTimeout(() => {
      publisher?.release();
      publisher = null;
      settingsResponder?.off();
      settingsResponder = null;
      publisherIdle = null;
    }, 15000);
  }
}

// ---------------- 구독 ----------------

/** 저장된 최신 상태를 읽는다. 없거나 깨졌거나 오래됐으면 null. */
export function readLive(now = Date.now()): LiveState | null {
  try {
    const raw = localStorage.getItem(LIVE_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const state = (parsed as { state?: unknown } | null)?.state;
    if (!isLiveState(state) || now - state.ts > LIVE_STALE_MS) return null;
    return state;
  } catch {
    return null;
  }
}

/**
 * 상태 변화를 구독한다. state=null 은 "곡 없음/종료". 반환값은 구독 해제 함수.
 * target을 주면 그 노래책만 받고 Realtime 채널도 함께 듣는다. 주지 않으면 같은 브라우저 안에서 오는 모든 상태를 받는다.
 * 같은 메시지가 두 전송 경로로 오면 (발신자 세션, ts)로 중복을 걸러낸다.
 */
export function subscribeLive(onChange: (state: LiveState | null) => void, target?: LiveTarget): () => void {
  const seen = new Map<string, number>();

  const handle = (env: LiveEnvelope) => {
    if (env.type !== "state" && env.type !== "heartbeat" && env.type !== "clear") return;
    if (target) {
      const bookId = env.type === "clear" ? env.bookId : env.state.bookId;
      if (bookId !== target.bookId) return;
    }
    const last = seen.get(env.sid) ?? -1;
    if (env.ts <= last) return;
    seen.set(env.sid, env.ts);
    onChange(env.type === "clear" ? null : env.state);
  };

  const ch = getLocalChannel();
  const onLocal = (e: MessageEvent<unknown>) => {
    if (isEnvelope(e.data)) handle(e.data);
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key !== LIVE_STORAGE_KEY) return;
    const state = readLive();
    if (state) handle({ type: "state", sid: `ls:${state.bookId}`, ts: state.ts, state });
    else onChange(null);
  };
  ch?.addEventListener("message", onLocal);
  window.addEventListener("storage", onStorage);

  let release: (() => void) | null = null;
  let offMessage: (() => void) | null = null;
  if (target && isRealtimeAvailable()) {
    const acquired = acquireLink(liveChannelName(target));
    if (acquired) {
      release = acquired.release;
      offMessage = acquired.link.onMessage((payload) => {
        if (isEnvelope(payload)) handle(payload);
      });
    }
  }

  return () => {
    ch?.removeEventListener("message", onLocal);
    window.removeEventListener("storage", onStorage);
    offMessage?.();
    release?.();
  };
}

/** Realtime 연결 상태를 구독한다 (설정 화면 표시용). 실시간을 쓸 수 없으면 "unavailable". */
export function subscribeLiveStatus(target: LiveTarget, onStatus: (status: LinkStatus) => void): () => void {
  const acquired = acquireLink(liveChannelName(target));
  if (!acquired) {
    onStatus("unavailable");
    return () => undefined;
  }
  const off = acquired.link.onStatus(onStatus);
  return () => {
    off();
    acquired.release();
  };
}

// ---------------- 오버레이 설정 동기화 ----------------

const SETTINGS_CACHE_PREFIX = "songbook:overlay-live-settings:";
const RECEIVED_PREFIX = "songbook:overlay-received:";
let lastSettingsVer = 0;

/** 설정 버전: 같은 브라우저 안에서 항상 증가하는 시각 기반 값 */
export function nextSettingsVer(): number {
  lastSettingsVer = Math.max(Date.now(), lastSettingsVer + 1);
  return lastSettingsVer;
}

export interface VersionedSettings {
  ver: number;
  settings: unknown;
}

function readVersioned(key: string): VersionedSettings | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<VersionedSettings> | null;
    return v && typeof v.ver === "number" && v.settings && typeof v.settings === "object" ? { ver: v.ver, settings: v.settings } : null;
  } catch {
    return null;
  }
}

/** 이 브라우저(설정 화면을 쓰는 곳)가 마지막으로 방송한 오버레이 설정 */
export function readOverlaySettingsCache(bookId: string): VersionedSettings | null {
  return readVersioned(SETTINGS_CACHE_PREFIX + bookId);
}

/** OBS(오버레이)가 마지막으로 받은 설정 — OBS 브라우저 소스를 새로고침해도 최신 디자인을 유지하기 위해 저장한다 */
export function readReceivedSettings(target: { bookId: string; key?: string | null }): VersionedSettings | null {
  return readVersioned(`${RECEIVED_PREFIX}${target.bookId}:${target.key ?? ""}`);
}
export function saveReceivedSettings(target: { bookId: string; key?: string | null }, value: VersionedSettings): void {
  try {
    localStorage.setItem(`${RECEIVED_PREFIX}${target.bookId}:${target.key ?? ""}`, JSON.stringify(value));
  } catch {
    // 저장소를 못 써도 실시간 반영은 계속된다
  }
}

/** 설정 화면 → 연결된 모든 오버레이: 현재 설정을 보낸다. 반환값은 이 설정의 버전. */
export function publishOverlaySettings(bookId: string, settings: unknown, ver: number = nextSettingsVer()): number {
  try {
    localStorage.setItem(SETTINGS_CACHE_PREFIX + bookId, JSON.stringify({ ver, settings }));
  } catch {
    // ignore
  }
  sendEnvelope(bookId, { type: "settings", sid: SESSION_ID, ts: nextTs(), bookId, ver, settings });
  return ver;
}

function sendCachedSettings(bookId: string): void {
  const cached = readOverlaySettingsCache(bookId);
  if (cached) sendEnvelope(bookId, { type: "settings", sid: SESSION_ID, ts: nextTs(), bookId, ver: cached.ver, settings: cached.settings });
}

function sendViaTarget(target: { bookId: string; key?: string | null }, env: LiveEnvelope): void {
  const acquired = isValidLiveKey(target.key) ? acquireLink(liveChannelName({ bookId: target.bookId, key: target.key })) : null;
  if (acquired) {
    acquired.link.send(env);
    acquired.release();
  }
  getLocalChannel()?.postMessage(env);
}

/** 오버레이 → "현재 설정을 주세요" */
export function requestOverlaySettings(target: { bookId: string; key?: string | null }): void {
  sendViaTarget(target, { type: "settings-request", sid: SESSION_ID, ts: nextTs(), bookId: target.bookId });
}

/** 오버레이 → "이 버전을 적용했어요 / 아직 연결돼 있어요" */
export function sendOverlaySettingsAck(target: { bookId: string; key?: string | null }, ver: number): void {
  sendViaTarget(target, { type: "settings-ack", sid: SESSION_ID, ts: nextTs(), bookId: target.bookId, ver });
}

export interface SettingsChannelHandlers {
  onSettings?: (settings: unknown, ver: number, sid: string) => void;
  onRequest?: (sid: string) => void;
  onAck?: (sid: string, ver: number) => void;
}

/**
 * 설정 동기화 메시지(settings / settings-request / settings-ack)를 구독한다.
 * 곡 상태 구독(subscribeLive)과 같은 채널·같은 중복 제거 규칙을 쓰지만 서로 영향을 주지 않는다.
 * key가 있으면 Realtime 채널도 함께 듣고, 없으면 같은 브라우저 안의 채널만 듣는다.
 */
export function subscribeSettingsChannel(target: { bookId: string; key?: string | null }, h: SettingsChannelHandlers): () => void {
  const seen = new Map<string, number>();
  const handle = (env: LiveEnvelope) => {
    if (env.type !== "settings" && env.type !== "settings-request" && env.type !== "settings-ack") return;
    if (env.bookId !== target.bookId) return;
    const last = seen.get(env.sid) ?? -1;
    if (env.ts <= last) return;
    seen.set(env.sid, env.ts);
    if (env.type === "settings") h.onSettings?.(env.settings, env.ver, env.sid);
    else if (env.type === "settings-request") h.onRequest?.(env.sid);
    else h.onAck?.(env.sid, env.ver);
  };
  const ch = getLocalChannel();
  const onLocal = (e: MessageEvent<unknown>) => {
    if (isEnvelope(e.data)) handle(e.data);
  };
  ch?.addEventListener("message", onLocal);
  const acquired = isValidLiveKey(target.key) ? acquireLink(liveChannelName({ bookId: target.bookId, key: target.key })) : null;
  const off = acquired?.link.onMessage((payload) => {
    if (isEnvelope(payload)) handle(payload);
  });
  return () => {
    ch?.removeEventListener("message", onLocal);
    off?.();
    acquired?.release();
  };
}

// ---------------- 연결 테스트 (OBS가 테스트 화면을 실제로 받았는지 확인) ----------------

/** 오버레이가 테스트 화면을 받았다고 알린다 */
export function sendLiveAck(target: { bookId: string; key?: string | null }, testId: string): void {
  const env: LiveEnvelope = { type: "ack", sid: SESSION_ID, ts: nextTs(), bookId: target.bookId, testId };
  // 방송 키가 있을 때만 Realtime으로도 알린다 (키 없는 옛 URL은 같은 브라우저 안에서만)
  const acquired = isValidLiveKey(target.key) ? acquireLink(liveChannelName({ bookId: target.bookId, key: target.key })) : null;
  if (acquired) {
    acquired.link.send(env);
    // 메시지가 보내진 뒤에 놓아준다 (grace 시간 덕분에 바로 닫히지 않는다)
    acquired.release();
  }
  getLocalChannel()?.postMessage(env);
}

/** 오버레이의 테스트 수신 확인을 구독한다 */
export function subscribeLiveAck(target: LiveTarget, onAck: (testId: string) => void): () => void {
  const ch = getLocalChannel();
  const onLocal = (e: MessageEvent<unknown>) => {
    if (isEnvelope(e.data) && e.data.type === "ack" && e.data.bookId === target.bookId) onAck(e.data.testId);
  };
  ch?.addEventListener("message", onLocal);
  const acquired = acquireLink(liveChannelName(target));
  const off = acquired?.link.onMessage((payload) => {
    if (isEnvelope(payload) && payload.type === "ack" && payload.bookId === target.bookId) onAck(payload.testId);
  });
  return () => {
    ch?.removeEventListener("message", onLocal);
    off?.();
    acquired?.release();
  };
}

/**
 * 파싱된 가사 → 오버레이용 줄 목록.
 * 타임스탬프가 있는 줄만 남기고, 원래 배열에서의 현재 위치(currentLineIndex)를 남은 줄 기준 위치로 바꿔준다.
 */
export function buildLiveLyrics(
  lyricLines: LyricLine[],
  currentLineIndex: number
): { lines: string[]; lineIndex: number } {
  const lines: string[] = [];
  let lineIndex = -1;
  lyricLines.forEach((l, i) => {
    if (l.time === null) return;
    lines.push(l.text);
    if (i <= currentLineIndex) lineIndex = lines.length - 1;
  });
  return { lines, lineIndex };
}

export function toLiveSong(song: Song): LiveSong {
  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    key: song.key || undefined,
    bpm: song.bpm || undefined,
    difficulty: song.difficulty || undefined,
    youtubeVideoId: song.youtubeVideoId || undefined,
  };
}

/** 플레이리스트 순서(songIds)대로 곡 목록을 만든다. songs에 없는 id(삭제된 곡 등)는 건너뛴다. */
export function buildLiveQueue(songIds: string[], songs: Song[]): LiveQueueItem[] {
  const byId = new Map(songs.map((s) => [s.id, s]));
  const queue: LiveQueueItem[] = [];
  for (const id of songIds) {
    const s = byId.get(id);
    if (s) queue.push({ id: s.id, title: s.title, artist: s.artist });
  }
  return queue;
}
