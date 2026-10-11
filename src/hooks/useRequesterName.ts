import { useEffect, useState } from "react";
import { getAdminRequestRepository } from "../services/songRequestRepository";

/**
 * 신청곡 대기열에서 "재생"으로 들어온 경우(?request=<id>) 그 신청자 이름을 읽어, 방송 오버레이에 보여줄 수 있게 한다.
 * - 관리자 로그인 세션(RLS)으로만 읽을 수 있고, 읽지 못하거나 현재 곡과 다른 신청이면 조용히 무시한다 (SongMode 동작에는 영향 없음).
 */
export function useRequesterName(requestId: string | null, songId: string | undefined): string | undefined {
  const [found, setFound] = useState<{ id: string; songId: string; name: string } | null>(null);
  useEffect(() => {
    if (!requestId || !songId) return;
    let alive = true;
    getAdminRequestRepository()
      .get(requestId)
      .then((r) => {
        if (alive && r && r.songId === songId && (r.status === "playing" || r.status === "approved")) setFound({ id: requestId, songId, name: r.requesterName });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [requestId, songId]);
  return found && found.id === requestId && found.songId === songId ? found.name : undefined;
}
