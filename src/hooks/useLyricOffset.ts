import { useCallback, useState } from "react";
import { OFFSET_STEP_SEC, clampOffset, readLyricOffset, writeLyricOffset } from "../lyrics/lyricOffset";

/** 곡별 가사 싱크 보정값. 곡이 바뀌면 그 곡의 저장값으로 바뀐다 (이전 곡의 값이 남지 않는다). */
export function useLyricOffset(songId: string | undefined) {
  const [state, setState] = useState(() => ({ songId, offset: readLyricOffset(songId) }));
  // 렌더 중 상태 보정: 곡이 바뀌면 저장된 값을 다시 읽는다
  if (state.songId !== songId) setState({ songId, offset: readLyricOffset(songId) });
  const offset = state.songId === songId ? state.offset : readLyricOffset(songId);

  const set = useCallback(
    (next: number) => {
      if (!songId) return;
      const v = clampOffset(next);
      writeLyricOffset(songId, v);
      setState({ songId, offset: v });
    },
    [songId]
  );
  return {
    offset,
    set,
    nudge: (dir: 1 | -1) => set(offset + dir * OFFSET_STEP_SEC),
    reset: () => set(0),
  };
}
