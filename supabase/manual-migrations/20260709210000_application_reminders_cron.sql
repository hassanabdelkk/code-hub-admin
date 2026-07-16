-- APPLY MANUALLY.
-- Cron für send-application-reminders alle 30 Minuten.
-- Nutzt den bestehenden Vault-Eintrag 'reminders_service_role_key'.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- TODO vor dem Apply: <SUPABASE_URL> ersetzen, z.B.:
--   sed -e "s|<SUPABASE_URL>|abcd1234.supabase.co|g" \
--       20260709210000_application_reminders_cron.sql | psql "$TARGET_DB_URL"

DO $$
BEGIN
  PERFORM cron.unschedule('send-application-reminders');
EXCEPTION WHEN OTHERS THEN NULL;
END$$;

SELECT cron.schedule(
  'send-application-reminders',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://<SUPABASE_URL>/functions/v1/send-application-reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'reminders_service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
