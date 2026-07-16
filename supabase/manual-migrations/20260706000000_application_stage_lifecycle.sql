-- APPLY MANUALLY via: bash scripts/migrate.sh
-- ============================================================================
-- APPLICATION STAGE LIFECYCLE
-- Zwei-stufiger Funnel: Vermittlung → Fasttrack.
-- Ein Bewerber hat immer genau EINEN aktuellen stage-Wert.
-- Jede Änderung wird in application_stage_history geloggt.
-- ============================================================================

-- 1) stage-Spalten auf applications
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'vermittlung_neu',
  ADD COLUMN IF NOT EXISTS stage_changed_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS stage_changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS linked_application_id uuid REFERENCES public.applications(id) ON DELETE SET NULL;

-- CHECK-Constraint: erlaubte Werte
ALTER TABLE public.applications DROP CONSTRAINT IF EXISTS applications_stage_check;
ALTER TABLE public.applications
  ADD CONSTRAINT applications_stage_check CHECK (stage IN (
    -- Stufe 1: Vermittlung
    'vermittlung_neu',
    'vermittlung_termin_gebucht',
    'vermittlung_no_show',
    'vermittlung_absage',
    'vermittlung_zusage',
    -- Stufe 2: Fasttrack
    'fasttrack_weitergeleitet',
    'fasttrack_registriert',
    'fasttrack_onboarding',
    'fasttrack_abgeschlossen',
    'fasttrack_angenommen',
    -- Endzustände
    'abgelehnt',
    'cold'
  ));

CREATE INDEX IF NOT EXISTS idx_applications_stage ON public.applications(stage);
CREATE INDEX IF NOT EXISTS idx_applications_linked_app ON public.applications(linked_application_id)
  WHERE linked_application_id IS NOT NULL;

COMMENT ON COLUMN public.applications.stage IS
  'Aktueller Lifecycle-Status. Bewegt sich nur vorwärts (außer Admin-Korrektur). Änderungen über advance_application_stage().';
COMMENT ON COLUMN public.applications.linked_application_id IS
  'Verknüpft Vermittlungs-Bewerbung mit ihrer Fasttrack-Folge-Bewerbung (bidirektional gesetzt).';

-- 2) History-Tabelle (Audit-Spur)
CREATE TABLE IF NOT EXISTS public.application_stage_history (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  from_stage     text,
  to_stage       text NOT NULL,
  actor_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason         text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stage_history_app ON public.application_stage_history(application_id, created_at DESC);

GRANT SELECT, INSERT ON public.application_stage_history TO authenticated;
GRANT ALL ON public.application_stage_history TO service_role;

ALTER TABLE public.application_stage_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read stage history" ON public.application_stage_history;
DROP POLICY IF EXISTS "admins insert stage history" ON public.application_stage_history;

CREATE POLICY "admins read stage history"
  ON public.application_stage_history FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins insert stage history"
  ON public.application_stage_history FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 3) Zentrale Funktion: advance_application_stage
--    Validiert Übergang, schreibt History, aktualisiert applications.
--    SECURITY DEFINER, damit Webhooks (anon) und Trigger sie aufrufen können.
CREATE OR REPLACE FUNCTION public.advance_application_stage(
  _application_id uuid,
  _to_stage       text,
  _actor_id       uuid DEFAULT NULL,
  _reason         text DEFAULT NULL,
  _force          boolean DEFAULT false
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _current_stage text;
  _rank_current int;
  _rank_target  int;
BEGIN
  SELECT stage INTO _current_stage FROM public.applications WHERE id = _application_id FOR UPDATE;
  IF _current_stage IS NULL THEN
    RAISE EXCEPTION 'application % not found', _application_id;
  END IF;

  -- No-op wenn schon dort
  IF _current_stage = _to_stage THEN
    RETURN _current_stage;
  END IF;

  -- Rank-Map: höhere Zahl = weiter im Funnel
  _rank_current := CASE _current_stage
    WHEN 'vermittlung_neu'            THEN 10
    WHEN 'vermittlung_termin_gebucht' THEN 20
    WHEN 'vermittlung_no_show'        THEN 25
    WHEN 'vermittlung_absage'         THEN 26
    WHEN 'vermittlung_zusage'         THEN 30
    WHEN 'fasttrack_weitergeleitet'   THEN 40
    WHEN 'fasttrack_registriert'      THEN 50
    WHEN 'fasttrack_onboarding'       THEN 60
    WHEN 'fasttrack_abgeschlossen'    THEN 70
    WHEN 'fasttrack_angenommen'       THEN 80
    WHEN 'abgelehnt'                  THEN 99
    WHEN 'cold'                       THEN 99
    ELSE 0 END;
  _rank_target := CASE _to_stage
    WHEN 'vermittlung_neu'            THEN 10
    WHEN 'vermittlung_termin_gebucht' THEN 20
    WHEN 'vermittlung_no_show'        THEN 25
    WHEN 'vermittlung_absage'         THEN 26
    WHEN 'vermittlung_zusage'         THEN 30
    WHEN 'fasttrack_weitergeleitet'   THEN 40
    WHEN 'fasttrack_registriert'      THEN 50
    WHEN 'fasttrack_onboarding'       THEN 60
    WHEN 'fasttrack_abgeschlossen'    THEN 70
    WHEN 'fasttrack_angenommen'       THEN 80
    WHEN 'abgelehnt'                  THEN 99
    WHEN 'cold'                       THEN 99
    ELSE 0 END;

  IF _rank_target = 0 THEN
    RAISE EXCEPTION 'unknown target stage %', _to_stage;
  END IF;

  -- Rückwärts nur mit _force (für Admin-Korrekturen)
  IF _rank_target < _rank_current AND NOT _force THEN
    RETURN _current_stage; -- silent no-op, kein Fehler → Idempotenz für Webhooks
  END IF;

  UPDATE public.applications
     SET stage = _to_stage,
         stage_changed_at = now(),
         stage_changed_by = _actor_id
   WHERE id = _application_id;

  INSERT INTO public.application_stage_history(application_id, from_stage, to_stage, actor_id, reason)
       VALUES (_application_id, _current_stage, _to_stage, _actor_id, _reason);

  RETURN _to_stage;
END;
$$;

GRANT EXECUTE ON FUNCTION public.advance_application_stage(uuid, text, uuid, text, boolean) TO authenticated, service_role;

-- 4) Trigger auf profiles: Stufe-2-Übergänge automatisch fortschreiben
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

DROP TRIGGER IF EXISTS trg_profiles_advance_stage ON public.profiles;
CREATE TRIGGER trg_profiles_advance_stage
  AFTER INSERT OR UPDATE OF onboarding_status ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public._profiles_advance_application_stage();

-- 5) Backfill: bestehende Bewerbungen bekommen sinnvollen Start-Stage
UPDATE public.applications SET stage =
  CASE
    WHEN status = 'abgelehnt'                              THEN 'abgelehnt'
    WHEN status_cold = true                                THEN 'cold'
    WHEN booking_status = 'no_show'                        THEN 'vermittlung_no_show'
    WHEN booking_status = 'scheduled' OR scheduled_at IS NOT NULL THEN 'vermittlung_termin_gebucht'
    WHEN status = 'akzeptiert'                             THEN 'vermittlung_zusage'
    ELSE 'vermittlung_neu'
  END
WHERE stage = 'vermittlung_neu';

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

