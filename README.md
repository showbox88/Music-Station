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

Public path layout (behind Tailscale Funnel `https://debian.tail4cfa2.ts.net/`):

| Path | Served by | Use |
|---|---|---|
| `/`        | smart-trip MCP | MCP `/mcp` endpoint, healthz |
| `/audio/*` | smart-trip MCP (express.static) | MP3 streaming (browser opens these) |
| `/app/*`   | music-station   | Frontend (this repo) |
| `/api/*`   | music-station   | REST API (this repo) |

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

Open `https://debian.tail4cfa2.ts.net/app/` in browser.

## Day-2 ops

| Operation | Command |
|---|---|
| Logs | `sudo journalctl -u music-station -f` |
| Restart | `sudo systemctl restart music-station` |
| Upgrade (pull + build + restart) | `cd /opt/music-station && sudo -u mcp git pull && sudo -u mcp npm install && sudo -u mcp npm run build && sudo systemctl restart music-station` |
| DB backup | `sqlite3 /var/lib/music-station/library.db ".backup /backup/library-$(date +%F).db"` |

## Schema notes

- `tracks.rel_path` is the unique key — relative to `MUSIC_DIR`, forward
  slashes only. URL is computed at API time using `PUBLIC_URL + /audio/ +
  encoded(rel_path)`.
- `track_tags` is many-to-many for free-form tags (genre is the single
  ID3 v1 genre field, separate concept).
- DB file has no migrations system yet — schema changes will need a
  migration script before this becomes painful.

## Known limitations / TODO

- No auth yet (S5). Anyone reaching the URL can browse and (later) upload.
- Concurrent upload + scan races aren't handled.
- Bulk metadata edit not implemented.
- No M3U export yet.
- Player UI: deferred to S5; in S1 you click ▶ which opens MP3 in new tab.
