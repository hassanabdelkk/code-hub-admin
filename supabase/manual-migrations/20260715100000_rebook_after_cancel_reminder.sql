-- APPLY MANUALLY: bash scripts/migrate.sh
--
-- Neuer Reminder: rebook_after_cancel_24h/72h
-- Ziel: Bewerber hat Termin abgesagt (Calendly canceled) → wir bitten
-- ihn 24h + 72h nach der Absage um eine Neubuchung.
-- Stop-Bedingung: sobald booking_status wieder 'scheduled' ist.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS reminder_app_rebook_subject text,
  ADD COLUMN IF NOT EXISTS reminder_app_rebook_body    text;

COMMENT ON COLUMN public.tenants.reminder_app_rebook_subject IS
  'Betreff: Termin abgesagt, bitte neuen Termin buchen (24h + 72h nach Cancel).';

-- CHECK-Constraint erweitern (idempotent)
ALTER TABLE public.application_reminder_log
  DROP CONSTRAINT IF EXISTS application_reminder_log_reminder_kind_check;
ALTER TABLE public.application_reminder_log
  ADD CONSTRAINT application_reminder_log_reminder_kind_check
  CHECK (reminder_kind IN (
    'no_booking_24h','no_booking_72h','no_show_24h',
    'interview_invite_30min',
    'registration_pending_24h','registration_pending_72h',
    'rebook_after_cancel_24h','rebook_after_cancel_72h'
  ));

NOTIFY pgrst, 'reload schema';
