/**
 * ISSUE #7: TEST-ONLY CONTRACT MODEL, not a deployed parser/adapter/security boundary.
 * Envelopes represent events already authenticated by a future official adapter.
 * No network, tokens, DB or runtime imports point to this file.
 */
import type { Song } from "../../src/types/song.ts";
import { searchSongs } from "../../src/utils/search.ts";
import { getSongAliases } from "../../src/utils/songAliases.ts";
import { normalizeForSearch } from "../../src/utils/searchNormalize.ts";
import { cleanRequesterName, evaluateSubmit, type ExistingRequest, type RequestSettings } from "../../src/utils/songRequest.ts";

export type Platform = "chzzk" | "soop";
export type Command = { kind: "submit"; title: string; artist: string } | { kind: "queue" | "cancel" };
export function parseCommand(raw: string): Command | null {
  if ([...raw].length > 300 || /[\p{Cc}\p{Cs}]/u.test(raw)) return null;
  const text = raw.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (text === "!대기열") return { kind: "queue" };
  if (text === "!취소") return { kind: "cancel" };
  const submit = /^!신청 (.+)$/.exec(text);
  if (!submit) return null;
  const parts = submit[1].split("/").map((s) => s.trim());
  if (parts.length !== 2 || parts.some((s) => !normalizeForSearch(s) || [...s].length > 100)) return null;
  return { kind: "submit", title: parts[0], artist: parts[1] };
}

/** Reuse broad search as candidates, then require exact title AND artist aliases; never pick first fuzzy hit. */
export function matchCommand(songs: Song[], command: Extract<Command, { kind: "submit" }>) {
  return searchSongs(songs, `${command.title} / ${command.artist}`).filter((song) => {
    const aliases = getSongAliases(song);
    return [song.title, ...aliases.titles].some((s) => normalizeForSearch(s) === normalizeForSearch(command.title)) &&
      [song.artist, ...aliases.artists].some((s) => normalizeForSearch(s) === normalizeForSearch(command.artist));
  });
}
export interface Envelope {
  platform: string;
  channelId: string;
  userId: string;
  eventId: string;
  displayName: string;
  text: string;
  fromSelf?: boolean;
}
export interface Binding { platform: Platform; channelId: string; bookId: string }
export interface ModelRow extends ExistingRequest {
  id: string; bookId: string; platform: Platform; channelId: string; userId: string;
  title: string; artist: string; requesterName: string;
}
const scope = (...values: string[]) => JSON.stringify(values);
export class ChatRequestModel {
  readonly rows: ModelRow[] = [];
  readonly seen = new Map<string, number>();
  private commands = new Map<string, number[]>();
  constructor(
    private songs: Song[],
    private bindings: Binding[],
    private settings: RequestSettings = { accepting: true, maxQueue: 30, perUserMax: 2 },
    private capacity = 1000,
  ) {}
  handle(event: Envelope, now: number) {
    if (event.platform !== "chzzk" && event.platform !== "soop") return { code: "unsupported_platform" };
    if (!event.userId || !event.eventId || !Number.isFinite(now)) return { code: "invalid_event" };
    const binding = this.bindings.find((b) => b.platform === event.platform && b.channelId === event.channelId);
    if (!binding) return { code: "unbound_channel" };
    if (event.fromSelf) return { code: "ignored_self" };
    const command = parseCommand(event.text);
    if (!command) return { code: "invalid_command" };
    for (const [k, expires] of this.seen) if (expires <= now) this.seen.delete(k);
    const eventKey = scope(event.platform, event.channelId, event.eventId);
    if (this.seen.has(eventKey)) return { code: "duplicate_event" };
    if (this.seen.size >= this.capacity) return { code: "busy" }; // bounded; fail closed, do not evict live dedupe entries
    this.seen.set(eventKey, now + 600_000);
    const actor = scope(binding.bookId, event.platform, event.channelId, event.userId);
    for (const [k, times] of this.commands) {
      const recent = times.filter((t) => now - t < 20_000);
      if (recent.length) this.commands.set(k, recent); else this.commands.delete(k);
    }
    const history = this.commands.get(actor) ?? [];
    if (history.length >= 5) return { code: "command_rate_limited" };
    history.push(now);
    this.commands.set(actor, history);
    const rows = this.rows.filter((r) => r.bookId === binding.bookId);
    if (command.kind === "queue") {
      const visible = rows.filter((r) => r.status === "approved" || r.status === "playing")
        .sort((a, b) => Number(b.status === "playing") - Number(a.status === "playing") || a.position - b.position).slice(0, 5);
      return { code: "queue", pendingCount: rows.filter((r) => r.status === "pending").length,
        queue: visible.map((r) => ({ title: r.title, artist: r.artist, status: r.status })) };
    }
    if (command.kind === "cancel") {
      const mine = rows.filter((r) => r.requesterKey === actor && r.status === "pending")
        .sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt) || b.position - a.position)[0];
      if (!mine) return { code: "nothing_to_cancel" };
      mine.status = "canceled";
      return { code: "canceled", id: mine.id };
    }
    const name = cleanRequesterName(event.displayName);
    if (!name) return { code: "bad_name" };
    const candidates = matchCommand(this.songs.filter((s) => s.ownerId === binding.bookId), command);
    if (!candidates.length) return { code: "song_not_found" };
    if (candidates.length > 1) return { code: "needs_choice" };
    const song = candidates[0];
    const verdict = evaluateSubmit(rows, this.settings, { songId: song.id, key: actor, songExists: true }, now);
    if (!verdict.ok) return { code: verdict.code };
    const id = `mock-${this.rows.length + 1}`;
    this.rows.push({ id, bookId: binding.bookId, platform: event.platform, channelId: event.channelId, userId: event.userId,
      songId: song.id, title: song.title, artist: song.artist ?? "", requesterName: name, requesterKey: actor,
      status: "pending", requestedAt: new Date(now).toISOString(), position: verdict.position });
    return { code: "accepted", id };
  }
}
