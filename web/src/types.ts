export type TrackSource = 'mine' | 'public' | 'shared';

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
  favorited: boolean;         // per-user; reflects current user's user_favorites
  added_at: string;
  modified_at: string;
  last_edited_at: string | null;
  url: string;
  cover_url: string | null;
  // Slice 3 — visibility / sharing
  owner_id: number | null;
  owner_username: string | null;
  owner_display_name: string | null;
  is_public: boolean;
  is_owner: boolean;
  shared_with_me: boolean;
  source: TrackSource;
}

export interface ShareUser {
  id: number;
  username: string;
  display_name: string | null;
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
  // Slice 4 — ownership / visibility
  owner_id: number | null;
  owner_username: string | null;
  owner_display_name: string | null;
  is_public: boolean;
  is_owner: boolean;
  shared_with_me: boolean;
  source: TrackSource;
}

export interface PlaylistDetail extends Playlist {
  tracks: Track[];
}
