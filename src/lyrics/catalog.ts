import { normalizeText, normalizeTitle } from "./text";
import type { ArtistRecording } from "./types";

/**
 * 아티스트별 곡 목록 정리 (순수 함수).
 *  - 같은 곡이 녹음/릴리스마다 여러 번 등록된 경우 하나로 합친다 (제목에서 괄호 부가 표기를 뺀 값이 같으면 같은 곡).
 *  - 라이브/리믹스/인스트루멘탈 등 다른 버전은 원곡이 있으면 원곡에 묶고, 원곡이 없으면 그대로 보여 준다.
 */
export interface RecordingGroup {
  /** 대표 녹음 */
  main: ArtistRecording;
  /** 이 곡으로 묶인 녹음 수 (대표 포함) */
  count: number;
  /** 묶인 다른 버전의 수 (라이브/리믹스 등) */
  versions: number;
  /** 묶인 모든 녹음의 다른 표기 (대표 것 포함, 중복 제거) */
  altTitles: string[];
}

export function groupRecordings(items: ArtistRecording[]): RecordingGroup[] {
  const groups = new Map<string, RecordingGroup>();
  const order: string[] = [];
  // 원곡(버전 아님)을 먼저 처리해 대표로 삼는다. 표시 순서는 처음 등장한 순서를 유지한다.
  const keyOf = (r: ArtistRecording) => normalizeTitle(r.title) || normalizeText(r.title);
  for (const r of items) {
    const k = keyOf(r);
    if (!k) continue;
    if (!groups.has(k)) order.push(k);
    const g = groups.get(k);
    if (!g) {
      groups.set(k, { main: r, count: 1, versions: r.isVersion ? 1 : 0, altTitles: [...r.altTitles] });
      continue;
    }
    g.count++;
    if (r.isVersion) g.versions++;
    // 대표: 버전이 아닌 것 > 길이 정보가 있는 것
    if ((g.main.isVersion && !r.isVersion) || (g.main.isVersion === r.isVersion && !g.main.length && r.length)) g.main = r;
    for (const a of r.altTitles) if (!g.altTitles.some((x) => normalizeTitle(x) === normalizeTitle(a))) g.altTitles.push(a);
  }
  return order.map((k) => groups.get(k) as RecordingGroup);
}

/** 제목 필터: 원어 제목, 로마자/다른 표기, 크레딧 어디든 (대소문자·공백·가나 종류 무시) */
export function filterGroups(groups: RecordingGroup[], query: string): RecordingGroup[] {
  const q = normalizeText(query);
  if (!q) return groups;
  return groups.filter((g) => [g.main.title, ...g.altTitles].some((t) => normalizeText(t).includes(q)));
}
