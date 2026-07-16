-- APPLY MANUALLY via: bash scripts/migrate.sh  (oder im Supabase SQL Editor)
-- Recovery-Mail aufsplitten in zwei Templates: Mitarbeiter vs. akzeptierte Bewerber.
-- Die bestehenden reminder_recovery_subject/body werden weiter für Mitarbeiter genutzt.
-- Neue Spalten gelten für Bewerber (kind = 'bewerber_akzeptiert').

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS reminder_recovery_bewerber_subject text,
  ADD COLUMN IF NOT EXISTS reminder_recovery_bewerber_body    text;

COMMENT ON COLUMN public.tenants.reminder_recovery_bewerber_subject IS
  'Betreff für Domain-Wechsel-Mail an akzeptierte Bewerber. NULL = Default.';
COMMENT ON COLUMN public.tenants.reminder_recovery_bewerber_body IS
  'HTML-Body für Domain-Wechsel-Mail an akzeptierte Bewerber. Platzhalter: {{first_name}}, {{portal_link}}, {{tenant_name}}. NULL = Default.';
