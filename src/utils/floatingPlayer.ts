/**
 * 플로팅 플레이어의 위치·크기 계산 (화면과 무관한 순수 로직).
 * 크기 기준은 "영상" 너비(w)이고 영상은 항상 16:9. 전체 창 높이 = 헤더 + 영상 + 하단 리사이즈 바.
 */
export interface FloatLayout {
  /** 창 왼쪽 위 모서리 (viewport 기준 px) */
  x: number;
  y: number;
  /** 영상 너비 px (높이는 w * 9/16) */
  w: number;
}

export const FLOAT_DEFAULT_W = 320; // 320×180
export const FLOAT_MIN_W = 240; // 240×135
export const FLOAT_HEADER_H = 32;
export const FLOAT_FOOTER_H = 16;
export const FLOAT_CHROME_H = FLOAT_HEADER_H + FLOAT_FOOTER_H;
export const FLOAT_MARGIN = 8;
export const FLOAT_STORAGE_KEY = "songbook:floating-player:v1";

export const videoHeight = (w: number) => (w * 9) / 16;
export const totalHeight = (w: number) => videoHeight(w) + FLOAT_CHROME_H;

/** 현재 화면에 들어갈 수 있는 가장 큰 영상 너비 (헤더/하단 바/여백 포함) */
export function maxWidthFor(vw: number, vh: number): number {
  return Math.max(1, Math.min(vw - 2 * FLOAT_MARGIN, ((vh - 2 * FLOAT_MARGIN - FLOAT_CHROME_H) * 16) / 9));
}

/** 최소 너비. 화면이 너무 좁으면 최소 크기보다 "화면 안에 보이는 것"을 우선한다 */
export function minWidthFor(vw: number, vh: number): number {
  return Math.min(FLOAT_MIN_W, maxWidthFor(vw, vh));
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** 크기를 허용 범위로, 위치를 화면 안으로 보정한다 */
export function clampLayout(l: FloatLayout, vw: number, vh: number): FloatLayout {
  // 소수 픽셀 때문에 화면을 0.x px 넘지 않도록 내림(floor)한다
  const w = Math.floor(Math.max(minWidthFor(vw, vh), Math.min(maxWidthFor(vw, vh), finite(l.w) ? l.w : FLOAT_DEFAULT_W)));
  const maxX = Math.max(FLOAT_MARGIN, Math.floor(vw - w - FLOAT_MARGIN));
  const maxY = Math.max(FLOAT_MARGIN, Math.floor(vh - totalHeight(w) - FLOAT_MARGIN));
  return {
    w,
    x: Math.floor(Math.max(FLOAT_MARGIN, Math.min(maxX, finite(l.x) ? l.x : maxX))),
    y: Math.floor(Math.max(FLOAT_MARGIN, Math.min(maxY, finite(l.y) ? l.y : maxY))),
  };
}

/** 기본 위치(우하단)와 기본 크기(320×180, 화면이 좁으면 그에 맞춰 축소) */
export function defaultLayout(vw: number, vh: number): FloatLayout {
  const w = Math.max(minWidthFor(vw, vh), Math.min(FLOAT_DEFAULT_W, maxWidthFor(vw, vh)));
  return clampLayout({ w, x: vw - w - 12, y: vh - totalHeight(w) - 12 }, vw, vh);
}

/** 저장된 값을 검증한다 — 형식이 이상하면 null (기본값 사용) */
export function parseStoredLayout(raw: string | null): FloatLayout | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<FloatLayout> | null;
    if (v && finite(v.x) && finite(v.y) && finite(v.w) && v.w > 0) return { x: v.x, y: v.y, w: v.w };
  } catch {
    // ignore
  }
  return null;
}

export function readStoredLayout(): FloatLayout | null {
  try {
    return parseStoredLayout(localStorage.getItem(FLOAT_STORAGE_KEY));
  } catch {
    return null;
  }
}
export function writeStoredLayout(l: FloatLayout): void {
  try {
    localStorage.setItem(FLOAT_STORAGE_KEY, JSON.stringify(l));
  } catch {
    // ignore
  }
}
export function clearStoredLayout(): void {
  try {
    localStorage.removeItem(FLOAT_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** 드래그 이동: 시작 위치에서 (dx, dy)만큼, 화면 밖으로 나가지 않게 */
export function moveLayout(start: FloatLayout, dx: number, dy: number, vw: number, vh: number): FloatLayout {
  return clampLayout({ ...start, x: start.x + dx, y: start.y + dy }, vw, vh);
}

/**
 * 우하단 모서리 드래그 크기 조절: 왼쪽 위 모서리는 고정하고 16:9를 유지한다.
 * 너비 변화(dx)와 높이 변화(dy)를 너비로 환산해 더 크게 움직인 쪽을 따른다.
 */
export function resizeLayout(start: FloatLayout, dx: number, dy: number, vw: number, vh: number): FloatLayout {
  const delta = Math.abs(dx) >= Math.abs((dy * 16) / 9) ? dx : (dy * 16) / 9;
  const roomX = vw - start.x - FLOAT_MARGIN;
  const roomY = ((vh - start.y - FLOAT_MARGIN - FLOAT_CHROME_H) * 16) / 9;
  const maxHere = Math.min(maxWidthFor(vw, vh), roomX, roomY);
  const w = Math.max(minWidthFor(vw, vh), Math.min(maxHere, start.w + delta));
  return clampLayout({ ...start, w }, vw, vh);
}

/** 키보드 이동 (방향키) */
export function nudgeLayout(l: FloatLayout, dx: number, dy: number, vw: number, vh: number): FloatLayout {
  return moveLayout(l, dx, dy, vw, vh);
}
