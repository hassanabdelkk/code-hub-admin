-- APPLY MANUALLY on Backend 123:
-- docker exec -i supabase-db psql -U postgres -d postgres < supabase/manual-migrations/20260719000000_booking_schedule_priority.sql
-- ============================================================================
-- Eigenes Buchungssystem: Schedule-Priorität für Vermittlungs-/Fasttrack-Flows
-- - Erst Ziel-/Fasttrack-Landing prüfen
-- - Dann Source-/Vermittlungs-Landing als Fallback
-- Verhindert, dass Bewerber trotz aktivem eigenem Kalender bei Calendly landen
-- oder der Buchungslink "no_schedule" zeigt.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.book_appointment_by_token(
  _magic_token text,
  _starts_at   timestamptz,
  _applicant_timezone text DEFAULT NULL
) RETURNS TABLE(appointment_id uuid, cancel_token uuid, starts_at timestamptz, ends_at timestamptz, error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  app          public.applications%ROWTYPE;
  sch          public.availability_schedules%ROWTYPE;
  ends_at_v    timestamptz;
  new_id       uuid;
  new_token    uuid;
  existing_id  uuid;
BEGIN
  SELECT * INTO app
    FROM public.applications
   WHERE magic_token = _magic_token
     AND (magic_token_expires_at IS NULL OR magic_token_expires_at > now())
   LIMIT 1;
  IF NOT FOUND THEN
    appointment_id := NULL; cancel_token := NULL; starts_at := NULL; ends_at := NULL;
    error := 'application_not_found'; RETURN NEXT; RETURN;
  END IF;

  SELECT s.* INTO sch
    FROM (
      SELECT 1 AS ord, app.target_landing_id AS landing_page_id WHERE app.target_landing_id IS NOT NULL
      UNION ALL
      SELECT 2 AS ord, app.source_landing_id AS landing_page_id WHERE app.source_landing_id IS NOT NULL
    ) candidates
    JOIN public.availability_schedules s
      ON s.landing_page_id = candidates.landing_page_id
     AND s.active
   ORDER BY candidates.ord
   LIMIT 1;
  IF NOT FOUND THEN
    error := 'no_schedule_configured'; RETURN NEXT; RETURN;
  END IF;

  ends_at_v := _starts_at + make_interval(mins => sch.slot_duration_minutes);

  SELECT id INTO existing_id
    FROM public.interview_appointments
   WHERE application_id = app.id AND status = 'scheduled'
   LIMIT 1;
  IF existing_id IS NOT NULL THEN
    error := 'already_scheduled'; RETURN NEXT; RETURN;
  END IF;

  BEGIN
    INSERT INTO public.interview_appointments
      (tenant_id, application_id, schedule_id, starts_at, ends_at, applicant_timezone)
    VALUES
      (app.tenant_id, app.id, sch.id, _starts_at, ends_at_v, _applicant_timezone)
    RETURNING id, cancel_token INTO new_id, new_token;
  EXCEPTION WHEN exclusion_violation THEN
    error := 'slot_taken'; RETURN NEXT; RETURN;
  END;

  UPDATE public.applications
     SET booking_status = 'scheduled',
         scheduled_at   = _starts_at,
         updated_at     = now()
   WHERE id = app.id;

  appointment_id := new_id;
  cancel_token   := new_token;
  starts_at      := _starts_at;
  ends_at        := ends_at_v;
  error          := NULL;
  RETURN NEXT;
END $$;

REVOKE ALL ON FUNCTION public.book_appointment_by_token(text, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.book_appointment_by_token(text, timestamptz, text)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_schedule_for_application(_magic_token text)
RETURNS TABLE(
  schedule_id uuid,
  slot_duration_minutes int,
  timezone text,
  max_days_ahead int,
  min_notice_hours int,
  tenant_name text,
  applicant_first_name text,
  applicant_email text,
  recruiter_name text,
  landing_page_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH app_row AS (
    SELECT *
      FROM public.applications app
     WHERE app.magic_token = _magic_token
       AND (app.magic_token_expires_at IS NULL OR app.magic_token_expires_at > now())
     LIMIT 1
  ),
  candidate_landings AS (
    SELECT 1 AS ord, target_landing_id AS landing_page_id FROM app_row WHERE target_landing_id IS NOT NULL
    UNION ALL
    SELECT 2 AS ord, source_landing_id AS landing_page_id FROM app_row WHERE source_landing_id IS NOT NULL
  ),
  schedule_pick AS (
    SELECT cl.landing_page_id, s.id, s.slot_duration_minutes, s.timezone, s.max_days_ahead, s.min_notice_hours
      FROM candidate_landings cl
      JOIN public.availability_schedules s
        ON s.landing_page_id = cl.landing_page_id
       AND s.active
     ORDER BY cl.ord
     LIMIT 1
  ),
  landing_pick AS (
    SELECT COALESCE(
      (SELECT landing_page_id FROM schedule_pick),
      (SELECT target_landing_id FROM app_row),
      (SELECT source_landing_id FROM app_row)
    ) AS landing_page_id
  )
  SELECT sp.id,
         sp.slot_duration_minutes,
         sp.timezone,
         sp.max_days_ahead,
         sp.min_notice_hours,
         t.name,
         split_part(app.full_name, ' ', 1),
         app.email,
         COALESCE(lp.recruiter_name, 'Ihr Ansprechpartner'),
         lp.id
    FROM app_row app
    LEFT JOIN landing_pick pick ON true
    LEFT JOIN public.landing_pages lp ON lp.id = pick.landing_page_id
    LEFT JOIN schedule_pick sp ON true
    LEFT JOIN public.tenants t ON t.id = app.tenant_id
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_schedule_for_application(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_schedule_for_application(text)
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';