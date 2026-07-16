-- APPLY MANUALLY via: bash scripts/migrate.sh
-- Erweitert reminder_log.reminder_type um 'domain_recovery',
-- damit die Edge-Function send-reminders im Modus domain_recovery
-- Log-Einträge schreiben kann (sonst CHECK-Constraint-Violation).

ALTER TABLE public.reminder_log
  DROP CONSTRAINT IF EXISTS reminder_log_reminder_type_check;

ALTER TABLE public.reminder_log
  ADD CONSTRAINT reminder_log_reminder_type_check
  CHECK (reminder_type IN (
    'invite',
    'confirm_email',
    'complete_registration',
    'no_recent_booking',
    'domain_recovery'
  ));

-- Index für schnelles Lookup pro Tenant + Typ (Recovery-Status-Tabelle)
CREATE INDEX IF NOT EXISTS reminder_log_tenant_type_sent_idx
  ON public.reminder_log (tenant_id, reminder_type, sent_at DESC);
