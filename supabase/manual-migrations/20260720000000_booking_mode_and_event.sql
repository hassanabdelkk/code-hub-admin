-- Booking-Mode + Event-Metadaten pro Landing Page.
-- 'calendly' (Default = bestehendes Verhalten), 'internal' = eigenes System.
-- Vermittlungs-Pages brauchen IMMER einen Modus (kein 'off').

DO $$ BEGIN
  CREATE TYPE public.landing_booking_mode AS ENUM ('calendly', 'internal');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.landing_pages
  ADD COLUMN IF NOT EXISTS booking_mode public.landing_booking_mode NOT NULL DEFAULT 'calendly',
  ADD COLUMN IF NOT EXISTS event_description text,
  ADD COLUMN IF NOT EXISTS booking_window_days integer NOT NULL DEFAULT 30
    CHECK (booking_window_days BETWEEN 1 AND 180);


-- get_schedule_for_application: nur Landings mit booking_mode='internal' liefern einen Kalender.
-- Signatur kompatibel zu 20260719 (RETURNS TABLE + Parameter _magic_token) + Event-Felder.
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
  landing_page_id uuid,
  event_description text,
  booking_window_days int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH app_row AS (
    SELECT a.*, lp_src.linked_fasttrack_landing_id AS src_linked
      FROM public.applications a
      LEFT JOIN public.landing_pages lp_src ON lp_src.id = a.source_landing_id
     WHERE a.magic_token = _magic_token
       AND (a.magic_token_expires_at IS NULL OR a.magic_token_expires_at > now())
     LIMIT 1
  ),
  candidates AS (
    SELECT target_landing_id AS lp_id, 1 AS prio FROM app_row WHERE target_landing_id IS NOT NULL
    UNION ALL
    SELECT src_linked, 2 FROM app_row WHERE src_linked IS NOT NULL
    UNION ALL
    SELECT source_landing_id, 3 FROM app_row WHERE source_landing_id IS NOT NULL
  ),
  pick AS (
    SELECT c.lp_id, s.id AS schedule_id, s.slot_duration_minutes, s.timezone,
           s.max_days_ahead, s.min_notice_hours
      FROM candidates c
      JOIN public.landing_pages lp ON lp.id = c.lp_id
      JOIN public.availability_schedules s
        ON s.landing_page_id = lp.id AND s.active = true
     WHERE lp.booking_mode = 'internal'
     ORDER BY c.prio
     LIMIT 1
  )
  SELECT p.schedule_id,
         p.slot_duration_minutes,
         p.timezone,
         p.max_days_ahead,
         p.min_notice_hours,
         t.name,
         split_part(app.full_name, ' ', 1),
         app.email,
         COALESCE(lp.recruiter_name, 'Ihr Ansprechpartner'),
         lp.id,
         lp.event_description,
         lp.booking_window_days
    FROM app_row app
    LEFT JOIN pick p ON true
    LEFT JOIN public.landing_pages lp ON lp.id = p.lp_id
    LEFT JOIN public.tenants t ON t.id = app.tenant_id
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_schedule_for_application(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_schedule_for_application(text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
