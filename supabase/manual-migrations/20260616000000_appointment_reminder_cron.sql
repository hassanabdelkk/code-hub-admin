-- APPLY MANUALLY via: bash scripts/migrate.sh
-- Cron für send-appointment-reminders: alle 10 Minuten.
-- Function nutzt 25-40 Min Toleranzfenster + appointment_reminder_log Idempotenz
-- → es geht garantiert genau 1 Mail pro Booking raus.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- TODO BEFORE APPLYING:
--   sed -e "s|<SUPABASE_URL>|abcd1234.supabase.co|g" \
--       20260616000000_appointment_reminder_cron.sql | psql "$TARGET_DB_URL"
-- (Service-Role-Key wird aus existing 'reminders_service_role_key' Vault-Eintrag genommen.)

DO $$
BEGIN
  PERFORM cron.unschedule('send-appointment-reminders');
EXCEPTION WHEN OTHERS THEN NULL;
END$$;

SELECT cron.schedule(
  'send-appointment-reminders',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://<SUPABASE_URL>/functions/v1/send-appointment-reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'reminders_service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- Verifizieren:
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'send-appointment-reminders';
