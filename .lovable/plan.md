# Backend-Deploy vom lokalen Rechner

## Ziel
Ein Skript `scripts/deploy-backend.sh` auf deinem lokalen Rechner, das per SSH das self-hosted Supabase auf `.123` auf den aktuellen Stand bringt — genauso einfach wie `deploy.sh` für das Frontend auf `.124`.

## Was „up to date bringen" konkret heißt

Drei Dinge können sich im Repo ändern und müssen auf `.123` landen:

1. **SQL-Migrations** — neue Dateien in `supabase/manual-migrations/*.sql`
2. **Edge Functions** — neue/geänderte Ordner in `supabase/functions/*`
3. **(optional) Supabase-Config** — z.B. `GOTRUE_SITE_URL` in der Supabase-`.env` auf `.123` beim Domain-Switch

## Voraussetzung (einmalig)

SSH-Key von deinem Laptop auf `.123` einrichten:
```
ssh-copy-id root@<ip-123>
```
Damit das Skript ohne Passwort-Eingabe läuft.

## Skript-Ablauf `scripts/deploy-backend.sh`

Läuft **lokal**, macht alles per `ssh` / `rsync` auf `.123`:

```text
0/4  Check: SSH auf .123 möglich? Repo aktuell? (git status sauber)
1/4  SQL-Migrations
     - rsync supabase/manual-migrations/ → .123:/opt/supabase/manual-migrations/
     - ssh .123: für jede neue .sql (State-File .migrations-applied)
       docker exec -i supabase-db psql -U postgres -d postgres -f <file>
     - Neu angewendete Migrations werden ins State-File geschrieben
2/4  Edge Functions
     - rsync supabase/functions/ → .123:/opt/supabase/volumes/functions/
       (--delete, damit gelöschte Functions auch verschwinden)
     - ssh .123: docker compose -f /opt/supabase/docker-compose.yml
                 restart functions
3/4  Health-Check
     - ssh .123: docker ps → alle Supabase-Container "healthy"?
     - curl https://api.mb-portal.com/auth/v1/health → 200?
4/4  Fertig ✅ — kurze Zusammenfassung (X Migrations, Y Functions)
```

## Sicherheitsnetze

- **State-File** auf `.123` verhindert Doppel-Anwendung von Migrations (wie bei `deploy.sh`).
- **Dry-Run-Modus**: `deploy-backend.sh --dry-run` zeigt nur, was passieren würde.
- **Backup vor Migrations**: `pg_dump` in `/opt/supabase/backups/pre-deploy-<timestamp>.sql` auf `.123` — falls eine Migration schiefgeht, ist der vorherige Stand da.
- **Atomic pro Migration**: Jede `.sql` läuft mit `-v ON_ERROR_STOP=1` in einer Transaktion; Fehler → Abbruch, State-File wird nicht aktualisiert.

## Neue Dateien

- `scripts/deploy-backend.sh` — lokal ausführbar (`bash scripts/deploy-backend.sh`)
- `scripts/backend-server.env.example` — Vorlage für lokale Config (`BACKEND_HOST=…`, `BACKEND_USER=root`, `BACKEND_SUPABASE_DIR=/opt/supabase`)
- `RUNBOOK.md` — neuer Abschnitt „Backend deployen" mit Ein-Zeiler + Troubleshooting

## Nicht enthalten

- Keine Änderung am Supabase-Docker-Stack selbst (Versions-Updates von Supabase machst du weiterhin manuell — das ist selten und riskant).
- Kein automatisches `.env`-Rewrite auf `.123`. Config-Änderungen (z.B. `GOTRUE_SITE_URL`) bleiben manuell dokumentiert im `RUNBOOK.md`, weil sie selten und heikel sind.

## Technische Details

- `rsync -avz --delete` für Functions (idempotent, schnell, löscht Entferntes).
- State-File auf `.123`: `/opt/supabase/.migrations-applied` (Zeilen mit Dateinamen, `grep -qxF`).
- psql via `docker exec -i supabase-db psql -U postgres -d postgres` — umgeht den Pooler (6543) komplett, deshalb kein „Tenant or user not found" mehr.
- Passwort für `postgres`-User wird auf `.123` aus `/opt/supabase/.env` (`POSTGRES_PASSWORD`) gelesen; das Skript braucht es lokal nicht.
