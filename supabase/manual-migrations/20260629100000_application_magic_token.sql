-- APPLY MANUALLY auf Backend-DB.
-- Magic-Link-Token für Bewerber, die nach Calendly-Buchung ins KI-Interview
-- geleitet werden. Token läuft nach 14 Tagen ab.

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS magic_token text UNIQUE,
  ADD COLUMN IF NOT EXISTS magic_token_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS applications_magic_token_idx
  ON public.applications(magic_token)
  WHERE magic_token IS NOT NULL;

-- SECURITY DEFINER RPC für Token-Lookup (öffentlich aufrufbar von /bewerbung).
-- Liefert nur sehr begrenzte Felder, niemals Passwörter o.ä.
CREATE OR REPLACE FUNCTION public.get_application_by_magic_token(_token text)
RETURNS TABLE(application_id uuid, tenant_id uuid, status text, full_name text, email text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, tenant_id, status, full_name, email
  FROM public.applications
  WHERE magic_token = _token
    AND (magic_token_expires_at IS NULL OR magic_token_expires_at > now())
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_application_by_magic_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_application_by_magic_token(text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
