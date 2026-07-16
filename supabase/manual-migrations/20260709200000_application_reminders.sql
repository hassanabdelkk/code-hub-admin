-- APPLY MANUALLY via: bash scripts/migrate.sh (oder docker exec -i supabase-db psql -U postgres -d postgres < diese.sql)
--
-- Zwei neue Reminder für Bewerber (Vermittlungs-/Broker-Flow):
--   1) application_no_booking   – Bewerbung eingegangen, aber kein Calendly-Termin (24h + 72h)
--   2) application_no_show      – Termin gebucht, aber nicht wahrgenommen (24h nach starts_at)
--
-- Idempotenz via application_reminder_log(application_id, reminder_kind, attempt) unique.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS reminder_app_no_booking_subject text,
  ADD COLUMN IF NOT EXISTS reminder_app_no_booking_body    text,
  ADD COLUMN IF NOT EXISTS reminder_app_no_show_subject    text,
  ADD COLUMN IF NOT EXISTS reminder_app_no_show_body       text;

COMMENT ON COLUMN public.tenants.reminder_app_no_booking_subject IS
  'Betreff: Bewerbung ohne gebuchten Termin (Vermittlung/Broker).';
COMMENT ON COLUMN public.tenants.reminder_app_no_show_subject IS
  'Betreff: Bewerber hat gebuchten Interview-Termin nicht wahrgenommen (24h Nachfass).';

CREATE TABLE IF NOT EXISTS public.application_reminder_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  uuid NOT NULL,
  tenant_id       uuid,
  reminder_kind   text NOT NULL CHECK (reminder_kind IN ('no_booking_24h','no_booking_72h','no_show_24h')),
  recipient_email text NOT NULL,
  status          text NOT NULL CHECK (status IN ('sent','failed','skipped')),
  error           text,
  sent_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id, reminder_kind)
);

GRANT SELECT ON public.application_reminder_log TO authenticated;
GRANT ALL    ON public.application_reminder_log TO service_role;

ALTER TABLE public.application_reminder_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read application_reminder_log" ON public.application_reminder_log;
CREATE POLICY "Admins read application_reminder_log"
  ON public.application_reminder_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS application_reminder_log_app_idx
  ON public.application_reminder_log (application_id, reminder_kind);

NOTIFY pgrst, 'reload schema';
