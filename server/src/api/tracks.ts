/**
 * Tracks REST API.
 *
 * Sprint 1: read-only listing + search/filter.
 * Later sprints will add PUT (edit metadata), DELETE, etc.
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
  rating: number | null;
  cover_filename: string | null;
  added_at: string;
  modified_at: string;
  last_edited_at: string | null;
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
  // Cache-bust by appending a version derived from the row's modified_at.
  // The static /api/covers/* route can keep long cache headers because
  // every cover change bumps modified_at → URL changes → cache miss.
  const v = version ? `?v=${encodeURIComponent(version)}` : '';
  return `/api/covers/${encodeURIComponent(coverFilename)}${v}`;
}

function dto(row: TrackRow, publicUrl: string) {
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
    cover_url: buildCoverUrl(row.cover_filename, row.modified_at),
  };
}

export function tracksRouter({ db, publicUrl, musicDir, coverDir }: Deps): Router {
  const r = Router();

  // GET /api/tracks?q=...&artist=...&album=...&limit=...&offset=...
  r.get('/', (req, res) => {
    const q = (req.query.q as string | undefined)?.trim() || null;
    const artist = (req.query.artist as string | undefined)?.trim() || null;
    const album = (req.query.album as string | undefined)?.trim() || null;
    const genre = (req.query.genre as string | undefined)?.trim() || null;
    const limit = Math.min(parseInt(req.query.limit as string) || 200, 1000);
    const offset = parseInt(req.query.offset as string) || 0;
    const sort = (req.query.sort as string | undefined) || 'title';
    const sortable = new Set(['title', 'artist', 'album', 'added_at', 'duration_sec']);
    const sortCol = sortable.has(sort) ? sort : 'title';
    const dir = (req.query.dir as string) === 'desc' ? 'DESC' : 'ASC';

    const where: string[] = [];
    const params: any = {};
    if (q) {
      where.push('(title LIKE @q OR artist LIKE @q OR album LIKE @q OR rel_path LIKE @q)');
      params.q = `%${q}%`;
    }
    if (artist) {
      where.push('artist LIKE @artist');
      params.artist = `%${artist}%`;
    }
    if (album) {
      where.push('album LIKE @album');
      params.album = `%${album}%`;
    }
    if (genre) {
      where.push('genre = @genre');
      params.genre = genre;
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = db
      .prepare(
        `SELECT * FROM tracks ${whereSql} ORDER BY ${sortCol} ${dir} NULLS LAST LIMIT @limit OFFSET @offset`,
      )
      .all({ ...params, limit, offset }) as TrackRow[];

    const total = (
      db.prepare(`SELECT COUNT(*) AS c FROM tracks ${whereSql}`).get(params) as { c: number }
    ).c;

    res.json({
      total,
      limit,
      offset,
      tracks: rows.map((row) => dto(row, publicUrl)),
    });
  });

  // GET /api/tracks/:id
  r.get('/:id(\\d+)', (req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM tracks WHERE id = ?').get(id) as TrackRow | undefined;
    if (!row) {
      res.status(404).json({ error: 'track not found' });
      return;
    }
    res.json(dto(row, publicUrl));
  });

  // PUT /api/tracks/:id — update subjective metadata fields. Writes only to
  // the DB; the underlying MP3 file is never modified. last_edited_at is
  // stamped so the UI can mark "edited" rows.
  r.put('/:id(\\d+)', (req, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM tracks WHERE id = ?').get(id) as
      | TrackRow
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'track not found' });
      return;
    }

    const body = req.body ?? {};
    const allowed: Array<keyof TrackRow> = [
      'title',
      'artist',
      'album',
      'genre',
      'year',
      'track_no',
      'rating',
    ];
    const updates: Partial<TrackRow> = {};
    for (const k of allowed) {
      if (k in body) {
        const v = body[k];
        // null / "" / undefined → store NULL (or 0 for rating); else coerce
        if (v === null || v === undefined || v === '') {
          (updates as any)[k] = k === 'rating' ? 0 : null;
        } else if (k === 'year' || k === 'track_no') {
          const n = Number(v);
          if (!Number.isFinite(n) || n < 0 || n > 99999) {
            res.status(400).json({ error: `${k} must be a non-negative integer` });
            return;
          }
          (updates as any)[k] = Math.trunc(n);
        } else if (k === 'rating') {
          const n = Number(v);
          if (!Number.isFinite(n) || n < 0 || n > 5) {
            res.status(400).json({ error: 'rating must be 0..5' });
            return;
          }
          (updates as any)[k] = Math.trunc(n);
        } else {
          (updates as any)[k] = String(v).trim();
        }
      }
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'no editable fields in body' });
      return;
    }

    const sets = Object.keys(updates).map((k) => `${k} = @${k}`);
    sets.push(`last_edited_at = datetime('now')`);
    sets.push(`modified_at = datetime('now')`);
    db.prepare(`UPDATE tracks SET ${sets.join(', ')} WHERE id = @id`).run({
      ...updates,
      id,
    });

    const fresh = db.prepare('SELECT * FROM tracks WHERE id = ?').get(id) as TrackRow;
    res.json(dto(fresh, publicUrl));
  });

  // DELETE /api/tracks/:id — removes the audio file from disk and the row
  // from the DB (cascades to playlist_tracks). If the file is already gone
  // (e.g. removed via Samba), we still clean up the DB row.
  r.delete('/:id(\\d+)', async (req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM tracks WHERE id = ?').get(id) as TrackRow | undefined;
    if (!row) {
      res.status(404).json({ error: 'track not found' });
      return;
    }

    const abs = join(musicDir, ...row.rel_path.split('/'));
    let fileRemoved = false;
    try {
      await unlink(abs);
      fileRemoved = true;
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        // already gone — that's fine, just clean up DB
        fileRemoved = false;
      } else {
        res.status(500).json({ error: `failed to delete file: ${err?.message ?? err}` });
        return;
      }
    }

    // Best-effort cover cleanup. Failure is non-fatal.
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
