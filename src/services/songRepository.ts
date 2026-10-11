import type { Song, SongFormInput } from "../types/song";
import { sampleSongs } from "../data/sampleSongs";
import { supabase, isSupabaseConfigured } from "./supabaseClient";
import { isMrEmpty, type MrSetResult } from "../utils/mrBatch";

/**
 * 노래 데이터 접근 인터페이스.
 * UI/훅은 이 인터페이스에만 의존하고 구현체(localStorage vs Supabase)를 모른다.
 * Supabase는 네트워크 호출이라 전부 비동기(Promise)로 통일했다.
 *
 * getAll이 아니라 getByOwner인 이유: 이번 Phase부터 관리자별로
 * 노래책이 분리되어, "전체 노래"라는 개념 자체가 없어졌기 때문이다.
 */
export interface SongRepository {
  getByOwner(ownerId: string): Promise<Song[]>;
  add(input: SongFormInput, ownerId: string): Promise<Song>;
  update(id: string, input: SongFormInput): Promise<Song | null>;
  toggleFavorite(id: string): Promise<Song | null>;
  /**
   * MR(youtubeVideoId)이 "지금도 비어 있을 때만" 값을 쓴다 (다른 필드는 건드리지 않는다).
   * 이미 값이 있으면 쓰지 않고 "conflict" — 기존 MR을 덮어쓰지 않는 것이 이 메서드의 핵심 계약이다.
   */
  setYoutubeVideoIdIfEmpty(id: string, videoId: string): Promise<MrSetResult>;
  remove(id: string): Promise<void>;
  /** "노래책 삭제": 계정/프로필은 그대로 두고 이 소유자의 songs만 전부 삭제한다. */
  removeAllByOwner(ownerId: string): Promise<void>;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * localStorage 기반 구현체.
 * Supabase 연결 정보가 없을 때(로컬 개발, 계정 준비 전) 자동으로 사용된다.
 * 데모 목적상 소유자 구분 없이 sampleSongs를 "demo-owner"에게 귀속시킨다.
 */
const DEMO_OWNER_ID = "demo-owner";
const STORAGE_KEY = "songbook:songs";

export class LocalSongRepository implements SongRepository {
  private readRaw(): Song[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      return JSON.parse(raw) as Song[];
    } catch {
      return [];
    }
  }

  private writeRaw(songs: Song[]): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(songs));
  }

  private ensureSeeded(): Song[] {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing === null) {
      const seeded = sampleSongs.map((s) => ({ ...s, ownerId: DEMO_OWNER_ID }));
      this.writeRaw(seeded);
      return seeded;
    }
    return this.readRaw();
  }

  async getByOwner(ownerId: string): Promise<Song[]> {
    const all = this.ensureSeeded();
    return all.filter((s) => s.ownerId === ownerId);
  }

  async add(input: SongFormInput, ownerId: string): Promise<Song> {
    const now = new Date().toISOString();
    const newSong: Song = {
      ...input,
      id: generateId(),
      ownerId,
      favorite: false,
      createdAt: now,
      updatedAt: now,
    };
    const songs = this.ensureSeeded();
    this.writeRaw([newSong, ...songs]);
    return newSong;
  }

  async update(id: string, input: SongFormInput): Promise<Song | null> {
    const songs = this.ensureSeeded();
    const idx = songs.findIndex((s) => s.id === id);
    if (idx === -1) return null;

    const updated: Song = {
      ...songs[idx],
      ...input,
      updatedAt: new Date().toISOString(),
    };
    songs[idx] = updated;
    this.writeRaw(songs);
    return updated;
  }

  async toggleFavorite(id: string): Promise<Song | null> {
    const songs = this.ensureSeeded();
    const idx = songs.findIndex((s) => s.id === id);
    if (idx === -1) return null;

    songs[idx] = { ...songs[idx], favorite: !songs[idx].favorite };
    this.writeRaw(songs);
    return songs[idx];
  }

  async setYoutubeVideoIdIfEmpty(id: string, videoId: string): Promise<MrSetResult> {
    // 읽기→쓰기가 동기 코드 안에서 끝나므로 이 탭 안에서는 끼어들 틈이 없다
    const songs = this.ensureSeeded();
    const idx = songs.findIndex((s) => s.id === id);
    if (idx === -1) return "not-found";
    if (!isMrEmpty(songs[idx].youtubeVideoId)) return "conflict";
    songs[idx] = { ...songs[idx], youtubeVideoId: videoId, updatedAt: new Date().toISOString() };
    this.writeRaw(songs);
    return "updated";
  }

  async remove(id: string): Promise<void> {
    const songs = this.ensureSeeded().filter((s) => s.id !== id);
    this.writeRaw(songs);
  }

  async removeAllByOwner(ownerId: string): Promise<void> {
    const songs = this.ensureSeeded().filter((s) => s.ownerId !== ownerId);
    this.writeRaw(songs);
  }
}

/** DB row(snake_case) <-> Song(camelCase) 변환 */
interface SongRow {
  id: string;
  owner_id: string;
  title: string;
  artist: string;
  composer: string | null;
  lyricist: string | null;
  genre: string | null;
  key: string | null;
  bpm: number | null;
  difficulty: number | null;
  lyrics: string | null;
  chords: string | null;
  memo: string | null;
  tags: string[];
  favorite: boolean;
  youtube_video_id: string | null;
  created_at: string;
  updated_at: string;
}

function rowToSong(row: SongRow): Song {
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    artist: row.artist,
    composer: row.composer ?? undefined,
    lyricist: row.lyricist ?? undefined,
    genre: row.genre ?? undefined,
    key: row.key ?? undefined,
    bpm: row.bpm ?? undefined,
    difficulty: row.difficulty ?? undefined,
    lyrics: row.lyrics ?? undefined,
    chords: row.chords ?? undefined,
    memo: row.memo ?? undefined,
    tags: row.tags ?? [],
    favorite: row.favorite,
    youtubeVideoId: row.youtube_video_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function inputToRow(input: SongFormInput) {
  return {
    title: input.title,
    artist: input.artist,
    composer: input.composer ?? null,
    lyricist: input.lyricist ?? null,
    genre: input.genre ?? null,
    key: input.key ?? null,
    bpm: input.bpm ?? null,
    difficulty: input.difficulty ?? null,
    lyrics: input.lyrics ?? null,
    chords: input.chords ?? null,
    memo: input.memo ?? null,
    tags: input.tags ?? [],
    youtube_video_id: input.youtubeVideoId ?? null,
  };
}

/**
 * Supabase 기반 구현체.
 * 실제 CRUD 권한 검사는 여기서 하지 않는다 — Postgres RLS(schema.sql)가
 * DB 레벨에서 owner_id 소유권을 강제하므로, 여기서 잘못된 요청을 보내도
 * Supabase가 거부한다 (지시서 12번: 서버측 권한 검사 요구사항 충족).
 */
export class SupabaseSongRepository implements SongRepository {
  private client() {
    if (!supabase) {
      throw new Error(
        "Supabase가 설정되지 않았습니다. VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY를 확인하세요."
      );
    }
    return supabase;
  }

  async getByOwner(ownerId: string): Promise<Song[]> {
    const { data, error } = await this.client()
      .from("songs")
      .select("*")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return (data as SongRow[]).map(rowToSong);
  }

  async add(input: SongFormInput, ownerId: string): Promise<Song> {
    const { data, error } = await this.client()
      .from("songs")
      .insert({ ...inputToRow(input), owner_id: ownerId })
      .select()
      .single();

    if (error) throw error;
    return rowToSong(data as SongRow);
  }

  async update(id: string, input: SongFormInput): Promise<Song | null> {
    const { data, error } = await this.client()
      .from("songs")
      .update(inputToRow(input))
      .eq("id", id)
      .select()
      .maybeSingle();

    // RLS로 인해 본인 소유가 아니면 data가 null로 옴 (에러가 아니라 0 row 매칭)
    if (error) throw error;
    return data ? rowToSong(data as SongRow) : null;
  }

  async toggleFavorite(id: string): Promise<Song | null> {
    const client = this.client();
    const { data: current, error: fetchError } = await client
      .from("songs")
      .select("favorite")
      .eq("id", id)
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (!current) return null;

    const { data, error } = await client
      .from("songs")
      .update({ favorite: !current.favorite })
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) throw error;
    return data ? rowToSong(data as SongRow) : null;
  }

  /**
   * 조건부 갱신(compare-and-set): 방금 읽은 youtube_video_id 값이 "그대로일 때만" 그 컬럼 하나만 UPDATE 한다.
   *  - 읽은 값이 NULL 이면 `youtube_video_id IS NULL`, 빈 문자열/공백이면 `youtube_video_id = '<읽은 값>'` 조건을 건다.
   *  - 그 사이 다른 사용자가 MR을 넣었다면 조건이 맞지 않아 0행 갱신 → 덮어쓰지 않는다.
   *  - 스키마/RLS 변경 없이 기존 update 정책(owner/super_admin) 그대로 동작한다.
   */
  async setYoutubeVideoIdIfEmpty(id: string, videoId: string): Promise<MrSetResult> {
    const client = this.client();
    const { data: cur, error: readError } = await client.from("songs").select("youtube_video_id").eq("id", id).maybeSingle();
    if (readError) throw readError;
    if (!cur) return "not-found";
    const observed = cur.youtube_video_id as string | null;
    if (!isMrEmpty(observed)) return "conflict";

    const base = client.from("songs").update({ youtube_video_id: videoId }).eq("id", id);
    const { data, error } = await (observed === null ? base.is("youtube_video_id", null) : base.eq("youtube_video_id", observed)).select("id");
    if (error) throw error;
    if (data && data.length > 0) return "updated";

    // 0행: 그 사이 값이 바뀌었거나(→ conflict), RLS가 갱신을 거부했다(→ 오류)
    const { data: after, error: afterError } = await client.from("songs").select("youtube_video_id").eq("id", id).maybeSingle();
    if (afterError) throw afterError;
    if (!after) return "not-found";
    if (!isMrEmpty(after.youtube_video_id)) return "conflict";
    throw new Error("저장 권한이 없어요. 이 노래책의 소유자로 로그인했는지 확인해 주세요.");
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.client().from("songs").delete().eq("id", id);
    if (error) throw error;
  }

  /**
   * "노래책 삭제": ownerId의 songs를 전부 지운다.
   * 실제 권한 검사는 이 코드가 아니라 RLS(songs_owner_delete /
   * songs_super_admin_delete)가 한다 — 본인 소유이거나 super_admin이
   * 아니면 이 delete 자체가 0건 삭제로 조용히 실패한다.
   * favorites는 songs.id에 대한 FK ON DELETE CASCADE로 자동 정리된다.
   */
  async removeAllByOwner(ownerId: string): Promise<void> {
    const { error } = await this.client().from("songs").delete().eq("owner_id", ownerId);
    if (error) throw error;
  }
}

// Supabase 연결 정보가 있으면 SupabaseSongRepository, 없으면 로컬로 자동 폴백.
// 계정/키가 아직 없어도 앱이 죽지 않고 데모 모드로 계속 동작한다.
export const songRepository: SongRepository = isSupabaseConfigured
  ? new SupabaseSongRepository()
  : new LocalSongRepository();
