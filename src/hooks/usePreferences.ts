import { useCallback, useEffect, useState } from "react";
import { preferencesRepository } from "../services/preferencesRepository";
import { DEFAULT_PREFERENCES, type UserPreferences } from "../types/preferences";

export function usePreferences(userId: string | undefined) {
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setPreferences(DEFAULT_PREFERENCES);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    preferencesRepository
      .get(userId)
      .then((p) => {
        if (active) setPreferences(p);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userId]);

  const update = useCallback(
    async (patch: Partial<UserPreferences>) => {
      if (!userId) return;
      // 낙관적 업데이트: 저장 요청 결과를 기다리지 않고 화면에 즉시 반영
      setPreferences((prev) => ({ ...prev, ...patch }));
      try {
        const saved = await preferencesRepository.update(userId, patch);
        setPreferences(saved);
      } catch {
        // 저장 실패해도 화면 표시는 유지 — 다음 방문 때 기본값으로 되돌아갈 수 있음을 감수
      }
    },
    [userId]
  );

  return { preferences, loading, update };
}
