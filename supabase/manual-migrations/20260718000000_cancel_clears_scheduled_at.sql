-- APPLY MANUALLY: bash scripts/migrate.sh
-- ============================================================================
-- K1-Fix: cancel_appointment_by_token setzt applications.scheduled_at zurück
-- Vorher: nach Cancel blieb scheduled_at stehen → Interview-Gate zeigte einen
-- toten Countdown und der Bewerber konnte nicht erneut einsteigen.
-- Zusätzlich: booking_status defensiv nur setzen, wenn kein anderer aktiver
-- Termin für dieselbe Application existiert (falls Admin parallel neu bucht).
-- ============================================================================

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
  other_active_id uuid;
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

  -- Gibt es noch einen anderen aktiven Termin? Dann applications-Spiegel nicht anfassen.
  SELECT id INTO other_active_id
    FROM public.interview_appointments
   WHERE application_id = appt.application_id
     AND status = 'scheduled'
     AND id <> appt.id
   LIMIT 1;

  IF other_active_id IS NULL THEN
    UPDATE public.applications
       SET booking_status = 'cancelled',
           scheduled_at   = NULL,
           updated_at     = now()
     WHERE id = appt.application_id;
  END IF;

  SELECT magic_token INTO app_token FROM public.applications WHERE id = appt.application_id;
  ok := true; error := NULL; application_magic_token := app_token;
  RETURN NEXT;
END $$;

REVOKE ALL ON FUNCTION public.cancel_appointment_by_token(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_appointment_by_token(uuid, text)
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
