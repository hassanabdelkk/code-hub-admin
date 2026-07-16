-- APPLY MANUALLY:
-- docker exec -i supabase-db psql -U postgres -d postgres < 20260710000000_interview_invite_30min.sql
--
-- Ergänzt reminder_kind 'interview_invite_30min' im application_reminder_log
-- und reaktiviert den 10-Min-Cron für send-appointment-reminders (nun als
-- Interview-Einladung 30 Min vor Termin).

-- 1) CHECK-Constraint erweitern
ALTER TABLE public.application_reminder_log
  DROP CONSTRAINT IF EXISTS application_reminder_log_reminder_kind_check;
ALTER TABLE public.application_reminder_log
  ADD CONSTRAINT application_reminder_log_reminder_kind_check
  CHECK (reminder_kind IN ('no_booking_24h','no_booking_72h','no_show_24h','interview_invite_30min'));

-- 2) Sicherstellen, dass der Upsert-Index existiert (für ON CONFLICT)
CREATE UNIQUE INDEX IF NOT EXISTS application_reminder_log_app_kind_uidx
  ON public.application_reminder_log (application_id, reminder_kind);

-- 3) Cron reaktivieren (alle 10 Min). URL vor dem Apply ersetzen:
--   sed -e "s|<SUPABASE_URL>|abcd1234.supabase.co|g" \
--       20260710000000_interview_invite_30min.sql | psql "$TARGET_DB_URL"
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

NOTIFY pgrst, 'reload schema';
