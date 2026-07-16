-- APPLY MANUALLY via: bash scripts/migrate.sh  (oder im Supabase SQL Editor)
-- ============================================================================
-- LANDING PAGES — zentrale Tabelle für alle Landings (gehostet auf Server 1).
--
-- Workflow:
--   1. Admin im Portal → /admin/landing-generator → "Speichern & live schalten"
--   2. Insert/Update in dieser Tabelle.
--   3. Server 1 (Bun-Renderer hinter Caddy) liest pro Request via anon-Key
--      die Zeile per Host-Header und rendert das Theme on-the-fly.
--   4. Caddy on_demand_tls fragt VOR Cert-Ausstellung den Renderer:
--      "kennst du die Domain X?" — Renderer prüft genau diese Tabelle.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.landing_pages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  slug          text NOT NULL UNIQUE,            -- interner Schlüssel, z.B. "digital-dgi"
  domain        text NOT NULL UNIQUE,            -- öffentliche Domain, z.B. "digital-dgigmbh.com"
  theme_id      text NOT NULL,                   -- z.B. "theme-10"
  branding      jsonb NOT NULL DEFAULT '{}'::jsonb,
  slots         jsonb NOT NULL DEFAULT '{}'::jsonb,
  logo_url      text,
  favicon_url   text,
  flow_type     text NOT NULL DEFAULT 'classic' CHECK (flow_type IN ('classic','fast')),
  source_slug   text,                            -- Funnel-Tracking
  is_published  boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_landing_pages_tenant ON public.landing_pages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_landing_pages_domain ON public.landing_pages(lower(domain));
CREATE INDEX IF NOT EXISTS idx_landing_pages_published ON public.landing_pages(is_published) WHERE is_published;

-- updated_at Trigger
CREATE OR REPLACE FUNCTION public._landing_pages_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_landing_pages_updated_at ON public.landing_pages;
CREATE TRIGGER trg_landing_pages_updated_at
  BEFORE UPDATE ON public.landing_pages
  FOR EACH ROW EXECUTE FUNCTION public._landing_pages_set_updated_at();

-- ── Grants (Data API muss SELECT/INSERT/UPDATE/DELETE explizit bekommen) ──
GRANT SELECT ON public.landing_pages TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.landing_pages TO authenticated;
GRANT ALL ON public.landing_pages TO service_role;

-- ── RLS ──
ALTER TABLE public.landing_pages ENABLE ROW LEVEL SECURITY;

-- Anon (Server 1 / Renderer): nur veröffentlichte Landings lesen.
CREATE POLICY "public read published"
  ON public.landing_pages FOR SELECT TO anon
  USING (is_published);

-- Authenticated Admins: alles
CREATE POLICY "admins read all"
  ON public.landing_pages FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins insert"
  ON public.landing_pages FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins update"
  ON public.landing_pages FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins delete"
  ON public.landing_pages FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ── Cross-Link: ein Tenant kann auf seine Default-Landing zeigen ──
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS landing_page_id uuid REFERENCES public.landing_pages(id) ON DELETE SET NULL;

COMMENT ON TABLE public.landing_pages IS
  'Zentrale Landings-Tabelle. Server 1 (Caddy + Bun) rendert beim Request anhand des Host-Headers.';

-- ============================================================================
-- STORAGE-BUCKET (einmalig manuell anlegen über Supabase-Studio ODER per SQL)
-- ============================================================================
-- public=true, damit Server 1 die Logo/Favicon-URLs ohne Auth ausliefern kann.
INSERT INTO storage.buckets (id, name, public)
VALUES ('landing-assets', 'landing-assets', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- RLS auf storage.objects: nur Admins dürfen schreiben, jeder darf lesen.
DROP POLICY IF EXISTS "landing-assets public read" ON storage.objects;
CREATE POLICY "landing-assets public read"
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'landing-assets');

DROP POLICY IF EXISTS "landing-assets admin write" ON storage.objects;
CREATE POLICY "landing-assets admin write"
  ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'landing-assets' AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (bucket_id = 'landing-assets' AND public.has_role(auth.uid(), 'admin'));
