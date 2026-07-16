-- Idempotenz-Anker für Domain-Recovery-Mails.
-- Bei einem Wechsel der Primary-Domain wird die Spalte auf now() gesetzt;
-- die Recovery-Edge-Function gilt als „bereits versendet" nur, wenn ein
-- reminder_log-Eintrag mit reminder_type='domain_recovery' nach diesem
-- Timestamp existiert.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS primary_domain_changed_at timestamptz;
