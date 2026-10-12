import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getPublicRequestClient } from "../services/songRequestRepository";
import { type PublicQueue } from "../utils/songRequest";
import { QueueOverlayView } from "../components/overlay/QueueOverlayView";
import { useOverlayConfig } from "../hooks/useOverlayConfig";
import { nextPollDelay, parseQueueOverlay } from "../utils/queueOverlay";

/** 이 시간 이상 새 데이터를 못 받으면 화면 구석에 "연결 확인 중" 점을 보여준다 (목록 자체는 마지막 값을 유지) */
const DEFAULT_POLL_MS = 4000;

/**
 * OBS 브라우저 소스용 "신청곡 대기열" 오버레이 (/overlay/queue?book=<노래책 id>).
 * 로그인/토큰이 필요 없다. 시청자 신청 페이지와 같은 공개 서버 API(/api/song-requests)만 읽으며,
 * 그 응답에는 승인/재생 중인 곡의 제목·가수·신청자 표시명만 들어 있다 (DB 키/해시/관리자 정보 없음).
 * 갱신: 4초마다 조회 + 관리자 화면이 같은 브라우저에서 열려 있으면 변경 즉시 알림(BroadcastChannel).
 * 연결이 끊기면 마지막 목록을 유지하고 재시도 간격을 늘리며, 돌아오면(온라인/탭 활성화) 즉시 다시 동기화한다.
 */
export function QueueOverlayPage() {
  const [params] = useSearchParams();
  const book = params.get("book");
  const urlSettings = useMemo(() => parseQueueOverlay(params), [params]);
  // cfg=1 (Overlay Studio 주소): 저장된 설정을 불러와 쓴다. 못 불러오는 동안/저장된 게 없으면 URL 설정(없으면 기본값)으로 보여준다.
  // cfg 가 없는 옛 주소는 예전과 똑같이 URL 만 쓰고, 설정 요청을 아예 하지 않는다.
  const useSaved = params.get("cfg") === "1";
  const saved = useOverlayConfig("queue", book, useSaved);
  const settings = saved.config ? saved.config.queue : urlSettings;
  const box = useSaved ? (saved.config ? saved.config.box : undefined) : undefined;
  const client = useMemo(() => getPublicRequestClient(), []);
  const [queue, setQueue] = useState<PublicQueue | null>(null);
  const [stale, setStale] = useState(false);
  const okAtRef = useRef(0);
  // pm= 조회 주기(ms, 500~60000): 기본 4초. 점검/테스트용 숨은 옵션
  const pmRaw = Number(params.get("pm"));
  const pollMs = Number.isFinite(pmRaw) && pmRaw >= 500 ? Math.min(60000, Math.round(pmRaw)) : DEFAULT_POLL_MS;
  const staleMs = pollMs * 5;

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
    if (!book) return; // 잘못된 id 는 서버가 거절한다 (연결 확인 중 표시)
    let stopped = false;
    let timer = 0;
    let failures = 0;
    let inflight = false;
    const schedule = () => {
      window.clearTimeout(timer);
      if (!stopped) timer = window.setTimeout(() => void load(), nextPollDelay(failures, pollMs));
    };
    const load = async () => {
      if (inflight || stopped) return;
      inflight = true;
      try {
        const q = await client.getQueue(book);
        if (stopped) return;
        failures = 0;
        okAtRef.current = Date.now();
        setQueue(q);
        setStale(false);
      } catch {
        failures += 1;
        if (okAtRef.current && Date.now() - okAtRef.current > staleMs) setStale(true);
        else if (!okAtRef.current && failures >= 3) setStale(true);
      } finally {
        inflight = false;
        schedule();
      }
    };
    void load();
    const wake = () => {
      if (document.visibilityState === "visible") {
        failures = 0;
        void load();
      }
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel("songbook-request-queue");
      bc.onmessage = (e) => {
        if (e.data === book) void load();
      };
    } catch {
      /* BroadcastChannel 미지원: 주기 조회만 사용 */
    }
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      bc?.close();
    };
  }, [book, client, pollMs, staleMs]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "transparent" }}>
      {!book ? <div style={{ padding: 12, color: "#fff", textShadow: "0 1px 3px rgba(0,0,0,.7)" }}>주소에 book= 이 없어요</div> : <QueueOverlayView queue={queue} settings={settings} box={box} stale={stale} />}
    </div>
  );
}
