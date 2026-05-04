import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
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
  // Migration helper: add new columns if missing (idempotent).
  const cols = db.prepare(`PRAGMA table_info(tracks)`).all() as Array<{ name: string }>;
  const has = (n: string) => cols.some((c) => c.name === n);
  if (!has('last_edited_at')) {
    db.exec(`ALTER TABLE tracks ADD COLUMN last_edited_at TEXT`);
  }
  if (!has('rating')) {
    // 0..5 stars. 0 = unrated.
    db.exec(`ALTER TABLE tracks ADD COLUMN rating INTEGER DEFAULT 0`);
  }
  if (!has('cover_filename')) {
    // Filename inside COVER_DIR (e.g. "47.jpg"). NULL = no custom cover.
    db.exec(`ALTER TABLE tracks ADD COLUMN cover_filename TEXT`);
  }
  if (!has('favorited')) {
    // 0/1 flag separate from rating: a quick "I love this" toggle that
    // powers the Favorites view in the sidebar.
    db.exec(`ALTER TABLE tracks ADD COLUMN favorited INTEGER NOT NULL DEFAULT 0`);
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

    -- Users. Authentication enforced from Slice 1 onwards.
    -- Migrations below add is_admin, must_change_password, display_name,
    -- disabled to existing DBs.
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    TEXT DEFAULT (datetime('now'))
    );

    -- Cookie-based sessions. Token is a 32-byte hex string the client
    -- sends back via the mw_session cookie.
    CREATE TABLE IF NOT EXISTS sessions (
      token       TEXT PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at  TEXT DEFAULT (datetime('now')),
      expires_at  TEXT NOT NULL,
      user_agent  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  `);

  // Idempotent column migrations on users
  const userCols = db.prepare(`PRAGMA table_info(users)`).all() as Array<{ name: string }>;
  const hasUserCol = (n: string) => userCols.some((c) => c.name === n);
  if (!hasUserCol('is_admin')) {
    db.exec(`ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0`);
  }
  if (!hasUserCol('must_change_password')) {
    db.exec(`ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0`);
  }
  if (!hasUserCol('display_name')) {
    db.exec(`ALTER TABLE users ADD COLUMN display_name TEXT`);
  }
  if (!hasUserCol('disabled')) {
    // 1 = login blocked. Lets the admin "封锁" a user without deleting their data.
    db.exec(`ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0`);
  }

  // ---- Slice 3: track ownership & sharing ----
  const trackCols = db.prepare(`PRAGMA table_info(tracks)`).all() as Array<{ name: string }>;
  const hasTrackCol = (n: string) => trackCols.some((c) => c.name === n);
  if (!hasTrackCol('owner_id')) {
    db.exec(`ALTER TABLE tracks ADD COLUMN owner_id INTEGER REFERENCES users(id)`);
  }
  if (!hasTrackCol('is_public')) {
    db.exec(`ALTER TABLE tracks ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tracks_owner ON tracks(owner_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tracks_public ON tracks(is_public)`);

  // Track-level direct shares: "owner shares this track with another user".
  db.exec(`
    CREATE TABLE IF NOT EXISTS track_shares (
      track_id     INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      with_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at   TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (track_id, with_user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_track_shares_with_user ON track_shares(with_user_id);
  `);

  // ---- Slice 4: playlist ownership & sharing (with transitive visibility) ----
  const playlistCols = db.prepare(`PRAGMA table_info(playlists)`).all() as Array<{ name: string }>;
  const hasPlaylistCol = (n: string) => playlistCols.some((c) => c.name === n);
  if (!hasPlaylistCol('owner_id')) {
    db.exec(`ALTER TABLE playlists ADD COLUMN owner_id INTEGER REFERENCES users(id)`);
  }
  if (!hasPlaylistCol('is_public')) {
    db.exec(`ALTER TABLE playlists ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_playlists_owner ON playlists(owner_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_playlists_public ON playlists(is_public)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS playlist_shares (
      playlist_id  INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      with_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at   TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (playlist_id, with_user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_playlist_shares_with_user ON playlist_shares(with_user_id);
  `);

  // Per-user favorites. Replaces the legacy single-tenant tracks.favorited
  // column (kept around for backfill but no longer read/written by the API).
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_favorites (
      user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      added_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, track_id)
    );
    CREATE INDEX IF NOT EXISTS idx_user_favorites_track ON user_favorites(track_id);
  `);

  // ---- Slice 6: per-user prefs + per-user-per-track EQ ----
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_prefs (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      data    TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS user_track_eq (
      user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      data     TEXT NOT NULL,
      PRIMARY KEY (user_id, track_id)
    );
    CREATE INDEX IF NOT EXISTS idx_user_track_eq_track ON user_track_eq(track_id);
  `);

  // ---- Slice 5: favorites-list sharing ----
  if (!hasUserCol('favorites_public')) {
    db.exec(`ALTER TABLE users ADD COLUMN favorites_public INTEGER NOT NULL DEFAULT 0`);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS favorites_shares (
      owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      with_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at    TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (owner_user_id, with_user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_favorites_shares_with_user ON favorites_shares(with_user_id);
  `);

  return db;
}

/**
 * One-time backfill for legacy data: anchor everything that existed
 * before multi-user to the bootstrap admin (user 1).
 *
 *  - tracks.owner_id IS NULL  → owner_id = 1
 *  - tracks.favorited = 1     → INSERT INTO user_favorites (1, track_id)
 *
 * Idempotent. Run once at startup after bootstrapAdmin.
 */
export function backfillOwnership(db: Database.Database): void {
  // Only relevant if user 1 exists (which bootstrapAdmin guarantees).
  const adminId = (db.prepare('SELECT id FROM users ORDER BY id ASC LIMIT 1').get() as
    | { id: number }
    | undefined)?.id;
  if (!adminId) return;

  const orphans = (db.prepare('SELECT COUNT(*) AS n FROM tracks WHERE owner_id IS NULL').get() as {
    n: number;
  }).n;
  if (orphans > 0) {
    db.prepare('UPDATE tracks SET owner_id = ? WHERE owner_id IS NULL').run(adminId);
    console.error(`[music-station] backfill: assigned owner_id=${adminId} to ${orphans} tracks`);
  }

  const orphanPlaylists = (
    db.prepare('SELECT COUNT(*) AS n FROM playlists WHERE owner_id IS NULL').get() as { n: number }
  ).n;
  if (orphanPlaylists > 0) {
    db.prepare('UPDATE playlists SET owner_id = ? WHERE owner_id IS NULL').run(adminId);
    console.error(
      `[music-station] backfill: assigned owner_id=${adminId} to ${orphanPlaylists} playlists`,
    );
  }

  // Migrate legacy tracks.favorited → user_favorites for the admin.
  const cols = db.prepare(`PRAGMA table_info(tracks)`).all() as Array<{ name: string }>;
  const hasFavorited = cols.some((c) => c.name === 'favorited');
  if (hasFavorited) {
    const moved = db
      .prepare(
        `INSERT OR IGNORE INTO user_favorites (user_id, track_id)
         SELECT ?, id FROM tracks WHERE favorited = 1`,
      )
      .run(adminId);
    if (moved.changes > 0) {
      console.error(
        `[music-station] backfill: migrated ${moved.changes} legacy favorites to user ${adminId}`,
      );
    }
  }
}

/**
 * Ensure at least one admin exists. Called once at startup.
 *
 * If the users table is empty, creates `showbox88` with the default password
 * "changeme123" and must_change_password=1 (forced reset on first login).
 *
 * Idempotent: if any user exists this is a no-op. Run after openDatabase
 * but before the API starts.
 */
export function bootstrapAdmin(db: Database.Database): void {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  if (count > 0) return;
  const hash = bcrypt.hashSync('changeme123', 10);
  db.prepare(
    `INSERT INTO users (username, password_hash, is_admin, must_change_password, display_name)
     VALUES (?, ?, 1, 1, ?)`,
  ).run('showbox88', hash, 'Admin');
  console.error(
    '[music-station] bootstrap: created admin showbox88 / changeme123 ' +
    '(forced password change on first login)',
  );
}
