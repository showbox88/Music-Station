import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * SQLite schema for music-station.
 *
 * Single-tenant, single-user. better-sqlite3 is synchronous so call sites
 * read like plain code (no async needed). Performance is plenty for a
 * personal library — 100k+ tracks no sweat.
 *
 * Schema is defined here as IF NOT EXISTS statements run at startup.
 * Migration story: when we change schema, add a versioned migration block
 * below. For S1, schema is the initial version.
 */
export function openDatabase(dbPath: string): Database.Database {
  // Ensure parent dir exists (e.g. /var/lib/music-station/)
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');     // safer concurrent reads
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');   // good enough for personal use

  db.exec(`
    -- Each MP3/audio file = one track row.
    --
    -- Field policy:
    --   "subjective" fields (title, artist, album, genre, year, track_no) are
    --     INITIALIZED from ID3 tags on first scan, then become DB-managed.
    --     Subsequent rescans NEVER touch them — they're the user's edits.
    --     The MP3 file itself is never modified.
    --
    --   "objective" fields (duration_sec, size_bytes, bitrate, mime) are
    --     refreshed on every rescan from the actual file on disk.
    --
    --   last_edited_at is set when the user PUTs an update via the API.
    --     NULL means "never edited" → values still reflect the file's tags.
    CREATE TABLE IF NOT EXISTS tracks (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      rel_path       TEXT NOT NULL UNIQUE,        -- relative to MUSIC_DIR
      title          TEXT,
      artist         TEXT,
      album          TEXT,
      genre          TEXT,
      year           INTEGER,
      track_no       INTEGER,
      duration_sec   REAL,
      size_bytes     INTEGER,
      bitrate        INTEGER,
      mime           TEXT,                         -- "audio/mpeg" etc
      added_at       TEXT DEFAULT (datetime('now')),
      modified_at    TEXT DEFAULT (datetime('now')),
      last_edited_at TEXT                          -- NULL = never edited via UI
    );

    -- Backfill column for databases created before last_edited_at existed.
    -- (SQLite is fine with no-op when the column already exists thanks to
    -- IF NOT EXISTS pattern via PRAGMA.)
  `);
  // Migration helper: add last_edited_at if it's missing (for DBs created
  // before this column was added).
  const cols = db.prepare(`PRAGMA table_info(tracks)`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'last_edited_at')) {
    db.exec(`ALTER TABLE tracks ADD COLUMN last_edited_at TEXT`);
  }
  db.exec(`

    CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
    CREATE INDEX IF NOT EXISTS idx_tracks_album  ON tracks(album);
    CREATE INDEX IF NOT EXISTS idx_tracks_title  ON tracks(title);

    -- Free-form tags (multi to one track). Distinct from genre (which is single).
    CREATE TABLE IF NOT EXISTS tags (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS track_tags (
      track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      tag_id   INTEGER NOT NULL REFERENCES tags(id)   ON DELETE CASCADE,
      PRIMARY KEY (track_id, tag_id)
    );

    -- Playlists.
    CREATE TABLE IF NOT EXISTS playlists (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      description TEXT,
      created_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS playlist_tracks (
      playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      track_id    INTEGER NOT NULL REFERENCES tracks(id)    ON DELETE CASCADE,
      position    INTEGER NOT NULL,
      PRIMARY KEY (playlist_id, track_id)
    );
    CREATE INDEX IF NOT EXISTS idx_pt_playlist_pos ON playlist_tracks(playlist_id, position);

    -- Upload audit log (debug + history).
    CREATE TABLE IF NOT EXISTS upload_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      filename    TEXT,
      size_bytes  INTEGER,
      status      TEXT,    -- "ok" | "rejected" | "duplicate"
      message     TEXT,
      uploaded_at TEXT DEFAULT (datetime('now'))
    );

    -- Admin user (S5). For S1-S4 left empty, no auth enforced.
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    TEXT DEFAULT (datetime('now'))
    );
  `);

  return db;
}
