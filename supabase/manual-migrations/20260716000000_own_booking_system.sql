-- APPLY MANUALLY: bash scripts/migrate.sh (oder docker exec -i supabase-db psql -U postgres -d postgres < diese.sql)
-- ============================================================================
-- EIGENES BUCHUNGSSYSTEM (Calendly-Ersatz)
-- - availability_schedules: pro Landing-Page 1 Kalender
-- - availability_rules: Wochentag-Regeln (mehrere Zeitfenster pro Tag möglich)
-- - availability_exceptions: pro Datum blocken oder Extra-Fenster
-- - interview_appointments: konkrete Buchungen mit Cancel-Token
-- - RPC get_free_appointment_slots(): freie Slots berechnen (SECURITY DEFINER)
-- - RPC book_appointment_by_token(): atomar buchen mit Race-Condition-Schutz
-- - RPC cancel_appointment_by_token(): stornieren + booking_status Update
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------------
-- 1) Schedules pro Landing-Page
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.availability_schedules (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  landing_page_id          uuid REFERENCES public.landing_pages(id) ON DELETE CASCADE,
  name                     text NOT NULL DEFAULT 'Standard-Kalender',
  timezone                 text NOT NULL DEFAULT 'Europe/Berlin',
  slot_duration_minutes    int  NOT NULL DEFAULT 30 CHECK (slot_duration_minutes BETWEEN 5 AND 240),
  buffer_before_minutes    int  NOT NULL DEFAULT 0  CHECK (buffer_before_minutes BETWEEN 0 AND 120),
  buffer_after_minutes     int  NOT NULL DEFAULT 0  CHECK (buffer_after_minutes  BETWEEN 0 AND 120),
  min_notice_hours         int  NOT NULL DEFAULT 4  CHECK (min_notice_hours BETWEEN 0 AND 168),
  max_days_ahead           int  NOT NULL DEFAULT 21 CHECK (max_days_ahead BETWEEN 1 AND 180),
  active                   boolean NOT NULL DEFAULT true,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS availability_schedules_landing_uidx
  ON public.availability_schedules(landing_page_id)
  WHERE landing_page_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS availability_schedules_tenant_idx
  ON public.availability_schedules(tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.availability_schedules TO authenticated;
GRANT ALL ON public.availability_schedules TO service_role;
ALTER TABLE public.availability_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins manage schedules" ON public.availability_schedules;
CREATE POLICY "admins manage schedules" ON public.availability_schedules
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------------------
-- 2) Wochenraster-Regeln
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.availability_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id   uuid NOT NULL REFERENCES public.availability_schedules(id) ON DELETE CASCADE,
  weekday       int  NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- 0=Sonntag, 1=Montag, ...
  start_time    time NOT NULL,
  end_time      time NOT NULL,
  CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS availability_rules_schedule_idx
  ON public.availability_rules(schedule_id, weekday);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.availability_rules TO authenticated;
GRANT ALL ON public.availability_rules TO service_role;
ALTER TABLE public.availability_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins manage rules" ON public.availability_rules;
CREATE POLICY "admins manage rules" ON public.availability_rules
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------------------
-- 3) Ausnahmen (Urlaub / Extra-Slots)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.availability_exceptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id   uuid NOT NULL REFERENCES public.availability_schedules(id) ON DELETE CASCADE,
  exception_date date NOT NULL,
  is_blocked    boolean NOT NULL DEFAULT true, -- true = kompletter Tag blocken; false = Extra-Fenster
  start_time    time,
  end_time      time,
  note          text,
  CHECK (
    (is_blocked = true) OR (start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time)
  )
);

CREATE INDEX IF NOT EXISTS availability_exceptions_schedule_date_idx
  ON public.availability_exceptions(schedule_id, exception_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.availability_exceptions TO authenticated;
GRANT ALL ON public.availability_exceptions TO service_role;
ALTER TABLE public.availability_exceptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins manage exceptions" ON public.availability_exceptions;
CREATE POLICY "admins manage exceptions" ON public.availability_exceptions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------------------
-- 4) Buchungen (interview_appointments)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.interview_appointments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  application_id        uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  schedule_id           uuid NOT NULL REFERENCES public.availability_schedules(id) ON DELETE RESTRICT,
  starts_at             timestamptz NOT NULL,
  ends_at               timestamptz NOT NULL,
  applicant_timezone    text,
  status                text NOT NULL DEFAULT 'scheduled'
                        CHECK (status IN ('scheduled','cancelled','no_show','completed')),
  cancel_token          uuid NOT NULL DEFAULT gen_random_uuid(),
  cancelled_at          timestamptz,
  cancelled_by          text CHECK (cancelled_by IS NULL OR cancelled_by IN ('applicant','admin','system')),
  cancel_reason         text,
  rescheduled_from_id   uuid REFERENCES public.interview_appointments(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS interview_appointments_cancel_token_uidx
  ON public.interview_appointments(cancel_token);

CREATE INDEX IF NOT EXISTS interview_appointments_app_idx
  ON public.interview_appointments(application_id, status);

CREATE INDEX IF NOT EXISTS interview_appointments_schedule_starts_idx
  ON public.interview_appointments(schedule_id, starts_at)
  WHERE status = 'scheduled';

-- Race-Condition-Schutz: keine überlappenden aktiven Buchungen im selben Kalender
ALTER TABLE public.interview_appointments
  DROP CONSTRAINT IF EXISTS interview_appointments_no_overlap;
ALTER TABLE public.interview_appointments
  ADD CONSTRAINT interview_appointments_no_overlap
  EXCLUDE USING gist (
    schedule_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status = 'scheduled');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.interview_appointments TO authenticated;
GRANT ALL ON public.interview_appointments TO service_role;
ALTER TABLE public.interview_appointments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read appointments" ON public.interview_appointments;
CREATE POLICY "admins read appointments" ON public.interview_appointments
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Trigger für updated_at
CREATE OR REPLACE FUNCTION public._set_updated_at_appointments()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_interview_appointments_updated_at ON public.interview_appointments;
CREATE TRIGGER trg_interview_appointments_updated_at
  BEFORE UPDATE ON public.interview_appointments
  FOR EACH ROW EXECUTE FUNCTION public._set_updated_at_appointments();

DROP TRIGGER IF EXISTS trg_availability_schedules_updated_at ON public.availability_schedules;
CREATE TRIGGER trg_availability_schedules_updated_at
  BEFORE UPDATE ON public.availability_schedules
  FOR EACH ROW EXECUTE FUNCTION public._set_updated_at_appointments();

-- ---------------------------------------------------------------------------
-- 5) RPC: freie Slots berechnen (public via SECURITY DEFINER)
-- ---------------------------------------------------------------------------
-- Nimmt schedule_id + Datumsbereich (in schedule-Zeitzone) und liefert
-- eine Liste freier Slot-Starts als timestamptz.
CREATE OR REPLACE FUNCTION public.get_free_appointment_slots(
  _schedule_id uuid,
  _from_date date,
  _to_date   date
) RETURNS TABLE(slot_start timestamptz, slot_end timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sch      public.availability_schedules%ROWTYPE;
  d        date;
  wday     int;
  rule     record;
  ex       record;
  slot_len interval;
  cursor_t timestamptz;
  end_t    timestamptz;
  window_start timestamptz;
  window_end   timestamptz;
  min_start timestamptz;
  max_end   timestamptz;
  has_extra boolean;
  full_block boolean;
BEGIN
  SELECT * INTO sch FROM public.availability_schedules WHERE id = _schedule_id AND active;
  IF NOT FOUND THEN RETURN; END IF;

  slot_len := make_interval(mins => sch.slot_duration_minutes);
  min_start := now() + make_interval(hours => sch.min_notice_hours);
  max_end   := now() + make_interval(days  => sch.max_days_ahead);

  IF _from_date IS NULL THEN _from_date := (now() AT TIME ZONE sch.timezone)::date; END IF;
  IF _to_date   IS NULL THEN _to_date   := _from_date + sch.max_days_ahead; END IF;

  d := _from_date;
  WHILE d <= _to_date LOOP
    wday := EXTRACT(DOW FROM d)::int;

    -- Ausnahme: kompletter Tag geblockt?
    SELECT bool_or(is_blocked) INTO full_block
      FROM public.availability_exceptions
     WHERE schedule_id = _schedule_id AND exception_date = d AND is_blocked = true;
    IF COALESCE(full_block, false) THEN
      d := d + 1; CONTINUE;
    END IF;

    SELECT EXISTS(
      SELECT 1 FROM public.availability_exceptions
       WHERE schedule_id = _schedule_id AND exception_date = d AND is_blocked = false
    ) INTO has_extra;

    -- Fenster für diesen Tag sammeln: Wochenregel + Extra-Ausnahmen
    FOR rule IN
      SELECT start_time, end_time FROM public.availability_rules
       WHERE schedule_id = _schedule_id AND weekday = wday
      UNION ALL
      SELECT start_time, end_time FROM public.availability_exceptions
       WHERE schedule_id = _schedule_id AND exception_date = d AND is_blocked = false
    LOOP
      window_start := (d + rule.start_time) AT TIME ZONE sch.timezone;
      window_end   := (d + rule.end_time)   AT TIME ZONE sch.timezone;
      cursor_t := window_start;

      WHILE cursor_t + slot_len <= window_end LOOP
        end_t := cursor_t + slot_len;
        IF cursor_t >= min_start AND end_t <= max_end THEN
          -- Konflikt mit existierender Buchung (inkl. Buffer)?
          IF NOT EXISTS (
            SELECT 1 FROM public.interview_appointments a
             WHERE a.schedule_id = _schedule_id
               AND a.status = 'scheduled'
               AND tstzrange(
                     a.starts_at - make_interval(mins => sch.buffer_before_minutes),
                     a.ends_at   + make_interval(mins => sch.buffer_after_minutes),
                     '[)'
                   ) && tstzrange(cursor_t, end_t, '[)')
          ) THEN
            slot_start := cursor_t;
            slot_end := end_t;
            RETURN NEXT;
          END IF;
        END IF;
        cursor_t := cursor_t + slot_len;
      END LOOP;
    END LOOP;

    d := d + 1;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.get_free_appointment_slots(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_free_appointment_slots(uuid, date, date)
  TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6) RPC: Slot per Magic-Token buchen (atomar, race-safe)
-- ---------------------------------------------------------------------------
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
  landing_id   uuid;
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

  landing_id := COALESCE(app.target_landing_id, app.source_landing_id);
  IF landing_id IS NULL THEN
    error := 'no_landing_page'; RETURN NEXT; RETURN;
  END IF;

  SELECT * INTO sch FROM public.availability_schedules
   WHERE landing_page_id = landing_id AND active
   LIMIT 1;
  IF NOT FOUND THEN
    error := 'no_schedule_configured'; RETURN NEXT; RETURN;
  END IF;

  ends_at_v := _starts_at + make_interval(mins => sch.slot_duration_minutes);

  -- Bereits einen aktiven Termin für diese Application? Dann verweigern
  -- (Reschedule läuft über cancel_appointment_by_token + neu buchen).
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

-- ---------------------------------------------------------------------------
-- 7) RPC: Termin per cancel_token absagen (Bewerber-Flow)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_appointment_by_token(
  _cancel_token uuid,
  _reason text DEFAULT NULL
) RETURNS TABLE(ok boolean, error text, application_magic_token text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  appt public.interview_appointments%ROWTYPE;
  app_token text;
BEGIN
  SELECT * INTO appt FROM public.interview_appointments
   WHERE cancel_token = _cancel_token LIMIT 1;
  IF NOT FOUND THEN
    ok := false; error := 'not_found'; application_magic_token := NULL; RETURN NEXT; RETURN;
  END IF;
  IF appt.status <> 'scheduled' THEN
    ok := false; error := 'already_' || appt.status;
    SELECT magic_token INTO app_token FROM public.applications WHERE id = appt.application_id;
    application_magic_token := app_token;
    RETURN NEXT; RETURN;
  END IF;

  UPDATE public.interview_appointments
     SET status = 'cancelled',
         cancelled_at = now(),
         cancelled_by = 'applicant',
         cancel_reason = _reason
   WHERE id = appt.id;

  UPDATE public.applications
     SET booking_status = 'cancelled',
         updated_at     = now()
   WHERE id = appt.application_id;

  SELECT magic_token INTO app_token FROM public.applications WHERE id = appt.application_id;

  ok := true; error := NULL; application_magic_token := app_token;
  RETURN NEXT;
END $$;

REVOKE ALL ON FUNCTION public.cancel_appointment_by_token(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_appointment_by_token(uuid, text)
  TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8) RPC: Termin-Details per cancel_token (für Bewerber-View)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_appointment_by_cancel_token(_cancel_token uuid)
RETURNS TABLE(
  appointment_id uuid,
  starts_at timestamptz,
  ends_at   timestamptz,
  status    text,
  applicant_first_name text,
  applicant_email text,
  tenant_name text,
  application_magic_token text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.starts_at, a.ends_at, a.status,
         split_part(app.full_name, ' ', 1) AS applicant_first_name,
         app.email,
         t.name,
         app.magic_token
    FROM public.interview_appointments a
    JOIN public.applications app ON app.id = a.application_id
    LEFT JOIN public.tenants t   ON t.id = a.tenant_id
   WHERE a.cancel_token = _cancel_token
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_appointment_by_cancel_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_appointment_by_cancel_token(uuid)
  TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9) RPC: Schedule-Info per Magic-Token (Bewerber sieht Recruiter-Name etc.)
-- ---------------------------------------------------------------------------
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
  SELECT s.id, s.slot_duration_minutes, s.timezone, s.max_days_ahead, s.min_notice_hours,
         t.name,
         split_part(app.full_name, ' ', 1),
         app.email,
         COALESCE(lp.recruiter_name, 'Ihr Ansprechpartner'),
         lp.id
    FROM public.applications app
    LEFT JOIN public.landing_pages lp
           ON lp.id = COALESCE(app.target_landing_id, app.source_landing_id)
    LEFT JOIN public.availability_schedules s
           ON s.landing_page_id = lp.id AND s.active
    LEFT JOIN public.tenants t ON t.id = app.tenant_id
   WHERE app.magic_token = _magic_token
     AND (app.magic_token_expires_at IS NULL OR app.magic_token_expires_at > now())
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_schedule_for_application(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_schedule_for_application(text)
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
