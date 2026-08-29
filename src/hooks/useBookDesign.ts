import { useCallback, useEffect, useState } from "react";
import { bookDesignRepository } from "../services/bookDesignRepository";
import { DEFAULT_BOOK_DESIGN, type BookDesign } from "../types/bookDesign";

export function useBookDesign(ownerId: string | undefined) {
  const [design, setDesign] = useState<BookDesign>(DEFAULT_BOOK_DESIGN);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ownerId) {
      setDesign(DEFAULT_BOOK_DESIGN);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    bookDesignRepository
      .get(ownerId)
      .then((d) => {
        if (active) setDesign(d);
      })
      .catch((e) => {
        console.error("노래책 디자인 불러오기 실패:", e);
        if (active) setError(e instanceof Error ? e.message : "디자인을 불러오지 못했어요.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [ownerId]);

  const update = useCallback(
    async (patch: Partial<BookDesign>) => {
      if (!ownerId) return;
      // 낙관적 업데이트 — Preview에 바로 반영
      setDesign((prev) => ({ ...prev, ...patch }));
      try {
        const saved = await bookDesignRepository.update(ownerId, patch);
        setDesign(saved);
        setError(null);
      } catch (e) {
        console.error("노래책 디자인 저장 실패:", e);
        setError(e instanceof Error ? e.message : "디자인 저장에 실패했어요.");
      }
    },
    [ownerId]
  );

  return { design, loading, error, update };
}
