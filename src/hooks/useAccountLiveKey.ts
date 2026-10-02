import { useEffect } from "react";
import { broadcastRepository } from "../services/broadcastRepository";
import { getLiveKey, isValidLiveKey, setLiveKey } from "../utils/liveBroadcast";

/**
 * 소유자의 방송 키를 "계정 단위"로 맞춘다 (기기/브라우저가 달라도 같은 OBS URL이 동작하게).
 * - 계정에 저장된 키가 있으면 이 브라우저의 키를 그 값으로 맞추고,
 * - 없으면 이 브라우저의 키를 계정에 올린다.
 * 서버를 쓸 수 없으면(로컬 데모, 테이블 미생성, 네트워크 오류) 아무 일도 하지 않고 기존처럼 브라우저별 키로 동작한다.
 * 소유자가 아닌 사람(공개 노래책 방문자)에게는 아무것도 하지 않는다.
 */
export function useAccountLiveKey(ownerId: string | undefined, isOwner: boolean, onKey?: (key: string) => void): void {
  useEffect(() => {
    if (!ownerId || !isOwner) return;
    let cancelled = false;
    void (async () => {
      try {
        const remote = await broadcastRepository.getLiveKey(ownerId);
        if (cancelled) return;
        if (isValidLiveKey(remote)) {
          if (getLiveKey(ownerId) !== remote && setLiveKey(ownerId, remote)) onKey?.(remote);
        } else {
          await broadcastRepository.saveLiveKey(ownerId, getLiveKey(ownerId));
        }
      } catch {
        // 실패해도 방송 기능은 브라우저별 키로 계속 동작한다
      }
    })();
    return () => {
      cancelled = true;
    };
    // onKey는 호출 시점의 최신 함수만 필요하고 재동기화를 일으키면 안 된다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId, isOwner]);
}
