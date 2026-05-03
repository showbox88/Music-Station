/**
 * Status / health / scanner endpoint.
 *
 * Used by frontend for the header pill and by ops monitoring.
 */
import { Router } from 'express';
import type { Database } from 'better-sqlite3';
import { statfs } from 'node:fs/promises';
import { scanLibrary } from '../scanner.js';
import { autoFetchMissingCovers } from './covers.js';

interface Deps {
  db: Database;
  musicDir: string;
  coverDir: string;
  startedAt: Date;
}

export function statusRouter({ db, musicDir, coverDir, startedAt }: Deps): Router {
  const r = Router();

  r.get('/', (_req, res) => {
    const tracks = (db.prepare('SELECT COUNT(*) AS c FROM tracks').get() as { c: number }).c;
    const playlists = (db.prepare('SELECT COUNT(*) AS c FROM playlists').get() as { c: number }).c;
    const lastScan = (
      db.prepare('SELECT MAX(modified_at) AS m FROM tracks').get() as { m: string | null }
    ).m;
    res.json({
      ok: true,
      service: 'music-station',
      version: '0.1.0',
      tracks,
      playlists,
      music_dir: musicDir,
      last_scan: lastScan,
      started_at: startedAt.toISOString(),
      uptime_sec: Math.round((Date.now() - startedAt.getTime()) / 1000),
    });
  });

  // Filesystem free/used for the music dir's mount point. The library size
  // is the SUM(size_bytes) from the tracks table — cheaper than walking the
  // directory and good enough as a "how much space am I using" indicator.
  r.get('/disk', async (_req, res) => {
    try {
      const fs = await statfs(musicDir);
      const total = Number(fs.blocks) * Number(fs.bsize);
      const free = Number(fs.bavail) * Number(fs.bsize);
      const used = total - free;
      const librarySize =
        (db.prepare('SELECT COALESCE(SUM(size_bytes),0) AS s FROM tracks').get() as { s: number })
          .s ?? 0;
      res.json({
        ok: true,
        music_dir: musicDir,
        total_bytes: total,
        free_bytes: free,
        used_bytes: used,
        library_bytes: librarySize,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  // Manual rescan trigger. Also auto-fetches covers for any track missing
  // one (queries iTunes Search API and saves the top result).
  // Skip the cover step with ?covers=false for a fast scan-only rescan.
  r.post('/rescan', async (req, res) => {
    try {
      const result = await scanLibrary(db, musicDir);
      let covers: { tried: number; found: number; failed: number; skipped: number } | null = null;
      if (req.query.covers !== 'false') {
        covers = await autoFetchMissingCovers(db, coverDir);
      }
      res.json({ ok: true, ...result, covers });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  return r;
}
