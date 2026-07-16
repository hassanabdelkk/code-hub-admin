-- Fügt applications.updated_at hinzu.
-- Grund: eine ältere/deployte Edge Function selektiert oder ordnet nach
-- "updated_at" und wirft dadurch 42703 "column applications.updated_at does
-- not exist". Spalte + Auto-Trigger sind harmlos und lösen den Fehler ohne
-- die Function neu deployen zu müssen.

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS applications_updated_at_idx
  ON public.applications (updated_at DESC);

-- Trigger: bei jedem UPDATE updated_at auf now() setzen.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS applications_set_updated_at ON public.applications;
CREATE TRIGGER applications_set_updated_at
  BEFORE UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
