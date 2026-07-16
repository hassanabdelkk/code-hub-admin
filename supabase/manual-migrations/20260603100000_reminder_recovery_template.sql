-- APPLY MANUALLY via: bash scripts/migrate.sh  (oder im Supabase SQL Editor)
-- Editierbares Template für die Domain-Wechsel-Mail (domain_recovery)
-- pro Tenant. NULL = Default-Template aus der Edge-Function.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS reminder_recovery_subject text,
  ADD COLUMN IF NOT EXISTS reminder_recovery_body    text;

COMMENT ON COLUMN public.tenants.reminder_recovery_subject IS
  'Betreff für Domain-Wechsel-Mail (domain_recovery). NULL = Default.';
COMMENT ON COLUMN public.tenants.reminder_recovery_body IS
  'HTML-Body für Domain-Wechsel-Mail. Platzhalter wie {{first_name}}, {{portal_link}}, {{company_name}}. NULL = Default.';
