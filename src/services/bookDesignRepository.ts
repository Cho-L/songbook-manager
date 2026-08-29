import { DEFAULT_BOOK_DESIGN, type BookDesign } from "../types/bookDesign";
import { supabase, isSupabaseConfigured } from "./supabaseClient";

const LOCAL_KEY_PREFIX = "songbook:book-design:";

interface BookDesignRow {
  preset: string;
  accent_color: string;
  background_color: string;
  surface_color: string;
  text_color: string;
  title: string | null;
  description: string | null;
  song_display: string;
}

function rowToDesign(row: BookDesignRow): BookDesign {
  return {
    preset: row.preset as BookDesign["preset"],
    accentColor: row.accent_color,
    backgroundColor: row.background_color,
    surfaceColor: row.surface_color,
    textColor: row.text_color,
    title: row.title,
    description: row.description,
    songDisplay: row.song_display as BookDesign["songDisplay"],
  };
}

function designToRow(design: Partial<BookDesign>) {
  const row: Record<string, unknown> = {};
  if (design.preset !== undefined) row.preset = design.preset;
  if (design.accentColor !== undefined) row.accent_color = design.accentColor;
  if (design.backgroundColor !== undefined) row.background_color = design.backgroundColor;
  if (design.surfaceColor !== undefined) row.surface_color = design.surfaceColor;
  if (design.textColor !== undefined) row.text_color = design.textColor;
  if (design.title !== undefined) row.title = design.title;
  if (design.description !== undefined) row.description = design.description;
  if (design.songDisplay !== undefined) row.song_display = design.songDisplay;
  return row;
}

export const bookDesignRepository = {
  async get(ownerId: string): Promise<BookDesign> {
    if (!isSupabaseConfigured || !supabase) {
      try {
        const raw = localStorage.getItem(LOCAL_KEY_PREFIX + ownerId);
        return raw ? { ...DEFAULT_BOOK_DESIGN, ...JSON.parse(raw) } : DEFAULT_BOOK_DESIGN;
      } catch {
        return DEFAULT_BOOK_DESIGN;
      }
    }
    const { data, error } = await supabase
      .from("book_designs")
      .select("*")
      .eq("owner_id", ownerId)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToDesign(data as BookDesignRow) : DEFAULT_BOOK_DESIGN;
  },

  async update(ownerId: string, patch: Partial<BookDesign>): Promise<BookDesign> {
    if (!isSupabaseConfigured || !supabase) {
      const current = await bookDesignRepository.get(ownerId);
      const merged = { ...current, ...patch };
      localStorage.setItem(LOCAL_KEY_PREFIX + ownerId, JSON.stringify(merged));
      return merged;
    }
    const { data, error } = await supabase
      .from("book_designs")
      .upsert({ owner_id: ownerId, ...designToRow(patch) }, { onConflict: "owner_id" })
      .select()
      .single();
    if (error) throw error;
    return rowToDesign(data as BookDesignRow);
  },
};
