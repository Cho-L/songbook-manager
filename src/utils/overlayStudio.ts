import { DEFAULT_OVERLAY_SETTINGS, presetDefaults, sanitizeOverlaySettings, serializeOverlaySettings, type OverlayPreset, type OverlaySettings } from "../types/overlay";
import { DEFAULT_QUEUE_OVERLAY, buildQueueOverlayUrl, type QueueOverlaySettings } from "./queueOverlay";

/**
 * OBS Overlay Studio 설정 모델.
 * - kind(오버레이 종류)별로, 노래책별로 하나씩 저장한다 (DB: overlay_configs, 로컬: localStorage).
 * - 표시 설정만 담는다. 비밀값/토큰은 없다. 어떤 값이 와도(옛 버전/손상/악의적 값) sanitize 가 안전한 값으로 바꾼다.
 * - song/lyrics 는 기존 OverlaySettings(11개 스타일 + 배너)를 그대로 재사용하고, queue 는 Phase 2 의 QueueOverlaySettings 를 확장해서 쓴다.
 */
export const OVERLAY_KINDS = ["song", "lyrics", "queue"] as const;
export type OverlayKind = (typeof OVERLAY_KINDS)[number];

export const KIND_LABEL: Record<OverlayKind, string> = { song: "현재 곡", lyrics: "가사", queue: "신청곡 대기열" };
export const KIND_DESC: Record<OverlayKind, string> = {
  song: "지금 부르는 곡의 제목·가수·신청자 (스타일 선택 가능)",
  lyrics: "지금 부르는 가사 줄 (싱크된 곡만)",
  queue: "승인된 신청곡 대기열 (재생 중 / 대기)",
};
/** 종류별로 고를 수 있는 기존 스타일 */
export const KIND_PRESETS: Record<"song" | "lyrics", OverlayPreset[]> = {
  song: ["minimal", "nowplaying", "card", "lowerthird", "covercard", "mini", "banner", "queue", "vertical"],
  lyrics: ["lyrics", "karaoke", "subtitle"],
};

/** 박스 꾸밈. 실제 OBS 화면(브라우저 소스 크기) 전체에 적용되며, w/h 는 권장 OBS 소스 크기 + 미리보기 비율이다. */
export interface StudioBox {
  w: number;
  h: number;
  /** 모서리 반경 px 0~80 */
  radius: number;
  /** 테두리 두께 px 0~16, 색 #rrggbb */
  borderW: number;
  borderColor: string;
  /** 안쪽 여백 px 0~80 */
  padding: number;
}
export const BOX_LIMITS = { w: [160, 3840], h: [60, 2160], radius: [0, 80], borderW: [0, 16], padding: [0, 80] } as const;

export function defaultBox(kind: OverlayKind): StudioBox {
  return kind === "queue"
    ? { w: 640, h: 360, radius: 8, borderW: 0, borderColor: "#ffffff", padding: 10 }
    : { w: 1920, h: 1080, radius: 0, borderW: 0, borderColor: "#ffffff", padding: 0 };
}

export interface StudioConfig {
  kind: OverlayKind;
  /** song / lyrics 일 때 */
  overlay: OverlaySettings;
  /** queue 일 때 */
  queue: QueueOverlaySettings;
  box: StudioBox;
}

const clamp = (n: number, [min, max]: readonly [number, number]) => Math.min(max, Math.max(min, n));
const int = (v: unknown, def: number, range: readonly [number, number]) => (typeof v === "number" && Number.isFinite(v) ? clamp(Math.round(v), range) : def);
const hex6 = (v: unknown, def: string) => (typeof v === "string" && /^#?[0-9a-fA-F]{6}$/.test(v) ? `#${v.replace("#", "").toLowerCase()}` : def);
const bool = (v: unknown, def: boolean) => (typeof v === "boolean" ? v : def);

export function sanitizeBox(raw: unknown, kind: OverlayKind): StudioBox {
  const d = defaultBox(kind);
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    w: int(o.w, d.w, BOX_LIMITS.w),
    h: int(o.h, d.h, BOX_LIMITS.h),
    radius: int(o.radius, d.radius, BOX_LIMITS.radius),
    borderW: int(o.borderW, d.borderW, BOX_LIMITS.borderW),
    borderColor: hex6(o.borderColor, d.borderColor),
    padding: int(o.padding, d.padding, BOX_LIMITS.padding),
  };
}

export function sanitizeQueueSettings(raw: unknown): QueueOverlaySettings {
  const d = DEFAULT_QUEUE_OVERLAY;
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    n: int(o.n, d.n, [1, 12]),
    fs: int(o.fs, d.fs, [12, 96]),
    align: o.align === "center" || o.align === "right" || o.align === "left" ? o.align : d.align,
    bg: int(o.bg, d.bg, [0, 100]),
    tc: hex6(o.tc, d.tc),
    ac: hex6(o.ac, d.ac),
    req: bool(o.req, d.req),
    head: bool(o.head, d.head),
    fw: int(o.fw, d.fw, [400, 800]),
    bgc: hex6(o.bgc, d.bgc),
    gap: int(o.gap, d.gap, [0, 20]),
    st: bool(o.st, d.st),
    sa: bool(o.sa, d.sa),
    sc: bool(o.sc, d.sc),
    sn: bool(o.sn, d.sn),
  };
}

/** 종류에 맞지 않는 값(예: 현재 곡 오버레이에 가사 표시)을 바로잡는다 */
export function constrainOverlay(kind: "song" | "lyrics", s: OverlaySettings): OverlaySettings {
  const allowed = KIND_PRESETS[kind];
  const preset = allowed.includes(s.preset) ? s.preset : allowed[0];
  const base = preset === s.preset ? s : { ...s, ...presetDefaults(preset), preset };
  return kind === "song" ? { ...base, showLyrics: false } : { ...base, showLyrics: true, showQueue: false };
}

export function defaultStudioConfig(kind: OverlayKind): StudioConfig {
  const base = { ...DEFAULT_OVERLAY_SETTINGS };
  const overlay =
    kind === "song"
      ? constrainOverlay("song", { ...base, ...presetDefaults("nowplaying"), preset: "nowplaying" })
      : kind === "lyrics"
        ? constrainOverlay("lyrics", { ...base, ...presetDefaults("lyrics"), preset: "lyrics" })
        : base;
  return { kind, overlay, queue: { ...DEFAULT_QUEUE_OVERLAY }, box: defaultBox(kind) };
}

/** 저장소/네트워크에서 온 임의의 값 → 안전한 StudioConfig */
export function sanitizeStudioConfig(kind: OverlayKind, raw: unknown): StudioConfig {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const def = defaultStudioConfig(kind);
  const overlay =
    kind === "queue" ? def.overlay : constrainOverlay(kind, o.overlay === undefined ? def.overlay : sanitizeOverlaySettings(o.overlay));
  return { kind, overlay, queue: kind === "queue" ? sanitizeQueueSettings(o.queue) : def.queue, box: sanitizeBox(o.box, kind) };
}

/** 저장용 JSON (그 종류에 필요한 부분만) */
export function toStoredConfig(c: StudioConfig): Record<string, unknown> {
  return c.kind === "queue" ? { queue: c.queue, box: c.box } : { overlay: c.overlay, box: c.box };
}

// ---------------------------------------------------------------- URL

export function overlayRoute(kind: OverlayKind): string {
  return `/overlay/${kind}`;
}

/** OBS 에 붙여넣는 짧은 주소: 저장된 Studio 설정을 불러온다 (cfg=1). 현재 곡/가사는 실시간 방송 키(lk)가 필요하다. */
export function buildStudioUrl(origin: string, kind: OverlayKind, bookId: string, liveKey?: string): string {
  const q = new URLSearchParams({ book: bookId, cfg: "1" });
  if (kind !== "queue" && liveKey) q.set("lk", liveKey);
  return `${origin}${overlayRoute(kind)}?${q.toString()}`;
}

/** 설정이 전부 URL 에 담긴 "독립형 주소" — DB 저장이 없어도, 어느 브라우저에서도 같은 모습. (box 의 테두리/반경/여백은 담기지 않는다) */
export function buildPortableUrl(origin: string, c: StudioConfig, bookId: string, liveKey?: string): string {
  if (c.kind === "queue") return buildQueueOverlayUrl(origin, bookId, c.queue);
  return `${origin}/overlay?${serializeOverlaySettings(c.overlay, bookId, liveKey)}`;
}

/** 이 종류의 오버레이가 쓰는 설정을 한 줄로 요약 (미리보기 캡션) */
export function recommendedSize(c: StudioConfig): string {
  return `${c.box.w}×${c.box.h}`;
}
