import { useCallback, useEffect, useState } from "react";
import { favoriteRepository } from "../services/favoriteRepository";

export function useFavorites(userId: string | undefined) {
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!userId) {
      setFavoriteIds(new Set());
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const ids = await favoriteRepository.listForUser(userId);
      setFavoriteIds(ids);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const toggle = useCallback(
    async (songId: string) => {
      if (!userId) return; // 로그인 안 한 방문자는 호출하지 않도록 UI에서 막는다
      if (loading) return; // 초기 즐겨찾기 목록을 아직 못 받아온 상태의 클릭은 무시 (오판 방지)
      const isFav = favoriteIds.has(songId);
      // 낙관적 업데이트로 즉시 반영, 실패하면 되돌린다.
      setFavoriteIds((prev) => {
        const next = new Set(prev);
        if (isFav) {
          next.delete(songId);
        } else {
          next.add(songId);
        }
        return next;
      });
      try {
        if (isFav) {
          await favoriteRepository.remove(userId, songId);
        } else {
          await favoriteRepository.add(userId, songId);
        }
      } catch (e) {
        // 원인 파악을 위해 반드시 콘솔에 남긴다 (조용히 되돌리기만 하면 디버깅 불가능).
        console.error("즐겨찾기 저장 실패:", e);
        setFavoriteIds((prev) => {
          const next = new Set(prev);
          if (isFav) {
            next.add(songId);
          } else {
            next.delete(songId);
          }
          return next;
        });
      }
    },
    [userId, favoriteIds, loading]
  );

  return { favoriteIds, loading, toggle };
}
