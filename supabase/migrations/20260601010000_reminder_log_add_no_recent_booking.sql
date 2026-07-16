-- Erweitert reminder_log.reminder_type um 'no_recent_booking'
ALTER TABLE public.reminder_log
  DROP CONSTRAINT IF EXISTS reminder_log_reminder_type_check;

ALTER TABLE public.reminder_log
  ADD CONSTRAINT reminder_log_reminder_type_check
  CHECK (reminder_type IN ('invite','confirm_email','complete_registration','no_recent_booking'));
