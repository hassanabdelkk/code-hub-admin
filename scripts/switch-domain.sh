#!/usr/bin/env bash
# switch-domain.sh — schaltet das Portal-Frontend auf eine andere Domain um.
# Idempotent: mehrfaches Ausführen mit derselben Domain ist ein No-Op-Rebuild.
#
# Verwendung:
#   sudo /opt/apps/portal/scripts/switch-domain.sh <NEUE_DOMAIN>
#
# Beispiel:
#   sudo /opt/apps/portal/scripts/switch-domain.sh mb-portal-eu.com
#
# Voraussetzungen (siehe RUNBOOK.md, Abschnitt "Einmalige Vorbereitung"):
#   - DNS für NEUE_DOMAIN + api.NEUE_DOMAIN zeigt auf die richtigen Server
#   - Reverse Proxy hat Zertifikate für beide Namen
#   - Supabase Auth erlaubt NEUE_DOMAIN in GOTRUE_URI_ALLOW_LIST
#   - Supabase GOTRUE_SITE_URL wurde separat auf BACKEND_HOST umgestellt

set -euo pipefail

DOMAIN="${1:-}"
if [[ -z "$DOMAIN" ]]; then
  echo "Verwendung: $0 <DOMAIN>  (z.B. mb-portal-eu.com)" >&2
  exit 1
fi

# Basic-Validierung: keine URL, kein Slash, kein Protokoll
if [[ "$DOMAIN" =~ ^https?:// ]] || [[ "$DOMAIN" == */* ]]; then
  echo "✗ Nur den Domain-Namen angeben, ohne https:// und ohne Pfad." >&2
  exit 1
fi

APP_DIR="${APP_DIR:-/opt/apps/portal}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env}"
SERVICE_NAME="${SERVICE_NAME:-portal.service}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "✗ $ENV_FILE nicht gefunden." >&2
  exit 1
fi

SITE_URL="https://${DOMAIN}"
API_URL="https://api.${DOMAIN}"

echo "→ Setze Portal auf:"
echo "    VITE_SITE_URL     = $SITE_URL"
echo "    VITE_SUPABASE_URL = $API_URL"

# Backup der aktuellen .env
cp "$ENV_FILE" "${ENV_FILE}.bak.$(date +%Y%m%d-%H%M%S)"

# Helper: Wert setzen oder Zeile anhängen
set_env() {
  local key="$1" val="$2"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    sed -i -E "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    echo "${key}=${val}" >> "$ENV_FILE"
  fi
}

set_env "VITE_SITE_URL"     "$SITE_URL"
set_env "VITE_SUPABASE_URL" "$API_URL"

echo "→ Deploy mit neuer .env starten…"
PROJECT_DIR="$APP_DIR" ENV_FILE="$ENV_FILE" SERVICE_NAME="$SERVICE_NAME" bash "$APP_DIR/scripts/deploy.sh"

echo ""
echo "✅ Switch auf $DOMAIN abgeschlossen."
echo "   Jetzt noch prüfen:"
echo "   1) Supabase GOTRUE_SITE_URL steht auf $SITE_URL"
echo "   2) curl -I $SITE_URL   → 200"
echo "   3) Login im Browser testen"
