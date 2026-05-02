export interface Track {
  id: number;
  rel_path: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  genre: string | null;
  year: number | null;
  track_no: number | null;
  duration_sec: number | null;
  size_bytes: number;
  bitrate: number | null;
  mime: string | null;
  rating: number;             // 0..5
  added_at: string;
  modified_at: string;
  last_edited_at: string | null;
  url: string;
  cover_url: string | null;
}

export interface TrackListResponse {
  total: number;
  limit: number;
  offset: number;
  tracks: Track[];
}

export interface Status {
  ok: boolean;
  service: string;
  version: string;
  tracks: number;
  playlists: number;
  music_dir: string;
  last_scan: string | null;
  started_at: string;
  uptime_sec: number;
}

export interface Playlist {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
  track_count: number;
}

export interface PlaylistDetail {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
  tracks: Track[];
}
