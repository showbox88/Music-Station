import type { Playlist, PlaylistDetail, Status, Track, TrackListResponse } from './types';

export interface TrackEdit {
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  genre?: string | null;
  year?: number | null;
  track_no?: number | null;
  rating?: number | null;
  favorited?: boolean;
}

export type LyricSource = 'local' | 'lrclib' | 'netease' | 'qq' | 'manual';

export interface LyricsResponse {
  found: boolean;
  source?: LyricSource | null;
  synced?: string;
  has_timestamps?: boolean;
}

export interface LyricCandidate {
  source: 'lrclib' | 'netease' | 'qq';
  ext_id: string;
  title: string;
  artist: string;
  album: string | null;
  duration_sec: number | null;
  has_synced: boolean;
}

export interface LyricSearchResponse {
  count: number;
  candidates: LyricCandidate[];
}

export interface LyricPreviewResponse {
  ok: boolean;
  found: boolean;
  source?: 'lrclib' | 'netease' | 'qq';
  ext_id?: string;
  synced?: string | null;
  plain?: string | null;
  has_timestamps?: boolean;
}

export interface CoverSearchResult {
  source: string;
  artist: string | null;
  album: string | null;
  thumbnail_url: string | null;
  full_url: string | null;
}

// Production base = '/app/', dev base = '/'. Vite injects the value at build.
// API endpoints live under <base>api/. After Tailscale strips the /app prefix
// in production, the backend receives /api/... and matches its routers.
const API_PREFIX = `${import.meta.env.BASE_URL}api`;

function url(path: string): string {
  return `${API_PREFIX}${path.startsWith('/') ? path : '/' + path}`;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(url(path));
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  return res.json();
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(url(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  return res.json();
}

async function putJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(url(path), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  return res.json();
}

async function deleteReq<T>(path: string): Promise<T> {
  const res = await fetch(url(path), { method: 'DELETE' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  return res.json();
}

export interface TracksQuery {
  q?: string;
  artist?: string;
  album?: string;
  genre?: string;
  favorited?: boolean;          // when true, only favorited tracks
  limit?: number;
  offset?: number;
  sort?: 'title' | 'artist' | 'album' | 'added_at' | 'duration_sec';
  dir?: 'asc' | 'desc';
}

export interface DiskInfo {
  ok: boolean;
  music_dir: string;
  total_bytes: number;
  free_bytes: number;
  used_bytes: number;
  library_bytes: number;
}

export const api = {
  status: () => getJson<Status>('/status'),
  disk: () => getJson<DiskInfo>('/status/disk'),
  rescan: () =>
    postJson<{
      ok: boolean;
      scanned_files: number;
      inserted: number;
      updated: number;
      removed: number;
      failed: number;
      took_ms: number;
      covers: {
        tried: number;
        found: number;
        failed: number;
        skipped: number;
      } | null;
    }>('/status/rescan'),
  listTracks: (q: TracksQuery = {}) => {
    const params = new URLSearchParams();
    Object.entries(q).forEach(([k, v]) => v !== undefined && v !== '' && params.set(k, String(v)));
    return getJson<TrackListResponse>(`/tracks?${params.toString()}`);
  },
  updateTrack: (id: number, fields: TrackEdit) => putJson<Track>(`/tracks/${id}`, fields),
  getTrackByPath: (relPath: string) =>
    getJson<Track>(`/tracks/by-path?p=${encodeURIComponent(relPath)}`),
  deleteTrack: async (id: number) => {
    const res = await fetch(url(`/tracks/${id}`), { method: 'DELETE' });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
    return res.json() as Promise<{ ok: boolean; deleted_id: number; file_removed: boolean }>;
  },
  // ----- playlists -----
  listPlaylists: () => getJson<{ count: number; playlists: Playlist[] }>('/playlists'),
  getPlaylist: (id: number) => getJson<PlaylistDetail>(`/playlists/${id}`),
  createPlaylist: (name: string, description?: string) =>
    postJson<Playlist>('/playlists', { name, description }),
  updatePlaylist: (id: number, fields: { name?: string; description?: string }) =>
    putJson<Playlist>(`/playlists/${id}`, fields),
  deletePlaylist: (id: number) => deleteReq<{ ok: boolean }>(`/playlists/${id}`),
  addTracksToPlaylist: (id: number, trackIds: number[]) =>
    postJson<{ ok: boolean; added: number; skipped: number }>(`/playlists/${id}/tracks`, {
      track_ids: trackIds,
    }),
  removeTrackFromPlaylist: (id: number, trackId: number) =>
    deleteReq<{ ok: boolean }>(`/playlists/${id}/tracks/${trackId}`),
  reorderPlaylist: (id: number, trackIds: number[]) =>
    putJson<{ ok: boolean; count: number }>(`/playlists/${id}/order`, { track_ids: trackIds }),

  // ----- covers -----
  searchCovers: (q: string, limit = 12) =>
    getJson<{ count: number; results: CoverSearchResult[] }>(
      `/covers/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    ),
  uploadCover: async (trackId: number, file: File) => {
    const fd = new FormData();
    fd.append('cover', file, file.name);
    const res = await fetch(url(`/tracks/${trackId}/cover`), { method: 'POST', body: fd });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    return res.json() as Promise<{ ok: boolean; cover_url: string }>;
  },
  setCoverFromUrl: (trackId: number, srcUrl: string) =>
    postJson<{ ok: boolean; cover_url: string }>(`/tracks/${trackId}/cover/url`, { url: srcUrl }),
  deleteCover: (trackId: number) =>
    deleteReq<{ ok: boolean }>(`/tracks/${trackId}/cover`),

  // ----- lyrics -----
  getLyrics: (trackId: number) =>
    getJson<LyricsResponse>(`/tracks/${trackId}/lyrics`),
  fetchLyrics: (trackId: number) =>
    postJson<LyricsResponse & { ok: boolean }>(`/tracks/${trackId}/lyrics/fetch`),
  searchLyrics: (trackId: number) =>
    getJson<LyricSearchResponse>(`/tracks/${trackId}/lyrics/search`),
  previewLyric: (source: string, extId: string) =>
    getJson<LyricPreviewResponse>(
      `/lyrics/preview?source=${encodeURIComponent(source)}&ext_id=${encodeURIComponent(extId)}`,
    ),
  selectLyric: (trackId: number, source: string, extId: string) =>
    postJson<LyricsResponse & { ok: boolean }>(
      `/tracks/${trackId}/lyrics/select`,
      { source, ext_id: extId },
    ),
  setLyrics: (trackId: number, text: string) =>
    putJson<LyricsResponse & { ok: boolean }>(`/tracks/${trackId}/lyrics`, { text }),
  deleteLyrics: (trackId: number) =>
    deleteReq<{ ok: boolean }>(`/tracks/${trackId}/lyrics`),

  uploadTracks: async (
    files: File[],
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<UploadResponse> => {
    const fd = new FormData();
    for (const f of files) fd.append('files', f, f.name);
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url('/upload'));
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(e.loaded, e.total);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch (e) {
            reject(new Error(`Bad JSON response: ${xhr.responseText}`));
          }
        } else {
          reject(new Error(`${xhr.status}: ${xhr.responseText}`));
        }
      };
      xhr.onerror = () => reject(new Error('network error'));
      xhr.send(fd);
    });
  },
};

export interface UploadResponse {
  ok: boolean;
  uploaded: Array<{ filename: string; size_bytes: number }>;
  scan: {
    scanned_files: number;
    inserted: number;
    updated: number;
    removed: number;
    failed: number;
    took_ms: number;
  };
}
