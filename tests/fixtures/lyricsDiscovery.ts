/** Synthetic provider contents: no claim these records exist on LRCLIB. Issue #10 metadata only. */
export const JP = "グリズリーに襲われたら♡";
export const BARE = "グリズリーに襲われたら";
export const KO = "그리즐리에게 습격당한다면";
export const ROM = "Grizzly ni Osowaretara";
export const LRC = "[00:10.00] synthetic alpha\n[00:20.00] synthetic beta";
export const original = { id: 100, trackName: JP, artistName: "神宿", albumName: "mock single", duration: 246, syncedLyrics: LRC, plainLyrics: "synthetic alpha\nsynthetic beta" };
export const live = { ...original, id: 101, trackName: `${JP} (Live in Okinawa)`, duration: 251 };
export const romanized = { ...original, trackName: ROM, artistName: "Kamiyado" };
export function discoveryFetch(mode: "roman" | "metadata" | "symbols" | "empty" | "no-lyrics" | "live" | "both", calls: URL[]): typeof fetch {
  return async (target) => {
    const url = new URL(String(target));
    calls.push(url);
    if (url.hostname !== "lyrics.invalid") throw new Error("unexpected external destination");
    const t = url.searchParams.get("track_name");
    const a = url.searchParams.get("artist_name");
    const q = url.searchParams.get("q");
    if (url.pathname === "/api/get") {
      if (mode === "metadata" && [JP, BARE].includes(t ?? "") && ["神宿", "Kamiyado"].includes(a ?? "")) return Response.json(original);
      return Response.json({ name: "TrackNotFound" }, { status: 404 });
    }
    if (mode === "roman" && t === ROM && a === "Kamiyado") return Response.json([romanized]);
    if (mode === "symbols" && t === BARE && a === "神宿") return Response.json([original]);
    if (mode === "no-lyrics") return Response.json([{ ...original, plainLyrics: null, syncedLyrics: null }]);
    if (mode === "live") return Response.json([live]);
    if (mode === "both") return Response.json([live, original]);
    if (mode === "roman" && q === `${ROM} Kamiyado`) return Response.json([romanized]);
    return Response.json([]);
  };
}
