import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import {
  clampLayout,
  clearStoredLayout,
  defaultLayout,
  moveLayout,
  readStoredLayout,
  resizeLayout,
  writeStoredLayout,
  type FloatLayout,
} from "../utils/floatingPlayer";

interface Gesture {
  kind: "move" | "resize";
  pointerId: number;
  startX: number;
  startY: number;
  start: FloatLayout;
  last: FloatLayout;
}

/**
 * 플로팅 플레이어의 위치·크기 상태.
 * - 이동/크기 조절은 핸들 요소의 Pointer Events + setPointerCapture 로만 처리한다 (마우스/터치 공통).
 *   포인터가 캡처되므로 iframe 위를 지나도 이벤트를 뺏기지 않고, window 전역 리스너가 없어서 정리할 것도 없다.
 * - 값은 localStorage 에 저장(검증 포함)하고, 창 크기가 바뀌면 화면 안으로 다시 보정한다.
 * - 이 훅은 레이아웃 숫자만 다룬다. iframe/플레이어 요소에는 전혀 관여하지 않는다.
 */
export function useFloatingPlayerLayout(active: boolean) {
  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const [raw, setRaw] = useState<FloatLayout | null>(() => readStoredLayout());
  const layout = useMemo(() => clampLayout(raw ?? defaultLayout(vp.w, vp.h), vp.w, vp.h), [raw, vp]);
  const layoutRef = useRef(layout);
  const gesture = useRef<Gesture | null>(null);

  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  function begin(kind: Gesture["kind"], e: PointerEvent<HTMLElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = { kind, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, start: layoutRef.current, last: layoutRef.current };
  }
  function update(e: PointerEvent<HTMLElement>) {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    e.preventDefault();
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    const w = window.innerWidth;
    const h = window.innerHeight;
    g.last = g.kind === "move" ? moveLayout(g.start, dx, dy, w, h) : resizeLayout(g.start, dx, dy, w, h);
    setRaw(g.last);
  }
  function end(e: PointerEvent<HTMLElement>) {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gesture.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    writeStoredLayout(g.last);
  }

  const handlers = (kind: Gesture["kind"]) => ({
    onPointerDown: (e: PointerEvent<HTMLElement>) => begin(kind, e),
    onPointerMove: update,
    onPointerUp: end,
    onPointerCancel: end,
  });

  const dragHandlers = {
    ...handlers("move"),
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      const step = e.shiftKey ? 48 : 16;
      const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const v = d[e.key];
      if (!v) return;
      e.preventDefault();
      const next = moveLayout(layoutRef.current, v[0], v[1], window.innerWidth, window.innerHeight);
      setRaw(next);
      writeStoredLayout(next);
    },
  };

  return {
    /** 지금 화면에 적용되는 (보정된) 위치·크기 */
    layout,
    active,
    dragHandlers,
    resizeHandlers: handlers("resize"),
    /** 기본 위치(우하단)·기본 크기(320×180)로 되돌리고 저장값을 지운다 */
    reset: () => {
      clearStoredLayout();
      setRaw(null);
    },
  };
}
