export interface Playlist {
  id: string;
  ownerId: string;
  name: string;
  createdAt: string;
}

/** 플레이리스트 안의 곡 하나 (순서 포함) */
export interface PlaylistSongEntry {
  songId: string;
  position: number;
}
