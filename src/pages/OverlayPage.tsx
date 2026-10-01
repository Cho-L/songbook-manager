import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { OverlayView } from "../components/overlay/OverlayView";
import { parseOverlaySettings } from "../types/overlay";
import {
  LIVE_STALE_MS,
  isValidLiveKey,
  readLive,
  sendLiveAck,
  subscribeLive,
  type LiveState,
  type LiveTarget,
} from "../utils/liveBroadcast";

/**
 * OBS 브라우저 소스용 방송 오버레이 (/overlay?...).
 * 일반 앱 UI 없이 방송 정보만 그리고, 배경은 투명이다. 로그인/토큰이 필요 없다.
 * 표시 설정은 URL 쿼리에서 읽고, 곡 정보는 Supabase Realtime(다른 브라우저/기기) 또는 같은 브라우저 채널로 받는다.
 */
export function OverlayPage() {
  const [params] = useSearchParams();
  const settings = useMemo(() => parseOverlaySettings(params), [params]);
  const bookFilter = params.get("book");
  const liveKey = params.get("lk");

  // 실시간 채널은 노래책 id + 방송 키가 모두 올바를 때만 연다 (키 없는 옛 URL은 같은 브라우저 안에서만 동작)
  const target = useMemo<LiveTarget | undefined>(
    () => (bookFilter && isValidLiveKey(liveKey) ? { bookId: bookFilter, key: liveKey } : undefined),
    [bookFilter, liveKey]
  );

  const [live, setLive] = useState<LiveState | null>(() => readLive());
  const [stale, setStale] = useState(false);
  const [everConnected, setEverConnected] = useState(() => readLive() !== null);
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const liveRef = useRef<LiveState | null>(live);
  // 마지막으로 무언가를 "받은" 시각 — 발신자 시계가 아니라 내 시계 기준이라 기기 간 시계 차이의 영향을 받지 않는다
  const recvAtRef = useRef<number>(Date.now());
  const ackedRef = useRef<Set<string>>(new Set());

  // 방송 캡처에 앱 배경색이 섞이지 않도록 문서 배경을 투명하게, 스크롤은 막는다 (페이지를 떠나면 원복)
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prev = [html.style.background, body.style.background, html.style.overflow, body.style.overflow];
    html.style.background = "transparent";
    body.style.background = "transparent";
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    return () => {
      [html.style.background, body.style.background, html.style.overflow, body.style.overflow] = prev;
    };
  }, []);

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    return subscribeLive((next) => {
      liveRef.current = next;
      recvAtRef.current = Date.now();
      setLive(next);
      setStale(false);
      if (next) setEverConnected(true);
      // 연결 테스트 화면을 실제로 받았으면 설정 화면에 알려준다 (테스트마다 한 번)
      if (next?.mode === "test" && next.song?.id && !ackedRef.current.has(next.song.id)) {
        ackedRef.current.add(next.song.id);
        sendLiveAck({ bookId: next.bookId, key: target?.key }, next.song.id);
      }
    }, target);
  }, [target]);

  // 오래 아무것도 못 받았는지 2초마다 확인 (상태가 그대로면 리렌더 없음)
  useEffect(() => {
    const id = window.setInterval(() => {
      setStale(liveRef.current !== null && Date.now() - recvAtRef.current > LIVE_STALE_MS);
    }, 2000);
    return () => window.clearInterval(id);
  }, []);

  const matches = live !== null && (!bookFilter || live.bookId === bookFilter);
  const active = matches && !stale ? live : null;

  return (
    <div style={{ position: "fixed", inset: 0, background: "transparent" }}>
      <OverlayView state={active} status={everConnected ? "lost" : "waiting"} settings={settings} width={size.w} height={size.h} />
    </div>
  );
}
