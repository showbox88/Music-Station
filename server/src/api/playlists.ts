/**
 * Playlists REST API.
 *
 * Routes:
 *   GET    /api/playlists                       — list all playlists with track counts
 *   POST   /api/playlists                       — create { name, description? }
 *   GET    /api/playlists/:id                   — playlist + ordered tracks
 *   PUT    /api/playlists/:id                   — update name/description
 *   DELETE /api/playlists/:id                   — delete
 *
 *   POST   /api/playlists/:id/tracks            — add { track_ids: number[] } to end
 *   DELETE /api/playlists/:id/tracks/:trackId   — remove one track
 *   PUT    /api/playlists/:id/order             — reorder { track_ids: number[] }
 *
 * Position semantics: stored 0-indexed in playlist_tracks.position. We
 * normalize positions on add/remove so they stay contiguous (0..N-1).
 */
import { Router } from 'express';
import type { Database } from 'better-sqlite3';

interface PlaylistRow {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
}

interface TrackRow {
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
  rating: number | null;
  cover_filename: string | null;
  added_at: string;
  modified_at: string;
  last_edited_at: string | null;
}

interface Deps {
  db: Database;
  publicUrl: string;
}

function buildAudioUrl(publicUrl: string, relPath: string): string {
  const encoded = relPath.split('/').map(encodeURIComponent).join('/');
  return `${publicUrl.replace(/\/+$/, '')}/audio/${encoded}`;
}

function trackDto(row: TrackRow, publicUrl: string) {
  return {
    id: row.id,
    rel_path: row.rel_path,
    title: row.title,
    artist: row.artist,
    album: row.album,
    genre: row.genre,
    year: row.year,
    track_no: row.track_no,
    duration_sec: row.duration_sec,
    size_bytes: row.size_bytes,
    bitrate: row.bitrate,
    mime: row.mime,
    rating: row.rating ?? 0,
    added_at: row.added_at,
    modified_at: row.modified_at,
    last_edited_at: row.last_edited_at,
    url: buildAudioUrl(publicUrl, row.rel_path),
    cover_url: row.cover_filename
      ? `/api/covers/${encodeURIComponent(row.cover_filename)}?v=${encodeURIComponent(row.modified_at)}`
      : null,
  };
}

function normalizePositions(db: Database, playlistId: number) {
  // Re-stamp 0..N-1 in current ascending order. Idempotent.
  const rows = db
    .prepare(
      `SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC`,
    )
    .all(playlistId) as Array<{ track_id: number }>;
  const update = db.prepare(
    `UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND track_id = ?`,
  );
  const tx = db.transaction(() => {
    rows.forEach((r, i) => update.run(i, playlistId, r.track_id));
  });
  tx();
}

export function playlistsRouter({ db, publicUrl }: Deps): Router {
  const r = Router();

  // GET /api/playlists
  r.get('/', (_req, res) => {
    const rows = db
      .prepare(
        `SELECT p.id, p.name, p.description, p.created_at,
                COUNT(pt.track_id) AS track_count
         FROM playlists p
         LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
         GROUP BY p.id
         ORDER BY p.created_at ASC`,
      )
      .all() as Array<PlaylistRow & { track_count: number }>;
    res.json({ count: rows.length, playlists: rows });
  });

  // POST /api/playlists
  r.post('/', (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    const description = req.body?.description ? String(req.body.description).trim() : null;
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const info = db
      .prepare('INSERT INTO playlists (name, description) VALUES (?, ?)')
      .run(name, description);
    const row = db.prepare('SELECT * FROM playlists WHERE id = ?').get(info.lastInsertRowid) as PlaylistRow;
    res.json({ ...row, track_count: 0 });
  });

  // GET /api/playlists/:id
  r.get('/:id(\\d+)', (req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id) as PlaylistRow | undefined;
    if (!row) {
      res.status(404).json({ error: 'playlist not found' });
      return;
    }
    const tracks = db
      .prepare(
        `SELECT t.*
         FROM playlist_tracks pt
         JOIN tracks t ON t.id = pt.track_id
         WHERE pt.playlist_id = ?
         ORDER BY pt.position ASC`,
      )
      .all(id) as TrackRow[];
    res.json({
      ...row,
      tracks: tracks.map((t) => trackDto(t, publicUrl)),
    });
  });

  // PUT /api/playlists/:id
  r.put('/:id(\\d+)', (req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id) as PlaylistRow | undefined;
    if (!row) {
      res.status(404).json({ error: 'playlist not found' });
      return;
    }
    const sets: string[] = [];
    const params: any = { id };
    if ('name' in (req.body ?? {})) {
      const name = String(req.body.name ?? '').trim();
      if (!name) {
        res.status(400).json({ error: 'name cannot be empty' });
        return;
      }
      sets.push('name = @name');
      params.name = name;
    }
    if ('description' in (req.body ?? {})) {
      const d = req.body.description;
      sets.push('description = @description');
      params.description = d ? String(d).trim() : null;
    }
    if (sets.length === 0) {
      res.status(400).json({ error: 'no updatable fields' });
      return;
    }
    db.prepare(`UPDATE playlists SET ${sets.join(', ')} WHERE id = @id`).run(params);
    const updated = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id);
    res.json(updated);
  });

  // DELETE /api/playlists/:id  (cascades to playlist_tracks via FK)
  r.delete('/:id(\\d+)', (req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id) as PlaylistRow | undefined;
    if (!row) {
      res.status(404).json({ error: 'playlist not found' });
      return;
    }
    db.prepare('DELETE FROM playlists WHERE id = ?').run(id);
    res.json({ ok: true, deleted_id: id });
  });

  // POST /api/playlists/:id/tracks  — append tracks to end
  r.post('/:id(\\d+)/tracks', (req, res) => {
    const id = Number(req.params.id);
    const playlist = db.prepare('SELECT id FROM playlists WHERE id = ?').get(id);
    if (!playlist) {
      res.status(404).json({ error: 'playlist not found' });
      return;
    }
    const trackIds: number[] = Array.isArray(req.body?.track_ids)
      ? req.body.track_ids.map((x: any) => Number(x)).filter(Number.isFinite)
      : [];
    if (trackIds.length === 0) {
      res.status(400).json({ error: 'track_ids must be a non-empty number[]' });
      return;
    }

    // Skip tracks already in playlist
    const existing = new Set(
      (
        db
          .prepare('SELECT track_id FROM playlist_tracks WHERE playlist_id = ?')
          .all(id) as Array<{ track_id: number }>
      ).map((r) => r.track_id),
    );
    const toAdd = trackIds.filter((tid) => !existing.has(tid));

    if (toAdd.length === 0) {
      res.json({ ok: true, added: 0, skipped: trackIds.length });
      return;
    }

    // Validate they all exist as real tracks
    const placeholders = toAdd.map(() => '?').join(',');
    const found = db
      .prepare(`SELECT id FROM tracks WHERE id IN (${placeholders})`)
      .all(...toAdd) as Array<{ id: number }>;
    const foundIds = new Set(found.map((r) => r.id));
    const valid = toAdd.filter((tid) => foundIds.has(tid));

    if (valid.length === 0) {
      res.status(400).json({ error: 'no valid track ids' });
      return;
    }

    const startPos = ((db
      .prepare('SELECT COALESCE(MAX(position), -1) AS m FROM playlist_tracks WHERE playlist_id = ?')
      .get(id) as { m: number }).m) + 1;

    const insert = db.prepare(
      'INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)',
    );
    const tx = db.transaction(() => {
      valid.forEach((tid, i) => insert.run(id, tid, startPos + i));
    });
    tx();

    res.json({ ok: true, added: valid.length, skipped: trackIds.length - valid.length });
  });

  // DELETE /api/playlists/:id/tracks/:trackId
  r.delete('/:id(\\d+)/tracks/:trackId(\\d+)', (req, res) => {
    const id = Number(req.params.id);
    const trackId = Number(req.params.trackId);
    const info = db
      .prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?')
      .run(id, trackId);
    if (info.changes === 0) {
      res.status(404).json({ error: 'not in playlist' });
      return;
    }
    normalizePositions(db, id);
    res.json({ ok: true });
  });

  // PUT /api/playlists/:id/order  — replace positions with given order
  r.put('/:id(\\d+)/order', (req, res) => {
    const id = Number(req.params.id);
    const playlist = db.prepare('SELECT id FROM playlists WHERE id = ?').get(id);
    if (!playlist) {
      res.status(404).json({ error: 'playlist not found' });
      return;
    }
    const trackIds: number[] = Array.isArray(req.body?.track_ids)
      ? req.body.track_ids.map((x: any) => Number(x)).filter(Number.isFinite)
      : [];

    // Verify the given list matches what's actually in the playlist
    const currentRows = db
      .prepare('SELECT track_id FROM playlist_tracks WHERE playlist_id = ?')
      .all(id) as Array<{ track_id: number }>;
    const current = new Set(currentRows.map((r) => r.track_id));
    if (trackIds.length !== current.size || !trackIds.every((tid) => current.has(tid))) {
      res.status(400).json({
        error: 'track_ids must contain exactly the same set of track ids currently in the playlist',
        playlist_size: current.size,
        provided_size: trackIds.length,
      });
      return;
    }

    const update = db.prepare(
      'UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND track_id = ?',
    );
    const tx = db.transaction(() => {
      trackIds.forEach((tid, i) => update.run(i, id, tid));
    });
    tx();
    res.json({ ok: true, count: trackIds.length });
  });

  return r;
}
