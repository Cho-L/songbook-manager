import type { Playlist, PlaylistSongEntry } from "../types/playlist";
import { supabase, isSupabaseConfigured } from "./supabaseClient";

const LOCAL_PLAYLISTS_KEY = "songbook:playlists";
const LOCAL_PLAYLIST_SONGS_KEY = "songbook:playlist_songs";

function readLocal<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}
function writeLocal<T>(key: string, value: T[]): void {
  localStorage.setItem(key, JSON.stringify(value));
}
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

interface PlaylistRow {
  id: string;
  owner_id: string;
  name: string;
  created_at: string;
}
function rowToPlaylist(row: PlaylistRow): Playlist {
  return { id: row.id, ownerId: row.owner_id, name: row.name, createdAt: row.created_at };
}

export const playlistRepository = {
  async listByOwner(ownerId: string): Promise<Playlist[]> {
    if (!isSupabaseConfigured || !supabase) {
      return readLocal<Playlist>(LOCAL_PLAYLISTS_KEY).filter((p) => p.ownerId === ownerId);
    }
    const { data, error } = await supabase
      .from("playlists")
      .select("*")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data as PlaylistRow[]).map(rowToPlaylist);
  },

  async getById(id: string): Promise<Playlist | null> {
    if (!isSupabaseConfigured || !supabase) {
      return readLocal<Playlist>(LOCAL_PLAYLISTS_KEY).find((p) => p.id === id) ?? null;
    }
    const { data, error } = await supabase.from("playlists").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? rowToPlaylist(data as PlaylistRow) : null;
  },

  async create(ownerId: string, name: string): Promise<Playlist> {
    if (!isSupabaseConfigured || !supabase) {
      const all = readLocal<Playlist>(LOCAL_PLAYLISTS_KEY);
      const created: Playlist = { id: generateId(), ownerId, name, createdAt: new Date().toISOString() };
      writeLocal(LOCAL_PLAYLISTS_KEY, [...all, created]);
      return created;
    }
    const { data, error } = await supabase
      .from("playlists")
      .insert({ owner_id: ownerId, name })
      .select()
      .single();
    if (error) throw error;
    return rowToPlaylist(data as PlaylistRow);
  },

  async remove(id: string): Promise<void> {
    if (!isSupabaseConfigured || !supabase) {
      writeLocal(
        LOCAL_PLAYLISTS_KEY,
        readLocal<Playlist>(LOCAL_PLAYLISTS_KEY).filter((p) => p.id !== id)
      );
      writeLocal(
        LOCAL_PLAYLIST_SONGS_KEY,
        readLocal<{ playlistId: string; songId: string; position: number }>(
          LOCAL_PLAYLIST_SONGS_KEY
        ).filter((e) => e.playlistId !== id)
      );
      return;
    }
    const { error } = await supabase.from("playlists").delete().eq("id", id);
    if (error) throw error;
  },

  async listSongEntries(playlistId: string): Promise<PlaylistSongEntry[]> {
    if (!isSupabaseConfigured || !supabase) {
      return readLocal<{ playlistId: string; songId: string; position: number }>(
        LOCAL_PLAYLIST_SONGS_KEY
      )
        .filter((e) => e.playlistId === playlistId)
        .sort((a, b) => a.position - b.position)
        .map((e) => ({ songId: e.songId, position: e.position }));
    }
    const { data, error } = await supabase
      .from("playlist_songs")
      .select("song_id, position")
      .eq("playlist_id", playlistId)
      .order("position", { ascending: true });
    if (error) throw error;
    return (data as { song_id: string; position: number }[]).map((r) => ({
      songId: r.song_id,
      position: r.position,
    }));
  },

  async addSong(playlistId: string, songId: string): Promise<void> {
    if (!isSupabaseConfigured || !supabase) {
      const all = readLocal<{ playlistId: string; songId: string; position: number }>(
        LOCAL_PLAYLIST_SONGS_KEY
      );
      if (all.some((e) => e.playlistId === playlistId && e.songId === songId)) return;
      const maxPos = Math.max(
        -1,
        ...all.filter((e) => e.playlistId === playlistId).map((e) => e.position)
      );
      writeLocal(LOCAL_PLAYLIST_SONGS_KEY, [
        ...all,
        { playlistId, songId, position: maxPos + 1 },
      ]);
      return;
    }
    const existing = await supabase
      .from("playlist_songs")
      .select("position")
      .eq("playlist_id", playlistId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextPosition = (existing.data?.position ?? -1) + 1;
    const { error } = await supabase
      .from("playlist_songs")
      .upsert(
        { playlist_id: playlistId, song_id: songId, position: nextPosition },
        { onConflict: "playlist_id,song_id", ignoreDuplicates: true }
      );
    if (error) throw error;
  },

  async removeSong(playlistId: string, songId: string): Promise<void> {
    if (!isSupabaseConfigured || !supabase) {
      writeLocal(
        LOCAL_PLAYLIST_SONGS_KEY,
        readLocal<{ playlistId: string; songId: string; position: number }>(
          LOCAL_PLAYLIST_SONGS_KEY
        ).filter((e) => !(e.playlistId === playlistId && e.songId === songId))
      );
      return;
    }
    const { error } = await supabase
      .from("playlist_songs")
      .delete()
      .eq("playlist_id", playlistId)
      .eq("song_id", songId);
    if (error) throw error;
  },
};
