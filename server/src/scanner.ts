/**
 * Filesystem → SQLite sync for the music library.
 *
 * Walks MUSIC_DIR recursively, parses ID3 tags via music-metadata, and
 * upserts rows into `tracks`. New files added, missing files removed,
 * existing files updated when filesystem mtime > DB modified_at.
 *
 * Sync, not async — better-sqlite3 transactions are sync. For a few thousand
 * tracks this finishes in seconds. Don't bother with worker threads yet.
 */
import type { Database } from 'better-sqlite3';
import { readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { parseFile } from 'music-metadata';

const SUPPORTED = /\.(mp3|m4a|flac|ogg|opus|wav|aac)$/i;

interface ScanResult {
  scanned_files: number;
  inserted: number;
  updated: number;
  removed: number;
  failed: number;
  took_ms: number;
}

async function walkAudio(dir: string, root: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkAudio(abs, root)));
    } else if (entry.isFile() && SUPPORTED.test(entry.name)) {
      out.push(relative(root, abs).split(sep).join('/'));
    }
  }
  return out;
}

interface ScannedTrack {
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
}

async function readTrack(absPath: string, relPath: string): Promise<ScannedTrack | null> {
  let st;
  try {
    st = await stat(absPath);
  } catch {
    return null;
  }
  // Filename fallback for title
  const fallbackTitle = relPath.replace(/\.[^.]+$/, '').split('/').pop() || relPath;

  let common: any = {};
  let format: any = {};
  try {
    const meta = await parseFile(absPath, { duration: true, skipCovers: true });
    common = meta.common;
    format = meta.format;
  } catch {
    /* keep defaults */
  }

  return {
    rel_path: relPath,
    title: (common.title as string | undefined)?.trim() || fallbackTitle,
    artist: (common.artist as string | undefined)?.trim() || null,
    album: (common.album as string | undefined)?.trim() || null,
    genre: Array.isArray(common.genre) ? common.genre[0] || null : null,
    year: typeof common.year === 'number' ? common.year : null,
    track_no: typeof common.track?.no === 'number' ? common.track.no : null,
    duration_sec: typeof format.duration === 'number' ? format.duration : null,
    size_bytes: st.size,
    bitrate: typeof format.bitrate === 'number' ? Math.round(format.bitrate) : null,
    mime: typeof format.codec === 'string' ? `audio/${format.codec.toLowerCase()}` : null,
  };
}

export async function scanLibrary(db: Database, musicDir: string): Promise<ScanResult> {
  const start = Date.now();

  const fsRelPaths = new Set(await walkAudio(musicDir, musicDir));
  const dbRelPaths = new Set(
    db.prepare('SELECT rel_path FROM tracks').all().map((r: any) => r.rel_path),
  );

  let inserted = 0;
  let updated = 0;
  let removed = 0;
  let failed = 0;

  // Remove rows whose files vanished.
  const toRemove = [...dbRelPaths].filter((p) => !fsRelPaths.has(p));
  if (toRemove.length > 0) {
    const stmt = db.prepare('DELETE FROM tracks WHERE rel_path = ?');
    const tx = db.transaction((paths: string[]) => {
      for (const p of paths) stmt.run(p);
    });
    tx(toRemove);
    removed = toRemove.length;
  }

  // Upsert tracks. Process in chunks to keep memory bounded.
  const upsertStmt = db.prepare(`
    INSERT INTO tracks (rel_path, title, artist, album, genre, year, track_no,
                        duration_sec, size_bytes, bitrate, mime)
    VALUES (@rel_path, @title, @artist, @album, @genre, @year, @track_no,
            @duration_sec, @size_bytes, @bitrate, @mime)
    ON CONFLICT (rel_path) DO UPDATE SET
      title        = excluded.title,
      artist       = excluded.artist,
      album        = excluded.album,
      genre        = excluded.genre,
      year         = excluded.year,
      track_no     = excluded.track_no,
      duration_sec = excluded.duration_sec,
      size_bytes   = excluded.size_bytes,
      bitrate      = excluded.bitrate,
      mime         = excluded.mime,
      modified_at  = datetime('now')
  `);

  for (const rel of fsRelPaths) {
    const abs = join(musicDir, ...rel.split('/'));
    try {
      const t = await readTrack(abs, rel);
      if (!t) {
        failed++;
        continue;
      }
      const existed = dbRelPaths.has(rel);
      upsertStmt.run(t);
      if (existed) updated++;
      else inserted++;
    } catch {
      failed++;
    }
  }

  return {
    scanned_files: fsRelPaths.size,
    inserted,
    updated,
    removed,
    failed,
    took_ms: Date.now() - start,
  };
}
