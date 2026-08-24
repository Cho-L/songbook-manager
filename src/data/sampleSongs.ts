import type { Song } from "../types/song";

// 앱을 처음 실행했을 때 빈 화면만 나오지 않도록 넣는 개발용 샘플 데이터.
// 필요 없어지면 이 배열 하나만 비우면 됨 (import하는 songRepository.ts 쪽 수정 불필요).
export const sampleSongs: Song[] = [
  {
    id: "sample-1",
    ownerId: "demo-owner",
    title: "밤의 조각",
    artist: "테스트 아티스트",
    composer: "김작곡",
    lyricist: "이작사",
    genre: "발라드",
    key: "C",
    bpm: 72,
    difficulty: 3,
    tags: ["감성", "발라드", "연습곡"],
    favorite: true,
    lyrics:
      "[Verse]\n창밖에 내리는 별빛 아래\n너의 목소리를 떠올려\n\n[Chorus]\n밤의 조각 하나씩 모아서\n너에게 닿을 편지를 써\n(테스트용 짧은 샘플 가사)",
    chords: "C  G  Am  F\nC  G  F  G",
    memo: "후렴 전 숨 크게 들이쉬기",
    createdAt: "2026-08-01T09:00:00.000Z",
    updatedAt: "2026-08-01T09:00:00.000Z",
  },
  {
    id: "sample-2",
    ownerId: "demo-owner",
    title: "여름 신호",
    artist: "샘플 밴드",
    genre: "팝",
    key: "G",
    bpm: 118,
    difficulty: 2,
    tags: ["신남", "여름"],
    favorite: false,
    lyrics:
      "[Verse]\n뜨거운 아스팔트 위로\n첫 매미 소리가 울리면\n\n[Chorus]\n여름 신호 켜졌어 지금부터\n(테스트용 짧은 샘플 가사)",
    chords: "G  D  Em  C\nG  D  C  D",
    createdAt: "2026-08-05T09:00:00.000Z",
    updatedAt: "2026-08-05T09:00:00.000Z",
  },
  {
    id: "sample-3",
    ownerId: "demo-owner",
    title: "골목 끝에서",
    artist: "테스트 아티스트",
    composer: "박멜로디",
    genre: "인디",
    key: "Am",
    bpm: 90,
    difficulty: 4,
    tags: ["인디", "잔잔"],
    favorite: true,
    lyrics:
      "[Verse]\n골목 끝에서 널 기다리던\n그 겨울이 다시 오면\n\n[Chorus]\n손 시려도 놓지 않을게\n(테스트용 짧은 샘플 가사)",
    chords: "Am  F  C  G\nAm  F  G  G",
    memo: "카포 2프렛",
    createdAt: "2026-08-10T09:00:00.000Z",
    updatedAt: "2026-08-10T09:00:00.000Z",
  },
];
