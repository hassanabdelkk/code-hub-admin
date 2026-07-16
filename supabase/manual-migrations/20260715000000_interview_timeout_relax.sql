-- APPLY MANUALLY: bash scripts/migrate.sh
-- Fix: Auto-Timeout von 20 → 45 Min. 20 Min war zu kurz — nachdenkliche
-- Bewerber (lange Antworten, Pausen) wurden mitten im Interview gekillt.
-- Beispiel: Stephanie Adler — Chat brach nach ~15 Min ab, obwohl KI kurz
-- vor Abschluss war.

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
           ) < now() - interval '45 minutes'
    RETURNING 1
  )
  SELECT count(*) INTO n FROM stale;
  RETURN n;
END $$;
