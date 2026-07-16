-- ============================================================================
-- SEND-REMINDERS CRON  (stündlich)
-- Triggert die Edge-Function send-reminders, die alle 3 Reminder-Typen
-- verarbeitet:
--   1. invite                 (akzeptierte Bewerber ohne Account)
--   2. confirm_email          (Account ohne bestätigte E-Mail)
--   3. complete_registration  (Account bestätigt, Onboarding offen)
--
-- Throttling in der Function selbst:
--   - max. 15 Sends pro Typ und Run (MAX_SENDS_PER_RUN)
--   - 2.5-5.5s Jitter zwischen Sends
--   - 12h-Cap + Per-Empfänger-Cap
-- Stündlich gibt also bis zu 45 Mails/Stunde Gesamtkapazität.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- TODO BEFORE APPLYING:
--   1) <SUPABASE_URL>      = z.B. abcd1234.supabase.co  (ohne https://)
--   2) <SERVICE_ROLE_KEY>  = aus Supabase Project Settings → API
--
--   sed -e "s|<SUPABASE_URL>|abcd1234.supabase.co|g" \
--       -e "s|<SERVICE_ROLE_KEY>|eyJhbGc...|g" \
--       20260609000000_send_reminders_cron.sql | psql "$TARGET_DB_URL"

-- Service-Role-Key in Vault speichern (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'reminders_service_role_key') THEN
    PERFORM vault.create_secret('<SERVICE_ROLE_KEY>', 'reminders_service_role_key');
  END IF;
END$$;

-- Alten Job entfernen (idempotent)
DO $$
BEGIN
  PERFORM cron.unschedule('send-reminders-hourly');
EXCEPTION WHEN OTHERS THEN NULL;
END$$;

DO $$
BEGIN
  PERFORM cron.unschedule('send-reminders-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END$$;

-- Stündlich um Minute 15 (versetzt zum Domain-Health-Cron, der auf 0/2 läuft)
SELECT cron.schedule(
  'send-reminders-hourly',
  '15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://<SUPABASE_URL>/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'reminders_service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

-- Verifizieren:
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'send-reminders%';
--   SELECT jobid, status, return_message, start_time
--     FROM cron.job_run_details
--     WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'send-reminders-hourly')
--     ORDER BY start_time DESC LIMIT 10;
