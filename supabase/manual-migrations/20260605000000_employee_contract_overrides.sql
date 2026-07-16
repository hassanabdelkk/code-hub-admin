-- APPLY MANUALLY via: bash scripts/migrate.sh
-- Pro Mitarbeiter editierter Arbeitsvertrag (HTML/Text) ODER hochgeladenes PDF.
-- Wenn ein Override existiert, sieht der Mitarbeiter auf /contract diesen
-- statt der Tenant-Standardvorlage.

CREATE TABLE IF NOT EXISTS public.employee_contract_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES public.tenants(id),
  html_body text,
  pdf_url text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_contract_overrides_one_source
    CHECK ((html_body IS NOT NULL) OR (pdf_url IS NOT NULL))
);

GRANT SELECT ON public.employee_contract_overrides TO authenticated;
GRANT ALL    ON public.employee_contract_overrides TO service_role;

ALTER TABLE public.employee_contract_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Mitarbeiter sieht eigenen Override" ON public.employee_contract_overrides;
CREATE POLICY "Mitarbeiter sieht eigenen Override"
  ON public.employee_contract_overrides FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Nur Admin schreibt Overrides" ON public.employee_contract_overrides;
CREATE POLICY "Nur Admin schreibt Overrides"
  ON public.employee_contract_overrides FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
