import { useCallback, useEffect, useState } from "react";
import { preferencesRepository } from "../services/preferencesRepository";
import { DEFAULT_PREFERENCES, type UserPreferences } from "../types/preferences";

export function usePreferences(userId: string | undefined) {
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) {
      setPreferences(DEFAULT_PREFERENCES);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    preferencesRepository
      .get(userId)
      .then((p) => {
        if (active) setPreferences(p);
      })
      .catch((e) => {
        console.error("설정 불러오기 실패:", e);
        if (active) {
          setError(e instanceof Error ? e.message : "설정을 불러오지 못했어요.");
        }
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
        setError(null);
      } catch (e) {
        // 저장 실패는 더 이상 조용히 넘어가지 않는다 — 콘솔 + 화면에 남긴다.
        console.error("설정 저장 실패:", e);
        setError(e instanceof Error ? e.message : "설정 저장에 실패했어요.");
      }
    },
    [userId]
  );

  return { preferences, loading, error, update };
}
