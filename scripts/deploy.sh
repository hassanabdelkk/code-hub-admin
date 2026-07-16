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
ENV_FILE="${ENV_FILE:-$PROJECT_DIR/.env}"
REPO_BRANCH="${REPO_BRANCH:-main}"
SERVICE_NAME="${SERVICE_NAME:-portal.service}"
PORT="${PORT:-3000}"
HOST="${HOST:-127.0.0.1}"
RELEASES_DIR="${RELEASES_DIR:-$PROJECT_DIR/.releases}"
ACTIVE_RELEASE_LINK="${ACTIVE_RELEASE_LINK:-$PROJECT_DIR/current}"
# Optional: DB-URL für Manual-Migrations (aus .env laden falls nicht gesetzt)
TARGET_DB_URL="${TARGET_DB_URL:-}"

log() { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
ok()  { printf "\033[1;32m  ✓ %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m  ! %s\033[0m\n" "$*"; }

env_file_value() {
  local key="$1"
  [ -f "$ENV_FILE" ] || return 0
  grep -E "^${key}=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/'
}

config_value() {
  local key="$1" val="${!key-}"
  if [ -z "$val" ]; then
    val="$(env_file_value "$key" || true)"
  fi
  printf '%s' "$val"
}

mask_value() {
  local val="$1"
  if [ ${#val} -le 12 ]; then
    printf '***'
  else
    printf '%s…%s' "${val:0:8}" "${val: -4}"
  fi
}

validate_config() {
  if [ ! -f "$ENV_FILE" ]; then
    echo "  ✗ $ENV_FILE fehlt. Deploy abgebrochen, damit kein kaputtes Login gebaut wird." >&2
    echo "    Benötigt: VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY" >&2
    exit 1
  fi

  local missing=()
  for key in VITE_SUPABASE_URL VITE_SUPABASE_PUBLISHABLE_KEY SUPABASE_URL SUPABASE_PUBLISHABLE_KEY; do
    if [ -z "$(config_value "$key")" ]; then
      missing+=("$key")
    fi
  done

  if [ ${#missing[@]} -gt 0 ]; then
    echo "  ✗ Pflichtwerte fehlen in $ENV_FILE: ${missing[*]}" >&2
    echo "    Deploy abgebrochen, damit das Portal nicht ohne Backend-Werte online geht." >&2
    exit 1
  fi

  local vite_url vite_key server_url server_key
  vite_url="$(config_value VITE_SUPABASE_URL)"
  vite_key="$(config_value VITE_SUPABASE_PUBLISHABLE_KEY)"
  server_url="$(config_value SUPABASE_URL)"
  server_key="$(config_value SUPABASE_PUBLISHABLE_KEY)"

  if [[ ! "$vite_url" =~ ^https?:// ]]; then
    echo "  ✗ VITE_SUPABASE_URL muss mit http:// oder https:// beginnen: $vite_url" >&2
    exit 1
  fi
  if [[ ! "$server_url" =~ ^https?:// ]]; then
    echo "  ✗ SUPABASE_URL muss mit http:// oder https:// beginnen: $server_url" >&2
    exit 1
  fi

  export VITE_SUPABASE_URL="$vite_url"
  export VITE_SUPABASE_PUBLISHABLE_KEY="$vite_key"
  export SUPABASE_URL="$server_url"
  export SUPABASE_PUBLISHABLE_KEY="$server_key"

  echo "  Backend URL (Frontend): $VITE_SUPABASE_URL"
  echo "  Backend URL (Server):   $SUPABASE_URL"
  echo "  Publishable Key:        $(mask_value "$VITE_SUPABASE_PUBLISHABLE_KEY")"
}

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
EnvironmentFile=-$ENV_FILE
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

asset_healthcheck() {
  local html assets path failed=0
  html="$(curl -fsS "http://$HOST:$PORT/login" 2>/dev/null || true)"
  if [ -z "$html" ]; then
    echo "  ✗ /login liefert kein HTML" >&2
    return 1
  fi

  assets="$(printf '%s' "$html" | grep -oE '"/assets/[^"?]+\.(js|css)"' | tr -d '"' | sort -u || true)"
  if [ -z "$assets" ]; then
    echo "  ✗ Keine JS/CSS-Assets in /login gefunden" >&2
    return 1
  fi

  while IFS= read -r path; do
    [ -z "$path" ] && continue
    if ! curl -fsS -o /dev/null "http://$HOST:$PORT$path"; then
      echo "  ✗ Asset fehlt oder lädt nicht: $path" >&2
      failed=1
    fi
  done <<EOF_ASSETS
$assets
EOF_ASSETS

  return "$failed"
}

cd "$PROJECT_DIR"

# Alles in { … } wickeln, damit bash die komplette Datei parst BEVOR sie ausführt.
# Sonst würde ein `git reset --hard` mitten in Schritt 1 die laufende Datei ersetzen
# und bash läse ab dem alten Byte-Offset in einer verschobenen neuen Datei weiter
# (⇒ scheinbar "falsche" Zeile wird ausgeführt).
{

log "0/5  Konfiguration prüfen"
validate_config
ok "Backend-Konfiguration vorhanden"

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
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}"
if command -v bun >/dev/null 2>&1; then
  log "2/5  bun install + build"
  bun install --frozen-lockfile
  bun run build
elif command -v npm >/dev/null 2>&1; then
  log "2/5  npm ci + build (bun nicht gefunden)"
  if [ -f package-lock.json ]; then
    npm ci
  else
    npm install
  fi
  npm run build
else
  echo "  ✗ Weder 'bun' noch 'npm' gefunden. Bitte installieren:" >&2
  echo "      curl -fsSL https://bun.sh/install | bash    # empfohlen" >&2
  echo "      # oder: apt-get install -y nodejs npm" >&2
  exit 1
fi
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

# State-File einmalig vorpopulieren: bei leerem State gelten alle
# vorhandenen Migrations als bereits eingespielt (historisch längst in der DB).
# Ab dem nächsten Deploy werden nur NEUE Dateien angewendet.
if [ -d "$MIG_DIR" ] && [ ! -s "$STATE_FILE" ]; then
  existing_count=$(ls "$MIG_DIR"/*.sql 2>/dev/null | wc -l | tr -d ' ')
  if [ "$existing_count" -gt 0 ]; then
    warn "State-File leer — markiere $existing_count bestehende Migrations als bereits angewendet (Erst-Bootstrap)"
    for sql in "$MIG_DIR"/*.sql; do
      basename "$sql" >> "$STATE_FILE"
    done
  fi
fi

# Preflight: DB-Connection einmal testen, damit ein defekter TARGET_DB_URL
# den Portal-Restart nicht blockiert.
db_reachable=0
if [ -n "$TARGET_DB_URL" ]; then
  if psql "$TARGET_DB_URL" -tAc 'select 1' >/dev/null 2>&1; then
    db_reachable=1
  else
    warn "TARGET_DB_URL nicht erreichbar (psql-Preflight fehlgeschlagen) — Migrations-Schritt wird übersprungen"
  fi
fi

if [ -d "$MIG_DIR" ] && [ "$db_reachable" = "1" ]; then
  for sql in $(ls "$MIG_DIR"/*.sql 2>/dev/null | sort); do
    name="$(basename "$sql")"
    if grep -qxF "$name" "$STATE_FILE"; then
      echo "  · $name (bereits angewendet, übersprungen)"
    else
      echo "  · $name → einspielen…"
      if psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -f "$sql"; then
        echo "$name" >> "$STATE_FILE"
        ok "$name angewendet"
      else
        warn "$name fehlgeschlagen — bitte manuell prüfen. Deploy läuft weiter."
      fi
    fi
  done
else
  echo "  (keine Manual-Migrations, TARGET_DB_URL nicht gesetzt oder DB unreachable — übersprungen)"
fi

# ── 4) Portal-Service neu starten ──────────────────────────────────────────
# ── 5) Portal-Service neu starten ──────────────────────────────────────────
log "5/5  $SERVICE_NAME neu starten"
systemctl stop "$SERVICE_NAME" || true
ensure_port_free
systemctl start "$SERVICE_NAME"
if systemctl is-active --quiet "$SERVICE_NAME" && healthcheck && asset_healthcheck; then
  systemctl status "$SERVICE_NAME" --no-pager | head -n 10
else
  echo "  ✗ $SERVICE_NAME ist nach dem Restart nicht gesund. Letzte Logs:" >&2
  journalctl -u "$SERVICE_NAME" -n 160 --no-pager >&2
  exit 1
fi

find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d | sort | head -n -5 | xargs -r rm -rf
ok "Deploy fertig ✅"
exit 0
}

