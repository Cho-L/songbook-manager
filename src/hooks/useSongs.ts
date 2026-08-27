import { useCallback, useEffect, useState } from "react";
import type { Song, SongFormInput } from "../types/song";
import { songRepository } from "../services/songRepository";

/**
 * 특정 ownerId(관리자)의 노래책을 다루는 훅.
 * 공개 방문자도 조회는 가능하지만, 추가/수정/삭제는 실제로는
 * 로그인한 본인이 아니면 DB(RLS)에서 거부된다 — 이 훅은 그 결과를 그대로 반영할 뿐,
 * 프론트엔드에서 권한을 "판단"하지는 않는다 (판단은 서버/DB 책임).
 */
export function useSongs(ownerId: string | undefined) {
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!ownerId) {
      setSongs([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await songRepository.getByOwner(ownerId);
      setSongs(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "노래 목록을 불러오지 못했어요.");
    } finally {
      setLoading(false);
    }
  }, [ownerId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const addSong = useCallback(
    async (input: SongFormInput) => {
      if (!ownerId) throw new Error("로그인이 필요해요.");
      const newSong = await songRepository.add(input, ownerId);
      setSongs((prev) => [newSong, ...prev]);
      return newSong;
    },
    [ownerId]
  );

  const updateSong = useCallback(async (id: string, input: SongFormInput) => {
    const updated = await songRepository.update(id, input);
    if (updated) {
      setSongs((prev) => prev.map((s) => (s.id === id ? updated : s)));
    }
    return updated;
  }, []);

  const removeSong = useCallback(async (id: string) => {
    await songRepository.remove(id);
    setSongs((prev) => prev.filter((s) => s.id !== id));
  }, []);

  /** 다중 선택 일괄 삭제. 실패한 곡은 결과에 개수로 알려준다. */
  const removeManySongs = useCallback(async (ids: string[]) => {
    let succeeded = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        await songRepository.remove(id);
        succeeded++;
      } catch (e) {
        console.error("일괄 삭제 실패:", e);
        failed++;
      }
    }
    setSongs((prev) => prev.filter((s) => !ids.includes(s.id)));
    return { succeeded, failed };
  }, []);

  /** "노래책 삭제": 계정은 그대로, songs만 전부 비운다. */
  const removeAllSongs = useCallback(async () => {
    if (!ownerId) throw new Error("대상 노래책이 없어요.");
    await songRepository.removeAllByOwner(ownerId);
    setSongs([]);
  }, [ownerId]);

  const toggleFavorite = useCallback(async (id: string) => {
    const updated = await songRepository.toggleFavorite(id);
    if (updated) {
      setSongs((prev) => prev.map((s) => (s.id === id ? updated : s)));
    }
  }, []);

  return {
    songs,
    loading,
    error,
    addSong,
    updateSong,
    removeSong,
    removeManySongs,
    removeAllSongs,
    toggleFavorite,
    reload,
  };
}
