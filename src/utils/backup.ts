import type { Song, SongFormInput } from "../types/song";

/** SongFormInput만 남긴 백업용 형태 (id/ownerId/favorite/생성일 등은 export에 포함하지 않음) */
type BackupSong = SongFormInput;

function toBackupSong(song: Song): BackupSong {
  return {
    title: song.title,
    artist: song.artist,
    composer: song.composer,
    lyricist: song.lyricist,
    genre: song.genre,
    key: song.key,
    bpm: song.bpm,
    difficulty: song.difficulty,
    lyrics: song.lyrics,
    chords: song.chords,
    memo: song.memo,
    tags: song.tags,
    youtubeVideoId: song.youtubeVideoId,
  };
}

export function songsToJSON(songs: Song[]): string {
  return JSON.stringify(songs.map(toBackupSong), null, 2);
}

const CSV_COLUMNS: (keyof BackupSong)[] = [
  "title",
  "artist",
  "composer",
  "lyricist",
  "genre",
  "key",
  "bpm",
  "difficulty",
  "tags",
  "youtubeVideoId",
  "memo",
  "chords",
  "lyrics",
];

function csvEscape(value: unknown): string {
  if (value === undefined || value === null) return "";
  const str = Array.isArray(value) ? value.join(";") : String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function songsToCSV(songs: Song[]): string {
  const header = CSV_COLUMNS.join(",");
  const rows = songs.map((song) => {
    const backup = toBackupSong(song);
    return CSV_COLUMNS.map((col) => csvEscape(backup[col])).join(",");
  });
  return [header, ...rows].join("\n");
}

export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export class BackupParseError extends Error {}

/** JSON 백업 파일 내용을 검증하고 SongFormInput 배열로 변환한다. */
export function parseSongsJSON(text: string): SongFormInput[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BackupParseError("올바른 JSON 파일이 아니에요.");
  }
  if (!Array.isArray(data)) {
    throw new BackupParseError("노래 목록(배열) 형식이어야 해요.");
  }
  return data.map((item, i) => {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof (item as Record<string, unknown>).title !== "string" ||
      typeof (item as Record<string, unknown>).artist !== "string"
    ) {
      throw new BackupParseError(`${i + 1}번째 항목에 제목/가수가 없어요.`);
    }
    const raw = item as Record<string, unknown>;
    return {
      title: raw.title as string,
      artist: raw.artist as string,
      composer: typeof raw.composer === "string" ? raw.composer : undefined,
      lyricist: typeof raw.lyricist === "string" ? raw.lyricist : undefined,
      genre: typeof raw.genre === "string" ? raw.genre : undefined,
      key: typeof raw.key === "string" ? raw.key : undefined,
      bpm: typeof raw.bpm === "number" ? raw.bpm : undefined,
      difficulty: typeof raw.difficulty === "number" ? raw.difficulty : undefined,
      lyrics: typeof raw.lyrics === "string" ? raw.lyrics : undefined,
      chords: typeof raw.chords === "string" ? raw.chords : undefined,
      memo: typeof raw.memo === "string" ? raw.memo : undefined,
      tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === "string") : [],
      youtubeVideoId: typeof raw.youtubeVideoId === "string" ? raw.youtubeVideoId : undefined,
    };
  });
}
