/**
 * Lyrics API.
 *
 * Routes (mounted under /api so paths can be /api/tracks/:id/lyrics):
 *   GET    /api/tracks/:id/lyrics         — read locally cached .lrc (no network)
 *   POST   /api/tracks/:id/lyrics/fetch   — fetch from LRCLIB → Netease, save to disk
 *   DELETE /api/tracks/:id/lyrics         — remove cached .lrc
 *
 * Files live in LYRICS_DIR (default /opt/music/lyrics) named "<track_id>.lrc".
 * Naming by track_id keeps the lyric tied to the DB row regardless of whether
 * the user later renames/moves the audio file.
 *
 * Source priority:
 *   1. LRCLIB (lrclib.net) — free, open, no key, returns { syncedLyrics, plainLyrics }.
 *      Match keys: artist + title (+ optional album + duration ±2s).
 *   2. Netease Cloud Music web API — unofficial, sometimes rate-limited. Used as
 *      fallback for Chinese-language tracks LRCLIB doesn't cover. We pick the
 *      best search hit by duration proximity.
 */
import { Router } from 'express';
import type { Database } from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

interface Deps {
  db: Database;
  lyricsDir: string;
}

interface TrackRow {
  id: number;
  title: string | null;
  artist: string | null;
  album: string | null;
  duration_sec: number | null;
}

interface FetchHit {
  source: 'lrclib' | 'netease' | null;
  synced: string | null;   // LRC text with [mm:ss.xx] timestamps
  plain: string | null;    // plain text (no timestamps) — last-resort
}

const EMPTY: FetchHit = { source: null, synced: null, plain: null };

function lrcPath(lyricsDir: string, id: number): string {
  return join(lyricsDir, `${id}.lrc`);
}

async function readLocal(lyricsDir: string, id: number): Promise<string | null> {
  try {
    return await readFile(lrcPath(lyricsDir, id), 'utf8');
  } catch {
    return null;
  }
}

async function fetchFromLrclib(t: TrackRow): Promise<FetchHit> {
  if (!t.title || !t.artist) return EMPTY;
  const params = new URLSearchParams({
    track_name: t.title,
    artist_name: t.artist,
  });
  if (t.album) params.set('album_name', t.album);
  if (t.duration_sec) params.set('duration', String(Math.round(t.duration_sec)));

  try {
    const resp = await fetch(`https://lrclib.net/api/get?${params.toString()}`, {
      signal: AbortSignal.timeout(8000),
      headers: {
        'User-Agent': 'music-station/0.1 (https://github.com/showbox88/Music-Station)',
      },
    });
    if (!resp.ok) return EMPTY;
    const j = (await resp.json()) as {
      syncedLyrics?: string | null;
      plainLyrics?: string | null;
      instrumental?: boolean;
    };
    if (j.instrumental) {
      // LRCLIB tags some tracks as instrumental — represent as a single header line
      return { source: 'lrclib', synced: '[00:00.00]♪ Instrumental ♪', plain: null };
    }
    const synced = typeof j.syncedLyrics === 'string' && j.syncedLyrics.trim() ? j.syncedLyrics : null;
    const plain = typeof j.plainLyrics === 'string' && j.plainLyrics.trim() ? j.plainLyrics : null;
    if (!synced && !plain) return EMPTY;
    return { source: 'lrclib', synced, plain };
  } catch {
    return EMPTY;
  }
}

async function fetchFromNetease(t: TrackRow): Promise<FetchHit> {
  if (!t.title || !t.artist) return EMPTY;
  const query = `${t.artist} ${t.title}`.trim().slice(0, 200);
  // Netease's web API checks UA + Referer; without them you get empty/blocked.
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    Referer: 'https://music.163.com/',
  };
  try {
    const searchUrl = `https://music.163.com/api/search/get?s=${encodeURIComponent(
      query,
    )}&type=1&limit=10`;
    const sResp = await fetch(searchUrl, {
      signal: AbortSignal.timeout(8000),
      headers,
    });
    if (!sResp.ok) return EMPTY;
    const sJ = (await sResp.json()) as {
      result?: { songs?: Array<{ id: number; duration?: number }> };
    };
    const songs = sJ.result?.songs;
    if (!Array.isArray(songs) || songs.length === 0) return EMPTY;

    // Pick the song whose duration is closest to ours (within 5s window if known).
    let pick = songs[0];
    if (t.duration_sec) {
      const targetMs = t.duration_sec * 1000;
      pick = songs.reduce((best, s) => {
        const db = Math.abs((best.duration ?? 0) - targetMs);
        const ds = Math.abs((s.duration ?? 0) - targetMs);
        return ds < db ? s : best;
      }, songs[0]);
    }
    if (!pick?.id) return EMPTY;

    const lyrUrl = `https://music.163.com/api/song/lyric?id=${pick.id}&lv=1&kv=1&tv=-1`;
    const lResp = await fetch(lyrUrl, {
      signal: AbortSignal.timeout(8000),
      headers,
    });
    if (!lResp.ok) return EMPTY;
    const lJ = (await lResp.json()) as { lrc?: { lyric?: string } };
    const synced = lJ.lrc?.lyric?.trim() ? lJ.lrc.lyric : null;
    if (!synced) return EMPTY;
    return { source: 'netease', synced, plain: null };
  } catch {
    return EMPTY;
  }
}

export function lyricsRouter({ db, lyricsDir }: Deps): Router {
  const r = Router();

  if (!existsSync(lyricsDir)) {
    mkdirSync(lyricsDir, { recursive: true });
  }

  // GET /api/tracks/:id/lyrics — local-only (no outbound network)
  r.get('/tracks/:id(\\d+)/lyrics', async (req, res) => {
    const id = Number(req.params.id);
    const exists = db.prepare('SELECT id FROM tracks WHERE id = ?').get(id);
    if (!exists) {
      res.status(404).json({ error: 'track not found' });
      return;
    }
    const text = await readLocal(lyricsDir, id);
    if (!text) {
      res.json({ found: false });
      return;
    }
    res.json({ found: true, source: 'local', synced: text });
  });

  // POST /api/tracks/:id/lyrics/fetch — fetch from LRCLIB → Netease, persist
  r.post('/tracks/:id(\\d+)/lyrics/fetch', async (req, res) => {
    const id = Number(req.params.id);
    const t = db
      .prepare('SELECT id, title, artist, album, duration_sec FROM tracks WHERE id = ?')
      .get(id) as TrackRow | undefined;
    if (!t) {
      res.status(404).json({ error: 'track not found' });
      return;
    }
    if (!t.title && !t.artist) {
      res.status(400).json({ error: 'track has no title/artist to search by' });
      return;
    }

    let hit = await fetchFromLrclib(t);
    if (!hit.synced && !hit.plain) {
      hit = await fetchFromNetease(t);
    }

    if (!hit.synced && !hit.plain) {
      res.json({ ok: false, found: false, source: null });
      return;
    }

    // Prefer synced. Plain text is saved as-is — the parser treats it as
    // "no timestamps" and falls back to a non-scrolling display.
    const text = hit.synced ?? hit.plain ?? '';
    await writeFile(lrcPath(lyricsDir, id), text, 'utf8');

    res.json({
      ok: true,
      found: true,
      source: hit.source,
      synced: text,
      has_timestamps: !!hit.synced,
    });
  });

  // DELETE /api/tracks/:id/lyrics — remove cached file (idempotent)
  r.delete('/tracks/:id(\\d+)/lyrics', async (req, res) => {
    const id = Number(req.params.id);
    try {
      await unlink(lrcPath(lyricsDir, id));
    } catch {
      /* not present is fine */
    }
    res.json({ ok: true, track_id: id });
  });

  return r;
}
