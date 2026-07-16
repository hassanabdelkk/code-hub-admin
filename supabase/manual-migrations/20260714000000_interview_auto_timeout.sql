-- APPLY MANUALLY: bash scripts/migrate.sh
-- C4: Chats, die > 20 Min ohne neue Nachricht offen hängen, automatisch
-- als "timeout" markieren. Kein KI-Aufruf, kein Score — Bewerber hat den
-- Chat einfach verlassen. Verhindert, dass hängige Interviews im Portal
-- ewig als "läuft" auftauchen.

CREATE OR REPLACE FUNCTION public.auto_timeout_stale_interviews()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer := 0;
BEGIN
  WITH stale AS (
    UPDATE public.applications a
       SET interview_status = 'timeout',
           updated_at       = now()
     WHERE a.interview_status = 'in_progress'
       AND COALESCE(
             (SELECT max((elem->>'ts')::timestamptz)
                FROM jsonb_array_elements(COALESCE(a.interview_messages, '[]'::jsonb)) elem),
             a.interview_started_at,
             a.updated_at
           ) < now() - interval '20 minutes'
    RETURNING 1
  )
  SELECT count(*) INTO n FROM stale;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.auto_timeout_stale_interviews() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auto_timeout_stale_interviews() TO service_role;

-- Alle 10 Min ausführen.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto_timeout_stale_interviews') THEN
    PERFORM cron.schedule(
      'auto_timeout_stale_interviews',
      '*/10 * * * *',
      $cron$ SELECT public.auto_timeout_stale_interviews(); $cron$
    );
  END IF;
END $$;
