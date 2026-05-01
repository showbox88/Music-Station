/**
 * Tracks REST API.
 *
 * Sprint 1: read-only listing + search/filter.
 * Later sprints will add PUT (edit metadata), DELETE, etc.
 */
import { Router } from 'express';
import type { Database } from 'better-sqlite3';

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
  added_at: string;
  modified_at: string;
}

interface Deps {
  db: Database;
  publicUrl: string;
}

function buildAudioUrl(publicUrl: string, relPath: string): string {
  const encoded = relPath.split('/').map(encodeURIComponent).join('/');
  return `${publicUrl.replace(/\/+$/, '')}/audio/${encoded}`;
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
    added_at: row.added_at,
    modified_at: row.modified_at,
    url: buildAudioUrl(publicUrl, row.rel_path),
  };
}

export function tracksRouter({ db, publicUrl }: Deps): Router {
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

  return r;
}
