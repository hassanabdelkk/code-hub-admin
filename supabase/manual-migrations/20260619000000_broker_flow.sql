-- APPLY MANUALLY via Supabase SQL Editor.
-- ============================================================================
-- BROKER-FLOW (Vermittlung): dritter Bewerbungs-Modus neben classic + fast.
-- + wiederverwendbare Partner-Firmen pro Tenant.
-- ============================================================================

-- 1) flow_type um 'broker' erweitern
ALTER TABLE public.applications DROP CONSTRAINT IF EXISTS applications_flow_type_check;
ALTER TABLE public.applications
  ADD CONSTRAINT applications_flow_type_check
  CHECK (flow_type IN ('classic','fast','broker'));

-- 2) partner_companies — wiederverwendbare Vermittlungs-Profile
CREATE TABLE IF NOT EXISTS public.partner_companies (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  name                  text NOT NULL,
  logo_url              text,
  calendly_url          text NOT NULL,
  calendly_account_id   uuid REFERENCES public.calendly_accounts(id) ON DELETE SET NULL,
  portal_register_url   text,
  intro_headline        text,
  intro_subline         text,
  button_label          text NOT NULL DEFAULT 'Jetzt Termin buchen',
  redirect_delay_ms     int  NOT NULL DEFAULT 2500,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_partner_companies_tenant
  ON public.partner_companies(tenant_id);

CREATE OR REPLACE FUNCTION public._partner_companies_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_partner_companies_updated_at ON public.partner_companies;
CREATE TRIGGER trg_partner_companies_updated_at
  BEFORE UPDATE ON public.partner_companies
  FOR EACH ROW EXECUTE FUNCTION public._partner_companies_set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.partner_companies TO authenticated;
GRANT SELECT ON public.partner_companies TO anon;
GRANT ALL ON public.partner_companies TO service_role;

ALTER TABLE public.partner_companies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon read partner companies"   ON public.partner_companies;
DROP POLICY IF EXISTS "admins read partner companies" ON public.partner_companies;
DROP POLICY IF EXISTS "admins write partner companies" ON public.partner_companies;
DROP POLICY IF EXISTS "admins update partner companies" ON public.partner_companies;
DROP POLICY IF EXISTS "admins delete partner companies" ON public.partner_companies;

-- Zwischenseite /bewerbung/verbinden liest mit anon-Key — daher SELECT public.
CREATE POLICY "anon read partner companies"
  ON public.partner_companies FOR SELECT TO anon
  USING (true);
CREATE POLICY "auth read partner companies"
  ON public.partner_companies FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "admins write partner companies"
  ON public.partner_companies FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins update partner companies"
  ON public.partner_companies FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins delete partner companies"
  ON public.partner_companies FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 3) Landing-Pages: optionale Referenz auf Partner-Firma
ALTER TABLE public.landing_pages
  ADD COLUMN IF NOT EXISTS partner_company_id uuid
    REFERENCES public.partner_companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_landing_pages_partner_company
  ON public.landing_pages(partner_company_id) WHERE partner_company_id IS NOT NULL;

COMMENT ON COLUMN public.landing_pages.partner_company_id IS
  'Bei flow_type=broker: Welche Partner-Firma vermittelt? Override-Felder auf der Landing (calendly_url, intermediate_*) gehen vor.';
