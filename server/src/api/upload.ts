/**
 * POST /api/upload — multipart audio file upload.
 *
 * Behavior:
 *   - Accepts one or more files in the `files` field
 *   - Filters by extension (mp3/m4a/flac/ogg/opus/wav/aac)
 *   - Per-file size cap = MAX_FILE_SIZE_MB (default 60 MB)
 *   - Drops files into MUSIC_DIR root with original (sanitized) filename
 *   - On filename collision, appends " (n)" before the extension
 *   - After all files written, runs a library scan so new tracks appear
 *     in the DB immediately. Returns the list of saved filenames.
 *
 * Files are owned by whoever the Node process runs as (the `mcp` user
 * in production). The Samba share's `force user = mcp` makes manual
 * drops match this same ownership.
 */
import { Router } from 'express';
import multer from 'multer';
import type { Database } from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { extname, basename, join } from 'node:path';
import { scanLibrary } from '../scanner.js';

const SUPPORTED_RE = /\.(mp3|m4a|flac|ogg|opus|wav|aac)$/i;
const MAX_FILE_SIZE_MB = Number(process.env.MAX_FILE_SIZE_MB ?? 60);

interface Deps {
  db: Database;
  musicDir: string;
}

export function uploadRouter({ db, musicDir }: Deps): Router {
  const r = Router();

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, musicDir),
    filename: (_req, file, cb) => {
      // Strip path separators / shell-unfriendly chars; keep CJK and most
      // unicode intact (Samba writes the same way, file system handles it).
      // Multer gives us file.originalname as latin1; reinterpret as utf-8
      // so Chinese/Japanese filenames survive.
      const original = Buffer.from(file.originalname, 'latin1').toString('utf8');
      const safe = original.replace(/[\/\\:*?"<>|\x00-\x1f]/g, '_').trim();
      const ext = extname(safe);
      const base = basename(safe, ext);

      let candidate = safe;
      let n = 1;
      while (existsSync(join(musicDir, candidate))) {
        candidate = `${base} (${n})${ext}`;
        n++;
        if (n > 999) {
          return cb(new Error('too many filename collisions'), '');
        }
      }
      cb(null, candidate);
    },
  });

  const upload = multer({
    storage,
    limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const original = Buffer.from(file.originalname, 'latin1').toString('utf8');
      if (SUPPORTED_RE.test(original)) {
        cb(null, true);
      } else {
        cb(new Error(`Unsupported file type: ${original}`));
      }
    },
  });

  r.post('/', (req, res) => {
    upload.array('files', 50)(req, res, async (err) => {
      if (err) {
        res.status(400).json({ error: String(err.message ?? err) });
        return;
      }
      const files = (req.files ?? []) as Express.Multer.File[];
      if (files.length === 0) {
        res.status(400).json({ error: 'no files received (form field name must be "files")' });
        return;
      }

      // Trigger a scan to insert the new files into the DB. The scanner
      // touches only new rel_paths (insert) and refreshes objective fields
      // for existing — perfectly safe to run after every upload.
      let scanResult;
      try {
        scanResult = await scanLibrary(db, musicDir);
      } catch (e: any) {
        // Files are saved but DB didn't get updated. Surface that.
        res.status(500).json({
          error: 'files saved but indexing failed',
          message: String(e?.message ?? e),
          files: files.map((f) => f.filename),
        });
        return;
      }

      // Assign ownership of just-uploaded tracks to the calling user.
      // The scanner inserts rows with owner_id NULL (it doesn't know about
      // sessions), so we look up rows by filename and stamp owner_id here.
      // This is also where future per-user upload quota would live.
      const ownerId = req.user?.id ?? null;
      if (ownerId) {
        const setOwner = db.prepare(
          'UPDATE tracks SET owner_id = ? WHERE rel_path = ? AND owner_id IS NULL',
        );
        for (const f of files) {
          setOwner.run(ownerId, f.filename);
        }
      }

      // Log to upload_log
      const logStmt = db.prepare(
        `INSERT INTO upload_log (filename, size_bytes, status, message) VALUES (?, ?, ?, ?)`,
      );
      for (const f of files) {
        logStmt.run(f.filename, f.size, 'ok', null);
      }

      res.json({
        ok: true,
        uploaded: files.map((f) => ({
          filename: f.filename,
          size_bytes: f.size,
        })),
        scan: scanResult,
      });
    });
  });

  return r;
}
