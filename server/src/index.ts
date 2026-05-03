/**
 * music-station server entry.
 *
 * - Loads .env (PORT/HOST/MUSIC_DIR/DB_PATH/PUBLIC_URL)
 * - Opens SQLite (creates tables if absent)
 * - Triggers an initial library scan in background
 * - Starts Express with /api/tracks, /api/status routes
 * - In production: also serves the built frontend from web/dist as static
 *
 * Designed to run behind Tailscale serve at /app/* + /api/*.
 */
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import express from 'express';
import { openDatabase } from './db/schema.js';
import { scanLibrary } from './scanner.js';
import { tracksRouter } from './api/tracks.js';
import { statusRouter } from './api/status.js';
import { uploadRouter } from './api/upload.js';
import { playlistsRouter } from './api/playlists.js';
import { coversRouter } from './api/covers.js';

const here = dirname(fileURLToPath(import.meta.url));
// .env lives at repo root (../../ from server/dist/ or server/src/)
loadEnv({ path: resolve(here, '..', '..', '.env') });

const PORT = Number(process.env.PORT ?? 3002);
const HOST = process.env.HOST ?? '127.0.0.1';
const MUSIC_DIR = process.env.MUSIC_DIR ?? '/opt/music';
const COVER_DIR = process.env.COVER_DIR ?? '/opt/music-covers';
const DB_PATH = process.env.DB_PATH ?? '/var/lib/music-station/library.db';
const PUBLIC_URL = process.env.PUBLIC_URL ?? '';

const startedAt = new Date();
console.error(`[music-station] starting…`);
console.error(`  PORT=${PORT} HOST=${HOST}`);
console.error(`  MUSIC_DIR=${MUSIC_DIR}`);
console.error(`  DB_PATH=${DB_PATH}`);
console.error(`  PUBLIC_URL=${PUBLIC_URL || '(unset)'}`);
console.error(`  COVER_DIR=${COVER_DIR}`);

const db = openDatabase(DB_PATH);

// Initial scan in background; API serves whatever is in DB so far.
scanLibrary(db, MUSIC_DIR)
  .then((r) => console.error(`[music-station] initial scan: ${JSON.stringify(r)}`))
  .catch((err) => console.error(`[music-station] initial scan failed:`, err));

const app = express();
app.use(express.json({ limit: '4mb' }));

// Static cover serving — must precede /api routers since the cover URL
// is /api/covers/<filename>. We use express.static so range/cache work.
app.use('/api/covers', express.static(COVER_DIR, { maxAge: '1h', fallthrough: true }));

// API routes
app.use('/api/tracks', tracksRouter({ db, publicUrl: PUBLIC_URL, musicDir: MUSIC_DIR, coverDir: COVER_DIR }));
app.use('/api/status', statusRouter({ db, musicDir: MUSIC_DIR, coverDir: COVER_DIR, startedAt }));
app.use('/api/upload', uploadRouter({ db, musicDir: MUSIC_DIR }));
app.use('/api/playlists', playlistsRouter({ db, publicUrl: PUBLIC_URL }));
// coversRouter mounts at /api so its routes can be /api/tracks/:id/cover
// (track-scoped cover ops) AND /api/covers/search (library-wide search)
app.use('/api', coversRouter({ db, coverDir: COVER_DIR }));

// Catch-all 404 for /api/*
app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));

// Production: serve built frontend if web/dist exists.
//
// Mounted at BOTH `/` and `/app` so it works regardless of how Tailscale
// serve forwards the request:
//   - If Tailscale forwards `/app/assets/foo.css` as-is → /app mount strips
//     /app and serves from webDist
//   - If Tailscale strips the prefix and forwards `/assets/foo.css` → root
//     mount serves directly
// Vite base = '/app/' so the HTML references the /app/-prefixed URLs, which
// is the path Tailscale routes here.
const webDist = resolve(here, '..', '..', 'web', 'dist');
if (existsSync(webDist)) {
  console.error(`[music-station] serving frontend from ${webDist} at / and /app`);
  app.use('/app', express.static(webDist));
  app.use(express.static(webDist));
  // SPA fallback — anything not matched (and not /api/*) goes to index.html
  app.get(/^\/(app(\/.*)?)?$/, (_req, res) => {
    res.sendFile(join(webDist, 'index.html'));
  });
  app.get('*', (_req, res) => {
    res.sendFile(join(webDist, 'index.html'));
  });
} else {
  console.error(`[music-station] (no built frontend at ${webDist} — dev mode?)`);
  app.get('/', (_req, res) => {
    res.type('text').send(
      'music-station API is running.\nFrontend not built. Run `npm run build:web` or use `npm run dev`.\n\nAPI: GET /api/status, /api/tracks',
    );
  });
}

app.listen(PORT, HOST, () => {
  console.error(`[music-station] listening on ${HOST}:${PORT}`);
});
