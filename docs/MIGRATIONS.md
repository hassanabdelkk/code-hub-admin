# Datenbank-Migrationen anwenden

Alle Schema-Änderungen liegen als SQL-Dateien in `supabase/manual-migrations/`.
Sie müssen **manuell** im Supabase SQL-Editor ausgeführt werden — in der hier
angegebenen Reihenfolge.

## So geht's

1. Supabase Dashboard öffnen → linke Sidebar → **SQL Editor** → **+ New query**.
2. Inhalt der Migrations-Datei kopieren, einfügen, **Run** klicken.
3. Mit der Check-Query unten prüfen, dass alles geklappt hat.
4. Nächste Migration.

> **Wichtig**: Die Dateien sind idempotent (`CREATE TABLE IF NOT EXISTS …`).
> Du kannst sie auch erneut ausführen, falls du dir nicht sicher bist.

---

## Reihenfolge

### 1. `20260616100000_applications_funnel.sql`

**Was sie tut:** Fügt der Tabelle `applications` die Spalten `source_slug`
(welche Landing hat den Bewerber gebracht) und `is_test` (Test-Bewerbungen
ausfiltern) hinzu — Grundlage für das Funnel-Tracking im Landing-Generator.

**Check-Query (sollte 2 Zeilen liefern):**

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'applications'
  AND column_name IN ('source_slug', 'is_test');
```

### 2. `20260617000000_landing_pages.sql`

**Was sie tut:** Erstellt die Tabelle `landing_pages` (zentrale Speicherung
aller Landing-Konfigurationen) und den Storage-Bucket `landing-assets` für
Logos/Favicons.

**Check-Query:**

```sql
SELECT to_regclass('public.landing_pages') AS landing_pages,
       (SELECT id FROM storage.buckets WHERE id = 'landing-assets') AS bucket;
```

Beide Spalten müssen einen Wert (nicht NULL) zurückgeben.

### 3. `20260618000000_landing_infrastructure.sql`

**Was sie tut:** Erstellt den Server-Pool (`landing_servers`), die Cloudflare-
Tabellen (`cloudflare_accounts`, `cloudflare_zones`) und das Audit-Log
(`automation_log`). Verknüpft `landing_pages` mit Server und CF-Zone.

**Check-Query:**

```sql
SELECT to_regclass('public.landing_servers')       AS landing_servers,
       to_regclass('public.cloudflare_accounts')   AS cloudflare_accounts,
       to_regclass('public.cloudflare_zones')      AS cloudflare_zones,
       to_regclass('public.automation_log')        AS automation_log;
```

Alle vier Spalten müssen einen Wert haben.

### 4. `20260618100000_calendly_integration.sql`

**Was sie tut:** Fügt `landing_pages` die Calendly-Felder hinzu
(`calendly_url`, `intermediate_company_name`, `intermediate_logo_url`,
`redirect_delay_ms`), erweitert `applications` um Buchungs-Tracking
(`booking_status`, `scheduled_at`, `calendly_event_uri`,
`calendly_invitee_uri`) und erstellt `calendly_accounts` für die
Webhook-Signatur-Verifikation pro Tenant.

**Check-Query:**

```sql
SELECT to_regclass('public.calendly_accounts') AS calendly_accounts,
       (SELECT count(*) FROM information_schema.columns
        WHERE table_schema='public' AND table_name='applications'
          AND column_name IN ('booking_status','scheduled_at','calendly_event_uri'))
        AS application_cols,
       (SELECT count(*) FROM information_schema.columns
        WHERE table_schema='public' AND table_name='landing_pages'
          AND column_name IN ('calendly_url','intermediate_company_name','redirect_delay_ms'))
        AS landing_cols;
```

`calendly_accounts` ≠ NULL, beide Counts = 3.

---

## Typische Fehlermeldungen

| Fehler im Portal | Welche Migration fehlt |
|---|---|
| `Could not find the table 'public.landing_pages'` | #2 |
| `Could not find the table 'public.landing_servers'` | #3 |
| `column applications.source_slug does not exist` | #1 |
| `Could not find the table 'public.cloudflare_accounts'` | #3 |

## Nach dem Migrieren

Im Portal die Seite einmal neu laden (Cmd/Ctrl-R). Das Supabase-Schema-Cache
braucht ein paar Sekunden, bis neue Tabellen sichtbar sind.
