-- APPLY MANUALLY: bash scripts/migrate.sh
-- ============================================================================
-- Booking-Confirmation-Mail + Auto-Complete für interview_appointments
--
-- 1) Neue Template-Spalten auf tenants (subject/body/button) für Bestätigungsmail
-- 2) pg_cron: send-booking-confirmation alle 2 Min → Edge Function
-- 3) SQL-Function auto_complete_and_noshow_appointments():
--    - status='scheduled' + ends_at < now()-30min + interview positiv/negativ/completed
--      → status='completed'
--    - status='scheduled' + starts_at < now()-45min + interview_status IS NULL
--      → status='no_show' (Bewerber ist einfach nicht erschienen)
-- 4) pg_cron: alle 15 Min die SQL-Function ausführen
-- ============================================================================

-- 1) Template-Spalten für Bestätigungsmail
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS booking_confirmation_subject text,
  ADD COLUMN IF NOT EXISTS booking_confirmation_body    text,
  ADD COLUMN IF NOT EXISTS booking_confirmation_button  text;

-- 2) Auto-Complete + No-Show
CREATE OR REPLACE FUNCTION public.auto_complete_and_noshow_appointments()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n_completed int := 0;
  n_noshow    int := 0;
BEGIN
  -- Completed: Termin vorbei UND Bewerber hat Interview durchgeführt
  WITH upd AS (
    UPDATE public.interview_appointments a
       SET status = 'completed',
           updated_at = now()
      FROM public.applications app
     WHERE a.application_id = app.id
       AND a.status = 'scheduled'
       AND a.ends_at < now() - interval '30 minutes'
       AND app.interview_status IN ('completed','positive','negative','passed','failed')
    RETURNING 1
  )
  SELECT count(*) INTO n_completed FROM upd;

  -- No-Show: Termin lief an, kein Interview gestartet
  WITH upd2 AS (
    UPDATE public.interview_appointments a
       SET status = 'no_show',
           updated_at = now()
      FROM public.applications app
     WHERE a.application_id = app.id
       AND a.status = 'scheduled'
       AND a.starts_at < now() - interval '45 minutes'
       AND (app.interview_status IS NULL OR app.interview_status IN ('not_started','pending'))
    RETURNING 1
  )
  SELECT count(*) INTO n_noshow FROM upd2;

  RETURN jsonb_build_object('completed', n_completed, 'no_show', n_noshow);
END $$;

REVOKE ALL ON FUNCTION public.auto_complete_and_noshow_appointments() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auto_complete_and_noshow_appointments()
  TO service_role;

-- 3) Cron-Jobs registrieren (setzt pg_cron + Vault mit project_url/cron_secret voraus)
DO $$
DECLARE
  proj_url  text;
  cron_key  text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skipping cron registration';
    RETURN;
  END IF;

  BEGIN
    SELECT decrypted_secret INTO proj_url
      FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1;
    SELECT decrypted_secret INTO cron_key
      FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    proj_url := NULL; cron_key := NULL;
  END;

  -- Booking-Confirmation Cron (alle 2 Min)
  IF proj_url IS NOT NULL AND cron_key IS NOT NULL THEN
    PERFORM cron.unschedule('send_booking_confirmation');
    PERFORM cron.schedule(
      'send_booking_confirmation',
      '*/2 * * * *',
      format(
        $c$SELECT net.http_post(
             url:=%L,
             headers:=jsonb_build_object('Content-Type','application/json','x-cron-secret',%L),
             body:='{}'::jsonb
           );$c$,
        proj_url || '/functions/v1/send-booking-confirmation',
        cron_key
      )
    );
  ELSE
    RAISE NOTICE 'vault.project_url/cron_secret missing — schedule send_booking_confirmation manually';
  END IF;

  -- Auto-Complete Cron (alle 15 Min) — reine SQL-Function, kein HTTP nötig
  PERFORM cron.unschedule('auto_complete_appointments');
  PERFORM cron.schedule(
    'auto_complete_appointments',
    '*/15 * * * *',
    $c$SELECT public.auto_complete_and_noshow_appointments();$c$
  );
END $$;

NOTIFY pgrst, 'reload schema';
