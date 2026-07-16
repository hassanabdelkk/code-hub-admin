-- ============================================================================
-- 30-MIN APPOINTMENT REMINDER
-- - 2 neue Spalten auf tenants für Subject/Body Template
-- - neue Tabelle appointment_reminder_log (Idempotenz pro Booking)
-- - Cron-Job alle 10 Min ist NICHT enthalten: triggert wie die anderen
--   Reminder per externer Cron auf die Edge-Function send-appointment-reminders
--   (Auth: x-cron-secret header ODER ?key=<CRON_SECRET>).
-- ============================================================================

-- 1) Tenant-Spalten für Template
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS reminder_appointment_subject text,
  ADD COLUMN IF NOT EXISTS reminder_appointment_body    text;

COMMENT ON COLUMN public.tenants.reminder_appointment_subject IS
  '30-Min-vor-Termin Reminder — E-Mail Betreff. NULL = Default aus Edge-Function.';
COMMENT ON COLUMN public.tenants.reminder_appointment_body IS
  '30-Min-vor-Termin Reminder — E-Mail Body. Platzhalter: {{first_name}}, {{appointment_date}}, {{appointment_time}}, {{tenant_name}}, {{portal_link}}.';

-- 2) Idempotenz-Tabelle: pro Booking max. 1 Reminder
CREATE TABLE IF NOT EXISTS public.appointment_reminder_log (
  booking_id      uuid PRIMARY KEY REFERENCES public.bookings(id) ON DELETE CASCADE,
  tenant_id       uuid NOT NULL,
  recipient_email text NOT NULL,
  sent_at         timestamptz NOT NULL DEFAULT now(),
  status          text NOT NULL DEFAULT 'sent', -- 'sent' | 'failed' | 'skipped'
  error           text
);

CREATE INDEX IF NOT EXISTS idx_appointment_reminder_log_tenant
  ON public.appointment_reminder_log(tenant_id, sent_at DESC);

GRANT SELECT ON public.appointment_reminder_log TO authenticated;
GRANT ALL    ON public.appointment_reminder_log TO service_role;

ALTER TABLE public.appointment_reminder_log ENABLE ROW LEVEL SECURITY;

-- Admins / Service-Role lesen alles; normale User sehen nichts (kein Need-to-Know)
DROP POLICY IF EXISTS "appointment_reminder_log_admin_read" ON public.appointment_reminder_log;
CREATE POLICY "appointment_reminder_log_admin_read"
  ON public.appointment_reminder_log
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
    )
  );
