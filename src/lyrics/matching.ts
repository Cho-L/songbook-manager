import type { CandidateSummary, LyricsCandidate, ScoredCandidate, SyncedLyricLine, TitleArtistAliases } from "./types";
import { matchArtists } from "./artist";
import { hasVersionWord, normalizeText, similarity, titleSimilarityScore } from "./text";
import { hasHangul, hasLatin } from "./phonetic";

// ---------------------------------------------------------------- 후보 점수

/** 이 신뢰도 이상(그리고 아래 조건 충족)이면 사용자 확인 없이 자동 선택한다 — high */
export const AUTO_ACCEPT_CONFIDENCE = 0.75;
/** 이 신뢰도 이상이면 후보 목록으로 보여 주고 사용자가 고르게 한다 — medium. 그 미만은 실패(low) 처리 */
export const MEDIUM_CONFIDENCE = 0.5;
/** 곡에 가수가 적혀 있으면, 자동 선택하려면 가수도 어느 정도 맞아야 한다 (제목만 같은 다른 곡 방지) */
export const AUTO_ACCEPT_MIN_ARTIST = 0.55;
export const AUTO_ACCEPT_MIN_TITLE = 0.6;

export function scoreCandidate(song: { title: string; artist: string }, c: LyricsCandidate, aliases?: TitleArtistAliases): ScoredCandidate {
  let titleSimilarity = titleSimilarityScore(song.title, c.title);
  // 가수는 목록으로 나눠 순서/구분자/한글·영문 표기 차이를 흡수해서 비교한다. 가수 정보가 없는 곡은 중립(0.5)
  let artistSimilarity = song.artist.trim() ? matchArtists(song.artist, c.artist).score : 0.5;
  // 외부 메타데이터(MusicBrainz)가 알려 준 다른 언어 표기(꽃길 ↔ Flower Way, 김세정 ↔ Kim Sejeong)도 같은 기준으로 비교한다.
  // 별칭 제목은 "그 가수의 같은 곡"으로 확인된 표기일 때만 들어오므로, 후보의 가수까지 맞아야 인정한다.
  if (aliases && song.artist.trim()) {
    for (const a of aliases.artists) artistSimilarity = Math.max(artistSimilarity, matchArtists(a, c.artist).score);
    if (artistSimilarity >= AUTO_ACCEPT_MIN_ARTIST) {
      for (const t of aliases.titles) titleSimilarity = Math.max(titleSimilarity, titleSimilarityScore(t, c.title));
    }
  }
  // 저장된 곡 제목에는 없는 "Live/Remix/Cover" 같은 표시가 후보에만 있으면 다른 버전일 가능성이 크다
  const versionMismatch = hasVersionWord(c.title) && !hasVersionWord(song.title);
  const hasLyrics = Boolean(c.syncedLyrics || c.plainLyrics);
  let confidence = 0.55 * titleSimilarity + 0.3 * artistSimilarity + 0.1 * (c.syncedLyrics ? 1 : 0) + 0.05 * (hasLyrics ? 1 : 0);
  if (versionMismatch) confidence -= 0.15;
  confidence = Math.max(0, Math.min(1, confidence));
  return { ...c, confidence, titleSimilarity, artistSimilarity, versionMismatch };
}

/** high confidence: 점수 + 제목/가수 각각의 최소 조건까지 충족해야 사용자 확인 없이 자동 선택한다 */
export function isAutoAccept(c: ScoredCandidate, songHasArtist: boolean): boolean {
  return (
    c.confidence >= AUTO_ACCEPT_CONFIDENCE &&
    c.titleSimilarity >= AUTO_ACCEPT_MIN_TITLE &&
    (!songHasArtist || c.artistSimilarity >= AUTO_ACCEPT_MIN_ARTIST)
  );
}

/** 쓸 수 없는 후보(연주곡, 가사 없음)를 빼고 신뢰도 순으로 정렬. 비슷한 점수에서는 싱크 가사가 있는 쪽을 앞에 둔다. */
export function rankCandidates(song: { title: string; artist: string }, candidates: LyricsCandidate[], aliases?: TitleArtistAliases): ScoredCandidate[] {
  return candidates
    .filter((c) => !c.instrumental && (c.syncedLyrics || c.plainLyrics))
    .map((c) => scoreCandidate(song, c, aliases))
    .sort((a, b) => b.confidence - a.confidence || Number(Boolean(b.syncedLyrics)) - Number(Boolean(a.syncedLyrics)));
}

/**
 * "제목은 서로 다른 문자 체계라 비교할 수 없지만(꽃길 ↔ Flower Way) 가수는 확실히 같은" 후보.
 * 번역을 추측해서 자동 선택하지는 않고, 사용자가 후보 목록에서 직접 고르게 할 때만 쓴다.
 */
export function isCrossScriptTitleChoice(song: { title: string }, c: ScoredCandidate): boolean {
  const a = song.title;
  const b = c.title;
  const crossScript = (hasHangul(a) && !hasLatin(a) && hasLatin(b) && !hasHangul(b)) || (hasHangul(b) && !hasLatin(b) && hasLatin(a) && !hasHangul(a));
  return crossScript && c.artistSimilarity >= 0.9 && c.titleSimilarity < 0.5 && !c.versionMismatch;
}

export function summarize(c: ScoredCandidate): CandidateSummary {
  return { id: c.id, title: c.title, artist: c.artist, duration: c.duration, hasSynced: Boolean(c.syncedLyrics), confidence: Math.round(c.confidence * 100) / 100 };
}

// ---------------------------------------------------------------- 저장된 평문 가사 ↔ 싱크 가사 정렬

/** 섹션 표기("[Verse]", "(후렴)")나 빈 줄은 정렬 대상이 아니다 */
function isStructural(text: string): boolean {
  const t = text.trim();
  return t === "" || /^\[[^\]]*\]$/.test(t) || /^\([^)]*\)$/.test(t);
}

export const LINE_MATCH_THRESHOLD = 0.55;

export interface AlignOutcome {
  lines: SyncedLyricLine[];
  matched: number;
  total: number;
  /** 시간을 얻은 줄의 비율 (정렬 대상 줄 기준) */
  coverage: number;
  /** 매칭된 줄의 평균 유사도 */
  meanSimilarity: number;
}

/**
 * 사용자가 저장해 둔 평문 가사 줄들을, provider 의 싱크 가사 줄들과 "순서를 지키며" 가장 잘 맞게 짝짓는다
 * (가중 LCS 동적계획법). 같은 후렴이 여러 번 나와도 순서대로 대응되고,
 * 짝을 못 찾은 줄은 시간 없이(matched=false) 둔다 — 이웃 줄 사이에서 시간을 지어내지 않는다.
 */
export function alignPlainToSynced(plainLines: string[], synced: SyncedLyricLine[]): AlignOutcome {
  const U = plainLines.map((t) => ({ text: t, key: normalizeText(t), skip: isStructural(t) }));
  const P = synced.filter((l) => l.time !== null && normalizeText(l.text) !== "").map((l) => ({ line: l, key: normalizeText(l.text) }));
  const ui = U.map((u, i) => (u.skip ? -1 : i)).filter((i) => i >= 0);
  const n = ui.length;
  const m = P.length;
  // sim[a][b]: a번째 대상 줄 ↔ b번째 provider 줄
  const sim: number[][] = ui.map((i) => P.map((p) => similarity(U[i].key, p.key)));
  // 뒤에서부터 계산하는 가중 LCS: dp[a][b] = 대상 줄 a.. 와 provider 줄 b.. 로 얻을 수 있는 최대 유사도 합.
  // 앞에서부터 따라가며 "가능하면 가장 이른 대응"을 고르므로, 후렴이 한 번만 적힌 가사는 첫 번째 후렴에 붙는다.
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let a = n - 1; a >= 0; a--) {
    for (let b = m - 1; b >= 0; b--) {
      const s = sim[a][b];
      const take = s >= LINE_MATCH_THRESHOLD ? s + dp[a + 1][b + 1] : -1;
      dp[a][b] = Math.max(dp[a + 1][b], dp[a][b + 1], take);
    }
  }
  const pairs = new Map<number, number>(); // 대상 줄 순번 → provider 순번
  let a = 0;
  let b = 0;
  while (a < n && b < m) {
    const s = sim[a][b];
    if (s >= LINE_MATCH_THRESHOLD && Math.abs(dp[a][b] - (s + dp[a + 1][b + 1])) < 1e-9) {
      pairs.set(a, b);
      a++;
      b++;
    } else if (Math.abs(dp[a][b] - dp[a][b + 1]) < 1e-9) b++;
    else a++;
  }
  const byUserIndex = new Map<number, { time: number; sim: number }>();
  for (const [aIdx, bIdx] of pairs) byUserIndex.set(ui[aIdx], { time: P[bIdx].line.time as number, sim: sim[aIdx][bIdx] });
  let simSum = 0;
  const lines: SyncedLyricLine[] = U.map((u, i) => {
    const hit = byUserIndex.get(i);
    if (!hit) return { time: null, text: u.text, matched: false };
    simSum += hit.sim;
    return { time: hit.time, text: u.text, matched: true, confidence: Math.round(hit.sim * 100) / 100 };
  });
  const matched = byUserIndex.size;
  return {
    lines,
    matched,
    total: n,
    coverage: n === 0 ? 0 : matched / n,
    meanSimilarity: matched === 0 ? 0 : simSum / matched,
  };
}
