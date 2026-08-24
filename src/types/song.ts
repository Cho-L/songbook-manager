export interface Song {
  id: string;
  ownerId: string; // 이 노래를 소유한 관리자(Profile.id)
  title: string;
  artist: string;
  composer?: string;
  lyricist?: string;
  genre?: string;
  key?: string;
  bpm?: number;
  difficulty?: number; // 1~5
  lyrics?: string;
  chords?: string;
  memo?: string;
  tags: string[];
  favorite: boolean;
  youtubeVideoId?: string; // YouTube MR 영상 ID
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

// 폼 입력값: Song에서 서버/시스템이 채우는 필드를 뺀 사용자 입력 부분
export type SongFormInput = Omit<
  Song,
  "id" | "ownerId" | "favorite" | "createdAt" | "updatedAt"
>;

export type SortOption = "recent" | "title" | "artist" | "difficulty" | "favorite";
