import type { PublicQueue, PublicQueueItem } from "./songRequest";

/** OBS 대기열 오버레이(/overlay/queue)의 표시 설정. 전부 URL 쿼리로 전달되며 비밀값은 없다 (노래책 id 만 필요). */
export interface QueueOverlaySettings {
  /** 보여줄 대기 곡 수 (재생 중인 곡은 별도) */
  n: number;
  /** 글자 크기(px) */
  fs: number;
  align: "left" | "center" | "right";
  /** 배경 불투명도 0~100 */
  bg: number;
  /** 글자색 / 강조색 (#rrggbb) */
  tc: string;
  ac: string;
  /** 신청자 이름 표시 */
  req: boolean;
  /** 제목 줄("신청곡 대기열") 표시 */
  head: boolean;
  // ---- Phase 3 (Overlay Studio). 전부 "예전과 똑같이 보이는 값"이 기본이라 옛 URL 은 그대로 동작한다 ----
  /** 대기 곡 제목 굵기 400~800 (재생 중인 곡은 항상 800) */
  fw: number;
  /** 배경 색 (#rrggbb) — bg(불투명도)와 함께 쓰인다 */
  bgc: string;
  /** 줄 사이 간격, 0.1em 단위 0~20 */
  gap: number;
  /** 곡 제목 / 가수 표시 */
  st: boolean;
  sa: boolean;
  /** 재생 중인 곡 줄 / 대기 곡 목록 표시 */
  sc: boolean;
  sn: boolean;
}
export const DEFAULT_QUEUE_OVERLAY: QueueOverlaySettings = {
  n: 5, fs: 28, align: "left", bg: 55, tc: "#ffffff", ac: "#fbbf24", req: true, head: true,
  fw: 400, bgc: "#000000", gap: 0, st: true, sa: true, sc: true, sn: true,
};

const HEX = /^[0-9a-f]{6}$/i;
const clampInt = (v: string | null, min: number, max: number, d: number) => {
  if (v === null || v.trim() === "") return d;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : d;
};

export function parseQueueOverlay(params: URLSearchParams): QueueOverlaySettings {
  const d = DEFAULT_QUEUE_OVERLAY;
  const hex = (k: string, def: string) => {
    const v = (params.get(k) ?? "").replace(/^#/, "");
    return HEX.test(v) ? `#${v.toLowerCase()}` : def;
  };
  const al = params.get("al");
  return {
    n: clampInt(params.get("n"), 1, 12, d.n),
    fs: clampInt(params.get("fs"), 12, 96, d.fs),
    align: al === "center" || al === "right" ? al : "left",
    bg: clampInt(params.get("bg"), 0, 100, d.bg),
    tc: hex("tc", d.tc),
    ac: hex("ac", d.ac),
    req: params.get("req") !== "0",
    head: params.get("head") !== "0",
    fw: clampInt(params.get("fw"), 400, 800, d.fw),
    bgc: hex("bgc", d.bgc),
    gap: clampInt(params.get("gp"), 0, 20, d.gap),
    st: params.get("st") !== "0",
    sa: params.get("sa") !== "0",
    sc: params.get("sc") !== "0",
    sn: params.get("sn") !== "0",
  };
}

/** 기본값과 같은 항목은 URL 에서 뺀다 (짧고 읽기 쉬운 주소) */
export function buildQueueOverlayUrl(origin: string, bookId: string, s: QueueOverlaySettings): string {
  const q = new URLSearchParams({ book: bookId });
  const d = DEFAULT_QUEUE_OVERLAY;
  if (s.n !== d.n) q.set("n", String(s.n));
  if (s.fs !== d.fs) q.set("fs", String(s.fs));
  if (s.align !== d.align) q.set("al", s.align);
  if (s.bg !== d.bg) q.set("bg", String(s.bg));
  if (s.tc !== d.tc) q.set("tc", s.tc.slice(1));
  if (s.ac !== d.ac) q.set("ac", s.ac.slice(1));
  if (!s.req) q.set("req", "0");
  if (!s.head) q.set("head", "0");
  if (s.fw !== d.fw) q.set("fw", String(s.fw));
  if (s.bgc !== d.bgc) q.set("bgc", s.bgc.slice(1));
  if (s.gap !== d.gap) q.set("gp", String(s.gap));
  if (!s.st) q.set("st", "0");
  if (!s.sa) q.set("sa", "0");
  if (!s.sc) q.set("sc", "0");
  if (!s.sn) q.set("sn", "0");
  return `${origin}/overlay/queue?${q.toString()}`;
}

export interface QueueView {
  playing: PublicQueueItem | null;
  /** 대기 곡 (표시할 수만큼) */
  upcoming: PublicQueueItem[];
  /** 표시하지 못한 나머지 곡 수 */
  more: number;
}
/** 서버가 준 큐를 화면용으로 나눈다: 재생 중 1곡 + 대기 n곡 (+ 나머지 수). 서버가 playing 을 여러 개 줘도 첫 곡만 재생 중으로 본다. */
export function toQueueView(queue: PublicQueue | null, n: number): QueueView {
  const items = queue?.queue ?? [];
  const playing = items.find((i) => i.status === "playing") ?? null;
  const rest = items.filter((i) => i !== playing);
  return { playing, upcoming: rest.slice(0, n), more: Math.max(0, rest.length - n) };
}

/** 재시도 간격(ms): 성공이면 기본 주기, 연속 실패면 2배씩 늘려 최대 20초 */
export function nextPollDelay(failures: number, baseMs = 4000): number {
  return failures <= 0 ? baseMs : Math.min(20000, baseMs * 2 ** Math.min(failures, 4));
}
