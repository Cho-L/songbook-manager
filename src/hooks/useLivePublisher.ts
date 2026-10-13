import { useEffect, useRef } from "react";
import { clearLive, LIVE_HEARTBEAT_MS, publishLive, type LiveStateInput } from "../utils/liveBroadcast";

/**
 * SongMode/ConcertMode가 현재 상태를 오버레이로 내보낸다.
 * - state가 실제로 바뀔 때(곡 변경, 가사 줄 변경 등)만 즉시 전송하고, 그 사이에는 5초마다 heartbeat만 보낸다.
 * - 화면을 벗어나면(언마운트) 상태를 지워서 오버레이에 이전 곡이 남지 않게 한다.
 * - state가 null이면(로딩 중 등) 아무것도 보내지 않는다.
 */
/** 재생 위치 시계: 호출한 순간의 MR 재생 위치(초)와 재생 속도. 알 수 없으면 null */
export type LiveClock = () => { pos: number; rate: number } | null;
/** 재생 중에 위치를 다시 알려 주는 간격 — OBS 가 받은 시각 기준으로 보간하다가 이때마다 보정된다 */
export const LIVE_CLOCK_MS = 2000;

export function useLivePublisher(state: LiveStateInput | null, clock?: LiveClock): void {
  const key = state ? JSON.stringify(state) : "";
  const clockRef = useRef<LiveClock | undefined>(clock);
  clockRef.current = clock;

  useEffect(() => {
    if (!state) return;
    // 위치(pos)는 key 에 넣지 않는다 (계속 바뀌므로). 대신 보내는 순간 시계를 읽어 붙인다.
    const withClock = (): LiveStateInput => {
      const c = clockRef.current?.();
      return c ? { ...state, pos: Math.round(c.pos * 100) / 100, rate: c.rate } : state;
    };
    publishLive(withClock());
    // 재생 중이면 2초마다, 아니면 5초마다 (일시정지/정지 상태는 위치가 안 변하므로 드물게)
    const period = state.playback === "playing" && state.times?.length ? LIVE_CLOCK_MS : LIVE_HEARTBEAT_MS;
    const id = window.setInterval(() => publishLive(withClock(), "heartbeat"), period);
    return () => window.clearInterval(id);
    // state는 key(JSON)가 같으면 내용도 같으므로 key만 의존성으로 쓴다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // 화면 이동(언마운트)뿐 아니라 탭 닫기/새로고침에서도 상태를 지운다 — 이때는 React 정리 함수가 실행되지 않는다.
  useEffect(() => {
    window.addEventListener("pagehide", clearLive);
    return () => {
      window.removeEventListener("pagehide", clearLive);
      clearLive();
    };
  }, []);
}
