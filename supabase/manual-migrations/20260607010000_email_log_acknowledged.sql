-- APPLY MANUALLY via: bash scripts/migrate.sh
-- Acknowledgment für fehlgeschlagene E-Mails:
-- Der "Aktion erforderlich"-Banner auf /admin/email-logs zählt nur Fails,
-- die noch nicht abgehakt wurden. Admin kann per Klick alles als bearbeitet
-- markieren — die Einträge bleiben in der Tabelle, fallen aber aus dem Banner.

ALTER TABLE public.email_send_log
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS acknowledged_by uuid REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS email_send_log_unack_failed_idx
  ON public.email_send_log (created_at DESC)
  WHERE acknowledged_at IS NULL AND status IN ('failed', 'dlq', 'bounced');

COMMENT ON COLUMN public.email_send_log.acknowledged_at IS
  'Wenn gesetzt: Admin hat den Fehler gesehen. Eintrag fällt aus dem "Aktion erforderlich"-Banner, bleibt aber im Log sichtbar.';
