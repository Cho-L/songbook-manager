import type { LiveState } from "./liveBroadcast";

/**
 * OBS 쪽 가사 시계 (순수 함수).
 * SongMode 가 보낸 "발신 순간의 재생 위치(pos)"를 OBS 가 **받은 시각** 기준으로 앞으로 진행시켜 줄 전환 시점을 스스로 계산한다.
 * - 발신자/수신자 시계를 비교하지 않는다 (기기 간 시계 차이의 영향 없음). 대신 네트워크 편도 지연만큼은 뒤처진다.
 * - playing 일 때만 진행한다. paused/waiting(버퍼링)은 마지막 위치에 멈춰 있는다.
 * - 메시지가 끊겨도 무한히 진행하지 않는다: 마지막 수신 후 MAX_EXTRAPOLATE_SEC 까지만 진행하고 멈춘다 (오버레이 자체는 LIVE_STALE_MS 뒤 사라진다).
 * 재생 시간 정보가 없는 발신자(예전 버전)/타임스탬프 없는 곡이면 null — 호출한 쪽은 기존 lineIndex 를 그대로 쓴다.
 */
export const MAX_EXTRAPOLATE_SEC = 12;

type ClockState = Pick<LiveState, "synced" | "lines" | "times" | "pos" | "rate" | "playback">;

export function hasClock(s: ClockState): s is ClockState & { times: number[]; pos: number } {
  return Boolean(s.synced && s.times && s.times.length === s.lines.length && s.times.length > 0 && typeof s.pos === "number" && Number.isFinite(s.pos));
}

export function clockPos(s: ClockState, nowMs: number, recvMs: number): number | null {
  if (!hasClock(s)) return null;
  if (s.playback !== "playing") return s.pos;
  const rate = s.rate && s.rate > 0 && s.rate <= 4 ? s.rate : 1;
  const elapsed = Math.max(0, Math.min((nowMs - recvMs) / 1000, MAX_EXTRAPOLATE_SEC));
  return s.pos + elapsed * rate;
}

/** times[i] <= pos 인 마지막 i (없으면 -1). times 는 오름차순이라고 가정하지 않는다 (LRC 가 어긋난 경우에도 마지막으로 지난 줄) */
export function indexAt(times: number[], pos: number): number {
  let r = -1;
  for (let i = 0; i < times.length; i++) if (times[i] <= pos) r = i;
  return r;
}

export function clockedLineIndex(s: ClockState, nowMs: number, recvMs: number): number | null {
  const pos = clockPos(s, nowMs, recvMs);
  return pos === null || !hasClock(s) ? null : indexAt(s.times, pos);
}

/** 다음 줄이 시작될 때까지 남은 시간(ms). playing 이 아니거나 더 이상 줄이 없으면 null */
export function msToNextLine(s: ClockState, nowMs: number, recvMs: number): number | null {
  if (!hasClock(s) || s.playback !== "playing") return null;
  const pos = clockPos(s, nowMs, recvMs) as number;
  const rate = s.rate && s.rate > 0 && s.rate <= 4 ? s.rate : 1;
  let next = Infinity;
  for (const t of s.times) if (t > pos && t < next) next = t;
  return Number.isFinite(next) ? ((next - pos) / rate) * 1000 : null;
}
