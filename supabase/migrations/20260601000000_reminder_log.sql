-- Reminder-Log für automatische Erinnerungs-Mails
-- Tracked pro E-Mail + Typ, max. 5 Versuche, mind. 3 Tage Abstand

CREATE TABLE IF NOT EXISTS public.reminder_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  reminder_type text NOT NULL CHECK (reminder_type IN ('invite','confirm_email','complete_registration')),
  attempt int NOT NULL CHECK (attempt BETWEEN 1 AND 5),
  sent_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','failed','skipped')),
  error text
);

CREATE INDEX IF NOT EXISTS reminder_log_email_type_idx
  ON public.reminder_log (email, reminder_type, sent_at DESC);

GRANT SELECT, INSERT ON public.reminder_log TO service_role;

ALTER TABLE public.reminder_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full access on reminder_log"
  ON public.reminder_log FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "admins read reminder_log"
  ON public.reminder_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

GRANT SELECT ON public.reminder_log TO authenticated;
