import { useCallback, useEffect, useRef, useState } from "react";

// 최신 브라우저 타입에는 있지만 프로젝트 lib 설정에 따라 없을 수 있어 최소 타입만 선언
interface WakeLockSentinelLike {
  release(): Promise<void>;
}
interface WakeLockApiLike {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
}

function getWakeLockApi(): WakeLockApiLike | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as unknown as { wakeLock?: WakeLockApiLike }).wakeLock;
}

/**
 * 화면 꺼짐 방지 토글. Wake Lock API를 지원하지 않는 브라우저에서는
 * isSupported가 false로 내려가고, 켜려고 하면 에러 없이 조용히 실패한다.
 */
export function useWakeLock() {
  const [enabled, setEnabled] = useState(false);
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);
  const isSupported = Boolean(getWakeLockApi());

  const release = useCallback(async () => {
    try {
      await sentinelRef.current?.release();
    } catch {
      // 이미 해제됐거나 지원 안 하는 경우 - 무시
    }
    sentinelRef.current = null;
    setEnabled(false);
  }, []);

  const toggle = useCallback(async () => {
    if (enabled) {
      await release();
      return;
    }
    const api = getWakeLockApi();
    if (!api) {
      alert("이 브라우저에서는 화면 꺼짐 방지를 지원하지 않아요.");
      return;
    }
    try {
      sentinelRef.current = await api.request("screen");
      setEnabled(true);
      alert("화면 유지가 켜졌습니다. 노래 부르는 동안 화면이 자동으로 꺼지지 않아요.");
    } catch {
      setEnabled(false);
      alert("화면 유지 기능을 활성화하지 못했습니다.");
    }
  }, [enabled, release]);

  // 탭이 다시 보이게 될 때 wake lock이 브라우저에 의해 자동 해제되어 있을 수 있어 재요청
  useEffect(() => {
    function handleVisibilityChange() {
      if (enabled && document.visibilityState === "visible" && !sentinelRef.current) {
        const api = getWakeLockApi();
        api
          ?.request("screen")
          .then((s) => {
            sentinelRef.current = s;
          })
          .catch(() => setEnabled(false));
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [enabled]);

  useEffect(() => {
    return () => {
      sentinelRef.current?.release().catch(() => {});
    };
  }, []);

  return { enabled, isSupported, toggle };
}
