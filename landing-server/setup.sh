#!/usr/bin/env bash
# =============================================================================
#  setup.sh — Erst-Setup für Server 1 (Landings)
# =============================================================================
#  Installiert auf einer frischen Linux-Kiste:
#    1. Bun + Caddy + git
#    2. Klont/kopiert landing-server nach /opt/apps/landing-server
#    3. Synct ./themes/ aus dem Haupt-Repo
#    4. .env mit SUPABASE_URL + ANON_KEY + PORTAL_API_ENDPOINT
#    5. systemd-Service `landing.service` (Bun auf 127.0.0.1:3001)
#    6. Caddy-Service (Auto-SSL via on_demand_tls)
#
#  Pflicht-Umgebungsvariablen vor Aufruf:
#    SUPABASE_URL=https://supabase.deine-domain.de
#    SUPABASE_PUBLISHABLE_KEY=<anon-key>
#    PORTAL_API_ENDPOINT=https://mb-portal.com/api/public/applications
#    ACME_EMAIL=admin@mb-portal.com
#
#  Optional:
#    REPO_URL=https://github.com/dein-user/dein-portal.git
#    REPO_BRANCH=main
#    PROJECT_DIR=/opt/apps/landing-server
# =============================================================================
set -euo pipefail

: "${SUPABASE_URL:?SUPABASE_URL nicht gesetzt}"
: "${SUPABASE_PUBLISHABLE_KEY:?SUPABASE_PUBLISHABLE_KEY nicht gesetzt}"
: "${PORTAL_API_ENDPOINT:?PORTAL_API_ENDPOINT nicht gesetzt}"
: "${ACME_EMAIL:?ACME_EMAIL nicht gesetzt}"

REPO_URL="${REPO_URL:-}"
REPO_BRANCH="${REPO_BRANCH:-main}"
PROJECT_DIR="${PROJECT_DIR:-/opt/apps/landing-server}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
ok()  { printf "\033[1;32m  ✓ %s\033[0m\n" "$*"; }

# ── 1) System-Pakete + Caddy + Bun ─────────────────────────────────────────
log "1/5  System-Pakete installieren"
if command -v apt-get >/dev/null; then
  apt-get update
  apt-get install -y curl unzip git debian-keyring debian-archive-keyring apt-transport-https ca-certificates
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
elif command -v dnf >/dev/null; then
  dnf install -y curl unzip git
  dnf copr enable -y @caddy/caddy
  dnf install -y caddy
else
  echo "Weder apt noch dnf — manuell caddy/git/curl installieren."; exit 1
fi
ok "Caddy installiert"

if ! command -v bun >/dev/null; then
  curl -fsSL https://bun.sh/install | bash
  ln -sf /root/.bun/bin/bun /usr/local/bin/bun
fi
bun --version
ok "Bun installiert"

# ── 2) Code nach PROJECT_DIR bringen ───────────────────────────────────────
log "2/5  Code nach $PROJECT_DIR"
mkdir -p "$(dirname "$PROJECT_DIR")"
if [ -n "$REPO_URL" ]; then
  if [ -d "$PROJECT_DIR/.git" ]; then
    cd "$PROJECT_DIR" && git fetch origin && git checkout "$REPO_BRANCH" && git pull --ff-only origin "$REPO_BRANCH"
  else
    git clone --branch "$REPO_BRANCH" "$REPO_URL" "$PROJECT_DIR.repo"
    # Repo-Subdir landing-server ins PROJECT_DIR kopieren
    mkdir -p "$PROJECT_DIR"
    cp -a "$PROJECT_DIR.repo/landing-server/." "$PROJECT_DIR/"
    # Themes aus src/landing-themes synchronisieren
    rm -rf "$PROJECT_DIR/themes"
    cp -a "$PROJECT_DIR.repo/src/landing-themes" "$PROJECT_DIR/themes"
  fi
else
  # Lokal: setup wird aus dem Repo heraus aufgerufen
  mkdir -p "$PROJECT_DIR"
  cp -a "$SCRIPT_DIR/." "$PROJECT_DIR/"
  if [ -d "$SCRIPT_DIR/../src/landing-themes" ]; then
    rm -rf "$PROJECT_DIR/themes"
    cp -a "$SCRIPT_DIR/../src/landing-themes" "$PROJECT_DIR/themes"
  fi
fi
ok "Code + Themes platziert"

cd "$PROJECT_DIR"
bun install
ok "Bun-Deps installiert"

# ── 3) .env schreiben ──────────────────────────────────────────────────────
log "3/5  .env schreiben"
cat > "$PROJECT_DIR/.env" <<EOF
SUPABASE_URL=$SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY=$SUPABASE_PUBLISHABLE_KEY
PORTAL_API_ENDPOINT=$PORTAL_API_ENDPOINT
PORT=3001
ACME_EMAIL=$ACME_EMAIL
EOF
chmod 600 "$PROJECT_DIR/.env"
ok ".env angelegt"

# ── 4) systemd-Service für Bun ─────────────────────────────────────────────
log "4/5  systemd-Service landing.service"
cat > /etc/systemd/system/landing.service <<EOF
[Unit]
Description=Landing-Renderer (Bun) — Server 1
After=network.target

[Service]
Type=simple
WorkingDirectory=$PROJECT_DIR
EnvironmentFile=$PROJECT_DIR/.env
ExecStart=/usr/local/bin/bun --smol server.js
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable landing.service
systemctl restart landing.service
sleep 2
systemctl status landing.service --no-pager | head -n 12
ok "Bun-Renderer läuft auf 127.0.0.1:3001"

# ── 5) Caddy konfigurieren ─────────────────────────────────────────────────
log "5/5  Caddy konfigurieren (Auto-SSL via on_demand_tls)"
# ACME_EMAIL aus .env in System-Env für Caddy bringen
mkdir -p /etc/systemd/system/caddy.service.d
cat > /etc/systemd/system/caddy.service.d/override.conf <<EOF
[Service]
Environment=ACME_EMAIL=$ACME_EMAIL
EOF

cp "$PROJECT_DIR/Caddyfile" /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable caddy
systemctl restart caddy
sleep 2
systemctl status caddy --no-pager | head -n 12
ok "Caddy läuft"

log "Fertig 🎉"
cat <<EOF

Test:
  curl http://127.0.0.1:3001/_health         # → ok
  curl -H "Host: kunde.de" http://127.0.0.1:3001/   # → 404 wenn nicht angelegt

Workflow:
  1. Admin im Portal: /admin/landing-generator → "Speichern & live schalten"
  2. Kunde setzt A-Record kunde.de → diese Server-IP
  3. Erster HTTPS-Request → Caddy holt LE-Cert → Seite live

Service-Befehle:
  systemctl status landing | caddy
  journalctl -u landing -f | journalctl -u caddy -f
EOF
