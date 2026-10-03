import { useEffect, useRef, useState } from "react";

// YouTube IFrame Player API의 최소 타입만 선언 (공식 @types 패키지를 새로 추가하지 않기 위함)
interface YTPlayer {
  getCurrentTime(): number;
  /** 영상 길이(초). 메타데이터가 아직 없으면 0 또는 undefined */
  getDuration?(): number;
  destroy(): void;
}
interface YTPlayerEvent {
  data: number;
}
interface YTPlayerErrorEvent {
  data: number;
}
interface YTNamespace {
  Player: new (
    elementId: string,
    options: {
      videoId: string;
      playerVars?: Record<string, number>;
      events?: {
        onStateChange?: (e: YTPlayerEvent) => void;
        onError?: (e: YTPlayerErrorEvent) => void;
      };
    }
  ) => YTPlayer;
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiLoadPromise: Promise<void> | null = null;

/** YouTube IFrame API 스크립트를 한 번만 로드한다 (여러 컴포넌트가 동시에 써도 중복 삽입 안 함). */
function loadYouTubeIframeAPI(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (apiLoadPromise) return apiLoadPromise;

  apiLoadPromise = new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve();
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
  return apiLoadPromise;
}

const YT_STATE_ENDED = 0;
const YT_STATE_PLAYING = 1;
const YT_STATE_BUFFERING = 3;
const BUFFERING_HANG_TIMEOUT_MS = 8000;

// https://developers.google.com/youtube/iframe_api_reference#onError
// 2=잘못된 매개변수, 5=HTML5 플레이어 오류, 100=영상 없음/비공개,
// 101/150=업로더가 다른 사이트에서 임베드 재생을 막아둔 경우
const EMBED_BLOCKED_ERROR_CODES = new Set([2, 5, 100, 101, 150]);

export interface YouTubePlayerState {
  currentTime: number;
  /** 영상 길이(초). 아직 모르면 0 — MR 길이와 원곡 길이 비교(싱크 보정 안내)에 쓴다 */
  duration: number;
  /** true면 이 영상은 임베드 재생이 막혀있거나 재생할 수 없는 상태 */
  playbackError: boolean;
}

/**
 * 가사 자동 싱크 / 연속재생 / 재생 실패 감지 공용: 지정한 컨테이너에 YouTube
 * 플레이어를 만들고 재생 중일 때만 현재 재생시간을 폴링해서 반환한다.
 * (일시정지/버퍼링/종료 등 재생 중이 아닐 때는 폴링을 멈추고, 그 순간의
 * 시간을 한 번만 반영한다 — seek 직후에도 값이 갱신되도록.)
 *
 * enabled가 false면 플레이어 자체를 만들지 않는다 — 영상이 아예 없는 곡은
 * 이 훅을 활성화하지 않는다.
 *
 * onEnded는 영상이 끝났을 때 한 번 호출된다 (플레이리스트 연속재생용).
 *
 * playbackError는 두 가지 경로로 감지한다:
 * 1) YouTube가 명시적으로 onError를 쏘는 경우 (임베드 금지 등)
 * 2) onError 없이 그냥 버퍼링 상태에서 멈춰버리는 경우 — 일부 차단된 임베드는
 *    에러 이벤트 없이 검은 화면/무한 버�퍼링으로만 나타나서, 버퍼링 상태가
 *    일정 시간(8초) 넘게 재생으로 못 넘어가면 재생 불가로 간주한다.
 *    (아직 재생 버튼을 안 눌러서 대기 중인 정상 영상은 버퍼링 상태 자체에
 *    들어가지 않으므로 이 타임아웃은 오탐이 거의 없다.)
 */
export function useYouTubePlayer(
  containerId: string,
  videoId: string | undefined,
  enabled: boolean,
  onEnded?: () => void
): YouTubePlayerState {
  const playerRef = useRef<YTPlayer | null>(null);
  const intervalRef = useRef<number | null>(null);
  const bufferingTimeoutRef = useRef<number | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackError, setPlaybackError] = useState(false);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;

  useEffect(() => {
    if (!enabled || !videoId) return;
    let cancelled = false;
    setPlaybackError(false);
    // 곡(영상)이 바뀌면 이전 곡의 재생 시간을 버린다 — 안 그러면 새 곡 가사가 이전 곡 시간 기준으로 계산된다.
    setCurrentTime(0);
    setDuration(0);

    function clearBufferingTimeout() {
      if (bufferingTimeoutRef.current !== null) {
        window.clearTimeout(bufferingTimeoutRef.current);
        bufferingTimeoutRef.current = null;
      }
    }

    // 재생 불가로 판정되면: interval/timeout부터 정리하고, React가 DOM을
    // 갈아치우기 전에 YouTube API의 destroy()로 iframe을 먼저 스스로
    // 정리하게 한다. 그 다음에야 React state를 바꿔서 대체 UI로 넘어간다.
    // (순서를 반대로 하면 React가 "div인 줄 알았던" 자리에 이미 YT가
    // 심어둔 iframe이 있어서 재조정 중 DOM이 꼬이고, 검은 화면/먹통
    // 상태가 화면에 그대로 남는 문제가 생겼다.)
    function failPlayback() {
      clearBufferingTimeout();
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      playerRef.current?.destroy();
      playerRef.current = null;
      setPlaybackError(true);
    }

    loadYouTubeIframeAPI().then(() => {
      if (cancelled || !window.YT) return;

      playerRef.current = new window.YT.Player(containerId, {
        videoId,
        playerVars: { rel: 0 },
        events: {
          onError: (e) => {
            if (EMBED_BLOCKED_ERROR_CODES.has(e.data)) {
              failPlayback();
            }
          },
          onStateChange: (e) => {
            if (intervalRef.current !== null) {
              window.clearInterval(intervalRef.current);
              intervalRef.current = null;
            }

            if (e.data === YT_STATE_BUFFERING) {
              clearBufferingTimeout();
              bufferingTimeoutRef.current = window.setTimeout(() => {
                failPlayback();
              }, BUFFERING_HANG_TIMEOUT_MS);
            } else {
              clearBufferingTimeout();
            }

            // 영상 길이는 재생이 시작된 뒤에 확실히 알 수 있다 (MR 길이 ↔ 원곡 길이 비교용, 한 번만 읽는다)
            const d = playerRef.current?.getDuration?.();
            if (typeof d === "number" && d > 0) setDuration(d);

            if (e.data === YT_STATE_PLAYING) {
              intervalRef.current = window.setInterval(() => {
                const t = playerRef.current?.getCurrentTime();
                if (typeof t === "number") setCurrentTime(t);
              }, 300);
            } else {
              // 일시정지/버퍼링(=seek 중)/종료 등: 그 순간 시간을 한 번만 반영
              const t = playerRef.current?.getCurrentTime();
              if (typeof t === "number") setCurrentTime(t);
              if (e.data === YT_STATE_ENDED) {
                onEndedRef.current?.();
              }
            }
          },
        },
      });
    });

    return () => {
      cancelled = true;
      clearBufferingTimeout();
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      playerRef.current?.destroy();
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerId, videoId, enabled]);

  return { currentTime, duration, playbackError };
}
