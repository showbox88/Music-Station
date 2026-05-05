/**
 * Tracks REST API.
 *
 * Visibility model (Slice 3):
 *   A track is visible to user :me iff
 *     - tracks.owner_id  = :me                              (mine)
 *     - OR tracks.is_public = 1                             (public)
 *     - OR EXISTS track_shares (track_id, with_user_id=:me) (direct share)
 *
 *   Transitive sharing via shared/public playlists or favorites is
 *   deferred to Slice 4.
 *
 *   Mutating endpoints (PUT/DELETE/visibility/shares) require ownership,
 *   except the favorite toggle and rating which are per-user state.
 */
import { Router } from 'express';
import type { Database } from 'better-sqlite3';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';

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
  rating: number | null;     // legacy, kept for backfill only — DTO uses my_rating
  cover_filename: string | null;
  added_at: string;
  modified_at: string;
  last_edited_at: string | null;
  owner_id: number | null;
  is_public: number;
  // Joined columns from queries below:
  owner_username?: string | null;
  owner_display_name?: string | null;
  favorited_by_me?: number;
  my_rating?: number | null;
  shared_with_me?: number;  // 1 if a direct track_share exists
}

interface Deps {
  db: Database;
  publicUrl: string;
  musicDir: string;
  coverDir: string;
}

function buildAudioUrl(publicUrl: string, relPath: string): string {
  const encoded = relPath.split('/').map(encodeURIComponent).join('/');
  return `${publicUrl.replace(/\/+$/, '')}/audio/${encoded}`;
}

function buildCoverUrl(coverFilename: string | null, version: string | null): string | null {
  if (!coverFilename) return null;
  const v = version ? `?v=${encodeURIComponent(version)}` : '';
  return `/api/covers/${encodeURIComponent(coverFilename)}${v}`;
}

function dto(row: TrackRow, publicUrl: string, meId: number) {
  const isOwner = row.owner_id === meId;
  // "source" = where this row came from for the calling user. Used by the
  // UI to render badges and apply the filter chips. With transitive
  // sharing (Slice 4) a "shared" track may have come via a direct
  // track_share OR via a shared/owned playlist — we collapse both into
  // 'shared' since the UI just shows "shared by <owner>".
  let source: 'mine' | 'public' | 'shared' = 'mine';
  if (!isOwner) {
    source = row.is_public ? 'public' : 'shared';
  }
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
    cover_url: buildCoverUrl(row.cover_filename, row.modified_at),
    owner_id: row.owner_id,
    owner_username: row.owner_username ?? null,
    owner_display_name: row.owner_display_name ?? null,
    is_public: !!row.is_public,
    is_owner: isOwner,
    shared_with_me: !!row.shared_with_me,
    source,
  };
}

/**
 * Visibility predicate fragment to drop into a WHERE.
 *
 * A track is visible to :me iff:
 *   - mine
 *   - public
 *   - directly shared with me
 *   - in any playlist visible to me (transitive: shared/public playlist → tracks in it)
 *   - in someone's favorites that are visible to me (Slice 5: shared/public favorites → tracks in them)
 *
 * The @me bind param must be set on the caller's parameter object.
 */
const VISIBLE_PREDICATE = `(
  t.owner_id = @me
  OR t.is_public = 1
  OR EXISTS (SELECT 1 FROM track_shares ts WHERE ts.track_id = t.id AND ts.with_user_id = @me)
  OR EXISTS (
    SELECT 1 FROM playlist_tracks pt
    JOIN playlists p ON p.id = pt.playlist_id
    WHERE pt.track_id = t.id
      AND (
        p.owner_id = @me
        OR p.is_public = 1
        OR EXISTS (SELECT 1 FROM playlist_shares ps2 WHERE ps2.playlist_id = p.id AND ps2.with_user_id = @me)
      )
  )
  OR EXISTS (
    SELECT 1 FROM user_favorites uf
    JOIN users uo ON uo.id = uf.user_id
    WHERE uf.track_id = t.id
      AND (
        uo.favorites_public = 1
        OR EXISTS (SELECT 1 FROM favorites_shares fs WHERE fs.owner_user_id = uo.id AND fs.with_user_id = @me)
      )
  )
)`;

/**
 * Common SELECT prefix that joins owner info + per-user "favorited" / "shared"
 * markers. Caller appends WHERE / ORDER BY / LIMIT.
 */
function selectTracksPrefix(): string {
  return `
    SELECT t.*,
           u.username     AS owner_username,
           u.display_name AS owner_display_name,
           CASE WHEN uf.track_id IS NULL THEN 0 ELSE 1 END AS favorited_by_me,
           utr.rating AS my_rating,
           CASE WHEN ts.track_id IS NULL THEN 0 ELSE 1 END AS shared_with_me
    FROM tracks t
    LEFT JOIN users u
      ON u.id = t.owner_id
    LEFT JOIN user_favorites uf
      ON uf.track_id = t.id AND uf.user_id = @me
    LEFT JOIN user_track_ratings utr
      ON utr.track_id = t.id AND utr.user_id = @me
    LEFT JOIN track_shares ts
      ON ts.track_id = t.id AND ts.with_user_id = @me
  `;
}

export function tracksRouter({ db, publicUrl, musicDir, coverDir }: Deps): Router {
  const r = Router();

  function meId(req: any): number {
    return req.user!.id as number;
  }

  // GET /api/tracks
  r.get('/', (req, res) => {
    const me = meId(req);
    const q = (req.query.q as string | undefined)?.trim() || null;
    const artist = (req.query.artist as string | undefined)?.trim() || null;
    const album = (req.query.album as string | undefined)?.trim() || null;
    const genre = (req.query.genre as string | undefined)?.trim() || null;
    const favoritedOnly = req.query.favorited === 'true';
    // Source filter for the [全部/我的/公开/分享给我的] chips.
    const sourceParam = (req.query.source as string | undefined) || 'all';
    const limit = Math.min(parseInt(req.query.limit as string) || 200, 1000);
    const offset = parseInt(req.query.offset as string) || 0;
    const sort = (req.query.sort as string | undefined) || 'title';
    const sortable = new Set(['title', 'artist', 'album', 'added_at', 'duration_sec']);
    const sortCol = sortable.has(sort) ? `t.${sort}` : 't.title';
    const dir = (req.query.dir as string) === 'desc' ? 'DESC' : 'ASC';

    const where: string[] = [VISIBLE_PREDICATE];
    const params: any = { me };
    if (q) {
      where.push('(t.title LIKE @q OR t.artist LIKE @q OR t.album LIKE @q OR t.rel_path LIKE @q)');
      params.q = `%${q}%`;
    }
    if (artist) {
      where.push('t.artist LIKE @artist');
      params.artist = `%${artist}%`;
    }
    if (album) {
      where.push('t.album LIKE @album');
      params.album = `%${album}%`;
    }
    if (genre) {
      where.push('t.genre = @genre');
      params.genre = genre;
    }
    if (favoritedOnly) {
      where.push('uf.track_id IS NOT NULL');
    }
    if (sourceParam === 'mine') {
      where.push('t.owner_id = @me');
    } else if (sourceParam === 'public') {
      where.push('t.owner_id <> @me AND t.is_public = 1');
    } else if (sourceParam === 'shared') {
      // "shared with me" = visible (per VISIBLE_PREDICATE) but neither
      // mine nor public. Covers direct track_shares AND transitive paths
      // via playlists shared with me.
      where.push('t.owner_id <> @me AND t.is_public = 0');
    }
    // 'all' (default) → no extra constraint beyond visibility.

    const whereSql = `WHERE ${where.join(' AND ')}`;

    const rows = db
      .prepare(
        `${selectTracksPrefix()} ${whereSql}
         ORDER BY ${sortCol} ${dir} NULLS LAST
         LIMIT @limit OFFSET @offset`,
      )
      .all({ ...params, limit, offset }) as TrackRow[];

    const total = (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM tracks t
           LEFT JOIN user_favorites uf ON uf.track_id = t.id AND uf.user_id = @me
           LEFT JOIN track_shares ts ON ts.track_id = t.id AND ts.with_user_id = @me
           ${whereSql}`,
        )
        .get(params) as { c: number }
    ).c;

    res.json({
      total,
      limit,
      offset,
      tracks: rows.map((row) => dto(row, publicUrl, me)),
    });
  });

  // GET /api/tracks/by-path  (visibility-checked)
  r.get('/by-path', (req, res) => {
    const me = meId(req);
    const p = String(req.query.p ?? '').trim();
    if (!p) {
      res.status(400).json({ error: 'p is required' });
      return;
    }
    const row = db
      .prepare(`${selectTracksPrefix()} WHERE t.rel_path = @p AND ${VISIBLE_PREDICATE}`)
      .get({ me, p }) as TrackRow | undefined;
    if (!row) {
      res.status(404).json({ error: 'track not found' });
      return;
    }
    res.json(dto(row, publicUrl, me));
  });

  // GET /api/tracks/:id  (visibility-checked)
  r.get('/:id(\\d+)', (req, res) => {
    const me = meId(req);
    const id = Number(req.params.id);
    const row = db
      .prepare(`${selectTracksPrefix()} WHERE t.id = @id AND ${VISIBLE_PREDICATE}`)
      .get({ me, id }) as TrackRow | undefined;
    if (!row) {
      res.status(404).json({ error: 'track not found' });
      return;
    }
    res.json(dto(row, publicUrl, me));
  });

  // PUT /api/tracks/:id — owner edits metadata; any visible user can
  // toggle their personal favorite + rating.
  r.put('/:id(\\d+)', (req, res) => {
    const me = meId(req);
    const id = Number(req.params.id);
    const existing = db
      .prepare(`${selectTracksPrefix()} WHERE t.id = @id AND ${VISIBLE_PREDICATE}`)
      .get({ me, id }) as TrackRow | undefined;
    if (!existing) {
      res.status(404).json({ error: 'track not found' });
      return;
    }
    const isOwner = existing.owner_id === me;

    const body = req.body ?? {};

    // Per-user fields (anyone with visibility)
    if ('favorited' in body) {
      if (body.favorited) {
        db.prepare(
          'INSERT OR IGNORE INTO user_favorites (user_id, track_id) VALUES (?, ?)',
        ).run(me, id);
      } else {
        db.prepare('DELETE FROM user_favorites WHERE user_id = ? AND track_id = ?').run(me, id);
      }
    }

    // Per-user rating: 0 deletes the row (track shows as unrated for me),
    // 1..5 upserts. Anyone with visibility can rate; ratings are private
    // — each user sees only their own.
    if ('rating' in body) {
      const v = body.rating;
      const n = v === null || v === undefined || v === '' ? 0 : Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 5) {
        res.status(400).json({ error: 'rating must be 0..5' });
        return;
      }
      const r = Math.trunc(n);
      if (r === 0) {
        db.prepare('DELETE FROM user_track_ratings WHERE user_id = ? AND track_id = ?').run(me, id);
      } else {
        db.prepare(
          `INSERT INTO user_track_ratings (user_id, track_id, rating, updated_at)
           VALUES (?, ?, ?, datetime('now'))
           ON CONFLICT(user_id, track_id) DO UPDATE SET
             rating = excluded.rating,
             updated_at = excluded.updated_at`,
        ).run(me, id, r);
      }
    }

    // Owner-only metadata
    const ownerFields: Array<keyof TrackRow> = [
      'title',
      'artist',
      'album',
      'genre',
      'year',
      'track_no',
    ];
    const updates: Record<string, any> = {};
    for (const k of ownerFields) {
      if (!(k in body)) continue;
      if (!isOwner) {
        res.status(403).json({ error: `not the owner — only the owner can edit ${k}` });
        return;
      }
      const v = (body as any)[k];
      if (v === null || v === undefined || v === '') {
        updates[k] = null;
      } else if (k === 'year' || k === 'track_no') {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || n > 99999) {
          res.status(400).json({ error: `${k} must be a non-negative integer` });
          return;
        }
        updates[k] = Math.trunc(n);
      } else {
        updates[k] = String(v).trim();
      }
    }

    if (Object.keys(updates).length > 0) {
      const sets = Object.keys(updates).map((k) => `${k} = @${k}`);
      sets.push(`last_edited_at = datetime('now')`);
      sets.push(`modified_at = datetime('now')`);
      db.prepare(`UPDATE tracks SET ${sets.join(', ')} WHERE id = @id`).run({ ...updates, id });
    }

    const fresh = db
      .prepare(`${selectTracksPrefix()} WHERE t.id = @id`)
      .get({ me, id }) as TrackRow;
    res.json(dto(fresh, publicUrl, me));
  });

  // PUT /api/tracks/:id/visibility — owner only; { is_public: boolean }
  r.put('/:id(\\d+)/visibility', (req, res) => {
    const me = meId(req);
    const id = Number(req.params.id);
    const row = db.prepare('SELECT owner_id FROM tracks WHERE id = ?').get(id) as
      | { owner_id: number | null }
      | undefined;
    if (!row) {
      res.status(404).json({ error: 'track not found' });
      return;
    }
    if (row.owner_id !== me) {
      res.status(403).json({ error: 'not the owner' });
      return;
    }
    const isPublic = req.body?.is_public ? 1 : 0;
    db.prepare('UPDATE tracks SET is_public = ? WHERE id = ?').run(isPublic, id);
    res.json({ ok: true, is_public: !!isPublic });
  });

  // GET /api/tracks/:id/shares — owner only; list users this track is shared with.
  r.get('/:id(\\d+)/shares', (req, res) => {
    const me = meId(req);
    const id = Number(req.params.id);
    const row = db.prepare('SELECT owner_id FROM tracks WHERE id = ?').get(id) as
      | { owner_id: number | null }
      | undefined;
    if (!row) {
      res.status(404).json({ error: 'track not found' });
      return;
    }
    if (row.owner_id !== me) {
      res.status(403).json({ error: 'not the owner' });
      return;
    }
    const users = db
      .prepare(
        `SELECT u.id, u.username, u.display_name
         FROM track_shares ts JOIN users u ON u.id = ts.with_user_id
         WHERE ts.track_id = ?
         ORDER BY u.username ASC`,
      )
      .all(id);
    res.json({ shared_with: users });
  });

  // PUT /api/tracks/:id/shares — owner only; replace share list with given user_ids.
  r.put('/:id(\\d+)/shares', (req, res) => {
    const me = meId(req);
    const id = Number(req.params.id);
    const row = db.prepare('SELECT owner_id FROM tracks WHERE id = ?').get(id) as
      | { owner_id: number | null }
      | undefined;
    if (!row) {
      res.status(404).json({ error: 'track not found' });
      return;
    }
    if (row.owner_id !== me) {
      res.status(403).json({ error: 'not the owner' });
      return;
    }
    const ids = Array.isArray(req.body?.user_ids) ? req.body.user_ids : [];
    const userIds: number[] = ids
      .map((x: any) => Number(x))
      .filter((n: number) => Number.isInteger(n) && n > 0 && n !== me);

    const tx = db.transaction((targetIds: number[]) => {
      db.prepare('DELETE FROM track_shares WHERE track_id = ?').run(id);
      const ins = db.prepare(
        'INSERT OR IGNORE INTO track_shares (track_id, with_user_id) VALUES (?, ?)',
      );
      for (const uid of targetIds) {
        // Skip self and non-existent users
        const exists = db.prepare('SELECT 1 FROM users WHERE id = ?').get(uid);
        if (exists) ins.run(id, uid);
      }
    });
    tx(userIds);

    const users = db
      .prepare(
        `SELECT u.id, u.username, u.display_name
         FROM track_shares ts JOIN users u ON u.id = ts.with_user_id
         WHERE ts.track_id = ?
         ORDER BY u.username ASC`,
      )
      .all(id);
    res.json({ ok: true, shared_with: users });
  });

  // DELETE /api/tracks/:id — only the owner can delete the underlying file.
  r.delete('/:id(\\d+)', async (req, res) => {
    const me = meId(req);
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM tracks WHERE id = ?').get(id) as TrackRow | undefined;
    if (!row) {
      res.status(404).json({ error: 'track not found' });
      return;
    }
    if (row.owner_id !== me) {
      res.status(403).json({ error: 'not the owner' });
      return;
    }

    const abs = join(musicDir, ...row.rel_path.split('/'));
    let fileRemoved = false;
    try {
      await unlink(abs);
      fileRemoved = true;
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        fileRemoved = false;
      } else {
        res.status(500).json({ error: `failed to delete file: ${err?.message ?? err}` });
        return;
      }
    }

    if (row.cover_filename) {
      try {
        await unlink(join(coverDir, row.cover_filename));
      } catch {
        /* ignore */
      }
    }

    db.prepare('DELETE FROM tracks WHERE id = ?').run(id);
    res.json({ ok: true, deleted_id: id, rel_path: row.rel_path, file_removed: fileRemoved });
  });

  return r;
}
