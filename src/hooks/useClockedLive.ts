import { useEffect, useState, type MutableRefObject } from "react";
import type { LiveState } from "../utils/liveBroadcast";
import { clockedLineIndex, hasClock, msToNextLine } from "../utils/liveClock";

/** 현재 시각 (렌더 중 직접 Date.now 를 부르지 않기 위한 얇은 래퍼 — 시계 보간은 의도적으로 "지금" 에 의존한다) */
const clockNow = (): number => Date.now();

/**
 * OBS 용: 받은 재생 위치를 보간해서 현재 가사 줄(lineIndex)을 계산한다. 원문과 발음은 같은 lineIndex 를 쓰므로 함께 바뀐다.
 * 시계 정보가 없으면 받은 상태를 그대로 돌려준다 (예전 발신자 / 타임스탬프 없는 곡 / 재생 시간 미제공).
 * 줄이 바뀔 시각에만 타이머를 걸어 다시 그린다 (매 프레임 갱신하지 않는다).
 */
export function useClockedLive(state: LiveState | null, recvAtRef: MutableRefObject<number>): LiveState | null {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!state || !hasClock(state)) return;
    const wait = msToNextLine(state, clockNow(), recvAtRef.current);
    if (wait === null) return;
    const id = window.setTimeout(() => setTick((n) => n + 1), Math.min(Math.max(wait + 20, 30), 2000));
    return () => window.clearTimeout(id);
    // recvAtRef 는 새 메시지가 올 때 state 도 함께 바뀌므로 state 만 의존성으로 둔다. tick 은 줄이 바뀐 뒤 다음 타이머를 다시 걸기 위한 것
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, tick]);

  if (!state) return state;
  const idx = clockedLineIndex(state, clockNow(), recvAtRef.current);
  return idx === null || idx === state.lineIndex ? state : { ...state, lineIndex: idx };
}
