# Domain-Failover Runbook

Ziel: Wenn die Primärdomain (`mb-portal.com` + `api.mb-portal.com`) ausfällt,
innerhalb von <30 Min auf eine Standby-Domain umschalten. Server, DB und
Applikation bleiben unverändert — nur die Domain wechselt.

Platzhalter im gesamten Dokument:
- `PRIMARY_DOMAIN`  = `mb-portal.com`
- `PRIMARY_API`     = `api.mb-portal.com`
- `SECONDARY_DOMAIN` = z. B. `mb-portal-eu.com`  ← noch zu kaufen, anderer Registrar, andere TLD
- `SECONDARY_API`    = `api.mb-portal-eu.com`
- `PORTAL_HOST` IP   = `190.97.167.124`
- `BACKEND_HOST` IP  = `190.97.167.123`

---

## Einmalige Vorbereitung (Hot-Standby aufbauen)

Diese Schritte MÜSSEN vor dem ersten Ernstfall abgeschlossen sein. Sonst
gibt es keinen 30-Min-Switch.

### 1. Zweite Domain kaufen
- Anderer Registrar als die Primärdomain (nicht derselbe, sonst gleicher Ausfallgrund).
- Andere TLD empfohlen (`.eu`, `.app`, `.de`).
- Domain hier eintragen, sobald vorhanden: `SECONDARY_DOMAIN = __________`

### 2. DNS für beide Domains
Für **beide** Domains identisch setzen, TTL **300s**:

| Name | Typ | Wert |
|------|-----|------|
| `@`   | A | `190.97.167.124` |
| `www` | A | `190.97.167.124` |
| `api` | A | `190.97.167.123` |

### 3. TLS auf beiden Hosts für beide Domains
Reverse Proxy (Caddy/Nginx) auf **PORTAL_HOST** erweitern:
```
server_name mb-portal.com www.mb-portal.com SECONDARY_DOMAIN www.SECONDARY_DOMAIN;
```
Auf **BACKEND_HOST** analog für `api.mb-portal.com` + `api.SECONDARY_DOMAIN`.
Let's-Encrypt-Zerts SOFORT ausstellen — nicht erst im Notfall (LE-Rate-Limits).

### 4. Supabase Auth beide Domains freischalten
In `docker-compose.yml` von Supabase (auf BACKEND_HOST) unter dem `auth`-Service:
```yaml
GOTRUE_SITE_URL: https://mb-portal.com
GOTRUE_URI_ALLOW_LIST: >-
  https://mb-portal.com,https://mb-portal.com/*,
  https://SECONDARY_DOMAIN,https://SECONDARY_DOMAIN/*
```
Danach:
```
docker compose up -d auth
```

### 5. CORS (Kong / PostgREST)
Beide Origins whitelisten. In Kong-Config beide Domains unter `origins:` aufnehmen.

### 6. Trockenlauf (PFLICHT)
Einmal in Ruhe komplett durchspielen: unten stehendes Switch-Runbook auf
Standby ausführen, 5 Min laufen lassen, zurückschalten. Erst wenn das
funktioniert, bist du wirklich failover-fähig.

---

## Ernstfall: Switch auf Standby-Domain (Ziel <30 Min)

### Schritt 1 — Prüfen, ob Standby erreichbar ist
```bash
curl -I https://SECONDARY_DOMAIN                     # erwartet: 200
curl -I https://api.SECONDARY_DOMAIN/rest/v1/        # erwartet: 401 (= erreichbar)
```
Wenn hier schon Fehler → Vorbereitung war unvollständig. Erst DNS/TLS fixen.

### Schritt 2 — Supabase SITE_URL umstellen
Auf **BACKEND_HOST**:
```bash
cd /opt/supabase        # Pfad ggf. anpassen
sudo sed -i.bak "s|GOTRUE_SITE_URL:.*|GOTRUE_SITE_URL: https://SECONDARY_DOMAIN|" docker-compose.yml
sudo docker compose up -d auth
```

### Schritt 3 — Portal-App auf neue API-URL zeigen
Auf **PORTAL_HOST**:
```bash
sudo /opt/apps/portal/scripts/switch-domain.sh SECONDARY_DOMAIN
```
Das Skript:
- ersetzt `VITE_SUPABASE_URL` und `VITE_SITE_URL` in `/opt/apps/portal/.env`
- baut das Frontend neu (`bun run build`)
- startet den `portal`-Dienst neu
- macht einen Health-Check auf `http://localhost:$PORT/`

### Schritt 4 — Verifizieren
```bash
curl -I https://SECONDARY_DOMAIN
# Im Browser: Login testen, ein authentifizierter Request muss durchgehen.
```

### Schritt 5 — Nutzer informieren
- Statusseite (dritte Domain, siehe unten) auf neue URL aktualisieren
- E-Mail / Discord / Slack an aktive Nutzer

---

## Zurückschwenken auf Primär

Sobald die Primärdomain wieder erreichbar ist:
```bash
# BACKEND_HOST:
sudo sed -i "s|GOTRUE_SITE_URL:.*|GOTRUE_SITE_URL: https://mb-portal.com|" /opt/supabase/docker-compose.yml
sudo docker compose up -d auth

# PORTAL_HOST:
sudo /opt/apps/portal/scripts/switch-domain.sh mb-portal.com
```

---

## Optional: Statusseite auf dritter Domain

Statische Seite bei Cloudflare Pages / GitHub Pages, die immer erreichbar
bleibt und die aktuell gültige Portal-URL anzeigt. Nutzer lernen: „Wenn
nichts geht → status.mb-portal.io schauen."

---

## Backend deployen (self-hosted Supabase auf BACKEND_HOST)

Analog zu `deploy.sh` (Frontend auf PORTAL_HOST) gibt es
`scripts/deploy-backend.sh`. Läuft **lokal auf deinem Rechner**, macht per
SSH auf BACKEND_HOST:

1. Neue SQL-Migrations aus `supabase/manual-migrations/*.sql` anwenden
   (mit automatischem `pg_dump`-Backup vorher).
2. Edge Functions aus `supabase/functions/*` per `rsync --delete` syncen
   und den Functions-Container neu starten.
3. Health-Check gegen `api.mb-portal.com/auth/v1/health`.

### Einmalige Vorbereitung

```
ssh-copy-id root@190.97.167.123
cp scripts/backend-server.env.example scripts/backend-server.env
# Werte in scripts/backend-server.env eintragen (Container-Namen mit
# `ssh root@BACKEND_HOST 'docker ps --format {{.Names}}'` prüfen)
```

`scripts/backend-server.env` ist in `.gitignore` — bleibt lokal.

### Ablauf

```
bash scripts/deploy-backend.sh --dry-run   # zuerst: was würde passieren?
bash scripts/deploy-backend.sh             # dann echt deployen
```

### Wenn etwas schiefgeht

- Migration failed → State-File wird nicht aktualisiert; Fehler fixen und
  Skript erneut starten. Backup liegt in
  `BACKEND_SUPABASE_DIR/backups/pre-deploy-*.sql.gz`.
- Functions-Container startet nicht → `ssh root@BACKEND_HOST 'docker logs
  supabase-edge-functions --tail 100'`.
- „Tenant or user not found" → das war der alte Pooler-Weg (Port 6543).
  `deploy-backend.sh` umgeht das, weil es direkt über `docker exec
  supabase-db psql` geht.

---

## Was dieses Runbook NICHT abdeckt

- Server-Ausfall (Portal- oder Backend-Host offline) → braucht zweiten Stack + Replikation, separater Plan.
- Automatischer DNS-Failover (Cloudflare Load Balancer) → hilft nicht gegen Registrar-Sperre der Primärdomain.
- Datenbank-Restore aus Backup → separater DR-Plan.
