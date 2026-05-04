/**
 * Lyrics API.
 *
 * Routes (mounted under /api so paths can be /api/tracks/:id/lyrics):
 *   GET    /api/tracks/:id/lyrics              — read locally cached .lrc (no network)
 *   POST   /api/tracks/:id/lyrics/fetch        — auto-pick: try sources in order, save first hit
 *   GET    /api/tracks/:id/lyrics/search       — query all sources, return candidates (no save)
 *   GET    /api/lyrics/preview                 — ?source=X&ext_id=Y → fetch full text (no save)
 *   POST   /api/tracks/:id/lyrics/select       — body { source, ext_id } → fetch + save
 *   PUT    /api/tracks/:id/lyrics              — manual override; body { text } (.lrc or plain)
 *   DELETE /api/tracks/:id/lyrics              — remove cached .lrc
 *
 * Files live in LYRICS_DIR (default /opt/music/lyrics) named "<track_id>.lrc".
 *
 * Sources (in priority order for auto-fetch):
 *   1. LRCLIB  — open, no key, English-leaning, has synced lyrics
 *   2. Netease — Chinese-leaning, unofficial web API, synced
 *   3. QQ Music — Chinese complement (Cantonese, Taiwan artists), unofficial
 *
 * Each source exposes search(track) → candidates[] and get(ext_id) → lyric text.
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

type SourceName = 'lrclib' | 'netease' | 'qq' | 'kugou';

interface Candidate {
  source: SourceName;
  ext_id: string;
  title: string;
  artist: string;
  album: string | null;
  duration_sec: number | null;
  has_synced: boolean;
}

interface LyricBody {
  synced: string | null;  // LRC text with [mm:ss.xx] timestamps
  plain: string | null;   // plain text (no timestamps)
}

const EMPTY_BODY: LyricBody = { synced: null, plain: null };

const FETCH_TIMEOUT_MS = 8000;

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

function hasTimestamps(text: string): boolean {
  return /\[\d+:\d{1,2}(?:[.:]\d{1,3})?\]/.test(text);
}

/* ------------------------------- LRCLIB ------------------------------- */

async function searchLrclib(t: TrackRow): Promise<Candidate[]> {
  if (!t.title) return [];
  const params = new URLSearchParams({ track_name: t.title });
  if (t.artist) params.set('artist_name', t.artist);
  if (t.album) params.set('album_name', t.album);
  try {
    const resp = await fetch(`https://lrclib.net/api/search?${params.toString()}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'User-Agent':
          'music-station/0.1 (https://github.com/showbox88/Music-Station)',
      },
    });
    if (!resp.ok) return [];
    const arr = (await resp.json()) as Array<{
      id: number;
      trackName?: string | null;
      artistName?: string | null;
      albumName?: string | null;
      duration?: number | null;
      syncedLyrics?: string | null;
      plainLyrics?: string | null;
      instrumental?: boolean;
    }>;
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, 10).map((h) => ({
      source: 'lrclib' as const,
      ext_id: String(h.id),
      title: h.trackName ?? '',
      artist: h.artistName ?? '',
      album: h.albumName ?? null,
      duration_sec: typeof h.duration === 'number' ? h.duration : null,
      has_synced:
        !!h.instrumental ||
        (typeof h.syncedLyrics === 'string' && h.syncedLyrics.trim().length > 0),
    }));
  } catch {
    return [];
  }
}

async function getLrclib(extId: string): Promise<LyricBody> {
  try {
    const resp = await fetch(`https://lrclib.net/api/get/${encodeURIComponent(extId)}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'User-Agent':
          'music-station/0.1 (https://github.com/showbox88/Music-Station)',
      },
    });
    if (!resp.ok) return EMPTY_BODY;
    const j = (await resp.json()) as {
      syncedLyrics?: string | null;
      plainLyrics?: string | null;
      instrumental?: boolean;
    };
    if (j.instrumental) {
      return { synced: '[00:00.00]♪ Instrumental ♪', plain: null };
    }
    const synced = typeof j.syncedLyrics === 'string' && j.syncedLyrics.trim() ? j.syncedLyrics : null;
    const plain = typeof j.plainLyrics === 'string' && j.plainLyrics.trim() ? j.plainLyrics : null;
    return { synced, plain };
  } catch {
    return EMPTY_BODY;
  }
}

/* ------------------------------ Netease ------------------------------ */

const NETEASE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  Referer: 'https://music.163.com/',
};

async function searchNetease(t: TrackRow): Promise<Candidate[]> {
  if (!t.title) return [];
  const query = `${t.artist ?? ''} ${t.title}`.trim().slice(0, 200);
  try {
    const url = `https://music.163.com/api/search/get?s=${encodeURIComponent(
      query,
    )}&type=1&limit=10`;
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: NETEASE_HEADERS,
    });
    if (!resp.ok) return [];
    const j = (await resp.json()) as {
      result?: {
        songs?: Array<{
          id: number;
          name?: string;
          artists?: Array<{ name?: string }>;
          album?: { name?: string };
          duration?: number;
        }>;
      };
    };
    const songs = j.result?.songs;
    if (!Array.isArray(songs)) return [];
    return songs.slice(0, 10).map((s) => ({
      source: 'netease' as const,
      ext_id: String(s.id),
      title: s.name ?? '',
      artist: (s.artists ?? []).map((a) => a.name ?? '').filter(Boolean).join(', '),
      album: s.album?.name ?? null,
      duration_sec:
        typeof s.duration === 'number' ? Math.round(s.duration / 1000) : null,
      // Netease search doesn't tell us if the song has synced lyrics — assume yes.
      has_synced: true,
    }));
  } catch {
    return [];
  }
}

async function getNetease(extId: string): Promise<LyricBody> {
  try {
    const url = `https://music.163.com/api/song/lyric?id=${encodeURIComponent(extId)}&lv=1&kv=1&tv=-1`;
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: NETEASE_HEADERS,
    });
    if (!resp.ok) return EMPTY_BODY;
    const j = (await resp.json()) as { lrc?: { lyric?: string } };
    const text = j.lrc?.lyric?.trim();
    if (!text) return EMPTY_BODY;
    return hasTimestamps(text)
      ? { synced: text, plain: null }
      : { synced: null, plain: text };
  } catch {
    return EMPTY_BODY;
  }
}

/* ------------------------------- QQ Music ----------------------------- */

const QQ_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  Referer: 'https://y.qq.com/',
};

async function searchQQ(t: TrackRow): Promise<Candidate[]> {
  if (!t.title) return [];
  const query = `${t.artist ?? ''} ${t.title}`.trim().slice(0, 200);
  try {
    const url =
      `https://c.y.qq.com/soso/fcgi-bin/client_search_cp` +
      `?w=${encodeURIComponent(query)}&format=json&p=1&n=10`;
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: QQ_HEADERS,
    });
    if (!resp.ok) return [];
    const j = (await resp.json()) as {
      data?: {
        song?: {
          list?: Array<{
            songmid?: string;
            songname?: string;
            singer?: Array<{ name?: string }>;
            albumname?: string;
            interval?: number;  // seconds
          }>;
        };
      };
    };
    const list = j.data?.song?.list;
    if (!Array.isArray(list)) return [];
    return list
      .filter((s) => s.songmid)
      .slice(0, 10)
      .map((s) => ({
        source: 'qq' as const,
        ext_id: s.songmid as string,
        title: s.songname ?? '',
        artist: (s.singer ?? []).map((a) => a.name ?? '').filter(Boolean).join(', '),
        album: s.albumname ?? null,
        duration_sec: typeof s.interval === 'number' ? s.interval : null,
        has_synced: true,
      }));
  } catch {
    return [];
  }
}

async function getQQ(extId: string): Promise<LyricBody> {
  try {
    const url =
      `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg` +
      `?songmid=${encodeURIComponent(extId)}&format=json&nobase64=1&g_tk=5381`;
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: QQ_HEADERS,
    });
    if (!resp.ok) return EMPTY_BODY;
    const j = (await resp.json()) as { lyric?: string; retcode?: number };
    if (j.retcode !== 0 && j.retcode !== undefined) return EMPTY_BODY;
    const raw = j.lyric;
    if (!raw || typeof raw !== 'string') return EMPTY_BODY;
    // QQ wraps & at start sometimes; trim and decode HTML entities
    const text = raw
      .replace(/&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim();
    if (!text) return EMPTY_BODY;
    return hasTimestamps(text)
      ? { synced: text, plain: null }
      : { synced: null, plain: text };
  } catch {
    return EMPTY_BODY;
  }
}

/* -------------------------------- Kugou ------------------------------- */

const KUGOU_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
};

// Kugou's ext_id encodes both hash and duration_ms because the lyric
// download endpoint matches by hash+duration to disambiguate covers/remixes.
// Format: "<hash>:<durationMs>"
function kugouExtId(hash: string, durationMs: number): string {
  return `${hash}:${durationMs}`;
}
function parseKugouExtId(ext: string): { hash: string; durationMs: number } | null {
  const [hash, ms] = ext.split(':');
  if (!hash || !ms) return null;
  const durationMs = Number(ms);
  if (!Number.isFinite(durationMs)) return null;
  return { hash, durationMs };
}

async function searchKugou(t: TrackRow): Promise<Candidate[]> {
  if (!t.title) return [];
  const query = `${t.artist ?? ''} ${t.title}`.trim().slice(0, 200);
  try {
    const url =
      `https://mobileservice.kugou.com/api/v3/search/song` +
      `?keyword=${encodeURIComponent(query)}&page=1&pagesize=10&showtype=10`;
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: KUGOU_HEADERS,
    });
    if (!resp.ok) return [];
    const j = (await resp.json()) as {
      data?: {
        info?: Array<{
          hash?: string;
          songname?: string;
          singername?: string;
          album_name?: string;
          duration?: number;  // seconds
        }>;
      };
    };
    const list = j.data?.info;
    if (!Array.isArray(list)) return [];
    return list
      .filter((s) => s.hash)
      .slice(0, 10)
      .map((s) => ({
        source: 'kugou' as const,
        ext_id: kugouExtId(s.hash as string, (s.duration ?? 0) * 1000),
        title: s.songname ?? '',
        artist: s.singername ?? '',
        album: s.album_name || null,
        duration_sec: typeof s.duration === 'number' ? s.duration : null,
        has_synced: true,
      }));
  } catch {
    return [];
  }
}

async function getKugou(extId: string): Promise<LyricBody> {
  const parsed = parseKugouExtId(extId);
  if (!parsed) return EMPTY_BODY;
  try {
    // Step 1: krcs lookup → returns candidates [{ id, accesskey, ... }]
    const lookupUrl =
      `https://krcs.kugou.com/search?ver=1&man=yes&client=mobi` +
      `&hash=${encodeURIComponent(parsed.hash)}&duration=${parsed.durationMs}`;
    const lResp = await fetch(lookupUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: KUGOU_HEADERS,
    });
    if (!lResp.ok) return EMPTY_BODY;
    const lJ = (await lResp.json()) as {
      candidates?: Array<{ id?: string; accesskey?: string }>;
    };
    const cand = lJ.candidates?.[0];
    if (!cand?.id || !cand?.accesskey) return EMPTY_BODY;

    // Step 2: download lrc (charset=utf8 returns base64-encoded UTF-8 LRC)
    const dlUrl =
      `https://lyrics.kugou.com/download?ver=1&client=pc&fmt=lrc&charset=utf8` +
      `&id=${encodeURIComponent(cand.id)}&accesskey=${encodeURIComponent(cand.accesskey)}`;
    const dResp = await fetch(dlUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: KUGOU_HEADERS,
    });
    if (!dResp.ok) return EMPTY_BODY;
    const dJ = (await dResp.json()) as { content?: string; status?: number };
    if (dJ.status !== 200 || !dJ.content) return EMPTY_BODY;
    let text: string;
    try {
      text = Buffer.from(dJ.content, 'base64').toString('utf8').trim();
    } catch {
      return EMPTY_BODY;
    }
    if (!text) return EMPTY_BODY;
    return hasTimestamps(text)
      ? { synced: text, plain: null }
      : { synced: null, plain: text };
  } catch {
    return EMPTY_BODY;
  }
}

/* ------------------------------ Dispatch ------------------------------ */

const SOURCES: SourceName[] = ['lrclib', 'netease', 'qq', 'kugou'];

async function searchAll(t: TrackRow): Promise<Candidate[]> {
  // Run all sources in parallel; ignore individual failures.
  const results = await Promise.allSettled([
    searchLrclib(t),
    searchNetease(t),
    searchQQ(t),
    searchKugou(t),
  ]);
  const out: Candidate[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') out.push(...r.value);
  }
  return out;
}

async function getBySource(source: SourceName, extId: string): Promise<LyricBody> {
  switch (source) {
    case 'lrclib': return getLrclib(extId);
    case 'netease': return getNetease(extId);
    case 'qq': return getQQ(extId);
    case 'kugou': return getKugou(extId);
  }
}

/* -------------------------------- Router ----------------------------- */

export function lyricsRouter({ db, lyricsDir }: Deps): Router {
  const r = Router();

  if (!existsSync(lyricsDir)) {
    mkdirSync(lyricsDir, { recursive: true });
  }

  function getTrack(id: number): TrackRow | undefined {
    return db
      .prepare('SELECT id, title, artist, album, duration_sec FROM tracks WHERE id = ?')
      .get(id) as TrackRow | undefined;
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

  // GET /api/tracks/:id/lyrics/search — return candidates from all sources
  r.get('/tracks/:id(\\d+)/lyrics/search', async (req, res) => {
    const id = Number(req.params.id);
    const t = getTrack(id);
    if (!t) {
      res.status(404).json({ error: 'track not found' });
      return;
    }
    if (!t.title && !t.artist) {
      res.json({ count: 0, candidates: [] });
      return;
    }
    const candidates = await searchAll(t);
    res.json({ count: candidates.length, candidates });
  });

  // GET /api/lyrics/preview?source=X&ext_id=Y — fetch full text without saving
  r.get('/lyrics/preview', async (req, res) => {
    const source = String(req.query.source ?? '') as SourceName;
    const extId = String(req.query.ext_id ?? '');
    if (!SOURCES.includes(source) || !extId) {
      res.status(400).json({ error: 'source and ext_id required' });
      return;
    }
    const body = await getBySource(source, extId);
    if (!body.synced && !body.plain) {
      res.json({ ok: false, found: false });
      return;
    }
    res.json({
      ok: true,
      found: true,
      source,
      ext_id: extId,
      synced: body.synced,
      plain: body.plain,
      has_timestamps: !!body.synced,
    });
  });

  // POST /api/tracks/:id/lyrics/select — body { source, ext_id } → fetch + save
  r.post('/tracks/:id(\\d+)/lyrics/select', async (req, res) => {
    const id = Number(req.params.id);
    const t = getTrack(id);
    if (!t) {
      res.status(404).json({ error: 'track not found' });
      return;
    }
    const source = String(req.body?.source ?? '') as SourceName;
    const extId = String(req.body?.ext_id ?? '');
    if (!SOURCES.includes(source) || !extId) {
      res.status(400).json({ error: 'source and ext_id required' });
      return;
    }
    const body = await getBySource(source, extId);
    const text = body.synced ?? body.plain;
    if (!text) {
      res.json({ ok: false, found: false, source });
      return;
    }
    await writeFile(lrcPath(lyricsDir, id), text, 'utf8');
    res.json({
      ok: true,
      found: true,
      source,
      synced: text,
      has_timestamps: !!body.synced,
    });
  });

  // POST /api/tracks/:id/lyrics/fetch — auto-pick: try sources in order, save first hit
  r.post('/tracks/:id(\\d+)/lyrics/fetch', async (req, res) => {
    const id = Number(req.params.id);
    const t = getTrack(id);
    if (!t) {
      res.status(404).json({ error: 'track not found' });
      return;
    }
    if (!t.title && !t.artist) {
      res.status(400).json({ error: 'track has no title/artist to search by' });
      return;
    }

    // Strategy: query all sources in parallel, pick the best candidate by
    // source priority + duration proximity. This is faster than serial
    // fallback and avoids missing a better hit just because LRCLIB had
    // *some* result for an ambiguous query.
    const candidates = await searchAll(t);
    if (candidates.length === 0) {
      res.json({ ok: false, found: false, source: null });
      return;
    }

    const priority: Record<SourceName, number> = { lrclib: 0, netease: 1, qq: 2, kugou: 3 };
    const target = t.duration_sec ?? null;
    const ranked = [...candidates].sort((a, b) => {
      // Prefer candidates with synced lyrics
      if (a.has_synced !== b.has_synced) return a.has_synced ? -1 : 1;
      // Then duration proximity (if we know the target)
      if (target !== null) {
        const da = a.duration_sec !== null ? Math.abs(a.duration_sec - target) : 999;
        const db2 = b.duration_sec !== null ? Math.abs(b.duration_sec - target) : 999;
        if (Math.abs(da - db2) > 2) return da - db2;
      }
      // Then source priority
      return priority[a.source] - priority[b.source];
    });

    // Try in ranked order until one returns text
    for (const c of ranked) {
      const body = await getBySource(c.source, c.ext_id);
      const text = body.synced ?? body.plain;
      if (!text) continue;
      await writeFile(lrcPath(lyricsDir, id), text, 'utf8');
      res.json({
        ok: true,
        found: true,
        source: c.source,
        synced: text,
        has_timestamps: !!body.synced,
      });
      return;
    }
    res.json({ ok: false, found: false, source: null });
  });

  // PUT /api/tracks/:id/lyrics — manual upload/paste; body { text }
  r.put('/tracks/:id(\\d+)/lyrics', async (req, res) => {
    const id = Number(req.params.id);
    const exists = db.prepare('SELECT id FROM tracks WHERE id = ?').get(id);
    if (!exists) {
      res.status(404).json({ error: 'track not found' });
      return;
    }
    const text = String(req.body?.text ?? '');
    if (!text.trim()) {
      res.status(400).json({ error: 'text must be non-empty' });
      return;
    }
    if (text.length > 256 * 1024) {
      res.status(413).json({ error: 'lyrics too large (max 256KB)' });
      return;
    }
    await writeFile(lrcPath(lyricsDir, id), text, 'utf8');
    res.json({
      ok: true,
      found: true,
      source: 'manual',
      synced: text,
      has_timestamps: hasTimestamps(text),
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
