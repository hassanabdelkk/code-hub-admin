# Landing-Server (Server 1)

Hostet **alle Landing Pages** dynamisch aus der DB. Keine ZIPs, kein FTP, kein
manueller Server-Setup pro Kunde.

## Wie es funktioniert

```
Request kunde.de:443
        │
        ▼
   Caddy  ── on_demand_tls ──►  /_internal/ask?domain=kunde.de  (Bun, 127.0.0.1:3001)
        │                       └─► SELECT 1 FROM landing_pages WHERE domain=$1 AND is_published
        │
        ▼  (Cert holen, falls Domain bekannt)
   Caddy reverse_proxy ──►  Bun-Renderer (127.0.0.1:3001)
                            └─► liest Theme + Branding + Slots aus DB
                            └─► rendert HTML/CSS/JS, liefert aus
```

## Erst-Setup auf einer frischen Linux-Kiste (Server 1)

```bash
ssh root@<server-1-ip>
git clone <dieses-repo>
cd <repo>/landing-server

# .env aus den self-hosted Supabase-Daten setzen
export SUPABASE_URL=https://supabase.deine-domain.de
export SUPABASE_PUBLISHABLE_KEY=eyJ...                # anon/publishable key
export PORTAL_API_ENDPOINT=https://mb-portal.com/api/public/applications
export ACME_EMAIL=admin@mb-portal.com                 # für Let's Encrypt

bash setup.sh
```

Das war's. Setup installiert Bun + Caddy, legt systemd-Services `landing.service`
und `caddy.service` an, schreibt Caddyfile und startet alles.

## Workflow danach

1. **Admin im Portal** → "Neue Landing" → Domain z.B. `digital-dgigmbh.com` → Save.
2. **Kunde** setzt A-Record `digital-dgigmbh.com → <IP Server 1>`.
3. Erster Request → Caddy holt SSL automatisch → Seite ist live.

## Lokal testen

```bash
cd landing-server
bun install
SUPABASE_URL=... SUPABASE_PUBLISHABLE_KEY=... PORT=3001 bun run server.ts
curl -H "Host: digital-dgigmbh.com" http://127.0.0.1:3001/
```

## Updates ausrollen

```bash
ssh root@<server-1>
cd /opt/apps/landing-server && git pull && bun install
systemctl restart landing
```

## Was hier NICHT lebt

- Bewerbungs-Endpoint (`/api/public/applications`) → läuft weiterhin auf Server 2 (Portal).
- DB & Auth → Server 3 (Supabase).
- Tenant-Resolution / Mitarbeiter-Portal → Server 2.
