import { formatLyricsWithTracks, parseLyrics, stripLyricTracks } from "../utils/lyrics";
import { alignPlainToSynced } from "./matching";
import { parseLrc } from "./lrc";
import { validateLines } from "./synchronizers";
import { compareDurations } from "./warp";
import type { LyricsCandidate } from "./types";

/**
 * 후보 → "전체 가사 미리보기" + "저장할 텍스트".
 * 실제 LRC 타임스탬프를 그대로 보존하고(없는 시간은 만들지 않는다), 싱크가 없으면 없다고 표시한다.
 */
export interface PreviewLine {
  time: number | null;
  text: string;
}

export interface CandidatePreview {
  id: string;
  title: string;
  artist: string;
  album?: string;
  source: string;
  /** 후보(기준 녹음)의 길이(초) */
  duration?: number;
  /** 진짜 타임스탬프가 읽히는 싱크 가사인가 */
  synced: boolean;
  lines: PreviewLine[];
  /** 가사가 있는 줄 수 */
  lineCount: number;
  firstTime?: number;
  lastTime?: number;
  /** MR 길이 − 후보 길이 (초). 둘 중 하나라도 모르면 undefined */
  durationDiff?: number;
  durationSimilar?: boolean;
  /** "교체" 적용 시 저장될 가사 텍스트 (싱크 있으면 LRC, 없으면 평문) */
  replaceText: string;
  /** 저장된 평문 가사가 있을 때: 그 줄들에 후보의 시간만 입힌 텍스트 (저장된 줄/발음 보존) */
  alignedText?: string;
  alignedCoverage?: number;
  warnings: string[];
}

export function buildPreview(c: LyricsCandidate, ctx: { ownLyrics?: string; mrDuration?: number } = {}): CandidatePreview {
  const warnings: string[] = [];
  let lines: PreviewLine[] = [];
  let synced = false;
  let replaceText = "";
  if (c.syncedLyrics) {
    const parsed = parseLrc(c.syncedLyrics);
    const err = validateLines(parsed);
    if (!err) {
      synced = true;
      lines = parsed.map((l) => ({ time: l.time, text: l.text }));
      replaceText = formatLyricsWithTracks(lines);
    } else {
      warnings.push(`싱크 데이터를 쓸 수 없어요 (${err})`);
    }
  }
  if (!synced && c.plainLyrics) {
    lines = c.plainLyrics.split(/\r?\n/).map((t) => ({ time: null, text: t }));
    replaceText = c.plainLyrics.replace(/\s+$/g, "");
  }
  const timed = lines.filter((l) => l.time !== null && l.text.trim());
  const lineCount = lines.filter((l) => l.text.trim()).length;
  const firstTime = timed[0]?.time ?? undefined;
  const lastTime = timed.length ? (timed[timed.length - 1].time ?? undefined) : undefined;
  const cmp = compareDurations(c.duration, ctx.mrDuration);
  if (!synced) warnings.push("싱크(시간) 정보가 없는 가사예요 — 화면이 자동으로 따라가지 않아요. 적용한 뒤 수동 싱크로 시간을 맞출 수 있어요");
  if (cmp && !cmp.similar) warnings.push(`MR이 원곡보다 약 ${Math.abs(Math.round(cmp.diff))}초 ${cmp.diff > 0 ? "길어요" : "짧아요"} — 적용 후 싱크 보정이 필요할 수 있어요`);
  if (synced && ctx.mrDuration && lastTime !== undefined && lastTime > ctx.mrDuration + 3) warnings.push("마지막 가사 시간이 MR 길이보다 뒤에 있어요 — 다른 버전일 수 있어요");

  const preview: CandidatePreview = {
    id: c.id,
    title: c.title,
    artist: c.artist,
    album: c.album,
    source: c.source,
    duration: c.duration,
    synced,
    lines,
    lineCount,
    firstTime,
    lastTime,
    durationDiff: cmp?.diff,
    durationSimilar: cmp?.similar,
    replaceText,
    warnings,
  };

  // 저장된 평문 가사 + 싱크 후보 → 저장된 가사 줄에 시간만 입히는 선택지 (저장된 줄/발음은 그대로)
  const own = stripLyricTracks(ctx.ownLyrics);
  if (synced && own.trim()) {
    const ownParsed = parseLyrics(ctx.ownLyrics);
    if (!ownParsed.some((l) => l.time !== null)) {
      const aligned = alignPlainToSynced(own.split(/\r?\n/), parseLrc(c.syncedLyrics ?? ""));
      if (aligned.coverage >= 0.4 && !validateLines(aligned.lines)) {
        preview.alignedCoverage = aligned.coverage;
        preview.alignedText = formatLyricsWithTracks(
          aligned.lines.map((l, i) => ({ time: l.matched ? l.time : null, text: l.text, pron: ownParsed[i]?.pron, trans: ownParsed[i]?.trans }))
        );
      }
    }
  }
  return preview;
}

export type ApplyMode = "replace" | "align";

/** 적용 시 저장할 텍스트. 없으면(해당 모드 불가) null */
export function textForApply(p: CandidatePreview, mode: ApplyMode): string | null {
  const t = mode === "align" ? p.alignedText : p.replaceText;
  return t && t.trim() ? t : null;
}

// ---------------------------------------------------------------- 덮어쓰기 백업 (직전 1회)

const BACKUP_PREFIX = "songbook:lyrics-backup:v1:";

export function writeLyricsBackup(songId: string, lyrics: string): void {
  try {
    localStorage.setItem(BACKUP_PREFIX + songId, JSON.stringify({ at: Date.now(), lyrics }));
  } catch {
    // 저장소를 못 써도 적용 자체는 진행한다
  }
}

export function readLyricsBackup(songId: string): { at: number; lyrics: string } | null {
  try {
    const raw = localStorage.getItem(BACKUP_PREFIX + songId);
    if (!raw) return null;
    const v = JSON.parse(raw) as { at?: unknown; lyrics?: unknown };
    return typeof v.at === "number" && typeof v.lyrics === "string" ? { at: v.at, lyrics: v.lyrics } : null;
  } catch {
    return null;
  }
}

export function clearLyricsBackup(songId: string): void {
  try {
    localStorage.removeItem(BACKUP_PREFIX + songId);
  } catch {
    // ignore
  }
}
