import { DEFAULT_PREFERENCES, type UserPreferences } from "../types/preferences";
import { supabase, isSupabaseConfigured } from "./supabaseClient";

const LOCAL_KEY_PREFIX = "songbook:preferences:";

interface PreferencesRow {
  lyrics_font_size: string;
  chords_font_size: string;
  font_family: string;
  lyrics_color: string;
  chords_color: string;
  background_color: string;
  theme: string;
  page_size: number;
}

function rowToPreferences(row: PreferencesRow): UserPreferences {
  return {
    lyricsFontSize: row.lyrics_font_size as UserPreferences["lyricsFontSize"],
    chordsFontSize: row.chords_font_size as UserPreferences["chordsFontSize"],
    fontFamily: row.font_family as UserPreferences["fontFamily"],
    lyricsColor: row.lyrics_color,
    chordsColor: row.chords_color,
    backgroundColor: row.background_color,
    theme: row.theme as UserPreferences["theme"],
    pageSize: row.page_size as UserPreferences["pageSize"],
  };
}

function preferencesToRow(prefs: Partial<UserPreferences>) {
  const row: Record<string, unknown> = {};
  if (prefs.lyricsFontSize !== undefined) row.lyrics_font_size = prefs.lyricsFontSize;
  if (prefs.chordsFontSize !== undefined) row.chords_font_size = prefs.chordsFontSize;
  if (prefs.fontFamily !== undefined) row.font_family = prefs.fontFamily;
  if (prefs.lyricsColor !== undefined) row.lyrics_color = prefs.lyricsColor;
  if (prefs.chordsColor !== undefined) row.chords_color = prefs.chordsColor;
  if (prefs.backgroundColor !== undefined) row.background_color = prefs.backgroundColor;
  if (prefs.theme !== undefined) row.theme = prefs.theme;
  if (prefs.pageSize !== undefined) row.page_size = prefs.pageSize;
  return row;
}

export const preferencesRepository = {
  async get(userId: string): Promise<UserPreferences> {
    if (!isSupabaseConfigured || !supabase) {
      try {
        const raw = localStorage.getItem(LOCAL_KEY_PREFIX + userId);
        return raw ? { ...DEFAULT_PREFERENCES, ...JSON.parse(raw) } : DEFAULT_PREFERENCES;
      } catch {
        return DEFAULT_PREFERENCES;
      }
    }
    const { data, error } = await supabase
      .from("user_preferences")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToPreferences(data as PreferencesRow) : DEFAULT_PREFERENCES;
  },

  async update(userId: string, patch: Partial<UserPreferences>): Promise<UserPreferences> {
    if (!isSupabaseConfigured || !supabase) {
      const current = await preferencesRepository.get(userId);
      const merged = { ...current, ...patch };
      localStorage.setItem(LOCAL_KEY_PREFIX + userId, JSON.stringify(merged));
      return merged;
    }
    const { data, error } = await supabase
      .from("user_preferences")
      .upsert({ user_id: userId, ...preferencesToRow(patch) }, { onConflict: "user_id" })
      .select()
      .single();
    if (error) throw error;
    return rowToPreferences(data as PreferencesRow);
  },
};
