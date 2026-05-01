/**
 * Status / health / scanner endpoint.
 *
 * Used by frontend for the header pill and by ops monitoring.
 */
import { Router } from 'express';
import type { Database } from 'better-sqlite3';
import { scanLibrary } from '../scanner.js';

interface Deps {
  db: Database;
  musicDir: string;
  startedAt: Date;
}

export function statusRouter({ db, musicDir, startedAt }: Deps): Router {
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

  // Manual rescan trigger; admin-protected later.
  r.post('/rescan', async (_req, res) => {
    try {
      const result = await scanLibrary(db, musicDir);
      res.json({ ok: true, ...result });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  return r;
}
