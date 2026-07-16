-- APPLY MANUALLY via: bash scripts/migrate.sh
-- Calendly "Group"-Events: mehrere Invitees teilen sich dieselbe event_uri.
-- Daher UNIQUE auf calendly_event_uri entfernen und stattdessen ein
-- zusammengesetztes UNIQUE auf (event_uri, invitee_uri) setzen, damit jeder
-- Invitee eindeutig bleibt, aber mehrere Invitees pro Event erlaubt sind.

-- 1) Alte UNIQUE-Constraint entfernen (Name wurde von Postgres automatisch vergeben).
DO $$
DECLARE
  c text;
BEGIN
  SELECT conname INTO c
  FROM pg_constraint
  WHERE conrelid = 'public.applications'::regclass
    AND contype = 'u'
    AND pg_get_constraintdef(oid) ILIKE '%(calendly_event_uri)%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.applications DROP CONSTRAINT %I', c);
  END IF;
END $$;

-- 2) Lookup-Index für Webhook-Matching.
CREATE INDEX IF NOT EXISTS idx_applications_calendly_event_uri
  ON public.applications(calendly_event_uri)
  WHERE calendly_event_uri IS NOT NULL;

-- 3) Pro Invitee eindeutig (verhindert Doppel-Verarbeitung desselben Webhooks).
CREATE UNIQUE INDEX IF NOT EXISTS applications_calendly_invitee_uidx
  ON public.applications(calendly_invitee_uri)
  WHERE calendly_invitee_uri IS NOT NULL;
