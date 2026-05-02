#!/bin/bash
# music-station deploy script.
#
# Runs as root (via sudo). All build steps drop privileges to the `mcp`
# user so file ownership stays consistent with how the service runs.
#
# Invoked by Claude Code via:
#   ssh showbox@vm 'sudo /opt/music-station/deploy.sh'
#
# Sudoers grants showbox NOPASSWD only for THIS exact path:
#   showbox ALL=(root) NOPASSWD: /opt/music-station/deploy.sh
set -euo pipefail

REPO_DIR=/opt/music-station
SERVICE=music-station
HEALTH_URL=http://127.0.0.1:3002/api/status

if [ "$(id -u)" -ne 0 ]; then
  echo "deploy.sh: must be invoked via sudo" >&2
  exit 1
fi

cd "$REPO_DIR"

echo "==> [music-station] git pull"
runuser -u mcp -- git pull --ff-only

# Sync systemd unit if it changed in the repo (idempotent: copy + reload)
if ! cmp -s "$REPO_DIR/systemd/$SERVICE.service" "/etc/systemd/system/$SERVICE.service" 2>/dev/null; then
  echo "==> [music-station] systemd unit changed; syncing"
  cp "$REPO_DIR/systemd/$SERVICE.service" "/etc/systemd/system/$SERVICE.service"
  systemctl daemon-reload
fi

echo "==> [music-station] npm install (only changed deps)"
runuser -u mcp -- npm install --silent --no-audit --no-fund

echo "==> [music-station] npm run build"
runuser -u mcp -- npm run build

echo "==> [music-station] systemctl restart $SERVICE"
systemctl restart "$SERVICE"

# Wait for service to come up, then probe health
for i in 1 2 3 4 5; do
  sleep 1
  if curl -fsS -m 3 "$HEALTH_URL" >/dev/null 2>&1; then
    echo "==> [music-station] health OK after ${i}s"
    curl -s -m 3 "$HEALTH_URL" | head -c 200
    echo
    echo "==> [music-station] done"
    exit 0
  fi
done

echo "==> [music-station] health check FAILED — check journalctl -u $SERVICE" >&2
exit 1
