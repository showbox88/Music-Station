/**
 * Playlists REST API.
 *
 * Visibility (Slice 4): a playlist is visible to user :me iff
 *     playlists.owner_id = :me
 *  OR playlists.is_public = 1
 *  OR EXISTS playlist_shares (playlist_id, with_user_id=:me)
 *
 * A visible playlist transitively makes its tracks visible too — that
 * predicate lives in tracks.ts.
 *
 * Mutating endpoints (PUT/DELETE/add-tracks/remove-track/order/visibility/
 * shares) require ownership; non-owners get 403.
 *
 * Routes:
 *   GET    /api/playlists                       — visible playlists with track counts
 *   POST   /api/playlists                       — create (owner = req.user)
 *   GET    /api/playlists/:id                   — playlist + ordered tracks (visibility-checked)
 *   PUT    /api/playlists/:id                   — owner: name/description
 *   DELETE /api/playlists/:id                   — owner only
 *
 *   POST   /api/playlists/:id/tracks            — owner: append
 *   DELETE /api/playlists/:id/tracks/:trackId   — owner: remove one
 *   PUT    /api/playlists/:id/order             — owner: reorder
 *
 *   PUT    /api/playlists/:id/visibility        — owner: { is_public }
 *   GET    /api/playlists/:id/shares            — owner: list users
 *   PUT    /api/playlists/:id/shares            — owner: replace { user_ids: [...] }
 */
import { Router } from 'express';
import type { Database } from 'better-sqlite3';

interface PlaylistRow {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
  owner_id: number | null;
  is_public: number;
  owner_username?: string | null;
  owner_display_name?: string | null;
  shared_with_me?: number;
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
  owner_id: number | null;
  is_public: number;
  owner_username?: string | null;
  owner_display_name?: string | null;
  favorited_by_me?: number;
  my_rating?: number | null;
}

interface Deps {
  db: Database;
  publicUrl: string;
}

const VISIBLE_PLAYLIST = `(
  p.owner_id = @me
  OR p.is_public = 1
  OR EXISTS (SELECT 1 FROM playlist_shares ps WHERE ps.playlist_id = p.id AND ps.with_user_id = @me)
)`;

function buildAudioUrl(publicUrl: string, relPath: string): string {
  const encoded = relPath.split('/').map(encodeURIComponent).join('/');
  return `${publicUrl.replace(/\/+$/, '')}/audio/${encoded}`;
}

function trackDto(row: TrackRow, publicUrl: string, meId: number) {
  const isOwner = row.owner_id === meId;
  let source: 'mine' | 'public' | 'shared' = 'mine';
  if (!isOwner) source = row.is_public ? 'public' : 'shared';
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
    rating: row.my_rating ?? 0,
    favorited: !!row.favorited_by_me,
    added_at: row.added_at,
    modified_at: row.modified_at,
    last_edited_at: row.last_edited_at,
    url: buildAudioUrl(publicUrl, row.rel_path),
    cover_url: row.cover_filename
      ? `/api/covers/${encodeURIComponent(row.cover_filename)}?v=${encodeURIComponent(row.modified_at)}`
      : null,
    owner_id: row.owner_id,
    owner_username: row.owner_username ?? null,
    owner_display_name: row.owner_display_name ?? null,
    is_public: !!row.is_public,
    is_owner: isOwner,
    shared_with_me: !isOwner && !row.is_public,
    source,
  };
}

function playlistDto(row: PlaylistRow & { track_count?: number }, meId: number) {
  const isOwner = row.owner_id === meId;
  let source: 'mine' | 'public' | 'shared' = 'mine';
  if (!isOwner) source = row.is_public ? 'public' : 'shared';
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    created_at: row.created_at,
    track_count: row.track_count ?? 0,
    owner_id: row.owner_id,
    owner_username: row.owner_username ?? null,
    owner_display_name: row.owner_display_name ?? null,
    is_public: !!row.is_public,
    is_owner: isOwner,
    shared_with_me: !!row.shared_with_me,
    source,
  };
}

function normalizePositions(db: Database, playlistId: number) {
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

  function meId(req: any): number {
    return req.user!.id as number;
  }

  /** Owner-only guard. Returns the playlist row or null+403. */
  function requireOwner(req: any, res: any, id: number): PlaylistRow | null {
    const me = meId(req);
    const row = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id) as
      | PlaylistRow
      | undefined;
    if (!row) {
      res.status(404).json({ error: 'playlist not found' });
      return null;
    }
    if (row.owner_id !== me) {
      res.status(403).json({ error: 'not the owner' });
      return null;
    }
    return row;
  }

  // GET /api/playlists — visible playlists
  r.get('/', (req, res) => {
    const me = meId(req);
    const rows = db
      .prepare(
        `SELECT p.id, p.name, p.description, p.created_at,
                p.owner_id, p.is_public,
                u.username     AS owner_username,
                u.display_name AS owner_display_name,
                CASE WHEN ps.playlist_id IS NULL THEN 0 ELSE 1 END AS shared_with_me,
                COUNT(pt.track_id) AS track_count
         FROM playlists p
         LEFT JOIN users u ON u.id = p.owner_id
         LEFT JOIN playlist_shares ps ON ps.playlist_id = p.id AND ps.with_user_id = @me
         LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
         WHERE ${VISIBLE_PLAYLIST}
         GROUP BY p.id
         ORDER BY p.created_at ASC`,
      )
      .all({ me }) as Array<PlaylistRow & { track_count: number }>;
    res.json({
      count: rows.length,
      playlists: rows.map((row) => playlistDto(row, me)),
    });
  });

  // POST /api/playlists — owner = caller
  r.post('/', (req, res) => {
    const me = meId(req);
    const name = String(req.body?.name ?? '').trim();
    const description = req.body?.description ? String(req.body.description).trim() : null;
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const info = db
      .prepare('INSERT INTO playlists (name, description, owner_id) VALUES (?, ?, ?)')
      .run(name, description, me);
    const row = db
      .prepare(
        `SELECT p.*, u.username AS owner_username, u.display_name AS owner_display_name,
                0 AS shared_with_me
         FROM playlists p LEFT JOIN users u ON u.id = p.owner_id WHERE p.id = ?`,
      )
      .get(info.lastInsertRowid) as PlaylistRow;
    res.json(playlistDto({ ...row, track_count: 0 }, me));
  });

  // GET /api/playlists/:id — visibility-checked, returns ordered tracks too
  r.get('/:id(\\d+)', (req, res) => {
    const me = meId(req);
    const id = Number(req.params.id);
    const row = db
      .prepare(
        `SELECT p.*,
                u.username     AS owner_username,
                u.display_name AS owner_display_name,
                CASE WHEN ps.playlist_id IS NULL THEN 0 ELSE 1 END AS shared_with_me
         FROM playlists p
         LEFT JOIN users u ON u.id = p.owner_id
         LEFT JOIN playlist_shares ps ON ps.playlist_id = p.id AND ps.with_user_id = @me
         WHERE p.id = @id AND ${VISIBLE_PLAYLIST}`,
      )
      .get({ me, id }) as PlaylistRow | undefined;
    if (!row) {
      res.status(404).json({ error: 'playlist not found' });
      return;
    }

    const tracks = db
      .prepare(
        `SELECT t.*,
                tu.username     AS owner_username,
                tu.display_name AS owner_display_name,
                CASE WHEN uf.track_id IS NULL THEN 0 ELSE 1 END AS favorited_by_me,
                utr.rating AS my_rating
         FROM playlist_tracks pt
         JOIN tracks t ON t.id = pt.track_id
         LEFT JOIN users tu ON tu.id = t.owner_id
         LEFT JOIN user_favorites uf ON uf.track_id = t.id AND uf.user_id = @me
         LEFT JOIN user_track_ratings utr ON utr.track_id = t.id AND utr.user_id = @me
         WHERE pt.playlist_id = @id
         ORDER BY pt.position ASC`,
      )
      .all({ me, id }) as TrackRow[];

    res.json({
      ...playlistDto(row, me),
      tracks: tracks.map((t) => trackDto(t, publicUrl, me)),
    });
  });

  // PUT /api/playlists/:id — owner only
  r.put('/:id(\\d+)', (req, res) => {
    const id = Number(req.params.id);
    if (!requireOwner(req, res, id)) return;

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
    const updated = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id) as PlaylistRow;
    const me = meId(req);
    res.json(playlistDto(updated, me));
  });

  // DELETE /api/playlists/:id — owner only
  r.delete('/:id(\\d+)', (req, res) => {
    const id = Number(req.params.id);
    if (!requireOwner(req, res, id)) return;
    db.prepare('DELETE FROM playlists WHERE id = ?').run(id);
    res.json({ ok: true, deleted_id: id });
  });

  // POST /api/playlists/:id/tracks — owner only
  r.post('/:id(\\d+)/tracks', (req, res) => {
    const id = Number(req.params.id);
    if (!requireOwner(req, res, id)) return;

    const trackIds: number[] = Array.isArray(req.body?.track_ids)
      ? req.body.track_ids.map((x: any) => Number(x)).filter(Number.isFinite)
      : [];
    if (trackIds.length === 0) {
      res.status(400).json({ error: 'track_ids must be a non-empty number[]' });
      return;
    }

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

    const startPos = ((
      db
        .prepare(
          'SELECT COALESCE(MAX(position), -1) AS m FROM playlist_tracks WHERE playlist_id = ?',
        )
        .get(id) as { m: number }
    ).m) + 1;

    const insert = db.prepare(
      'INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)',
    );
    const tx = db.transaction(() => {
      valid.forEach((tid, i) => insert.run(id, tid, startPos + i));
    });
    tx();

    res.json({ ok: true, added: valid.length, skipped: trackIds.length - valid.length });
  });

  // DELETE /api/playlists/:id/tracks/:trackId — owner only
  r.delete('/:id(\\d+)/tracks/:trackId(\\d+)', (req, res) => {
    const id = Number(req.params.id);
    if (!requireOwner(req, res, id)) return;
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

  // PUT /api/playlists/:id/order — owner only
  r.put('/:id(\\d+)/order', (req, res) => {
    const id = Number(req.params.id);
    if (!requireOwner(req, res, id)) return;

    const trackIds: number[] = Array.isArray(req.body?.track_ids)
      ? req.body.track_ids.map((x: any) => Number(x)).filter(Number.isFinite)
      : [];
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

  // PUT /api/playlists/:id/visibility — owner only
  r.put('/:id(\\d+)/visibility', (req, res) => {
    const id = Number(req.params.id);
    if (!requireOwner(req, res, id)) return;
    const isPublic = req.body?.is_public ? 1 : 0;
    db.prepare('UPDATE playlists SET is_public = ? WHERE id = ?').run(isPublic, id);
    res.json({ ok: true, is_public: !!isPublic });
  });

  // GET /api/playlists/:id/shares — owner only
  r.get('/:id(\\d+)/shares', (req, res) => {
    const id = Number(req.params.id);
    if (!requireOwner(req, res, id)) return;
    const users = db
      .prepare(
        `SELECT u.id, u.username, u.display_name
         FROM playlist_shares ps JOIN users u ON u.id = ps.with_user_id
         WHERE ps.playlist_id = ?
         ORDER BY u.username ASC`,
      )
      .all(id);
    res.json({ shared_with: users });
  });

  // PUT /api/playlists/:id/shares — owner only; replace
  r.put('/:id(\\d+)/shares', (req, res) => {
    const id = Number(req.params.id);
    const me = meId(req);
    if (!requireOwner(req, res, id)) return;
    const ids = Array.isArray(req.body?.user_ids) ? req.body.user_ids : [];
    const userIds: number[] = ids
      .map((x: any) => Number(x))
      .filter((n: number) => Number.isInteger(n) && n > 0 && n !== me);
    const tx = db.transaction((targetIds: number[]) => {
      db.prepare('DELETE FROM playlist_shares WHERE playlist_id = ?').run(id);
      const ins = db.prepare(
        'INSERT OR IGNORE INTO playlist_shares (playlist_id, with_user_id) VALUES (?, ?)',
      );
      for (const uid of targetIds) {
        const exists = db.prepare('SELECT 1 FROM users WHERE id = ?').get(uid);
        if (exists) ins.run(id, uid);
      }
    });
    tx(userIds);
    const users = db
      .prepare(
        `SELECT u.id, u.username, u.display_name
         FROM playlist_shares ps JOIN users u ON u.id = ps.with_user_id
         WHERE ps.playlist_id = ?
         ORDER BY u.username ASC`,
      )
      .all(id);
    res.json({ ok: true, shared_with: users });
  });

  return r;
}
