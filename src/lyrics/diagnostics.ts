import type { LyricsDiagnosticEvent, LyricsRequestObserver } from "./types";

/** Only song query metadata is retained, never raw URLs, account data or lyric bodies. */
export function diagnosticText(value: string | null): string | undefined {
  if (!value) return undefined;
  return value.replace(/https?:\/\/\S+|\b[^\s@]+@[^\s@]+\.[^\s@]+/giu, "[redacted]")
    .replace(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/giu, "[redacted]")
    .replace(/[A-Za-z0-9_-]{40,}/gu, "[redacted]")
    .replace(/[\p{Cc}\p{Cs}]/gu, " ").slice(0, 160);
}

export function reportRequest(observe: LyricsRequestObserver | undefined, request: LyricsDiagnosticEvent): void {
  try { observe?.(request); } catch { /* Diagnostics must never change search behavior. */ }
}
