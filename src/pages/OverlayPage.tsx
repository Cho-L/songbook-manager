import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { OverlayView } from "../components/overlay/OverlayView";
import { useOverlayConfig } from "../hooks/useOverlayConfig";
import { constrainOverlay } from "../utils/overlayStudio";
import { parseOverlaySettings, sanitizeOverlaySettings, type OverlaySettings } from "../types/overlay";
import {
  LIVE_STALE_MS,
  isValidLiveKey,
  readLive,
  readOverlaySettingsCache,
  readReceivedSettings,
  requestOverlaySettings,
  saveReceivedSettings,
  sendLiveAck,
  sendOverlaySettingsAck,
  subscribeLive,
  subscribeLiveStatus,
  subscribeSettingsChannel,
  type LiveState,
  type LiveTarget,
} from "../utils/liveBroadcast";

/** OBS가 "아직 연결돼 있어요"를 설정 화면에 알리는 간격 (연결된 OBS 수/적용 확인 표시용, 곡 상태 heartbeat와는 별개) */
const PRESENCE_MS = 10000;

/**
 * OBS 브라우저 소스용 방송 오버레이 (/overlay?...).
 * 일반 앱 UI 없이 방송 정보만 그리고, 배경은 투명이다. 로그인/토큰이 필요 없다.
 * 표시 설정은 URL 쿼리에서 읽고, 곡 정보는 Supabase Realtime(다른 브라우저/기기) 또는 같은 브라우저 채널로 받는다.
 */
export function OverlayPage({ kind }: { kind?: "song" | "lyrics" } = {}) {
  const [params] = useSearchParams();
  // URL에 들어 있는 설정은 "처음 모습"일 뿐이다. 설정 화면에서 보낸 최신 설정이 오면 그것으로 바뀐다 (OBS URL을 다시 만들 필요 없음).
  const urlSettings = useMemo(() => parseOverlaySettings(params), [params]);
  const bookFilter = params.get("book");
  const liveKey = params.get("lk");
  // fx=1: 이 URL의 디자인에 고정 (실시간 설정 동기화를 따르지 않는다). 서로 다른 디자인의 오버레이를 같이 쓰고 싶을 때만 사용.
  // kind(= /overlay/song, /overlay/lyrics 독립 주소)는 설정 화면의 실시간 설정 동기화를 따르지 않는다 (종류별 저장 설정/URL 설정만 사용)
  const fixed = params.get("fx") === "1" || kind !== undefined;
  // cfg=1: Overlay Studio 에 저장된 설정을 불러온다. 옛 /overlay 주소는 이 경로를 전혀 타지 않는다 (요청 없음).
  const useSaved = kind !== undefined && params.get("cfg") === "1";
  const saved = useOverlayConfig(kind ?? "song", bookFilter, useSaved);

  // 실시간 채널은 노래책 id + 방송 키가 모두 올바를 때만 연다 (키 없는 옛 URL은 같은 브라우저 안에서만 동작)
  const target = useMemo<LiveTarget | undefined>(
    () => (bookFilter && isValidLiveKey(liveKey) ? { bookId: bookFilter, key: liveKey } : undefined),
    [bookFilter, liveKey]
  );

  // 설정 우선순위: Realtime으로 받은 최신 설정 > OBS가 마지막으로 받아 둔 설정(새로고침해도 유지) > URL 설정 > 기본값.
  // 같은 브라우저에서 열었을 때는 설정 화면이 저장해 둔 최신 설정도 후보에 넣고, 버전이 가장 큰 것을 쓴다.
  const [applied, setApplied] = useState<{ settings: OverlaySettings; ver: number }>(() => {
    if (fixed || !bookFilter) return { settings: urlSettings, ver: 0 };
    const candidates = [readReceivedSettings({ bookId: bookFilter, key: liveKey }), readOverlaySettingsCache(bookFilter)].filter(
      (c): c is NonNullable<typeof c> => c !== null
    );
    const best = candidates.sort((a, b) => b.ver - a.ver)[0];
    return best ? { settings: sanitizeOverlaySettings(best.settings), ver: best.ver } : { settings: urlSettings, ver: 0 };
  });
  const settings = kind ? constrainOverlay(kind, saved.config ? saved.config.overlay : urlSettings) : fixed ? urlSettings : applied.settings;
  const box = useSaved ? saved.config?.box : undefined;
  const verRef = useRef(applied.ver);
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

  // 설정 동기화: 설정 화면(또는 방송 중인 화면)이 보내는 최신 설정을 받는다. 버전이 더 큰 것만 적용해서 오래된 설정이 최신 설정을 덮지 못한다.
  useEffect(() => {
    if (fixed || !bookFilter) return;
    const settingsTarget = { bookId: bookFilter, key: target?.key };
    const off = subscribeSettingsChannel(settingsTarget, {
      onSettings: (raw, ver) => {
        if (ver <= verRef.current) {
          sendOverlaySettingsAck(settingsTarget, verRef.current); // 이미 적용한 버전: 확인만 다시 알려준다
          return;
        }
        verRef.current = ver;
        const next = sanitizeOverlaySettings(raw);
        setApplied({ settings: next, ver });
        saveReceivedSettings(settingsTarget, { ver, settings: next });
        sendOverlaySettingsAck(settingsTarget, ver);
      },
    });
    // 연결되면 현재 설정을 요청하고(설정 화면이 열려 있으면 바로 응답), 이후에는 10초마다 "살아 있어요"만 알린다
    const offStatus = target
      ? subscribeLiveStatus(target, (status) => {
          if (status === "connected") requestOverlaySettings(settingsTarget);
        })
      : (requestOverlaySettings(settingsTarget), () => undefined);
    sendOverlaySettingsAck(settingsTarget, verRef.current);
    const ping = window.setInterval(() => sendOverlaySettingsAck(settingsTarget, verRef.current), PRESENCE_MS);
    return () => {
      off();
      offStatus();
      window.clearInterval(ping);
    };
  }, [fixed, bookFilter, target]);

  // 오래 아무것도 못 받았는지 2초마다 확인 (상태가 그대로면 리렌더 없음)
  useEffect(() => {
    const id = window.setInterval(() => {
      setStale(liveRef.current !== null && Date.now() - recvAtRef.current > LIVE_STALE_MS);
    }, 2000);
    return () => window.clearInterval(id);
  }, []);

  const matches = live !== null && (!bookFilter || live.bookId === bookFilter);
  const active = matches && !stale ? live : null;

  const inset = box ? box.padding + box.borderW : 0;
  const view = <OverlayView state={active} status={everConnected ? "lost" : "waiting"} settings={settings} width={Math.max(1, size.w - 2 * inset)} height={Math.max(1, size.h - 2 * inset)} />;
  return (
    <div style={{ position: "fixed", inset: 0, background: "transparent" }}>
      {box ? (
        <div
          data-testid="overlay-frame"
          style={{
            position: "absolute",
            inset: 0,
            boxSizing: "border-box",
            overflow: "hidden",
            padding: box.padding,
            borderRadius: box.radius,
            border: box.borderW > 0 ? `${box.borderW}px solid ${box.borderColor}` : "none",
          }}
        >
          <div style={{ position: "relative", width: "100%", height: "100%" }}>{view}</div>
        </div>
      ) : (
        view
      )}
    </div>
  );
}
