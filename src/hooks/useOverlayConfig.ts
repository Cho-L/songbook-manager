import { useEffect, useRef, useState } from "react";
import { CONFIG_CHANGED_CHANNEL, fetchPublicOverlayConfig } from "../services/overlayConfigRepository";
import type { OverlayKind, StudioConfig } from "../utils/overlayStudio";

/** 저장 설정 확인 주기. 설정은 자주 안 바뀌므로 대기열(4초)보다 느리게, 요청 수를 줄인다. */
export const CONFIG_POLL_MS = 15000;

/**
 * OBS 화면용: 저장된 Overlay Studio 설정을 불러와 최신으로 유지한다.
 * - enabled=false(cfg=1 이 아닌 옛 URL)이면 아무 요청도 하지 않는다.
 * - 실패하면 마지막 정상 설정을 그대로 쓴다 (화면이 깜빡이거나 기본값으로 돌아가지 않는다).
 * - 같은 브라우저에서 Studio 가 저장하면 즉시, 그 밖에는 15초 안에 반영된다. 탭이 숨겨져 있으면 쉰다.
 */
export function useOverlayConfig(kind: OverlayKind, book: string | null, enabled: boolean, pollMs = CONFIG_POLL_MS): { config: StudioConfig | null; loaded: boolean } {
  const [state, setState] = useState<{ config: StudioConfig | null; loaded: boolean }>({ config: null, loaded: false });
  const revRef = useRef(-1);

  useEffect(() => {
    if (!enabled || !book) return;
    let stopped = false;
    let inflight = false;
    const load = async () => {
      if (inflight || stopped) return;
      inflight = true;
      try {
        const r = await fetchPublicOverlayConfig(book, kind);
        if (stopped) return;
        // 서버 버전이 같으면(로컬 모드는 항상 0) 내용을 비교해 바뀐 경우만 갱신 → 불필요한 리렌더 없음
        const same = r.rev === revRef.current && r.rev > 0;
        revRef.current = r.rev;
        if (!same) setState((prev) => (JSON.stringify(prev.config) === JSON.stringify(r.config) && prev.loaded ? prev : { config: r.config, loaded: true }));
      } catch {
        /* 마지막 정상 설정 유지. 첫 로드 실패라면 loaded=false 로 두어 URL 설정/기본값으로 먼저 보여준다 */
      } finally {
        inflight = false;
      }
    };
    void load();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, pollMs);
    const wake = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", wake);
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel(CONFIG_CHANGED_CHANNEL);
      bc.onmessage = (e) => {
        if (e.data?.book === book && e.data?.kind === kind) void load();
      };
    } catch {
      /* 주기 확인만 사용 */
    }
    return () => {
      stopped = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", wake);
      bc?.close();
    };
  }, [kind, book, enabled, pollMs]);

  return state;
}
