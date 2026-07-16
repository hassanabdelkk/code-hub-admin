// Liefert dem Bootstrap-Script die benötigten Dateien (server.ts, themes/*).
// Splat-Route: /api/public/landing-server-files/$
// Erlaubt nur whitelisted Pfade.

import { createFileRoute } from "@tanstack/react-router";
import { THEMES } from "@/lib/landing-themes";
import { THEME_ASSETS } from "@/lib/theme-assets.generated";
import landingServerSource from "../../../../landing-server/server.js?raw";

function mimeFor(name: string): string {
  const ext = name.toLowerCase().split(".").pop() || "";
  return ({
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
    gif: "image/gif", svg: "image/svg+xml", ico: "image/x-icon",
    woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
    css: "text/css", js: "application/javascript", json: "application/json",
    html: "text/html", txt: "text/plain",
  } as Record<string, string>)[ext] || "application/octet-stream";
}

const PACKAGE_JSON = `{
  "name": "landing-server",
  "version": "1.0.0",
  "type": "module",
  "scripts": { "start": "node --max-old-space-size=128 server.js" },
  "dependencies": {}
}
`;

const HEARTBEAT_SH = `#!/usr/bin/env bash
# Liest .env, schickt alle 60s einen Heartbeat und lädt Themes bei Bedarf neu.
# Wichtig: Der Heartbeat läuft auch dann weiter, wenn der Renderer gerade kaputt ist.
set -euo pipefail
[ -f /opt/landing-server/.env ] && set -a && . /opt/landing-server/.env && set +a
THEMES_DIR=/opt/landing-server/themes
AGENT_VERSION="1.3.0"

if [ -z "\${SERVER_FILES_BASE:-}" ]; then
  SERVER_FILES_BASE="\${HEARTBEAT_URL%/landing-server-heartbeat}/landing-server-files"
fi

resync_themes() {
  echo "[heartbeat] Resync angefordert — lade Themes + server.js neu …" >&2
  mkdir -p "$THEMES_DIR"
  THEMES_JSON=$(curl -fsSL "$SERVER_FILES_BASE/themes.json" 2>/dev/null || echo '{"themes":[]}')
  echo "$THEMES_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{JSON.parse(s).themes.forEach(t=>console.log(t))}catch{}})' | while read -r THEME_ID; do
    [ -z "$THEME_ID" ] && continue
    mkdir -p "$THEMES_DIR/$THEME_ID"
    for F in template.html style.css script.js; do
      curl -fsSL "$SERVER_FILES_BASE/themes/$THEME_ID/$F" -o "$THEMES_DIR/$THEME_ID/$F" 2>/dev/null || true
    done
    # Assets pro Theme syncen
    mkdir -p "$THEMES_DIR/$THEME_ID/assets"
    ASSETS_JSON=$(curl -fsSL "$SERVER_FILES_BASE/themes/$THEME_ID/assets.json" 2>/dev/null || echo '{"files":[]}')
    echo "$ASSETS_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{JSON.parse(s).files.forEach(f=>console.log(f))}catch{}})' | while read -r ASSET_FILE; do
      [ -z "$ASSET_FILE" ] && continue
      curl -fsSL "$SERVER_FILES_BASE/themes/$THEME_ID/assets/$ASSET_FILE" -o "$THEMES_DIR/$THEME_ID/assets/$ASSET_FILE" 2>/dev/null || true
    done
  done
  # server.js zusätzlich syncen (atomic via .new + mv)
  if curl -fsSL "$SERVER_FILES_BASE/server.js" -o /opt/landing-server/server.js.new 2>/dev/null; then
    if [ -s /opt/landing-server/server.js.new ]; then
      mv /opt/landing-server/server.js.new /opt/landing-server/server.js
      echo "[heartbeat] server.js aktualisiert." >&2
    else
      rm -f /opt/landing-server/server.js.new
    fi
  fi
  systemctl restart landing-server.service 2>/dev/null || systemctl restart landing.service 2>/dev/null || true
  echo "[heartbeat] Resync fertig." >&2
}

while true; do
  COUNT=0
  RENDERER_HEALTHY=false
  if curl -fsS http://127.0.0.1:3001/_health >/dev/null 2>&1; then
    RENDERER_HEALTHY=true
  fi

  PAYLOAD=$(printf '{"token":"%s","landing_count":%s,"agent_version":"%s","renderer_healthy":%s}' "$BOOTSTRAP_TOKEN" "$COUNT" "$AGENT_VERSION" "$RENDERER_HEALTHY")
  RESP=$(curl -sS -X POST "$HEARTBEAT_URL" \\
    -H 'Content-Type: application/json' \\
    --data "$PAYLOAD" \\
    2>/dev/null || echo '')

  if echo "$RESP" | grep -q '"resync_needed":true'; then
    resync_themes
    # Bestätigung an Portal
    RESYNC_PAYLOAD=$(printf '{"token":"%s","resync_done":true,"agent_version":"%s","renderer_healthy":%s}' "$BOOTSTRAP_TOKEN" "$AGENT_VERSION" "$RENDERER_HEALTHY")
    curl -sS -X POST "$HEARTBEAT_URL" \\
      -H 'Content-Type: application/json' \\
      --data "$RESYNC_PAYLOAD" \\
      >/dev/null 2>&1 || true
  fi
  sleep 60
done
`;

export const Route = createFileRoute("/api/public/landing-server-files/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const path = String((params as any)._splat ?? "").replace(/\.\./g, "");

        if (path === "server.js" || path === "server.ts") {
          return new Response(landingServerSource, {
            headers: { "content-type": "text/plain; charset=utf-8" },
          });
        }
        if (path === "package.json") {
          return new Response(PACKAGE_JSON, {
            headers: { "content-type": "application/json; charset=utf-8" },
          });
        }
        if (path === "heartbeat.sh") {
          return new Response(HEARTBEAT_SH, {
            headers: { "content-type": "text/x-shellscript; charset=utf-8" },
          });
        }
        if (path === "themes.json") {
          return Response.json({ themes: THEMES.map((t) => t.id) });
        }
        // themes/<id>/assets.json → Liste aller Asset-Dateinamen
        const list = /^themes\/([^/]+)\/assets\.json$/.exec(path);
        if (list) {
          const files = Object.keys(THEME_ASSETS[list[1]] || {});
          return Response.json({ files });
        }
        // themes/<id>/<file>
        const m = /^themes\/([^/]+)\/(template\.html|style\.css|script\.js)$/.exec(path);
        if (m) {
          const theme = THEMES.find((t) => t.id === m[1]);
          if (!theme) return new Response("theme not found", { status: 404 });
          const body = m[2] === "template.html" ? theme.html : m[2] === "style.css" ? theme.css : theme.js;
          const ct = m[2].endsWith(".html") ? "text/html" : m[2].endsWith(".css") ? "text/css" : "application/javascript";
          return new Response(body, { headers: { "content-type": `${ct}; charset=utf-8` } });
        }
        // themes/<id>/assets/<file>  → aus THEME_ASSETS (base64) dekodieren
        const a = /^themes\/([^/]+)\/assets\/([A-Za-z0-9._-]+)$/.exec(path);
        if (a) {
          const b64 = THEME_ASSETS[a[1]]?.[a[2]];
          if (!b64) return new Response("asset not found", { status: 404 });
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          return new Response(bytes, {
            headers: {
              "content-type": mimeFor(a[2]),
              "cache-control": "public, max-age=86400, immutable",
            },
          });
        }
        return new Response("not found", { status: 404 });
      },
    },
  },
});
