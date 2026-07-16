# send-reminders

Sendet automatische Erinnerungs-Mails an drei Zielgruppen.

## Deploy (auf dem Self-Hosted Server)

```bash
supabase functions deploy send-reminders --no-verify-jwt
```

## Migration ausführen

```bash
# in mb-portal-src:
psql -h <db-host> -U postgres -d postgres -f supabase/migrations/20260601000000_reminder_log.sql
```

## Manuell triggern (für initialen Sweep der Alt-Bewerber)

Option A — Über UI: Im Admin-Bereich "Bewerbungen" → Button **"Erinnerungen senden"**

Option B — Direkt via curl:
```bash
curl -X POST https://<SUPABASE_URL>/functions/v1/send-reminders \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Dry-Run (nichts senden, nur zählen):
```bash
curl -X POST https://<SUPABASE_URL>/functions/v1/send-reminders \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"dry_run": true}'
```

Nur ein Typ:
```bash
# only_type: "invite" | "confirm_email" | "complete_registration"
-d '{"only_type": "invite"}'
```

Verfügbare Typen:
- `invite` – Bewerber angenommen, kein Account (Tag 3, 6, 9, 12, 15)
- `confirm_email` – Account angelegt, E-Mail nicht bestätigt
- `complete_registration` – Account bestätigt, Onboarding unvollständig (Vertrag/Personalausweis/Pflichtdaten fehlend)
- `no_recent_booking` – Mitarbeiter mit abgeschlossenem Onboarding ohne Buchung seit 7+ Tagen

## pg_cron einrichten (1x/Tag um 09:00 Europe/Berlin = 07:00 UTC)

In der Postgres-DB ausführen (einmalig):

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Service-Role-Key in Vault speichern (einmalig)
SELECT vault.create_secret('<SERVICE_ROLE_KEY>', 'reminders_service_role_key');

SELECT cron.schedule(
  'send-reminders-daily',
  '0 7 * * *',
  $$
  SELECT net.http_post(
    url := 'https://<SUPABASE_URL>/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'reminders_service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

## Gates / Logik

- max. 5 Mails pro Empfänger und Typ
- min. 3 Tage Abstand zwischen Mails
- min. 3 Tage seit Bewerbungsannahme / Account-Erstellung / Profil-Erstellung
- Alle Sends werden in `public.reminder_log` protokolliert

## Anti-Spam-Throttling

Um zu verhindern, dass die Sender-Domain als Spam markiert wird, werden Mails **gestaffelt** versendet:

- **Max. 15 echte Sends pro Typ und Function-Aufruf** (`MAX_SENDS_PER_RUN`)
- **2,5–5,5 s Pause** (zufällig gejittert) zwischen zwei Sends — kein Burst
- Übersprungene Empfänger (`run_cap_reached`) werden beim **nächsten Cron-Lauf** automatisch nachgeholt

### Empfohlene Cron-Frequenz

Für die 150 Alt-Bewerber binnen 24 h: **stündlich** laufen lassen statt täglich:

```sql
-- Statt '0 7 * * *' (1×/Tag):
SELECT cron.schedule(
  'send-reminders-hourly',
  '0 * * * *',   -- jede volle Stunde
  $$ … (Body wie oben) $$
);
```

Kapazität: 15 Mails/Stunde × 24 = **360 Mails/Tag pro Typ** → 150 Invite-Reminder sind in ~10 h durch, ohne dass die Domain Burst-Signale sendet.

Wenn der initiale Sweep durch ist, kannst du auf täglich (`0 7 * * *`) zurückstellen.
