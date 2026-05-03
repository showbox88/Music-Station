# Multi-user + Selective Sharing — Planning Document

Status: **draft, no code yet** · Owner: showbox88 · Drafted: 2026-05-03

---

## 1. Goal

Turn music-station from a single-tenant personal server into a multi-user
service where:

- Each user has **their own private library** (tracks, playlists, covers, EQ
  presets).
- Users can **selectively share** at three granularities: single track,
  whole playlist, or entire library.
- Optional **public share links** with expiry, for sending a track to
  someone who doesn't have an account.
- Per-user EQ / Dolby / visualizer prefs sync across devices.

Non-goals (for now):

- Synchronized "listening room" playback (separate feature, see ROADMAP).
- Federation across servers.
- Any kind of mobile app — web stays the only client.

---

## 2. Current state (2026-05-03)

- Single tenant. Everything in `/opt/music`, one SQLite DB at
  `/var/lib/music-station/library.db`.
- No auth — Tailscale network is the only access boundary.
- Per-track EQ + global Dolby preset + viz style live in browser
  `localStorage`, so settings don't follow the user across devices.
- 16 tracks, ~56 MB. Plenty of headroom on a 14.8 GB disk.

---

## 3. Schema changes

### 3.1 New tables

```sql
CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  display_name  TEXT,
  password_hash TEXT NOT NULL,        -- bcrypt
  created_at    TEXT DEFAULT (datetime('now')),
  storage_quota_bytes INTEGER DEFAULT 5368709120  -- 5 GB default
);

CREATE TABLE sessions (
  token       TEXT PRIMARY KEY,        -- random 32-byte hex
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL,
  user_agent  TEXT
);

CREATE TABLE track_shares (
  track_id       INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  with_user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  perm           TEXT NOT NULL DEFAULT 'play',   -- 'play' | 'edit'
  created_at     TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (track_id, with_user_id)
);

CREATE TABLE playlist_shares (
  playlist_id    INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  with_user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  perm           TEXT NOT NULL DEFAULT 'play',
  created_at     TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (playlist_id, with_user_id)
);

CREATE TABLE library_shares (
  owner_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  with_user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  perm           TEXT NOT NULL DEFAULT 'play',
  created_at     TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (owner_id, with_user_id)
);

CREATE TABLE share_links (
  token         TEXT PRIMARY KEY,       -- url-safe random 24-byte
  scope_type    TEXT NOT NULL,          -- 'track' | 'playlist' | 'library'
  scope_id      INTEGER NOT NULL,
  owner_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  perm          TEXT NOT NULL DEFAULT 'play',
  expires_at    TEXT,                   -- NULL = never (discouraged)
  uses_left     INTEGER,                -- NULL = unlimited
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE user_prefs (
  user_id   INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data      TEXT NOT NULL              -- JSON blob: viz style, dolby preset,
                                       --   volume, last viewed playlist, etc.
);

-- Per-track EQ moves out of localStorage:
CREATE TABLE user_track_eq (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id  INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  data      TEXT NOT NULL,              -- JSON: { gains, preamp, bypass }
  PRIMARY KEY (user_id, track_id)
);
```

### 3.2 Existing tables — add `owner_id`

```sql
ALTER TABLE tracks     ADD COLUMN owner_id INTEGER REFERENCES users(id);
ALTER TABLE playlists  ADD COLUMN owner_id INTEGER REFERENCES users(id);
CREATE INDEX idx_tracks_owner    ON tracks(owner_id);
CREATE INDEX idx_playlists_owner ON playlists(owner_id);
```

Migration: backfill all existing rows to `owner_id = 1` (the first
user — showbox88).

---

## 4. Storage layout

Switch from `/opt/music/<file>.mp3` to `/opt/music/<user_id>/<file>.mp3`.

- Migration: move existing files into `/opt/music/1/` and update
  `tracks.rel_path`.
- Upload endpoint reads `user_id` from session, writes into that user's
  subdir.
- Disk-bar endpoint changes: it should report (a) overall partition
  free/total, (b) the **calling user's** library size + quota, not the
  global library sum.

Future optimization: dedup. Hash content (SHA-256), store the actual
file once at `/opt/music-content/<sha256>.mp3`, and per-user records
just point to it. Defer until storage actually hurts.

---

## 5. Auth

**Approach:** session cookies (HttpOnly, Secure, SameSite=Lax) backed
by the `sessions` table. Simple, no JWT pain, works with Tailscale and
any future Caddy/Nginx fronting.

- `POST /api/auth/register` — email + password (bcrypt, 12 rounds)
- `POST /api/auth/login`    — sets `mw_session` cookie
- `POST /api/auth/logout`   — deletes session row + clears cookie
- `GET  /api/auth/me`       — current user (or 401)

**Bootstrap:** the first registration on a fresh DB becomes the admin.
Subsequent registrations require either an admin invite token or admin
toggle "open registration".

**Auth middleware** sits in front of every `/api` route except auth
endpoints. Looks up cookie token in `sessions`, attaches `req.user`,
or 401s.

**Quota:** every upload checks `SUM(size_bytes) WHERE owner_id = me <
storage_quota_bytes - incoming_size`.

---

## 6. Authorization (visibility queries)

The single most important query: "what tracks can this user see?"

```sql
SELECT t.* FROM tracks t
WHERE t.owner_id = :me
   OR EXISTS (SELECT 1 FROM track_shares    WHERE track_id   = t.id          AND with_user_id = :me)
   OR EXISTS (SELECT 1 FROM playlist_shares ps
              JOIN playlist_tracks pt ON pt.playlist_id = ps.playlist_id
              WHERE ps.with_user_id = :me AND pt.track_id = t.id)
   OR EXISTS (SELECT 1 FROM library_shares  WHERE owner_id   = t.owner_id    AND with_user_id = :me)
```

This becomes a **view** (`tracks_visible_to(:me)`) so all routes use it
without rewriting the predicate. Same shape for playlists.

Audio file streaming (`/audio/<user_id>/<file>`) gets gated through the
same check before serving the byte range.

---

## 7. Frontend changes

- New `/login` and `/register` pages.
- Auth context (similar to `PlayerContext`) wraps the app, redirects to
  `/login` if `/api/auth/me` returns 401.
- Header: avatar / user-menu top-right (logout, settings, quota bar
  showing **your** library size, not global).
- Track list / playlist views: badge on rows that are shared-in (small
  "shared by Alice" pill).
- Per-track context menu: "Share with…" → user picker.
- Per-playlist menu: "Share playlist…" + "Create public link…".
- Settings page: change password, manage active sessions, list incoming
  + outgoing shares, revoke a share, regenerate share links.

EQ / Dolby / viz style move from `localStorage` to `user_prefs.data`.
On login, fetch prefs and seed; on change, debounce-save to server.

---

## 8. MVP slicing

A roughly week-long path that lands real value at every step:

**Slice 1 — auth foundation (½ day)**
- Add users + sessions tables.
- Implement register/login/logout/me endpoints.
- Add cookie middleware.
- Migrate the existing single user to `users.id = 1`.

**Slice 2 — owner_id on existing tables (½ day)**
- Migration backfills `owner_id = 1` everywhere.
- All read endpoints scope to `req.user.id`.
- Upload writes into `/opt/music/<user_id>/`.

**Slice 3 — login UI (½ day)**
- `/login` + `/register` pages.
- Auth context, redirect logic.
- Avatar menu in header.

**Slice 4 — single-track sharing (1 day)**
- `track_shares` table + endpoints.
- `tracks_visible_to(:me)` view.
- "Share with…" UI on track row.

**Slice 5 — playlist + library sharing (1 day)**
- Same pattern as slice 4 for playlists.
- "Share entire library" toggle in settings.

**Slice 6 — public share links (½ day)**
- `share_links` + token route `GET /s/:token` (no auth required).
- "Create public link" UI with expiry / use-count picker.

**Slice 7 — per-user prefs sync (½ day)**
- Move EQ + Dolby + viz from localStorage to `user_prefs`.
- Debounced server sync.

**Slice 8 — quota + disk bar per-user (½ day)**
- DiskBar shows my library size vs my quota.
- Upload guard.

Total ≈ 5 working days, shippable in two ~3-day arcs.

---

## 9. Risks / open questions

- **Bcrypt on Node** — use `@node-rs/bcrypt` (faster, no native deps
  surprise) or `bcrypt` package; pick before slice 1.
- **Public share-link abuse** — rate-limit `/s/:token` and require an
  expiry by default (max 30 days, configurable per share).
- **Storage explosion** — multiple users uploading the same album = N
  copies. Defer dedup until it matters; mention quota in the UI so users
  feel the pressure.
- **Existing browser sessions** post-migration — once auth is on, every
  open tab will 401 and force a login. Document this in the deploy
  runbook.
- **Backups** — need to actually start backing up `library.db` once
  it has multiple users; one corrupted DB = lost prefs/shares for
  everyone.
- **GDPR-ish** — if anyone outside your household ever uses this,
  add a "delete my account + all data" path. SQLite cascades make this
  almost free.
- **Tailscale → public** — if this ever leaves the tailnet, audit all
  routes for IDOR (`/api/tracks/:id` must check ownership), add CSRF
  protection (Origin header check is enough for cookie auth).

---

## 10. Future, not in this plan

- Listening rooms (synchronized playback via WebSocket).
- Federated libraries (browse a friend's server without a local account).
- Content-hash dedup of audio files.
- Mobile-tuned UI / PWA install.
- Last.fm scrobbling.
- Per-share permissions beyond `play` / `edit` (e.g. `can-download`).
