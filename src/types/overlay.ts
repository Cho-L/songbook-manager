/**
 * 방송 오버레이 설정.
 * OBS 브라우저 소스는 로그인 세션이 없으므로 DB(user_preferences)에 둘 수 없고,
 * URL 쿼리에 그대로 실린다 — 그래서 토큰/비밀번호 같은 민감 정보는 절대 들어가지 않고,
 * 화면 표시에 필요한 값(디자인/표시 옵션/색/방송 키)만 담는다.
 * 새로 추가된 설정은 모두 "기존과 똑같이 보이는 값"이 기본값이라, 예전에 만든 URL도 그대로 동작한다.
 */
export type OverlayPreset =
  | "minimal"
  | "card"
  | "subtitle"
  | "karaoke"
  | "nowplaying"
  | "mini"
  | "lyrics"
  | "lowerthird"
  | "covercard"
  | "queue"
  | "vertical";
export type OverlayLyricsMode = "current" | "next" | "prevnext";
export type OverlayBackground = "transparent" | "translucent" | "card" | "solid";
export type OverlayIdle = "waiting" | "start" | "custom" | "hidden";
export type OverlayEnd = "hide" | "ko" | "finished" | "thanks" | "custom";
export type OverlayPosition = "auto" | "tl" | "tc" | "tr" | "c" | "bl" | "bc" | "br";
export type OverlayAlign = "auto" | "left" | "center" | "right";
export type OverlayFontFamily = "sans" | "serif" | "mono";
export type OverlayCoverStyle = "square" | "rounded" | "circle" | "hidden";
export type OverlayAnimStyle = "slide" | "fade";
export type OverlayProgressStyle = "text" | "thin" | "thick" | "dot";
export type OverlayQueueMode = "current" | "next" | "next3";

export interface OverlaySettings {
  preset: OverlayPreset;
  showTitle: boolean;
  showArtist: boolean;
  showCover: boolean;
  showLyrics: boolean;
  showKey: boolean;
  showBpm: boolean;
  showDifficulty: boolean;
  showProgress: boolean;
  showQueue: boolean;
  lyricsMode: OverlayLyricsMode;
  background: OverlayBackground;
  /** 반투명/카드/단색 배경의 불투명도 (10~100) */
  opacity: number;
  animation: boolean;
  /** 글자 크기 배율 % (60~200) */
  size: number;
  /** 커버가 없을 때: 자리표시 아이콘 / 영역 숨김 */
  coverFallback: "placeholder" | "hide";
  idle: OverlayIdle;
  idleText: string;
  endMode: OverlayEnd;
  endText: string;
  /** 강조색 (# 없는 6자리 hex). useBookAccent가 켜져 있으면 설정 화면이 노래책 Book Design accent로 채운다 */
  accent: string;
  useBookAccent: boolean;
  /** 위치 프리셋 (auto = 프리셋 기본 위치) + 미세 조정 (%, 화면 밖으로 못 나가게 범위 제한) */
  position: OverlayPosition;
  offsetX: number;
  offsetY: number;
  align: OverlayAlign;
  fontFamily: OverlayFontFamily;
  /** 굵기 400~800 */
  fontWeight: number;
  /** 줄 간격 x100 (110~180 → 1.10~1.80) */
  lineHeight: number;
  /** 글자 간격 x100em (-2~10) */
  letterSpacing: number;
  /** "" = 자동(기본색). 사용자가 지정하면 그 색이 우선한다 */
  textColor: string;
  subColor: string;
  bgColor: string;
  coverStyle: OverlayCoverStyle;
  /** 현재 가사를 accent 색으로 강조 */
  lyricAccent: boolean;
  animStyle: OverlayAnimStyle;
  progressStyle: OverlayProgressStyle;
  queueMode: OverlayQueueMode;
}

export const DEFAULT_OVERLAY_SETTINGS: OverlaySettings = {
  preset: "minimal",
  showTitle: true,
  showArtist: true,
  showCover: true,
  showLyrics: true,
  showKey: false,
  showBpm: false,
  showDifficulty: false,
  showProgress: false,
  showQueue: false,
  lyricsMode: "next",
  background: "transparent",
  opacity: 60,
  animation: true,
  size: 100,
  coverFallback: "placeholder",
  idle: "waiting",
  idleText: "",
  endMode: "ko",
  endText: "",
  accent: "fbbf24",
  useBookAccent: true,
  position: "auto",
  offsetX: 0,
  offsetY: 0,
  align: "auto",
  fontFamily: "sans",
  fontWeight: 700,
  lineHeight: 130,
  letterSpacing: 0,
  textColor: "",
  subColor: "",
  bgColor: "",
  coverStyle: "rounded",
  lyricAccent: false,
  animStyle: "slide",
  progressStyle: "text",
  queueMode: "next3",
};

export const OVERLAY_PRESETS: { value: OverlayPreset; label: string; hint: string; desc: string }[] = [
  { value: "minimal", label: "Minimal", hint: "제목·가수·가사만 단순하게", desc: "제목과 가수, 가사를 화면 구석에 단순하게 보여줍니다." },
  { value: "nowplaying", label: "Now Playing", hint: "커버 + 제목 + Key/BPM", desc: "커버와 함께 지금 곡의 제목, 가수, Key/BPM을 보여줍니다. 가사는 나오지 않아요." },
  { value: "lyrics", label: "Lyrics", hint: "현재 가사를 크게, 다음 가사 한 줄", desc: "현재 가사를 크게, 다음 가사를 한 줄 보여줍니다." },
  { value: "karaoke", label: "Karaoke", hint: "현재 가사 강조, 가운데", desc: "현재 가사를 강조해서 가운데에 보여줍니다." },
  { value: "lowerthird", label: "Lower Third", hint: "화면 아래 띠 형태 자막", desc: "방송 화면 하단에 제목과 가수를 띠 모양으로 표시합니다." },
  { value: "covercard", label: "Cover Card", hint: "큰 커버 중심 카드", desc: "큰 커버 이미지를 중심으로 제목과 가수를 카드로 보여줍니다." },
  { value: "queue", label: "Queue", hint: "지금 곡 + 다음 곡 목록", desc: "지금 곡(NOW)과 다음 곡(NEXT) 목록을 보여줍니다." },
  { value: "vertical", label: "Vertical", hint: "세로 화면(9:16)용", desc: "세로 방송 화면(9:16)에 맞게 커버, 제목, 가사를 세로로 쌓아 보여줍니다." },
  { value: "card", label: "Card", hint: "커버와 함께 가로 카드", desc: "커버와 함께 가로 카드 형태로 보여줍니다." },
  { value: "subtitle", label: "Subtitle", hint: "화면 아래 자막처럼", desc: "화면 아래에 자막처럼 가사를 보여줍니다." },
  { value: "mini", label: "Mini", hint: "구석에 '제목 · 가수'만 한 줄", desc: "화면 구석에 제목 · 가수만 한 줄로 작게 보여줍니다." },
];

export const OVERLAY_POSITIONS: { value: OverlayPosition; label: string }[] = [
  { value: "auto", label: "프리셋 기본" },
  { value: "tl", label: "Top Left" },
  { value: "tc", label: "Top Center" },
  { value: "tr", label: "Top Right" },
  { value: "c", label: "Center" },
  { value: "bl", label: "Bottom Left" },
  { value: "bc", label: "Bottom Center" },
  { value: "br", label: "Bottom Right" },
];

export const OFFSET_X_MAX = 20;
export const OFFSET_Y_MAX = 15;

const PRESETS = OVERLAY_PRESETS.map((p) => p.value);
const LYRIC_MODES: OverlayLyricsMode[] = ["current", "next", "prevnext"];
const BACKGROUNDS: OverlayBackground[] = ["transparent", "translucent", "card", "solid"];
const IDLES: OverlayIdle[] = ["waiting", "start", "custom", "hidden"];
const ENDS: OverlayEnd[] = ["hide", "ko", "finished", "thanks", "custom"];
const POSITIONS = OVERLAY_POSITIONS.map((p) => p.value);
const ALIGNS: OverlayAlign[] = ["auto", "left", "center", "right"];
const FONTS: OverlayFontFamily[] = ["sans", "serif", "mono"];
const COVERS: OverlayCoverStyle[] = ["square", "rounded", "circle", "hidden"];
const ANIMS: OverlayAnimStyle[] = ["slide", "fade"];
const PROGRESS: OverlayProgressStyle[] = ["text", "thin", "thick", "dot"];
const QUEUES: OverlayQueueMode[] = ["current", "next", "next3"];

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function bool(value: string | null, fallback: boolean): boolean {
  if (value === "1") return true;
  if (value === "0") return false;
  return fallback;
}

function num(value: string | null, fallback: number, min: number, max: number): number {
  if (value === null || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? clamp(Math.round(n), min, max) : fallback;
}

/** "" 또는 6자리 hex만 허용 (그 외는 자동색으로 되돌린다) */
function hexOrEmpty(value: string | null): string {
  const v = (value ?? "").replace("#", "");
  return /^[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : "";
}

const MAX_TEXT = 60;
/** 사용자 문구: 앞뒤 공백 제거 + 길이 제한. (화면에는 React 텍스트로만 그려지므로 HTML로 해석되지 않는다) */
function text(value: string | null): string {
  return (value ?? "").trim().slice(0, MAX_TEXT);
}

/** 쿼리스트링 → 설정. 알 수 없거나 잘못된 값은 전부 기본값으로 안전하게 되돌린다. */
export function parseOverlaySettings(params: URLSearchParams): OverlaySettings {
  const d = DEFAULT_OVERLAY_SETTINGS;
  // 예전 URL의 end=0/1 도 그대로 이해한다 (em이 있으면 em이 우선)
  const legacyEnd = params.get("end") === "0" ? "hide" : d.endMode;
  return {
    preset: pick(params.get("p"), PRESETS, d.preset),
    showTitle: bool(params.get("t"), d.showTitle),
    showArtist: bool(params.get("a"), d.showArtist),
    showCover: bool(params.get("c"), d.showCover),
    showLyrics: bool(params.get("l"), d.showLyrics),
    showKey: bool(params.get("k"), d.showKey),
    showBpm: bool(params.get("b"), d.showBpm),
    showDifficulty: bool(params.get("d"), d.showDifficulty),
    showProgress: bool(params.get("pr"), d.showProgress),
    showQueue: bool(params.get("q"), d.showQueue),
    lyricsMode: pick(params.get("lm"), LYRIC_MODES, d.lyricsMode),
    background: pick(params.get("bg"), BACKGROUNDS, d.background),
    opacity: num(params.get("op"), d.opacity, 10, 100),
    animation: bool(params.get("an"), d.animation),
    size: num(params.get("sz"), d.size, 60, 200),
    coverFallback: pick(params.get("cf"), ["placeholder", "hide"] as const, d.coverFallback),
    idle: pick(params.get("id"), IDLES, d.idle),
    idleText: text(params.get("it")),
    endMode: pick(params.get("em"), ENDS, legacyEnd),
    endText: text(params.get("et")),
    accent: hexOrEmpty(params.get("ac")) || d.accent,
    useBookAccent: bool(params.get("ub"), d.useBookAccent),
    position: pick(params.get("pos"), POSITIONS, d.position),
    offsetX: num(params.get("ox"), d.offsetX, -OFFSET_X_MAX, OFFSET_X_MAX),
    offsetY: num(params.get("oy"), d.offsetY, -OFFSET_Y_MAX, OFFSET_Y_MAX),
    align: pick(params.get("al"), ALIGNS, d.align),
    fontFamily: pick(params.get("ff"), FONTS, d.fontFamily),
    fontWeight: clamp(Math.round(num(params.get("fw"), d.fontWeight, 400, 800) / 100) * 100, 400, 800),
    lineHeight: num(params.get("lh"), d.lineHeight, 110, 180),
    letterSpacing: num(params.get("ls"), d.letterSpacing, -2, 10),
    textColor: hexOrEmpty(params.get("tc")),
    subColor: hexOrEmpty(params.get("sc")),
    bgColor: hexOrEmpty(params.get("bc")),
    coverStyle: pick(params.get("cs"), COVERS, d.coverStyle),
    lyricAccent: bool(params.get("la"), d.lyricAccent),
    animStyle: pick(params.get("as"), ANIMS, d.animStyle),
    progressStyle: pick(params.get("ps"), PROGRESS, d.progressStyle),
    queueMode: pick(params.get("qm"), QUEUES, d.queueMode),
  };
}

/** 설정 → 쿼리스트링. 기본값과 같은 항목도 전부 적어서, 나중에 기본값이 바뀌어도 OBS 화면이 달라지지 않게 한다. */
export function serializeOverlaySettings(s: OverlaySettings, bookId?: string, liveKey?: string): string {
  const b = (v: boolean) => (v ? "1" : "0");
  const q = new URLSearchParams();
  if (bookId) q.set("book", bookId);
  // 실시간 채널 입장 열쇠 (인증 토큰이 아니라, 이 노래책 방송 채널을 추측할 수 없게 하는 무작위 값)
  if (bookId && liveKey) q.set("lk", liveKey);
  q.set("p", s.preset);
  q.set("t", b(s.showTitle));
  q.set("a", b(s.showArtist));
  q.set("c", b(s.showCover));
  q.set("l", b(s.showLyrics));
  q.set("k", b(s.showKey));
  q.set("b", b(s.showBpm));
  q.set("d", b(s.showDifficulty));
  q.set("pr", b(s.showProgress));
  q.set("q", b(s.showQueue));
  q.set("lm", s.lyricsMode);
  q.set("bg", s.background);
  q.set("op", String(s.opacity));
  q.set("an", b(s.animation));
  q.set("sz", String(s.size));
  q.set("cf", s.coverFallback);
  q.set("id", s.idle);
  if (s.idleText) q.set("it", s.idleText);
  q.set("em", s.endMode);
  q.set("end", b(s.endMode !== "hide")); // 예전 URL 형식과의 호환용
  if (s.endText) q.set("et", s.endText);
  q.set("ac", s.accent.replace("#", ""));
  q.set("ub", b(s.useBookAccent));
  q.set("pos", s.position);
  q.set("ox", String(s.offsetX));
  q.set("oy", String(s.offsetY));
  q.set("al", s.align);
  q.set("ff", s.fontFamily);
  q.set("fw", String(s.fontWeight));
  q.set("lh", String(s.lineHeight));
  q.set("ls", String(s.letterSpacing));
  if (s.textColor) q.set("tc", s.textColor);
  if (s.subColor) q.set("sc", s.subColor);
  if (s.bgColor) q.set("bc", s.bgColor);
  q.set("cs", s.coverStyle);
  q.set("la", b(s.lyricAccent));
  q.set("as", s.animStyle);
  q.set("ps", s.progressStyle);
  q.set("qm", s.queueMode);
  return q.toString();
}

/** 프리셋을 고르면 그 프리셋에 어울리는 옵션으로 한 번 맞춰준다 (이후 개별 조정 가능). 위치/색/글꼴 같은 개인 취향 설정은 건드리지 않는다. */
export function presetDefaults(preset: OverlayPreset): Partial<OverlaySettings> {
  switch (preset) {
    case "minimal":
      return { showTitle: true, showArtist: true, showLyrics: true, lyricsMode: "next", background: "transparent", lyricAccent: false, showCover: true };
    case "card":
      return { showTitle: true, showArtist: true, showCover: true, showLyrics: true, lyricsMode: "current", background: "card", lyricAccent: false };
    case "subtitle":
      return { showTitle: false, showArtist: false, showLyrics: true, lyricsMode: "next", background: "transparent", lyricAccent: false };
    case "karaoke":
      return { showTitle: true, showArtist: true, showLyrics: true, lyricsMode: "next", background: "transparent", lyricAccent: true };
    case "nowplaying":
      return { showTitle: true, showArtist: true, showCover: true, showKey: true, showBpm: true, showLyrics: false, background: "transparent" };
    case "mini":
      return { showTitle: true, showArtist: true, showLyrics: false, background: "translucent" };
    case "lyrics":
      return { showTitle: false, showArtist: false, showLyrics: true, lyricsMode: "next", background: "transparent", lyricAccent: true };
    case "lowerthird":
      return { showTitle: true, showArtist: true, showLyrics: false, background: "translucent", showProgress: false };
    case "covercard":
      return { showTitle: true, showArtist: true, showCover: true, showLyrics: false, background: "card", coverStyle: "rounded" };
    case "queue":
      return { showTitle: true, showArtist: true, showLyrics: false, background: "translucent" };
    case "vertical":
      return { showTitle: true, showArtist: true, showCover: true, showLyrics: true, lyricsMode: "next", background: "transparent", lyricAccent: true, showProgress: true };
  }
}

// ---------------------------------------------------------------- 방송 프로필 / 설정 파일

/** 어떤 값이 들어와도(옛 버전, 깨진 값, 엉뚱한 타입) 안전한 OverlaySettings로 만든다. */
export function sanitizeOverlaySettings(raw: unknown): OverlaySettings {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  // 기본값과 같은 타입의 값만 받아들이고, 나머지는 기본값 → 그 뒤 URL 파서와 같은 검증(범위/허용값/색 형식)을 한 번 더 거친다
  const merged: Record<string, unknown> = { ...DEFAULT_OVERLAY_SETTINGS };
  for (const key of Object.keys(DEFAULT_OVERLAY_SETTINGS) as (keyof OverlaySettings)[]) {
    const v = obj[key];
    if (v !== undefined && typeof v === typeof DEFAULT_OVERLAY_SETTINGS[key]) merged[key] = v;
  }
  return parseOverlaySettings(new URLSearchParams(serializeOverlaySettings(merged as unknown as OverlaySettings)));
}

export const PROFILE_NAME_MAX = 40;
export function cleanProfileName(name: string): string {
  return name.trim().replace(/\s+/g, " ").slice(0, PROFILE_NAME_MAX) || "이름 없는 프로필";
}

export const OVERLAY_EXPORT_VERSION = 1;

export function buildOverlayExport(name: string, settings: OverlaySettings): string {
  return JSON.stringify({ version: OVERLAY_EXPORT_VERSION, profile: name, settings }, null, 2);
}

export type OverlayImportResult = { ok: true; name: string; settings: OverlaySettings } | { ok: false; error: string };

/** 가져온 설정 파일 검사. 형식/버전이 맞지 않으면 거부하고(호출한 쪽은 기존 설정을 그대로 둔다) 이유를 돌려준다. */
export function parseOverlayImport(text: string): OverlayImportResult {
  if (text.length > 200_000) return { ok: false, error: "파일이 너무 커요." };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "올바른 JSON 파일이 아니에요." };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, error: "방송 설정 파일 형식이 아니에요." };
  const d = data as { version?: unknown; profile?: unknown; settings?: unknown };
  if (d.version !== OVERLAY_EXPORT_VERSION) return { ok: false, error: "지원하지 않는 버전의 설정 파일이에요." };
  if (!d.settings || typeof d.settings !== "object" || Array.isArray(d.settings)) return { ok: false, error: "설정 내용이 없어요." };
  return {
    ok: true,
    name: typeof d.profile === "string" ? cleanProfileName(d.profile) : "가져온 설정",
    settings: sanitizeOverlaySettings(d.settings),
  };
}

/** 처음 쓰는 사람을 위한 추천 설정 — DB에 자동 생성하지 않고, 눌러서 현재 설정에 적용한 뒤 직접 프로필로 저장하게 한다. */
export const RECOMMENDED_PROFILES: { name: string; desc: string; build: () => OverlaySettings }[] = [
  {
    name: "YouTube 가로 방송",
    desc: "제목·가수·가사를 왼쪽 아래에 단순하게",
    build: () => ({ ...DEFAULT_OVERLAY_SETTINGS, preset: "minimal", ...presetDefaults("minimal"), showProgress: true }),
  },
  {
    name: "YouTube 세로 방송",
    desc: "9:16 세로 화면에 맞춘 구성",
    build: () => ({ ...DEFAULT_OVERLAY_SETTINGS, preset: "vertical", ...presetDefaults("vertical") }),
  },
  {
    name: "Karaoke",
    desc: "현재 가사를 크게 강조해 가운데에",
    build: () => ({ ...DEFAULT_OVERLAY_SETTINGS, preset: "karaoke", ...presetDefaults("karaoke") }),
  },
  {
    name: "Minimal",
    desc: "구석에 '제목 · 가수' 한 줄만",
    build: () => ({ ...DEFAULT_OVERLAY_SETTINGS, preset: "mini", ...presetDefaults("mini") }),
  },
];
