# music-station

Self-hosted music library web app — list / search / upload / edit ID3 / playlists.

Runs on the same Proxmox VM as `mcp-servers/smart-trip`. Reads/writes
`/opt/music`, owns its own SQLite DB. The MCP music tools (in mcp-servers)
read the same `/opt/music` filesystem and stay independent for now.

## Status

| Sprint | Scope | Done |
|---|---|---|
| S1 | Express + SQLite + scanner; list view; search | ✅ |
| S2 | Edit ID3 metadata (title/artist/album/genre) | ⏳ |
| S3 | Upload + delete | ⏳ |
| S4 | Playlists CRUD | ⏳ |
| S5 | Built-in HTML5 player + auth | ⏳ |

## Architecture

```
/opt/music/                       ← shared MP3 directory
        ▲             ▲
        │             │
  smart-trip MCP   music-station
  (read-only,      (full CRUD,
   in-memory)      SQLite library.db)
```

Path layout (2026-05-30 reshuffle — music-station moved off public Funnel
to a tailnet-only Serve listener for auth reasons):

`https://debian.tail4cfa2.ts.net/` (Funnel, public):

| Path | Served by | Use |
|---|---|---|
| `/`        | smart-trip MCP | MCP `/mcp` endpoint, healthz |
| `/audio/*` | smart-trip MCP (express.static) | MP3 streaming (browser opens these) |
| `/dl/*`    | dl-server | APK / file download landing |

`https://debian.tail4cfa2.ts.net:8448/` (Tailscale Serve, tailnet only):

| Path | Served by | Use |
|---|---|---|
| `/app/*`   | music-station | Frontend (this repo) |
| `/api/*`   | music-station | REST API (this repo) |

## Local dev

```bash
npm install
cp .env.example .env
# Edit .env: set MUSIC_DIR to a real local folder, DB_PATH to a writable file
npm run dev
```

`npm run dev` runs the Express server (`:3002`) and Vite dev server (`:5173`)
together. Open http://localhost:5173.

## Deploy (Linux VM)

```bash
# 1. Pull source
sudo mkdir -p /opt/music-station
sudo chown mcp:mcp /opt/music-station
sudo -u mcp git clone https://github.com/showbox88/music-station.git /opt/music-station

# 2. Configure
cd /opt/music-station
sudo -u mcp cp .env.example .env
sudo -u mcp nano .env

# 3. DB dir (must be writable by 'mcp' user)
sudo mkdir -p /var/lib/music-station
sudo chown mcp:mcp /var/lib/music-station

# 4. Build
sudo -u mcp npm install
sudo -u mcp npm run build

# 5. systemd
sudo cp systemd/music-station.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now music-station
curl -s http://127.0.0.1:3002/api/status

# 6. Tailscale serve (route /app and /api to this app)
sudo tailscale serve --bg --https=443 --set-path=/app  http://localhost:3002
sudo tailscale serve --bg --https=443 --set-path=/api  http://localhost:3002
sudo tailscale serve status
```

Open `https://debian.tail4cfa2.ts.net:8448/app/` in browser (requires
Tailscale — music-station is no longer exposed via public Funnel).

## Day-2 ops

| Operation | Command |
|---|---|
| Logs | `sudo journalctl -u music-station -f` |
| Restart | `sudo systemctl restart music-station` |
| Upgrade (pull + build + restart) | `cd /opt/music-station && sudo -u mcp git pull && sudo -u mcp npm install && sudo -u mcp npm run build && sudo systemctl restart music-station` |
| DB backup | `sqlite3 /var/lib/music-station/library.db ".backup /backup/library-$(date +%F).db"` |

## SMB access to /opt/music

A Samba share named `music` exposes `/opt/music` over Tailscale so you can
drop mp3s in from a phone or PC without going through the web upload form.
Restricted to the tailnet via `hosts allow = 100.64.0.0/10 127.0.0.1` in
`/etc/samba/smb.conf` — credentials are a samba password for the existing
`showbox` Linux user, set with `smbpasswd` (not in this repo).

### Connection address (client quirks)

| Client | Address |
|---|---|
| Windows Explorer | `\\debian.tail4cfa2.ts.net\music` |
| macOS Finder / iOS Files / VLC / CX File Explorer | `smb://debian.tail4cfa2.ts.net` (then pick share `music`) |
| Samsung "我的文件" | `debian.tail4cfa2.ts.net/music/` — path-style, in one field. The standard `smb://` + separate share form gives a misleading "credentials wrong" error. |

### After dropping files in

The scanner only runs at server startup and on demand — there's no
filesystem watcher. Click the **重新扫描 / Rescan** button in the web
header to ingest new files; new rows are assigned `owner_id = 1`
(first user = bootstrap admin) so they're immediately visible.

### Toggle read-only vs read-write

```bash
# Lock down (read-only)
ssh showbox@debian "sudo sed -i 's/^   read only = no$/   read only = yes/' /etc/samba/smb.conf && sudo systemctl reload smbd"

# Allow upload (read-write)
ssh showbox@debian "sudo sed -i 's/^   read only = yes$/   read only = no/' /etc/samba/smb.conf && sudo systemctl reload smbd"
```

Files uploaded via SMB are forced to `mcp:mcp` ownership by
`force user = mcp` / `force group = mcp` in the share config, matching
the systemd service user — so the Express side can always read them.

## Browser-local folder library (Chrome / Edge desktop only)

A second "library" you can add via the **📁 本地文件夹** sidebar entry —
picks a folder from the user's own computer using the File System
Access API, scans the audio files in it, and plays them through the
existing player. Files never leave the machine; the server is not
involved.

### What v1 does

- One folder per browser, recursive scan
- ID3 metadata via `music-metadata-browser`
- Embedded cover art lifted into a data: URL (capped at 256 KB per
  cover to keep IndexedDB small)
- Sibling `.lrc` files **detected** (rendered display is a v1.1 item)
- Manual rescan button — no filesystem watcher
- Re-grant flow on page reload (Chrome drops the directory permission
  for security; we call `queryPermission` / `requestPermission`)

### Where the data lives

| Thing | Storage |
|---|---|
| Folder handle | IndexedDB on this browser only |
| Track rows | IndexedDB on this browser only |
| Current play queue | Process memory, ephemeral |

Nothing crosses to the server. Logging into the same Music-Station
account from a different device, the local-folder library doesn't
follow — each browser has its own independent local library.

### Where the sidebar entry doesn't show

Only when `window.showDirectoryPicker` exists — Chrome / Edge on
desktop. Safari, Firefox, and most mobile browsers lack the API, so
the entry is hidden instead of leading users into a broken page.

### Track identity convention

Local-folder tracks get **negative synthetic ids** (FNV-1a hash of
rel_path, folded into the negative integer range), distinct from
server tracks (positive AUTOINCREMENT). The existing `Track` type
and player work unchanged, and components that touch server-side
per-user state branch on `track.id < 0` to no-op for local tracks.
The helper `isLocalTrack()` lives in `web/src/local/types.ts`.

### v1.1 follow-ups (deliberately deferred)

- Render lyrics from sibling `.lrc` files
- Local-side favorites / ratings / per-track EQ in IndexedDB
- Local playlists with mixed server + local items
- Dynamic-import `music-metadata-browser` so it doesn't add 400+ KB
  to the main bundle every page load
- Multi-folder
- ID3 editing / upload-to-server pipe for local tracks

## Schema notes

- `tracks.rel_path` is the unique key — relative to `MUSIC_DIR`, forward
  slashes only. URL is computed at API time using `PUBLIC_URL + /audio/ +
  encoded(rel_path)`.
- `track_tags` is many-to-many for free-form tags (genre is the single
  ID3 v1 genre field, separate concept).
- DB file has no migrations system yet — schema changes will need a
  migration script before this becomes painful.

## Known limitations / TODO

- Cookie-session auth and per-user track/playlist/favorites are in place
  (see `db/schema.ts` and `PLAN-multiuser.md`). The bootstrap admin
  `showbox88` is created on first start with a forced password change.
- Concurrent upload + scan races aren't handled.
- Bulk metadata edit not implemented.
- No M3U export yet.
- No filesystem watcher — SMB / direct filesystem drops require a manual
  "重新扫描" click in the web header to be picked up.
