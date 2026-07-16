-- APPLY MANUALLY via: bash scripts/migrate.sh
-- Erlaubt individuelle Arbeitsverträge auch für Bewerber, die noch kein
-- Benutzerkonto haben. Der Override wird per email + application_id
-- gespeichert. Sobald sich der Bewerber registriert, übernimmt ein Trigger
-- den Override automatisch (setzt user_id, leert email).

-- 1) user_id darf NULL sein (für Bewerber ohne Konto).
ALTER TABLE public.employee_contract_overrides
  ALTER COLUMN user_id DROP NOT NULL;

-- 2) Bestehende UNIQUE(user_id) durch partial unique index ersetzen,
--    damit mehrere Bewerber-Einträge (user_id IS NULL) koexistieren können.
ALTER TABLE public.employee_contract_overrides
  DROP CONSTRAINT IF EXISTS employee_contract_overrides_user_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS employee_contract_overrides_user_uidx
  ON public.employee_contract_overrides(user_id)
  WHERE user_id IS NOT NULL;

-- 3) Neue Felder für Bewerber.
ALTER TABLE public.employee_contract_overrides
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS application_id uuid REFERENCES public.applications(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS employee_contract_overrides_email_uidx
  ON public.employee_contract_overrides(lower(email))
  WHERE user_id IS NULL AND email IS NOT NULL;

-- 4) Zielzeile muss irgendwie identifizierbar sein.
ALTER TABLE public.employee_contract_overrides
  DROP CONSTRAINT IF EXISTS employee_contract_overrides_target;
ALTER TABLE public.employee_contract_overrides
  ADD CONSTRAINT employee_contract_overrides_target
  CHECK (user_id IS NOT NULL OR email IS NOT NULL);

-- 5) Trigger: sobald ein neuer auth-User mit passender E-Mail entsteht,
--    Override automatisch zuordnen.
CREATE OR REPLACE FUNCTION public.claim_contract_overrides_for_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS NULL THEN
    RETURN NEW;
  END IF;
  UPDATE public.employee_contract_overrides
  SET user_id = NEW.id,
      email = NULL,
      updated_at = now()
  WHERE user_id IS NULL
    AND email IS NOT NULL
    AND lower(email) = lower(NEW.email);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS claim_contract_overrides_on_signup ON auth.users;
CREATE TRIGGER claim_contract_overrides_on_signup
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.claim_contract_overrides_for_user();

-- Falls bereits Profile mit passender E-Mail existieren, retro-claimen.
UPDATE public.employee_contract_overrides o
SET user_id = u.id, email = NULL, updated_at = now()
FROM auth.users u
WHERE o.user_id IS NULL
  AND o.email IS NOT NULL
  AND lower(o.email) = lower(u.email);
