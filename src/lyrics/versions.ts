/** Conservative title metadata gate, not an inference about the actual audio recording. */
const RULES: [string, RegExp][] = [
  ["live", /\blive\b|라이브|ライブ/iu],
  ["cover", /\bcover\b|커버|カバー/iu],
  ["instrumental", /\b(?:mr|inst\.?|instrumental|karaoke)\b|\boff[ -]?vocal\b|반주|노래방|伴奏|カラオケ|インスト(?:ゥルメンタル)?/iu],
  ["acoustic", /\bacoustic\b|어쿠스틱|アコースティック/iu],
  ["remix", /\bremix\b|리믹스|リミックス/iu],
  ["edit", /\bedit\b/iu],
  ["remaster", /\bremaster(?:ed)?\b|리마스터|リマスター/iu],
];
const GENERIC = /\b(?:ver\.?|version)\b|버전|バージョン/iu;
const EXPLICIT_ORIGINAL = /\b(?:original|studio)\b|원곡|오리지널|オリジナル/iu;
const compact = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** Includes recording qualifiers so Live at Tokyo and Live at Osaka are not assumed interchangeable. */
export function lyricsVersionKey(title: string): string {
  const text = title.normalize("NFKC");
  const markers = [...RULES.map(([, p]) => p), GENERIC, EXPLICIT_ORIGINAL];
  const isMarked = (s: string) => RULES.some(([, p]) => p.test(s)) || GENERIC.test(s);
  // Version metadata belongs in annotations or suffixes. A word in the actual
  // title ("Live Forever", "Cover Me") is not itself evidence of a recording version.
  const annotations = [...text.matchAll(/[([{【]([^\])}】]*)[\])}】]/gu)]
    .map((m) => m[1]);
  const bare = text.replace(/[([{【][^\])}】]*[\])}】]/gu, " ").trim();
  const separated = bare.split(/\s+[-–—|:]\s*/u).slice(1).filter(isMarked);
  annotations.push(...separated);
  if (!separated.length) {
    const positions = markers.flatMap((p) => [...bare.matchAll(new RegExp(p.source, "giu"))].map((m) => m.index));
    const first = positions.filter((i) => i > 0).sort((a, b) => a - b)[0];
    if (first !== undefined) {
      const suffix = bare.slice(first).trim();
      // Keep ambiguous suffixes conservative, including venue/recording details.
      annotations.push(GENERIC.test(suffix) ? bare : suffix);
    } else if (/^live\s+(?:at|in|on|from)\b/iu.test(bare)) {
      annotations.push(bare);
    }
  }
  const metadata = annotations.join(" ");
  const kinds = RULES.filter(([, pattern]) => pattern.test(metadata)).map(([kind]) => kind);
  if (!kinds.length && !GENERIC.test(metadata)) return "original";
  const stripMarkers = (s: string) => markers.reduce((rest, p) => rest.replace(new RegExp(p.source, "giu"), " "), s);
  const details = annotations.map((a) => compact(stripMarkers(a))).filter(Boolean).sort();
  // Only a bare Original/Studio Version label is compatible with an unlabelled original.
  if (!kinds.length && EXPLICIT_ORIGINAL.test(metadata) && details.length === 0) return "original";
  if (!kinds.length) kinds.push("other");
  return JSON.stringify([kinds.sort(), details]);
}

export function lyricsVersionsMatch(a: string, b: string): boolean {
  if (lyricsVersionKey(a) !== lyricsVersionKey(b)) return false;
  // An otherwise unannotated leading word can still be an explicit prefix when
  // removing it yields the other title exactly ("Live Song" versus "Song").
  // This preserves safety without calling every "Live Forever" a live recording.
  const prefixes = [...RULES.map(([, p]) => p), GENERIC];
  const prefixesOtherTitle = (title: string, other: string) => prefixes.some((p) => {
    const match = p.exec(title.normalize("NFKC"));
    if (!match || match.index !== 0) return false;
    const rest = compact(title.normalize("NFKC").slice(match[0].length));
    return Boolean(rest) && rest === compact(other.normalize("NFKC"));
  });
  return !prefixesOtherTitle(a, b) && !prefixesOtherTitle(b, a);
}

export function hasLyricsVersion(title: string): boolean {
  return lyricsVersionKey(title) !== "original";
}
