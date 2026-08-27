import type { Song, SongFormInput } from "../types/song";
import { parseCSV } from "./csv";

const FORMAT_NAME = "songbook-manager";
const FORMAT_VERSION = 1;

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

/** JSON은 완전 백업/복원용 — Songbook Manager 전용 포맷(format/version 메타 포함)으로 내보낸다. */
export function songsToJSON(songs: Song[]): string {
  return JSON.stringify(
    { format: FORMAT_NAME, version: FORMAT_VERSION, songs: songs.map(toBackupSong) },
    null,
    2
  );
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
const REQUIRED_CSV_COLUMNS: (keyof BackupSong)[] = ["title", "artist"];

function csvEscape(value: unknown): string {
  if (value === undefined || value === null) return "";
  const str = Array.isArray(value) ? value.join(";") : String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** CSV는 엑셀/구글시트에서 대량 편집하기 위한 형식 — 사람이 읽기 쉬운 평문 헤더를 그대로 유지한다. */
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

export interface ImportRowError {
  row: number;
  message: string;
}

export interface ImportResult {
  valid: SongFormInput[];
  errors: ImportRowError[];
  totalRows: number;
}

function toSongFormInput(raw: Record<string, unknown>): SongFormInput {
  return {
    title: raw.title as string,
    artist: raw.artist as string,
    composer: typeof raw.composer === "string" && raw.composer ? raw.composer : undefined,
    lyricist: typeof raw.lyricist === "string" && raw.lyricist ? raw.lyricist : undefined,
    genre: typeof raw.genre === "string" && raw.genre ? raw.genre : undefined,
    key: typeof raw.key === "string" && raw.key ? raw.key : undefined,
    bpm: typeof raw.bpm === "number" ? raw.bpm : undefined,
    difficulty: typeof raw.difficulty === "number" ? raw.difficulty : undefined,
    lyrics: typeof raw.lyrics === "string" && raw.lyrics ? raw.lyrics : undefined,
    chords: typeof raw.chords === "string" && raw.chords ? raw.chords : undefined,
    memo: typeof raw.memo === "string" && raw.memo ? raw.memo : undefined,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === "string") : [],
    youtubeVideoId:
      typeof raw.youtubeVideoId === "string" && raw.youtubeVideoId ? raw.youtubeVideoId : undefined,
  };
}

/**
 * JSON 백업 파일을 검증하고 Import Preview용 결과로 변환한다.
 * Songbook Manager 전용 포맷({format, version, songs})을 기대하지만,
 * 예전(Phase 7) 방식인 "곡 배열 그대로"도 하위 호환으로 허용한다.
 * 개별 곡 하나가 잘못됐다고 전체를 실패시키지 않고, 오류가 있는 행만 errors에 담는다.
 */
export function parseSongsJSON(text: string): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BackupParseError("올바른 JSON 파일이 아니에요.");
  }

  let songsArray: unknown;
  if (Array.isArray(data)) {
    // 하위 호환: format 메타 없이 배열만 있는 예전 백업 파일
    songsArray = data;
  } else if (
    typeof data === "object" &&
    data !== null &&
    "songs" in (data as Record<string, unknown>)
  ) {
    const obj = data as Record<string, unknown>;
    if (obj.format !== undefined && obj.format !== FORMAT_NAME) {
      throw new BackupParseError(
        `이 파일은 Songbook Manager 백업 형식이 아니에요. (format: ${String(obj.format)})`
      );
    }
    if (obj.version !== undefined && obj.version !== FORMAT_VERSION) {
      throw new BackupParseError(`지원하지 않는 백업 버전이에요. (version: ${String(obj.version)})`);
    }
    songsArray = obj.songs;
  } else {
    throw new BackupParseError(
      "Songbook Manager 백업 형식이 아니에요. { format, version, songs } 구조여야 해요."
    );
  }

  if (!Array.isArray(songsArray)) {
    throw new BackupParseError("songs가 배열이 아니에요.");
  }

  const valid: SongFormInput[] = [];
  const errors: ImportRowError[] = [];

  songsArray.forEach((item, i) => {
    const rowNum = i + 1;
    if (typeof item !== "object" || item === null) {
      errors.push({ row: rowNum, message: "올바른 형식의 데이터가 아니에요." });
      return;
    }
    const raw = item as Record<string, unknown>;
    if (typeof raw.title !== "string" || !raw.title.trim()) {
      errors.push({ row: rowNum, message: "제목이 비어 있어요." });
      return;
    }
    if (typeof raw.artist !== "string" || !raw.artist.trim()) {
      errors.push({ row: rowNum, message: "가수가 비어 있어요." });
      return;
    }
    valid.push(toSongFormInput(raw));
  });

  return { valid, errors, totalRows: songsArray.length };
}

/**
 * CSV Import — songsToCSV()가 만드는 표준 헤더를 기준으로 검증한다.
 * 필수 헤더 누락, 필드 수 불일치, 필수 값 누락, 타입 오류를 행 단위로 리포트한다.
 */
export function parseSongsCSV(text: string): ImportResult {
  const rows = parseCSV(text);
  if (rows.length === 0) {
    throw new BackupParseError("빈 파일이에요.");
  }

  const header = rows[0].map((h) => h.trim());
  const missingRequired = REQUIRED_CSV_COLUMNS.filter((col) => !header.includes(col));
  if (missingRequired.length > 0) {
    throw new BackupParseError(
      `필수 헤더가 없어요: ${missingRequired.join(", ")}. songsToCSV()로 내보낸 파일 형식을 사용해주세요.`
    );
  }
  const unknownColumns = header.filter((h) => !CSV_COLUMNS.includes(h as keyof BackupSong));
  if (unknownColumns.length > 0) {
    throw new BackupParseError(`지원하지 않는 열이에요: ${unknownColumns.join(", ")}`);
  }

  const dataRows = rows.slice(1);
  const valid: SongFormInput[] = [];
  const errors: ImportRowError[] = [];

  dataRows.forEach((cells, i) => {
    const rowNum = i + 2; // 헤더가 1행이므로 데이터는 2행부터
    if (cells.length !== header.length) {
      errors.push({
        row: rowNum,
        message: `열 개수가 헤더(${header.length}개)와 달라요 (${cells.length}개).`,
      });
      return;
    }

    const record: Record<string, string> = {};
    header.forEach((col, idx) => {
      record[col] = cells[idx];
    });

    if (!record.title?.trim()) {
      errors.push({ row: rowNum, message: "제목이 비어 있어요." });
      return;
    }
    if (!record.artist?.trim()) {
      errors.push({ row: rowNum, message: "가수가 비어 있어요." });
      return;
    }
    if (record.bpm && isNaN(Number(record.bpm))) {
      errors.push({ row: rowNum, message: `BPM은 숫자여야 해요 (입력값: "${record.bpm}").` });
      return;
    }
    if (record.difficulty && isNaN(Number(record.difficulty))) {
      errors.push({
        row: rowNum,
        message: `난이도는 숫자여야 해요 (입력값: "${record.difficulty}").`,
      });
      return;
    }

    valid.push(
      toSongFormInput({
        ...record,
        bpm: record.bpm ? Number(record.bpm) : undefined,
        difficulty: record.difficulty ? Number(record.difficulty) : undefined,
        tags: record.tags ? record.tags.split(";").map((t) => t.trim()).filter(Boolean) : [],
      })
    );
  });

  return { valid, errors, totalRows: dataRows.length };
}
