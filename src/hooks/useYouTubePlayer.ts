import { useEffect, useRef, useState } from "react";

// YouTube IFrame Player API의 최소 타입만 선언 (공식 @types 패키지를 새로 추가하지 않기 위함)
interface YTPlayer {
  getCurrentTime(): number;
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

// https://developers.google.com/youtube/iframe_api_reference#onError
// 2=잘못된 매개변수, 5=HTML5 플레이어 오류, 100=영상 없음/비공개,
// 101/150=업로더가 다른 사이트에서 임베드 재생을 막아둔 경우
const EMBED_BLOCKED_ERROR_CODES = new Set([2, 5, 100, 101, 150]);

export interface YouTubePlayerState {
  currentTime: number;
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
 */
export function useYouTubePlayer(
  containerId: string,
  videoId: string | undefined,
  enabled: boolean,
  onEnded?: () => void
): YouTubePlayerState {
  const playerRef = useRef<YTPlayer | null>(null);
  const intervalRef = useRef<number | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackError, setPlaybackError] = useState(false);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;

  useEffect(() => {
    if (!enabled || !videoId) return;
    let cancelled = false;
    setPlaybackError(false);

    loadYouTubeIframeAPI().then(() => {
      if (cancelled || !window.YT) return;

      playerRef.current = new window.YT.Player(containerId, {
        videoId,
        playerVars: { rel: 0 },
        events: {
          onError: (e) => {
            if (EMBED_BLOCKED_ERROR_CODES.has(e.data)) {
              setPlaybackError(true);
            }
          },
          onStateChange: (e) => {
            if (intervalRef.current !== null) {
              window.clearInterval(intervalRef.current);
              intervalRef.current = null;
            }
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
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      playerRef.current?.destroy();
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerId, videoId, enabled]);

  return { currentTime, playbackError };
}
