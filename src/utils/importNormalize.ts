import type { SongFormInput } from "../types/song";
import { parseCSV } from "./csv";
import {
  BackupParseError,
  FORMAT_NAME,
  FORMAT_VERSION,
  type ImportRowError,
  type ImportResult,
} from "./backup";

/**
 * 외부 CSV/JSON의 컬럼명·필드명을 내부 SongFormInput 필드로 매핑하기 위한 별칭 테이블.
 * key는 실제 Song 필드 이름이고, value는 그 필드로 인식할 별칭들(영문 변형 + 한글)이다.
 * 여기 없는 필드(예: 앨범, 발매일 등)는 Song 타입에 아예 존재하지 않으므로 매핑하지 않는다.
 */
const FIELD_ALIASES: Record<keyof SongFormInput, string[]> = {
  title: [
    "title", "name", "song", "songTitle", "song_name", "songTitleName",
    "곡명", "곡제목", "노래명", "노래제목", "제목",
  ],
  artist: ["artist", "singer", "vocalist", "artistName", "singerName", "가수", "아티스트", "가수명"],
  composer: ["composer", "composerName", "작곡", "작곡가", "작곡자"],
  lyricist: ["lyricist", "lyricistName", "lyricWriter", "writer", "lyricsWriter", "작사", "작사가", "작사자"],
  genre: ["genre", "category", "type", "categoryName", "장르", "분류"],
  key: ["key", "musicalKey", "songKey", "song_key", "조", "키"],
  bpm: ["bpm", "tempo", "tempoBpm", "speed", "beatsPerMinute", "템포", "BPM"],
  difficulty: ["difficulty", "level", "difficultyLevel", "difficulty_level", "난이도", "레벨"],
  lyrics: ["lyrics", "lyric", "lyricText", "lyricsText", "text", "가사", "가사내용"],
  chords: ["chords", "chord", "chordText", "코드", "코드내용"],
  memo: ["memo", "note", "notes", "description", "comment", "메모", "비고", "설명"],
  tags: ["tags", "tag", "keywords", "keyword", "태그", "키워드"],
  youtubeVideoId: [
    "youtubeVideoId", "youtube_video_id", "youtubeUrl", "youtubeURL", "youtube",
    "youtubeLink", "videoUrl", "videoURL", "video", "유튜브", "유튜브링크", "영상", "영상링크",
  ],
};

function stripBOM(s: string): string {
  return s.replace(/^\uFEFF/, "");
}

/** 헤더/키 비교용 정규화: 대소문자, 공백, 언더스코어, 하이픈, 점을 모두 무시하고 비교한다. */
function normalizeKey(key: string): string {
  return stripBOM(key).trim().toLowerCase().replace(/[\s_\-.]/g, "");
}

const ALIAS_LOOKUP: Map<string, keyof SongFormInput> = (() => {
  const map = new Map<string, keyof SongFormInput>();
  (Object.keys(FIELD_ALIASES) as (keyof SongFormInput)[]).forEach((field) => {
    FIELD_ALIASES[field].forEach((alias) => map.set(normalizeKey(alias), field));
  });
  return map;
})();

/** 외부 컬럼명/필드명 하나를 내부 Song 필드로 매핑한다. 매핑되지 않으면 undefined. */
export function mapExternalField(externalKey: string): keyof SongFormInput | undefined {
  return ALIAS_LOOKUP.get(normalizeKey(externalKey));
}

function extractNumber(raw: string): number | undefined {
  const m = stripBOM(raw).match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : undefined;
}

/** "https://youtu.be/xxx", "https://www.youtube.com/watch?v=xxx" 등에서 videoId만 뽑아낸다.
 *  이미 순수 videoId 형태면 그대로 쓰고, 인식 못하면 과도하게 추측하지 않고 원본을 보존한다. */
function extractYouTubeVideoId(raw: string): string | undefined {
  const value = stripBOM(raw).trim();
  if (!value) return undefined;
  if (!/[/\s]/.test(value)) return value;
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{6,})/,
    /youtu\.be\/([a-zA-Z0-9_-]{6,})/,
    /embed\/([a-zA-Z0-9_-]{6,})/,
    /shorts\/([a-zA-Z0-9_-]{6,})/,
  ];
  for (const re of patterns) {
    const m = value.match(re);
    if (m) return m[1];
  }
  return value;
}

/** 값 하나를 필드 타입에 맞게 정규화한다. 변환 실패는 오류가 아니라 warning으로만 남긴다. */
export function normalizeImportedValue(
  field: keyof SongFormInput,
  rawValue: unknown
): { value: unknown; warning?: string } {
  if (rawValue === undefined || rawValue === null) return { value: undefined };

  if (field === "tags") {
    if (Array.isArray(rawValue)) {
      return { value: rawValue.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean) };
    }
    const str = stripBOM(String(rawValue)).trim();
    if (!str) return { value: [] };
    const sep = str.includes(";") ? ";" : ",";
    return { value: str.split(sep).map((t) => t.trim()).filter(Boolean) };
  }

  if (field === "bpm" || field === "difficulty") {
    const raw = typeof rawValue === "number" ? rawValue : extractNumber(String(rawValue));
    const original = String(rawValue).trim();
    if (!original) return { value: undefined };
    if (raw === undefined || !Number.isFinite(raw)) {
      return {
        value: undefined,
        warning: `${field === "bpm" ? "BPM" : "난이도"} 값을 숫자로 바꿀 수 없어요: "${original}"`,
      };
    }
    if (field === "difficulty" && (raw < 1 || raw > 5)) {
      return { value: undefined, warning: `난이도는 1~5 사이여야 해요 (입력값: "${original}").` };
    }
    if (field === "bpm" && raw <= 0) {
      return { value: undefined, warning: `BPM 값이 올바르지 않아요 (입력값: "${original}").` };
    }
    return { value: Math.round(raw) };
  }

  if (field === "youtubeVideoId") {
    const str = stripBOM(String(rawValue)).trim();
    return { value: str ? extractYouTubeVideoId(str) : undefined };
  }

  const str = stripBOM(String(rawValue)).trim();
  return { value: str || undefined };
}

export interface NormalizedRow {
  row: number;
  input?: SongFormInput;
  error?: string;
  warnings: string[];
  unrecognizedFields: string[];
}

/** 외부 데이터 한 행(raw key-value)을 내부 Song 형식(SongFormInput)으로 정규화한다.
 *  title을 찾을 수 없는 행만 오류로 제외하고, 그 외에는 최대한 데이터를 보존한다. */
export function normalizeImportedSong(raw: Record<string, unknown>, rowNum: number): NormalizedRow {
  const mapped: Partial<Record<keyof SongFormInput, unknown>> = {};
  const unrecognizedFields: string[] = [];
  const warnings: string[] = [];

  for (const [rawKey, rawValue] of Object.entries(raw)) {
    const field = mapExternalField(rawKey);
    if (!field) {
      if (stripBOM(rawKey).trim()) unrecognizedFields.push(rawKey);
      continue;
    }
    const { value, warning } = normalizeImportedValue(field, rawValue);
    if (warning) warnings.push(warning);
    if (value !== undefined) mapped[field] = value;
  }

  const title = typeof mapped.title === "string" ? mapped.title : undefined;
  if (!title) {
    return { row: rowNum, error: "❌ 제목(title)을 찾을 수 없습니다.", warnings, unrecognizedFields };
  }

  const input: SongFormInput = {
    title,
    artist: typeof mapped.artist === "string" ? mapped.artist : "",
    composer: mapped.composer as string | undefined,
    lyricist: mapped.lyricist as string | undefined,
    genre: mapped.genre as string | undefined,
    key: mapped.key as string | undefined,
    bpm: mapped.bpm as number | undefined,
    difficulty: mapped.difficulty as number | undefined,
    lyrics: mapped.lyrics as string | undefined,
    chords: mapped.chords as string | undefined,
    memo: mapped.memo as string | undefined,
    tags: Array.isArray(mapped.tags) ? (mapped.tags as string[]) : [],
    youtubeVideoId: mapped.youtubeVideoId as string | undefined,
  };

  return { row: rowNum, input, warnings, unrecognizedFields };
}

export type DetectedImportFormat = "csv" | "json";

/** 파일 확장자를 기준으로 형식을 감지한다 (기존 handleImportFile과 동일한 방식). */
export function detectImportFormat(filename: string): DetectedImportFormat {
  return filename.toLowerCase().endsWith(".csv") ? "csv" : "json";
}

export interface FlexibleImportResult extends ImportResult {
  detectedFormat: DetectedImportFormat;
  unrecognizedFields: string[];
  warnings: ImportRowError[];
  mappedFieldCount: number;
}

function collect(
  rows: Array<{ row: number; input?: SongFormInput; error?: string; warnings: string[]; unrecognizedFields: string[] }>,
  totalRows: number,
  detectedFormat: DetectedImportFormat
): FlexibleImportResult {
  const valid: SongFormInput[] = [];
  const errors: ImportRowError[] = [];
  const warnings: ImportRowError[] = [];
  const unrecognizedSet = new Set<string>();
  const mappedFieldSet = new Set<string>();

  rows.forEach((r) => {
    r.unrecognizedFields.forEach((f) => unrecognizedSet.add(f));
    r.warnings.forEach((w) => warnings.push({ row: r.row, message: w }));
    if (r.error) {
      errors.push({ row: r.row, message: r.error });
      return;
    }
    if (r.input) {
      valid.push(r.input);
      (Object.keys(r.input) as (keyof SongFormInput)[]).forEach((f) => {
        const v = r.input![f];
        if (v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0)) mappedFieldSet.add(f);
      });
    }
  });

  return {
    valid,
    errors,
    totalRows,
    detectedFormat,
    unrecognizedFields: [...unrecognizedSet],
    warnings,
    mappedFieldCount: mappedFieldSet.size,
  };
}

/**
 * CSV를 컬럼명/별칭 기준으로 자동 매핑해서 Import한다. 컬럼 순서는 무관하고,
 * 필드가 적거나 많아도(모르는 컬럼은 unrecognizedFields로만 보고) 정상 처리한다.
 * 단, 헤더 행에서 title로 인식되는 컬럼이 하나도 없으면(=헤더가 없는 CSV일 가능성)
 * 위치 추측을 하지 않고 전체를 실패시킨다.
 */
export function normalizeImportedCSV(text: string): FlexibleImportResult {
  const rows = parseCSV(text);
  if (rows.length === 0) {
    throw new BackupParseError("빈 파일이에요.");
  }

  const rawHeader = rows[0].map((h) => stripBOM(h).trim());
  const headerHasTitle = rawHeader.some((h) => mapExternalField(h) === "title");
  if (!headerHasTitle) {
    throw new BackupParseError(
      "CSV 헤더를 확인할 수 없습니다. 컬럼명을 포함한 CSV 파일을 사용해주세요."
    );
  }

  const dataRows = rows.slice(1).filter((r) => r.some((c) => c.trim() !== ""));
  const normalized = dataRows.map((cells, i) => {
    const record: Record<string, string> = {};
    rawHeader.forEach((h, idx) => {
      record[h] = cells[idx] ?? "";
    });
    return normalizeImportedSong(record, i + 2);
  });

  return collect(normalized, dataRows.length, "csv");
}

/**
 * JSON을 자동 인식해서 Import한다. 지원 구조: 배열 / {songs:[...]} / {data:[...]} / 단일 객체.
 * {format, version, songs} 형태(기존 Songbook Manager 백업 포맷)라면 기존과 동일하게
 * format/version을 검증해서 다른 앱의 파일을 잘못 가져오는 걸 막는다.
 */
export function normalizeImportedJSON(text: string): FlexibleImportResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BackupParseError("올바른 JSON 파일이 아니에요.");
  }

  let songsArray: unknown[];
  if (Array.isArray(data)) {
    songsArray = data;
  } else if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;
    if ("songs" in obj || "data" in obj) {
      if (obj.format !== undefined && obj.format !== FORMAT_NAME) {
        throw new BackupParseError(
          `이 파일은 Songbook Manager 백업 형식이 아니에요. (format: ${String(obj.format)})`
        );
      }
      if (obj.version !== undefined && obj.version !== FORMAT_VERSION) {
        throw new BackupParseError(`지원하지 않는 백업 버전이에요. (version: ${String(obj.version)})`);
      }
      const arr = obj.songs ?? obj.data;
      if (!Array.isArray(arr)) {
        throw new BackupParseError("songs가 배열이 아니에요.");
      }
      songsArray = arr;
    } else {
      // songs/data 래퍼가 없는 순수 단일 객체 — 곡 1개로 취급한다.
      songsArray = [obj];
    }
  } else {
    throw new BackupParseError("지원하지 않는 JSON 구조예요.");
  }

  const normalized = songsArray.map((item, i) => {
    if (typeof item !== "object" || item === null) {
      return { row: i + 1, error: "올바른 형식의 데이터가 아니에요.", warnings: [], unrecognizedFields: [] };
    }
    return normalizeImportedSong(item as Record<string, unknown>, i + 1);
  });

  return collect(normalized, songsArray.length, "json");
}
