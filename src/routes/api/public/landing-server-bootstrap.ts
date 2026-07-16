// Public endpoint: Bootstrap-Script für einen neuen Landing-Server.
// Aufruf: curl -sSL https://mb-portal.com/api/public/landing-server-bootstrap?token=XYZ | bash
//
// Validiert Token gegen landing_servers.bootstrap_token, gibt dann ein
// idempotentes Setup-Script aus (Node, Caddy, server.js, systemd) — alle
// benötigten Env-Vars (Supabase-URL/Key, Portal-URL, Server-ID, Token) sind
// direkt eingebettet.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/landing-server-bootstrap")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("token") ?? "";
        const clean = url.searchParams.get("clean") === "1";
        if (!token || token.length < 20) {
          return new Response("# fehlender token", { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: server, error } = await supabaseAdmin
          .from("landing_servers")
          .select("id, name, hostname, ip")
          .eq("bootstrap_token", token)
          .maybeSingle();
        if (error || !server) {
          return new Response("# Token unbekannt — Server zuerst im Portal anlegen", { status: 401 });
        }

        const supabaseUrl = process.env.SUPABASE_URL ?? "";
        const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
        const portalOrigin = normalizePortalOrigin(url.origin);
        const acmeEmail = process.env.ACME_EMAIL ?? "admin@example.com";

        const script = renderScript({
          serverName: server.name,
          serverId: server.id,
          token,
          supabaseUrl,
          supabaseKey,
          portalOrigin,
          acmeEmail,
          clean,
        });

        // Log Bootstrap-Abruf
        await supabaseAdmin.from("automation_log").insert({
          action: "server.bootstrap",
          target: server.name,
          status: "ok",
          payload: { ip: server.ip, hostname: server.hostname },
        });

        return new Response(script, {
          status: 200,
          headers: { "content-type": "text/x-shellscript; charset=utf-8" },
        });
      },
    },
  },
});

function shellEscape(s: string): string {
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}

function normalizePortalOrigin(origin: string): string {
  if (origin.startsWith("http://localhost") || origin.startsWith("http://127.0.0.1")) return origin;
  const httpsOrigin = origin.replace(/^http:\/\//, "https://");
  try {
    const parsed = new URL(httpsOrigin);
    const previewMatch = /^id-preview--([a-f0-9-]+)\.lovable\.app$/i.exec(parsed.hostname);
    if (previewMatch) return `https://project--${previewMatch[1]}-dev.lovable.app`;
  } catch {
    // Fallback below keeps the previous behavior for unusual origins.
  }
  return httpsOrigin;
}

function renderScript(p: {
  serverName: string;
  serverId: string;
  token: string;
  supabaseUrl: string;
  supabaseKey: string;
  portalOrigin: string;
  acmeEmail: string;
  clean: boolean;
}): string {
  const SERVER_FILES = `${p.portalOrigin}/api/public/landing-server-files`;
  const cleanBlock = p.clean
    ? `
echo "[bootstrap] 0/7 CLEAN: vorhandene Installation entfernen …"
systemctl stop landing-server.service 2>/dev/null || true
systemctl stop landing-heartbeat.service 2>/dev/null || true
systemctl stop landing.service 2>/dev/null || true
systemctl stop caddy 2>/dev/null || true
systemctl stop nginx 2>/dev/null || true
systemctl stop apache2 2>/dev/null || true
systemctl stop httpd 2>/dev/null || true
systemctl disable landing-server.service 2>/dev/null || true
systemctl disable landing-heartbeat.service 2>/dev/null || true
systemctl disable landing.service 2>/dev/null || true
systemctl disable nginx 2>/dev/null || true
systemctl disable apache2 2>/dev/null || true
systemctl disable httpd 2>/dev/null || true
rm -f /etc/systemd/system/landing-server.service
rm -f /etc/systemd/system/landing-heartbeat.service
rm -f /etc/systemd/system/landing.service
rm -rf /etc/systemd/system/landing-server.service.d
rm -rf /etc/systemd/system/caddy.service.d
systemctl daemon-reload
# Verzeichnisse / alte Renderer plattmachen
rm -rf /opt/landing-server /opt/apps/landing-server
rm -rf /etc/caddy/Caddyfile.d /etc/caddy/conf.d
rm -f  /etc/caddy/Caddyfile
# Ports 80/443/3001 erzwungen freiräumen (laufende Prozesse killen)
for P in 80 443 3001; do
  PIDS=\$(ss -lptnH "sport = :\$P" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true)
  for PID in \$PIDS; do kill -9 "\$PID" 2>/dev/null || true; done
done
# Optional vorhandene Pakete entfernen (apache/nginx) — Caddy bleibt, wird gleich neu konfiguriert
if command -v apt-get >/dev/null; then
  # Sicherstellen, dass SSH als manuell installiert gilt, damit es autoremove nicht anfasst
  apt-mark manual openssh-server openssh-sftp-server ssh task-ssh-server 2>/dev/null || true
  apt-get remove -y -qq nginx nginx-common nginx-full apache2 apache2-bin apache2-utils 2>/dev/null || true
  # Kein apt-get autoremove! Das hat auf dem letzten Server openssh-server entfernt.
fi
# Alten landing-User entfernen (wird gleich neu angelegt)
id -u landing >/dev/null 2>&1 && userdel -r landing 2>/dev/null || true
echo "[bootstrap]   ✓ Server geputzt"
`
    : "";
  return `#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────────────
# Landing-Server Bootstrap — generiert von ${p.portalOrigin}
# Server: ${p.serverName}  (id=${p.serverId})
# Idempotent: kann mehrfach ausgeführt werden.${p.clean ? "\n# CLEAN-Modus: bestehende Webserver/Services werden vorher entfernt." : ""}
# ────────────────────────────────────────────────────────────────────────────
set -euo pipefail
trap 'echo "[bootstrap] ❌ Fehler in Zeile $LINENO" >&2' ERR

if [ "$EUID" -ne 0 ]; then echo "Bitte mit sudo/root ausführen."; exit 1; fi

INSTALL_DIR=/opt/landing-server
SERVICE_USER=landing
HEARTBEAT_URL=${shellEscape(`${p.portalOrigin}/api/public/landing-server-heartbeat`)}
BOOTSTRAP_TOKEN=${shellEscape(p.token)}
SUPABASE_URL=${shellEscape(p.supabaseUrl)}
SUPABASE_PUBLISHABLE_KEY=${shellEscape(p.supabaseKey)}
ACME_EMAIL=${shellEscape(p.acmeEmail)}
SERVER_FILES_BASE=${shellEscape(SERVER_FILES)}
${cleanBlock}

echo "[bootstrap] 1/7 Pakete aktualisieren …"
export DEBIAN_FRONTEND=noninteractive
# Debian 11/12: falls security-Repo des Anbieters falsch gesetzt ist, sources.list reparieren
if grep -q "bullseye" /etc/os-release 2>/dev/null; then
  cat > /etc/apt/sources.list <<'SRC'
deb http://deb.debian.org/debian bullseye main contrib non-free
deb http://security.debian.org/debian-security bullseye-security main contrib non-free
deb http://deb.debian.org/debian bullseye-updates main contrib non-free
SRC
elif grep -q "bookworm" /etc/os-release 2>/dev/null; then
  cat > /etc/apt/sources.list <<'SRC'
deb http://deb.debian.org/debian bookworm main contrib non-free non-free-firmware
deb http://security.debian.org/debian-security bookworm-security main contrib non-free non-free-firmware
deb http://deb.debian.org/debian bookworm-updates main contrib non-free non-free-firmware
SRC
fi
apt-get update -o Acquire::AllowReleaseInfoChange=true -qq || apt-get update -qq || true
apt-get install -y -qq curl ca-certificates debian-keyring debian-archive-keyring apt-transport-https unzip jq gnupg >/dev/null

echo "[bootstrap] 2/7 Caddy installieren …"
if ! command -v caddy >/dev/null 2>&1; then
  curl -sSL 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -sSL 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy >/dev/null
fi
systemctl stop nginx apache2 httpd 2>/dev/null || true
systemctl disable nginx apache2 httpd 2>/dev/null || true
for P in 80 443; do
  PIDS=$(ss -lptnH "sport = :$P" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true)
  for PID in $PIDS; do
    COMM=$(ps -p "$PID" -o comm= 2>/dev/null || true)
    if [ "$COMM" != "caddy" ]; then kill -9 "$PID" 2>/dev/null || true; fi
  done
done

echo "[bootstrap] 3/7 Node prüfen …"
command -v /usr/bin/node >/dev/null 2>&1 || { echo "Node.js fehlt: bitte nodejs installieren"; exit 1; }

echo "[bootstrap] 4/7 User + Verzeichnisse …"
id -u "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --home "$INSTALL_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
mkdir -p "$INSTALL_DIR/themes"
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

echo "[bootstrap] 5/7 Renderer + Themes laden …"
curl -fsSL "$SERVER_FILES_BASE/server.js"  -o "$INSTALL_DIR/server.js"
curl -fsSL "$SERVER_FILES_BASE/package.json"  -o "$INSTALL_DIR/package.json"
curl -fsSL "$SERVER_FILES_BASE/heartbeat.sh" -o "$INSTALL_DIR/heartbeat.sh"
if head -c 32 "$INSTALL_DIR/server.js" | grep -qi '<!DOCTYPE html\|<html'; then
  echo "[bootstrap] ❌ server.js Download enthält HTML statt JavaScript." >&2
  echo "[bootstrap]    Prüfe URL: $SERVER_FILES_BASE/server.js" >&2
  exit 1
fi
if grep -q 'Bun\.serve' "$INSTALL_DIR/server.js"; then
  echo "[bootstrap] ❌ server.js ist noch die alte Bun-Version." >&2
  exit 1
fi
if ! grep -q 'node:http\|createServer' "$INSTALL_DIR/server.js"; then
  echo "[bootstrap] ❌ server.js sieht nicht wie der Node-Renderer aus." >&2
  exit 1
fi
chmod +x "$INSTALL_DIR/heartbeat.sh"

# Themes-Liste & Dateien holen
mkdir -p "$INSTALL_DIR/themes"
THEMES_JSON=$(curl -fsSL "$SERVER_FILES_BASE/themes.json")
echo "$THEMES_JSON" | jq -r '.themes[]' | while read -r THEME_ID; do
  mkdir -p "$INSTALL_DIR/themes/$THEME_ID"
  for F in template.html style.css script.js; do
    curl -fsSL "$SERVER_FILES_BASE/themes/$THEME_ID/$F" -o "$INSTALL_DIR/themes/$THEME_ID/$F"
  done
done

# .env schreiben
cat > "$INSTALL_DIR/.env" <<EOF
SUPABASE_URL=$SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY=$SUPABASE_PUBLISHABLE_KEY
PORT=3001
SERVER_ID=${p.serverId}
BOOTSTRAP_TOKEN=$BOOTSTRAP_TOKEN
HEARTBEAT_URL=$HEARTBEAT_URL
SERVER_FILES_BASE=$SERVER_FILES_BASE
PORTAL_API_ENDPOINT=${shellEscape(`${p.portalOrigin}/api/public/applications`)}
ACME_EMAIL=$ACME_EMAIL
EOF
chmod 600 "$INSTALL_DIR/.env"
chown "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/.env"

# Caddyfile
cat > /etc/caddy/Caddyfile <<EOF
{
  email $ACME_EMAIL
  on_demand_tls {
    ask http://127.0.0.1:3001/_internal/ask
  }
}

:80 {
  redir https://{host}{uri} 308
}

:443 {
  tls {
    on_demand
  }
  encode zstd gzip
  reverse_proxy 127.0.0.1:3001 {
    header_up Host {host}
    header_up X-Real-IP {remote_host}
    header_up X-Forwarded-For {remote_host}
    header_up X-Forwarded-Proto {scheme}
  }
}
EOF

echo "[bootstrap] 6/7 systemd-Services …"
rm -rf /etc/systemd/system/landing-server.service.d
cat > /etc/systemd/system/landing-server.service <<EOF
[Unit]
Description=Landing Renderer (Node)
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$INSTALL_DIR/.env
ExecStart=/usr/bin/node --max-old-space-size=128 server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/landing-heartbeat.service <<EOF
[Unit]
Description=Landing-Server Heartbeat
After=network.target

[Service]
Type=simple
EnvironmentFile=$INSTALL_DIR/.env
ExecStart=/bin/bash $INSTALL_DIR/heartbeat.sh
Restart=always
RestartSec=60

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now landing-server.service
systemctl enable --now landing-heartbeat.service
caddy validate --config /etc/caddy/Caddyfile || { journalctl -u caddy -n 80 --no-pager || true; exit 1; }
if ! systemctl reload caddy; then
  systemctl restart caddy || { systemctl status caddy --no-pager || true; journalctl -u caddy -n 80 --no-pager || true; exit 1; }
fi

echo "[bootstrap] 7/7 Initialer Heartbeat …"
sleep 2
RENDERER_HEALTHY=false
if curl -fsS http://127.0.0.1:3001/_health >/dev/null 2>&1; then
  RENDERER_HEALTHY=true
fi
curl -sS -X POST "$HEARTBEAT_URL" \
  -H 'Content-Type: application/json' \
  -d "{\\"token\\":\\"$BOOTSTRAP_TOKEN\\",\\"agent_version\\":\\"1.2.0\\",\\"renderer_healthy\\":$RENDERER_HEALTHY}" || true

# Sicherstellen, dass SSH weiterhin erreichbar ist (hat autoremove zuvor entfernt)
if command -v systemctl >/dev/null 2>&1; then
  if ! systemctl is-active ssh >/dev/null 2>&1 && ! systemctl is-active sshd >/dev/null 2>&1; then
    echo "[bootstrap] SSH-Dienst nicht aktiv — wird neu installiert/gestartet ..."
    apt-get update -qq
    apt-get install -y -qq openssh-server 2>/dev/null || true
    systemctl enable --now ssh 2>/dev/null || systemctl enable --now sshd 2>/dev/null || true
  fi
fi

echo ""
echo "✅ Landing-Server bereit."
echo "   - Renderer:  systemctl status landing-server"
echo "   - Heartbeat: systemctl status landing-heartbeat"
echo "   - Logs:      journalctl -u landing-server -f"
echo "   - SSH:       systemctl status ssh || systemctl status sshd"
`;
}
