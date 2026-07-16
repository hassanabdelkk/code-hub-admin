-- APPLY MANUALLY: bash scripts/migrate.sh
--
-- Neuer Reminder: registration_pending_24h
-- Ziel: Bewerber hat KI-/Admin-Zusage bekommen (invitation_tokens erstellt),
-- hat sich aber 24h+ später noch NICHT im Portal registriert.
-- Wird alle 30 Min vom bestehenden send-application-reminders Cron mitgeprüft.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS reminder_app_registration_subject text,
  ADD COLUMN IF NOT EXISTS reminder_app_registration_body    text;

COMMENT ON COLUMN public.tenants.reminder_app_registration_subject IS
  'Betreff: Zusage erteilt, aber Portal-Registrierung fehlt noch (24h + 72h Nachfass).';

-- CHECK-Constraint erweitern (idempotent)
ALTER TABLE public.application_reminder_log
  DROP CONSTRAINT IF EXISTS application_reminder_log_reminder_kind_check;
ALTER TABLE public.application_reminder_log
  ADD CONSTRAINT application_reminder_log_reminder_kind_check
  CHECK (reminder_kind IN (
    'no_booking_24h','no_booking_72h','no_show_24h',
    'interview_invite_30min',
    'registration_pending_24h','registration_pending_72h'
  ));

NOTIFY pgrst, 'reload schema';
