import { useEffect } from "react";
import { clearLive, LIVE_HEARTBEAT_MS, publishLive, type LiveStateInput } from "../utils/liveBroadcast";

/**
 * SongMode/ConcertMode가 현재 상태를 오버레이로 내보낸다.
 * - state가 실제로 바뀔 때(곡 변경, 가사 줄 변경 등)만 즉시 전송하고, 그 사이에는 5초마다 heartbeat만 보낸다.
 * - 화면을 벗어나면(언마운트) 상태를 지워서 오버레이에 이전 곡이 남지 않게 한다.
 * - state가 null이면(로딩 중 등) 아무것도 보내지 않는다.
 */
export function useLivePublisher(state: LiveStateInput | null): void {
  const key = state ? JSON.stringify(state) : "";

  useEffect(() => {
    if (!state) return;
    publishLive(state);
    const id = window.setInterval(() => publishLive(state, "heartbeat"), LIVE_HEARTBEAT_MS);
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
