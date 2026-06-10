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
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { assertPublicUrl } from '../net_guard.js';

/**
 * NetEase image URLs are obfuscated — the API returns a numeric picId
 * and the image lives at `p3.music.126.net/<encrypted>/<picId>.jpg`.
 * The encryption is XOR with a constant string + MD5 + base64url. This
 * is the same recipe NetEase's own web client uses; community-reverse-
 * engineered, stable for 10+ years. Without this, type=1006 results
 * have no cover URL we can actually display.
 */
function neteasePicUrlFromId(picId: string | number | null | undefined): string | null {
  if (picId === undefined || picId === null) return null;
  const idStr = String(picId);
  if (!idStr || idStr === '0') return null;
  const magic = '3go8&$8*3*3h0k(2)2';
  const buf = Buffer.from(idStr, 'ascii');
  for (let i = 0; i < buf.length; i++) {
    buf[i] ^= magic.charCodeAt(i % magic.length);
  }
  const md5 = createHash('md5').update(buf).digest('base64');
  const encrypted = md5.replace(/\//g, '_').replace(/\+/g, '-');
  return `https://p3.music.126.net/${encrypted}/${idStr}.jpg`;
}

/**
 * NetEase type=1006 returns the full lyric text in `lyrics.txt`, not
 * the matched snippet. Pull out the first line that actually contains
 * the user's query (case-insensitive) so the result tile shows
 * something meaningful — otherwise we'd display 200 chars of unrelated
 * lyric prefix.
 */
function extractLyricMatch(txt: string | null | undefined, q: string): string | null {
  if (!txt) return null;
  const lines = txt.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  const lower = q.toLowerCase();
  for (const line of lines) {
    if (line.toLowerCase().includes(lower)) return line.slice(0, 80);
  }
  return lines[0].slice(0, 80);
}

const MAX_COVER_BYTES = 5 * 1024 * 1024; // 5 MB plenty for cover art
const ALLOWED_EXT = /^\.(jpe?g|png|webp|gif)$/i;

/**
 * Background helper: scan tracks with cover_filename IS NULL, run an
 * iTunes search per track using artist+album (or title), and save the
 * top result. Skips tracks with no usable query. Polite: 200ms delay
 * between requests, 8s timeout per fetch.
 *
 * Called from the rescan endpoint so users get covers auto-filled
 * after dropping new MP3s in.
 */
export async function autoFetchMissingCovers(
  db: Database,
  coverDir: string,
): Promise<{ tried: number; found: number; failed: number; skipped: number }> {
  const rows = db
    .prepare('SELECT id, title, artist, album FROM tracks WHERE cover_filename IS NULL')
    .all() as Array<{
      id: number;
      title: string | null;
      artist: string | null;
      album: string | null;
    }>;

  let found = 0;
  let failed = 0;
  let skipped = 0;

  for (const t of rows) {
    const parts = [t.artist, t.album].filter((s): s is string => !!s && !!s.trim());
    const query = (parts.join(' ').trim() || (t.title ?? '').trim()).slice(0, 200);
    if (!query) {
      skipped++;
      continue;
    }
    try {
      const searchUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(
        query,
      )}&entity=album&limit=1`;
      const searchResp = await fetch(searchUrl, {
        signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': 'music-station/0.1' },
      });
      if (!searchResp.ok) {
        failed++;
        continue;
      }
      const searchData = (await searchResp.json()) as { results?: any[] };
      const r = searchData.results?.[0];
      if (!r?.artworkUrl100) {
        failed++;
        continue;
      }
      const fullUrl = String(r.artworkUrl100).replace(
        /\/\d+x\d+bb\.(jpg|png|webp)$/i,
        '/600x600bb.jpg',
      );

      const imgResp = await fetch(fullUrl, { signal: AbortSignal.timeout(8000) });
      if (!imgResp.ok) {
        failed++;
        continue;
      }
      const buf = Buffer.from(await imgResp.arrayBuffer());
      if (buf.length > MAX_COVER_BYTES) {
        failed++;
        continue;
      }

      const filename = `${t.id}.jpg`;
      await writeFile(join(coverDir, filename), buf);
      db.prepare(
        `UPDATE tracks SET cover_filename = ?, modified_at = datetime('now') WHERE id = ?`,
      ).run(filename, t.id);
      found++;
    } catch {
      failed++;
    }
    // Be polite to iTunes — slight pacing between requests
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return { tried: rows.length, found, failed, skipped };
}

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
        cover_url: `/api/covers/${encodeURIComponent(filename)}?v=${Date.now()}`,
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
      await assertPublicUrl(url);
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message ?? e) });
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
        cover_url: `/api/covers/${encodeURIComponent(filename)}?v=${Date.now()}`,
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

  // GET /api/covers/search-by-lyrics?q=<lyric text>
  // Proxies NetEase's type=1006 lyric-text search — the only public
  // endpoint among our lyric sources that matches against lyric BODY
  // text rather than just metadata. Returns songs that contain the
  // user's text, with the album cover URL so the result tile shows
  // something pickable. The lyric_match field contains a short snippet
  // of the matching line so the user can verify they got the right
  // song before clicking.
  r.get('/covers/search-by-lyrics', async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (!q) {
      res.status(400).json({ error: 'q is required' });
      return;
    }
    const limit = Math.min(Number(req.query.limit) || 12, 25);
    try {
      const url =
        `https://music.163.com/api/search/get?s=${encodeURIComponent(q)}` +
        `&type=1006&limit=${limit}`;
      const resp = await fetch(url, {
        signal: AbortSignal.timeout(8000),
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/120.0 Safari/537.36',
          Referer: 'https://music.163.com/',
        },
      });
      if (!resp.ok) {
        res.status(502).json({ error: `netease returned ${resp.status}` });
        return;
      }
      // NetEase type=1006 actually returns:
      //   { result: { songs: [{ name, artists:[{name}],
      //       album:{ name, picId, picUrl(maybe null) },
      //       lyrics: { txt: "<full lyric>", range: [...] } }] } }
      // Both the cover and the matched snippet need extra work — see
      // neteasePicUrlFromId and extractLyricMatch above.
      const j = (await resp.json()) as {
        result?: {
          songs?: Array<{
            name?: string;
            artists?: Array<{ name?: string }>;
            album?: {
              name?: string;
              picId?: string | number;
              picUrl?: string | null;
            };
            lyrics?: { txt?: string } | string | string[];
          }>;
        };
      };
      const songs = j.result?.songs ?? [];
      const results = songs
        .map((s) => {
          // Prefer picUrl if present (it sometimes is, especially for
          // newer albums); fall back to deriving from picId. Force
          // https either way to avoid mixed-content blocks.
          const rawPic =
            (typeof s.album?.picUrl === 'string' && s.album.picUrl) ||
            neteasePicUrlFromId(s.album?.picId);
          const pic = rawPic ? rawPic.replace(/^http:\/\//i, 'https://') : null;

          // lyrics can be: { txt }, string, string[]
          const lyricTxt =
            s.lyrics && typeof s.lyrics === 'object' && !Array.isArray(s.lyrics)
              ? typeof s.lyrics.txt === 'string'
                ? s.lyrics.txt
                : null
              : Array.isArray(s.lyrics)
                ? s.lyrics.join('\n')
                : typeof s.lyrics === 'string'
                  ? s.lyrics
                  : null;

          return {
            source: 'netease',
            title: s.name ?? null,
            artist:
              (s.artists ?? []).map((a) => a.name ?? '').filter(Boolean).join(', ') ||
              null,
            album: s.album?.name ?? null,
            thumbnail_url: pic,
            full_url: pic,
            lyric_match: extractLyricMatch(lyricTxt, q),
          };
        })
        .filter((r) => r.full_url);  // can't pick a result with no cover
      res.json({ count: results.length, results });
    } catch (err: any) {
      res.status(500).json({ error: `search failed: ${err?.message ?? err}` });
    }
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
