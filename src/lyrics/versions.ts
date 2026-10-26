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
  const kinds = RULES.filter(([, pattern]) => pattern.test(text)).map(([kind]) => kind);
  if (!kinds.length && !GENERIC.test(text)) return "original";
  const markers = [...RULES.map(([, p]) => p), GENERIC, EXPLICIT_ORIGINAL];
  const stripMarkers = (s: string) => markers.reduce((rest, p) => rest.replace(new RegExp(p.source, "giu"), " "), s);
  const annotations = [...text.matchAll(/[([{【]([^\])}】]*)[\])}】]/gu)].map((m) => m[1]);
  const bare = text.replace(/[([{【][^\])}】]*[\])}】]/gu, " ");
  // Include suffix qualifiers when the marker is outside brackets ("Song - Live at Tokyo").
  const first = markers.map((p) => bare.search(p)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
  if (first !== undefined) annotations.push(bare.slice(first));
  const details = annotations.map((a) => compact(stripMarkers(a))).filter(Boolean).sort();
  // Only a bare Original/Studio Version label is compatible with an unlabelled original.
  if (!kinds.length && EXPLICIT_ORIGINAL.test(text) && details.length === 0) return "original";
  if (!kinds.length) kinds.push("other");
  return JSON.stringify([kinds.sort(), details]);
}

export function lyricsVersionsMatch(a: string, b: string): boolean {
  return lyricsVersionKey(a) === lyricsVersionKey(b);
}

export function hasLyricsVersion(title: string): boolean {
  return lyricsVersionKey(title) !== "original";
}
