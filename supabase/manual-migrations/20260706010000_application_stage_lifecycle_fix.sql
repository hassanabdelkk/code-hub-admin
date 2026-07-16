-- Hotfix zu 20260706000000_application_stage_lifecycle.sql
-- profiles hat keine email-Spalte -> stattdessen auth.users.email via user_id joinen.

-- 1) Trigger-Funktion neu: email aus auth.users holen
CREATE OR REPLACE FUNCTION public._profiles_advance_application_stage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _app_id uuid;
  _target text;
  _email  text;
BEGIN
  SELECT u.email INTO _email FROM auth.users u WHERE u.id = NEW.user_id;
  IF _email IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.onboarding_status = 'abgeschlossen' THEN
    _target := 'fasttrack_abgeschlossen';
  ELSIF NEW.onboarding_status = 'in_bearbeitung' THEN
    _target := 'fasttrack_onboarding';
  ELSE
    _target := 'fasttrack_registriert';
  END IF;

  SELECT id INTO _app_id
    FROM public.applications
   WHERE lower(email) = lower(_email)
     AND (tenant_id IS NULL OR NEW.tenant_id IS NULL OR tenant_id = NEW.tenant_id)
   ORDER BY created_at DESC
   LIMIT 1;

  IF _app_id IS NOT NULL THEN
    PERFORM public.advance_application_stage(_app_id, _target, NEW.user_id, 'auto: profile change');
  END IF;

  RETURN NEW;
END;
$$;

-- 2) Trigger neu binden (ohne OF email, da diese Spalte nicht existiert)
DROP TRIGGER IF EXISTS trg_profiles_advance_stage ON public.profiles;
CREATE TRIGGER trg_profiles_advance_stage
  AFTER INSERT OR UPDATE OF onboarding_status ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public._profiles_advance_application_stage();

-- 3) Backfill Stufe 2 über auth.users
UPDATE public.applications a SET stage = 'fasttrack_registriert'
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.user_id
 WHERE lower(a.email) = lower(u.email)
   AND a.stage IN ('vermittlung_neu','vermittlung_zusage')
   AND a.flow_type = 'fast';

UPDATE public.applications a SET stage = 'fasttrack_abgeschlossen'
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.user_id
 WHERE lower(a.email) = lower(u.email)
   AND p.onboarding_status = 'abgeschlossen'
   AND a.stage NOT IN ('fasttrack_angenommen','abgelehnt','cold');
