import { useCallback, useEffect, useState } from "react";
import { playlistRepository } from "../services/playlistRepository";
import type { Playlist } from "../types/playlist";

export function usePlaylists(ownerId: string | undefined) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!ownerId) {
      setPlaylists([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setPlaylists(await playlistRepository.listByOwner(ownerId));
    } finally {
      setLoading(false);
    }
  }, [ownerId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const createPlaylist = useCallback(
    async (name: string) => {
      if (!ownerId) throw new Error("로그인이 필요해요.");
      const created = await playlistRepository.create(ownerId, name);
      setPlaylists((prev) => [...prev, created]);
      return created;
    },
    [ownerId]
  );

  const removePlaylist = useCallback(async (id: string) => {
    await playlistRepository.remove(id);
    setPlaylists((prev) => prev.filter((p) => p.id !== id));
  }, []);

  return { playlists, loading, createPlaylist, removePlaylist, reload };
}

/** 특정 플레이리스트에 속한 songId를 순서대로 반환 */
export function usePlaylistSongIds(playlistId: string | undefined) {
  const [songIds, setSongIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!playlistId) {
      setSongIds([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const entries = await playlistRepository.listSongEntries(playlistId);
      setSongIds(entries.map((e) => e.songId));
    } finally {
      setLoading(false);
    }
  }, [playlistId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const addSong = useCallback(
    async (songId: string) => {
      if (!playlistId) return;
      await playlistRepository.addSong(playlistId, songId);
      await reload();
    },
    [playlistId, reload]
  );

  const removeSong = useCallback(
    async (songId: string) => {
      if (!playlistId) return;
      await playlistRepository.removeSong(playlistId, songId);
      setSongIds((prev) => prev.filter((id) => id !== songId));
    },
    [playlistId]
  );

  return { songIds, loading, addSong, removeSong, reload };
}
