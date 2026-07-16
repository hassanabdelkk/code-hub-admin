-- APPLY MANUALLY via: bash scripts/migrate.sh
-- Erlaubt im Admin-Logs-Modal die fertig gerenderte HTML-Mail anzuzeigen.
-- Wird beim Versand befüllt; ältere Logs bleiben NULL (Vorschau zeigt dann
-- Hinweis "kein HTML gespeichert").

ALTER TABLE public.email_send_log
  ADD COLUMN IF NOT EXISTS rendered_subject text,
  ADD COLUMN IF NOT EXISTS rendered_html    text,
  ADD COLUMN IF NOT EXISTS sender_email     text,
  ADD COLUMN IF NOT EXISTS tenant_id        uuid REFERENCES public.tenants(id);

COMMENT ON COLUMN public.email_send_log.rendered_html IS
  'Fertig gerendertes HTML wie es der Empfänger sieht. Optional, von neueren Sends befüllt.';
