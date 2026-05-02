/**
 * Covers API.
 *
 * Routes:
 *   POST   /api/tracks/:id/cover         — multipart upload (field "cover")
 *   POST   /api/tracks/:id/cover/url     — body: { url } — server fetches & saves
 *   DELETE /api/tracks/:id/cover         — remove DB ref + file
 *   GET    /api/covers/search?q=...      — proxy iTunes Search API
 *
 * Cover files live in COVER_DIR (default /opt/music-covers/) named
 * `<track_id>.<ext>`. We always replace any existing cover for that track.
 *
 * iTunes search: free, no API key, returns album artwork URLs. We expand
 * the URL to 600x600 (replacing the size segment in the URL).
 */
import { Router } from 'express';
import multer from 'multer';
import type { Database } from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const MAX_COVER_BYTES = 5 * 1024 * 1024; // 5 MB plenty for cover art
const ALLOWED_EXT = /^\.(jpe?g|png|webp|gif)$/i;

interface Deps {
  db: Database;
  coverDir: string;
}

interface TrackRow {
  id: number;
  cover_filename: string | null;
}

async function deleteIfExists(path: string) {
  try {
    await unlink(path);
  } catch {
    /* ok */
  }
}

function extFromMime(mime: string | null | undefined): string {
  if (!mime) return '.jpg';
  if (/png/i.test(mime)) return '.png';
  if (/webp/i.test(mime)) return '.webp';
  if (/gif/i.test(mime)) return '.gif';
  return '.jpg';
}

function extFromContentType(ct: string | null): string {
  if (!ct) return '.jpg';
  if (/png/i.test(ct)) return '.png';
  if (/webp/i.test(ct)) return '.webp';
  if (/gif/i.test(ct)) return '.gif';
  if (/svg/i.test(ct)) return '.svg';
  return '.jpg';
}

export function coversRouter({ db, coverDir }: Deps): Router {
  const r = Router();

  // Make sure the dir exists. Failures here are loud.
  if (!existsSync(coverDir)) {
    mkdirSync(coverDir, { recursive: true });
  }

  // Multer in-memory; we hand-write the file after validating the track + ext
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_COVER_BYTES },
    fileFilter: (_req, file, cb) => {
      const ext = extname(file.originalname).toLowerCase();
      if (ALLOWED_EXT.test(ext) || /^image\//.test(file.mimetype)) cb(null, true);
      else cb(new Error('Cover must be an image (jpg/png/webp/gif).'));
    },
  });

  // POST /api/tracks/:id/cover  — multipart upload
  r.post('/tracks/:id(\\d+)/cover', (req, res) => {
    upload.single('cover')(req, res, async (err) => {
      if (err) {
        res.status(400).json({ error: String(err.message ?? err) });
        return;
      }
      const id = Number(req.params.id);
      const track = db.prepare('SELECT id, cover_filename FROM tracks WHERE id = ?').get(id) as
        | TrackRow
        | undefined;
      if (!track) {
        res.status(404).json({ error: 'track not found' });
        return;
      }
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'cover file required (form field "cover")' });
        return;
      }
      const ext = extname(file.originalname).toLowerCase() || extFromMime(file.mimetype);
      const filename = `${id}${ext}`;

      // Remove any prior cover (could have different extension)
      if (track.cover_filename) {
        await deleteIfExists(join(coverDir, track.cover_filename));
      }
      await writeFile(join(coverDir, filename), file.buffer);

      db.prepare('UPDATE tracks SET cover_filename = ?, modified_at = datetime(\'now\') WHERE id = ?')
        .run(filename, id);

      res.json({
        ok: true,
        track_id: id,
        cover_url: `/api/covers/${encodeURIComponent(filename)}`,
        size_bytes: file.size,
      });
    });
  });

  // POST /api/tracks/:id/cover/url  — body: { url }
  r.post('/tracks/:id(\\d+)/cover/url', async (req, res) => {
    const id = Number(req.params.id);
    const track = db.prepare('SELECT id, cover_filename FROM tracks WHERE id = ?').get(id) as
      | TrackRow
      | undefined;
    if (!track) {
      res.status(404).json({ error: 'track not found' });
      return;
    }
    const url = String(req.body?.url ?? '').trim();
    if (!/^https?:\/\//i.test(url)) {
      res.status(400).json({ error: 'url must be http/https' });
      return;
    }
    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        res.status(400).json({ error: `fetch failed: ${resp.status}` });
        return;
      }
      const ct = resp.headers.get('content-type');
      const len = Number(resp.headers.get('content-length') || 0);
      if (len > MAX_COVER_BYTES) {
        res.status(400).json({ error: `image too large (${len} bytes, max ${MAX_COVER_BYTES})` });
        return;
      }
      if (ct && !/^image\//.test(ct)) {
        res.status(400).json({ error: `not an image (content-type: ${ct})` });
        return;
      }
      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.length > MAX_COVER_BYTES) {
        res.status(400).json({ error: 'image too large' });
        return;
      }
      const ext = extFromContentType(ct);
      const filename = `${id}${ext}`;
      if (track.cover_filename) {
        await deleteIfExists(join(coverDir, track.cover_filename));
      }
      await writeFile(join(coverDir, filename), buf);
      db.prepare('UPDATE tracks SET cover_filename = ?, modified_at = datetime(\'now\') WHERE id = ?')
        .run(filename, id);

      res.json({
        ok: true,
        track_id: id,
        cover_url: `/api/covers/${encodeURIComponent(filename)}`,
        size_bytes: buf.length,
        source_url: url,
      });
    } catch (err: any) {
      res.status(500).json({ error: `failed to fetch cover: ${err?.message ?? err}` });
    }
  });

  // DELETE /api/tracks/:id/cover
  r.delete('/tracks/:id(\\d+)/cover', async (req, res) => {
    const id = Number(req.params.id);
    const track = db.prepare('SELECT id, cover_filename FROM tracks WHERE id = ?').get(id) as
      | TrackRow
      | undefined;
    if (!track) {
      res.status(404).json({ error: 'track not found' });
      return;
    }
    if (track.cover_filename) {
      await deleteIfExists(join(coverDir, track.cover_filename));
    }
    db.prepare('UPDATE tracks SET cover_filename = NULL, modified_at = datetime(\'now\') WHERE id = ?')
      .run(id);
    res.json({ ok: true, track_id: id });
  });

  // GET /api/covers/search?q=...
  // Proxies iTunes Search API. No API key needed. Returns simplified results.
  r.get('/covers/search', async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (!q) {
      res.status(400).json({ error: 'q is required' });
      return;
    }
    const limit = Math.min(Number(req.query.limit) || 12, 25);
    try {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=album&limit=${limit}`;
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'music-station/0.1' },
      });
      if (!resp.ok) {
        res.status(502).json({ error: `iTunes returned ${resp.status}` });
        return;
      }
      const data = (await resp.json()) as { results?: any[] };
      const results = (data.results ?? []).map((r: any) => ({
        source: 'itunes',
        artist: r.artistName ?? null,
        album: r.collectionName ?? null,
        thumbnail_url: r.artworkUrl100 ?? null,
        // upgrade artwork resolution by replacing 100x100bb with 600x600bb
        full_url:
          typeof r.artworkUrl100 === 'string'
            ? r.artworkUrl100.replace(/\/\d+x\d+bb\.(jpg|png|webp)$/i, '/600x600bb.jpg')
            : null,
      }));
      res.json({ count: results.length, results });
    } catch (err: any) {
      res.status(500).json({ error: `search failed: ${err?.message ?? err}` });
    }
  });

  return r;
}
