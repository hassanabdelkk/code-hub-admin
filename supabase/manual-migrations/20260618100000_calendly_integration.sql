-- APPLY MANUALLY via Supabase SQL Editor.
-- ============================================================================
-- CALENDLY-INTEGRATION
-- Zwischenseite "Sie werden mit [Firma] verbunden" → Calendly-Buchung →
-- Webhook trifft uns → applications.booking_status = 'scheduled'.
-- ============================================================================

-- 1) Landing-Pages: Calendly-Link + Zwischenseiten-Branding
ALTER TABLE public.landing_pages
  ADD COLUMN IF NOT EXISTS calendly_url               text,
  ADD COLUMN IF NOT EXISTS intermediate_company_name  text,
  ADD COLUMN IF NOT EXISTS intermediate_logo_url      text,
  ADD COLUMN IF NOT EXISTS redirect_delay_ms          int NOT NULL DEFAULT 2500;

COMMENT ON COLUMN public.landing_pages.calendly_url IS
  'Calendly-Buchungslink (z.B. https://calendly.com/sabine-schneider/bewerbung). Leer = kein Calendly-Flow.';
COMMENT ON COLUMN public.landing_pages.intermediate_company_name IS
  'Anzeigename auf der Zwischenseite ("Sie werden mit [Firma] verbunden").';
COMMENT ON COLUMN public.landing_pages.redirect_delay_ms IS
  'Loader-Dauer in ms bevor automatisch zu Calendly weitergeleitet wird. 0 = manueller Button.';

-- 2) Applications: Buchungs-Status
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS calendly_event_uri    text UNIQUE,
  ADD COLUMN IF NOT EXISTS calendly_invitee_uri  text,
  ADD COLUMN IF NOT EXISTS scheduled_at          timestamptz,
  ADD COLUMN IF NOT EXISTS booking_status        text NOT NULL DEFAULT 'none'
    CHECK (booking_status IN ('none','pending','scheduled','cancelled','no_show','completed'));

CREATE INDEX IF NOT EXISTS idx_applications_booking_status
  ON public.applications(booking_status) WHERE booking_status <> 'none';
CREATE INDEX IF NOT EXISTS idx_applications_scheduled_at
  ON public.applications(scheduled_at) WHERE scheduled_at IS NOT NULL;

COMMENT ON COLUMN public.applications.booking_status IS
  'none=Calendly nicht genutzt, pending=Bewerbung angelegt aber noch kein Termin, scheduled=Termin gebucht, cancelled/no_show/completed.';

-- 3) Calendly-Accounts pro Tenant
CREATE TABLE IF NOT EXISTS public.calendly_accounts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  display_name         text NOT NULL,
  calendly_user_uri    text,
  webhook_signing_key  text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calendly_accounts_tenant
  ON public.calendly_accounts(tenant_id);

CREATE OR REPLACE FUNCTION public._calendly_accounts_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_calendly_accounts_updated_at ON public.calendly_accounts;
CREATE TRIGGER trg_calendly_accounts_updated_at
  BEFORE UPDATE ON public.calendly_accounts
  FOR EACH ROW EXECUTE FUNCTION public._calendly_accounts_set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendly_accounts TO authenticated;
GRANT ALL ON public.calendly_accounts TO service_role;

ALTER TABLE public.calendly_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read calendly accounts"
  ON public.calendly_accounts FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins insert calendly accounts"
  ON public.calendly_accounts FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins update calendly accounts"
  ON public.calendly_accounts FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins delete calendly accounts"
  ON public.calendly_accounts FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
