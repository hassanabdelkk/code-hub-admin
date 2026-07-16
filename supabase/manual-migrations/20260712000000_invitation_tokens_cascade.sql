-- APPLY MANUALLY via: bash scripts/migrate.sh
-- Fix: Bewerbungen mit erteilter Zusage konnten nicht gelöscht werden,
-- weil invitation_tokens.application_id ohne ON DELETE-Klausel auf
-- applications(id) verwies (Default = NO ACTION → FK blockiert DELETE).
--
-- Lösung: FK auf ON DELETE CASCADE umstellen. Die Tokens gehören
-- logisch zur Bewerbung und sollen mit ihr entfernt werden.

DO $$
DECLARE
  c text;
BEGIN
  SELECT conname INTO c
  FROM pg_constraint
  WHERE conrelid = 'public.invitation_tokens'::regclass
    AND contype = 'f'
    AND pg_get_constraintdef(oid) ILIKE '%applications(id)%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.invitation_tokens DROP CONSTRAINT %I', c);
  END IF;
END $$;

ALTER TABLE public.invitation_tokens
  ADD CONSTRAINT invitation_tokens_application_id_fkey
  FOREIGN KEY (application_id)
  REFERENCES public.applications(id)
  ON DELETE CASCADE;
