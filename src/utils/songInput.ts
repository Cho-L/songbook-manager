import type { Song, SongFormInput } from "../types/song";

/** 저장된 곡에서 가사만 바꾼 SongFormInput (나머지 필드는 그대로 유지) */
export function songToInput(song: Song, lyrics: string): SongFormInput {
  return {
    title: song.title,
    artist: song.artist,
    composer: song.composer,
    lyricist: song.lyricist,
    genre: song.genre,
    key: song.key,
    bpm: song.bpm,
    difficulty: song.difficulty,
    lyrics: lyrics.trim() ? lyrics : undefined,
    chords: song.chords,
    memo: song.memo,
    tags: song.tags,
    titleAliases: song.titleAliases,
    artistAliases: song.artistAliases,
    youtubeVideoId: song.youtubeVideoId,
  };
}
