#!/usr/bin/env bash
# =============================================================================
#  deploy.sh — Update-Deploy auf Portal-Server (Server 2)
# =============================================================================
#  Was macht das Skript?
#   1. git pull (neuester Stand aus GitHub)
#   2. bun install + bun run build
#   3. Neue Manual-Migrations gegen self-hosted Supabase einspielen
#   4. portal.service neu starten
#
#  AUF SERVER 2 ALS ROOT AUSFÜHREN:
#    bash /opt/apps/portal/scripts/deploy.sh
#
#  Oder von deinem lokalen Rechner:
#    ssh root@<portal-ip> 'bash /opt/apps/portal/scripts/deploy.sh'
# =============================================================================
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/apps/portal}"
REPO_BRANCH="${REPO_BRANCH:-main}"
SERVICE_NAME="${SERVICE_NAME:-portal.service}"
PORT="${PORT:-3000}"
HOST="${HOST:-127.0.0.1}"
RELEASES_DIR="${RELEASES_DIR:-$PROJECT_DIR/.releases}"
ACTIVE_RELEASE_LINK="${ACTIVE_RELEASE_LINK:-$PROJECT_DIR/.current}"
# Optional: DB-URL für Manual-Migrations (aus .env laden falls nicht gesetzt)
TARGET_DB_URL="${TARGET_DB_URL:-}"

log() { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
ok()  { printf "\033[1;32m  ✓ %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m  ! %s\033[0m\n" "$*"; }

service_uses_atomic_output() {
  systemctl show "$SERVICE_NAME" -p Environment --value 2>/dev/null | grep -q "PORTAL_BUILD_DIR=$ACTIVE_RELEASE_LINK"
}

port_pids() {
  if command -v ss >/dev/null; then
    ss -ltnp "sport = :$PORT" 2>/dev/null | sed -nE 's/.*pid=([0-9]+).*/\1/p' | sort -u
  elif command -v lsof >/dev/null; then
    lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | sort -u
  fi
}

ensure_port_free() {
  local pids
  pids="$(port_pids || true)"
  if [ -z "$pids" ]; then
    return 0
  fi
  warn "Port $PORT ist noch belegt (PID: ${pids//$'\n'/, }) — beende alten Listener"
  echo "$pids" | xargs -r kill -TERM
  for _ in {1..20}; do
    sleep 0.25
    [ -z "$(port_pids || true)" ] && return 0
  done
  pids="$(port_pids || true)"
  if [ -n "$pids" ]; then
    warn "Alter Listener reagiert nicht — erzwinge Freigabe von Port $PORT"
    echo "$pids" | xargs -r kill -KILL
  fi
}

install_service_override() {
  mkdir -p "/etc/systemd/system/$SERVICE_NAME.d"
  cat > "/etc/systemd/system/$SERVICE_NAME.d/10-portal-build-dir.conf" <<EOF
[Service]
Environment=PORTAL_BUILD_DIR=$ACTIVE_RELEASE_LINK
Environment=PORT=$PORT
Environment=HOST=$HOST
EOF
  systemctl daemon-reload
}

healthcheck() {
  for _ in {1..30}; do
    if curl -fsS "http://$HOST:$PORT/login" >/dev/null 2>&1 || curl -fsS "http://$HOST:$PORT/" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

cd "$PROJECT_DIR"

if systemctl is-active --quiet "$SERVICE_NAME" && ! service_uses_atomic_output; then
  log "0/5  Erstes Atomic-Deploy vorbereiten"
  warn "$SERVICE_NAME nutzt noch kein separates Release-Verzeichnis — stoppe vor dem Build, damit keine alten Chunks gelöscht werden"
  systemctl stop "$SERVICE_NAME" || true
  ensure_port_free
fi

# ── 1) Code aktualisieren ──────────────────────────────────────────────────
log "1/5  git pull ($REPO_BRANCH)"
git fetch --all --prune
git reset --hard "origin/$REPO_BRANCH"
ok "Repo auf neuesten Stand"

# ── 2) Dependencies + Build ────────────────────────────────────────────────
log "2/5  bun install + build"
bun install --frozen-lockfile
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}"
bun run build
ok "Build fertig"

# ── 3) Build atomar als Release aktivieren ─────────────────────────────────
log "3/5  Build atomar aktivieren"
release_dir="$RELEASES_DIR/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$release_dir"
cp -a "$PROJECT_DIR/.output" "$release_dir/.output"
ln -sfn "$release_dir" "$ACTIVE_RELEASE_LINK.tmp"
mv -Tf "$ACTIVE_RELEASE_LINK.tmp" "$ACTIVE_RELEASE_LINK"
install_service_override
ok "Release aktiviert: $release_dir"

# ── 4) Neue Manual-Migrations einspielen ───────────────────────────────────
log "4/5  Manual-Migrations prüfen"
MIG_DIR="$PROJECT_DIR/supabase/manual-migrations"
STATE_FILE="$PROJECT_DIR/.deploy-migrations-applied"
touch "$STATE_FILE"

# TARGET_DB_URL aus .env holen falls nicht per Env übergeben
if [ -z "$TARGET_DB_URL" ] && [ -f "$PROJECT_DIR/.env" ]; then
  TARGET_DB_URL="$(grep -E '^TARGET_DB_URL=' "$PROJECT_DIR/.env" | cut -d= -f2- || true)"
fi

if [ -d "$MIG_DIR" ] && [ -n "$TARGET_DB_URL" ]; then
  for sql in $(ls "$MIG_DIR"/*.sql 2>/dev/null | sort); do
    name="$(basename "$sql")"
    if grep -qxF "$name" "$STATE_FILE"; then
      echo "  · $name (bereits angewendet, übersprungen)"
    else
      echo "  · $name → einspielen…"
      psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -f "$sql"
      echo "$name" >> "$STATE_FILE"
      ok "$name angewendet"
    fi
  done
else
  echo "  (keine Manual-Migrations oder TARGET_DB_URL nicht gesetzt — übersprungen)"
fi

# ── 4) Portal-Service neu starten ──────────────────────────────────────────
# ── 5) Portal-Service neu starten ──────────────────────────────────────────
log "5/5  $SERVICE_NAME neu starten"
systemctl stop "$SERVICE_NAME" || true
ensure_port_free
systemctl start "$SERVICE_NAME"
if systemctl is-active --quiet "$SERVICE_NAME" && healthcheck; then
  systemctl status "$SERVICE_NAME" --no-pager | head -n 10
else
  echo "  ✗ $SERVICE_NAME ist nach dem Restart nicht gesund. Letzte Logs:" >&2
  journalctl -u "$SERVICE_NAME" -n 160 --no-pager >&2
  exit 1
fi

find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d | sort | head -n -5 | xargs -r rm -rf
ok "Deploy fertig ✅"
