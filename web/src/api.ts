import type { Status, Track, TrackListResponse } from './types';

export interface TrackEdit {
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  genre?: string | null;
  year?: number | null;
  track_no?: number | null;
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

export interface TracksQuery {
  q?: string;
  artist?: string;
  album?: string;
  genre?: string;
  limit?: number;
  offset?: number;
  sort?: 'title' | 'artist' | 'album' | 'added_at' | 'duration_sec';
  dir?: 'asc' | 'desc';
}

export const api = {
  status: () => getJson<Status>('/status'),
  rescan: () => postJson<{ ok: boolean; scanned_files: number; inserted: number; updated: number; removed: number; failed: number; took_ms: number }>('/status/rescan'),
  listTracks: (q: TracksQuery = {}) => {
    const params = new URLSearchParams();
    Object.entries(q).forEach(([k, v]) => v !== undefined && v !== '' && params.set(k, String(v)));
    return getJson<TrackListResponse>(`/tracks?${params.toString()}`);
  },
  updateTrack: (id: number, fields: TrackEdit) => putJson<Track>(`/tracks/${id}`, fields),
};
