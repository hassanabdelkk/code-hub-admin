-- APPLY MANUALLY via: bash scripts/migrate.sh
-- Cron für process-invite-resend-queue: alle 15 Minuten.
-- Worker respektiert Quiet-Hours (8-21 Berlin) und MAX_PER_RUN intern.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- TODO BEFORE APPLYING:
--   sed -e "s|<SUPABASE_URL>|abcd1234.supabase.co|g" \
--       20260614000100_invite_resend_queue_cron.sql | psql "$TARGET_DB_URL"
-- (Service-Role-Key wird aus existing 'reminders_service_role_key' Vault-Eintrag genommen.)

DO $$
BEGIN
  PERFORM cron.unschedule('process-invite-resend-queue');
EXCEPTION WHEN OTHERS THEN NULL;
END$$;

SELECT cron.schedule(
  'process-invite-resend-queue',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://<SUPABASE_URL>/functions/v1/process-invite-resend-queue',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'reminders_service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
