import type { Status, TrackListResponse } from './types';

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  return res.json();
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
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
  status: () => getJson<Status>('/api/status'),
  rescan: () => postJson<{ ok: boolean; scanned_files: number; inserted: number; updated: number; removed: number; failed: number; took_ms: number }>('/api/status/rescan'),
  listTracks: (q: TracksQuery = {}) => {
    const params = new URLSearchParams();
    Object.entries(q).forEach(([k, v]) => v !== undefined && v !== '' && params.set(k, String(v)));
    return getJson<TrackListResponse>(`/api/tracks?${params.toString()}`);
  },
};
