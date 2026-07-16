-- APPLY MANUALLY via: bash scripts/migrate.sh  (oder im Supabase SQL Editor)
-- ============================================================================
-- LANDING INFRASTRUCTURE — Server-Pool + Cloudflare-Accounts + Automation-Log
--
-- Modell:
--   landing_servers       Pool von Landing-Renderer-Servern (Server 1a, 1b, …)
--   cloudflare_accounts   1..N CF-Accounts, in denen Kunden-Domains liegen
--   cloudflare_zones      Cache aller bekannten CF-Zonen (Domain → zone_id)
--   automation_log        Audit-Log aller automatisierten Aktionen
--   landing_pages.server_id              welcher Server hostet diese Landing
--   landing_pages.cloudflare_zone_id     welche CF-Zone managt die DNS
-- ============================================================================

-- ── landing_servers ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.landing_servers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  hostname           text NOT NULL,
  ip                 inet NOT NULL,
  capacity           int  NOT NULL DEFAULT 100 CHECK (capacity > 0),
  status             text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','online','offline','paused')),
  last_heartbeat_at  timestamptz,
  landing_count      int  NOT NULL DEFAULT 0,
  bootstrap_token    text NOT NULL UNIQUE,
  agent_version      text,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_landing_servers_status ON public.landing_servers(status);
CREATE INDEX IF NOT EXISTS idx_landing_servers_token  ON public.landing_servers(bootstrap_token);

CREATE OR REPLACE FUNCTION public._landing_servers_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_landing_servers_touch ON public.landing_servers;
CREATE TRIGGER trg_landing_servers_touch
  BEFORE UPDATE ON public.landing_servers
  FOR EACH ROW EXECUTE FUNCTION public._landing_servers_touch();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.landing_servers TO authenticated;
GRANT ALL ON public.landing_servers TO service_role;
-- Anon: KEIN Zugriff (Token sind sensibel)

ALTER TABLE public.landing_servers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read servers" ON public.landing_servers
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins insert servers" ON public.landing_servers
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins update servers" ON public.landing_servers
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins delete servers" ON public.landing_servers
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ── cloudflare_accounts ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cloudflare_accounts (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   text NOT NULL,                -- z.B. "DGI Holding"
  account_id             text NOT NULL,                -- Cloudflare Account-ID
  -- Welche env-var-Secret hält den API-Token. Default: CLOUDFLARE_API_TOKEN.
  -- Für mehrere Accounts: CF_TOKEN_DGI, CF_TOKEN_PRIVAT, … (Admin legt per add_secret an)
  api_token_secret_name  text NOT NULL DEFAULT 'CLOUDFLARE_API_TOKEN',
  is_default             boolean NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cloudflare_accounts_account_id
  ON public.cloudflare_accounts(account_id);

CREATE OR REPLACE FUNCTION public._cf_accounts_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_cf_accounts_touch ON public.cloudflare_accounts;
CREATE TRIGGER trg_cf_accounts_touch
  BEFORE UPDATE ON public.cloudflare_accounts
  FOR EACH ROW EXECUTE FUNCTION public._cf_accounts_touch();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cloudflare_accounts TO authenticated;
GRANT ALL ON public.cloudflare_accounts TO service_role;

ALTER TABLE public.cloudflare_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage cf accounts" ON public.cloudflare_accounts
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ── cloudflare_zones ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cloudflare_zones (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cloudflare_account_id  uuid NOT NULL REFERENCES public.cloudflare_accounts(id) ON DELETE CASCADE,
  domain                 text NOT NULL,
  zone_id                text NOT NULL,
  status                 text NOT NULL DEFAULT 'active',
  nameservers            text[] NOT NULL DEFAULT ARRAY[]::text[],
  last_synced_at         timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cf_zones_domain ON public.cloudflare_zones(lower(domain));
CREATE INDEX IF NOT EXISTS idx_cf_zones_account ON public.cloudflare_zones(cloudflare_account_id);

CREATE OR REPLACE FUNCTION public._cf_zones_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_cf_zones_touch ON public.cloudflare_zones;
CREATE TRIGGER trg_cf_zones_touch
  BEFORE UPDATE ON public.cloudflare_zones
  FOR EACH ROW EXECUTE FUNCTION public._cf_zones_touch();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cloudflare_zones TO authenticated;
GRANT ALL ON public.cloudflare_zones TO service_role;

ALTER TABLE public.cloudflare_zones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage cf zones" ON public.cloudflare_zones
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ── automation_log ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.automation_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action      text NOT NULL,                  -- 'landing.live', 'cf.record.set', 'server.bootstrap'
  target      text,                           -- z.B. domain oder server-name
  status      text NOT NULL DEFAULT 'ok'      -- ok|warn|error
                CHECK (status IN ('ok','warn','error')),
  actor_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automation_log_created ON public.automation_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_log_action  ON public.automation_log(action);
CREATE INDEX IF NOT EXISTS idx_automation_log_status  ON public.automation_log(status);

GRANT SELECT, INSERT ON public.automation_log TO authenticated;
GRANT ALL ON public.automation_log TO service_role;

ALTER TABLE public.automation_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read log" ON public.automation_log
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins insert log" ON public.automation_log
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ── landing_pages: server_id + cloudflare_zone_id ───────────────────────────
ALTER TABLE public.landing_pages
  ADD COLUMN IF NOT EXISTS server_id          uuid REFERENCES public.landing_servers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cloudflare_zone_id uuid REFERENCES public.cloudflare_zones(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_landing_pages_server ON public.landing_pages(server_id);

-- ── landing_count Trigger: hält landing_servers.landing_count aktuell ──────
CREATE OR REPLACE FUNCTION public._landing_pages_recount_server()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.server_id IS NOT NULL THEN
      UPDATE public.landing_servers SET landing_count = landing_count + 1 WHERE id = NEW.server_id;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.server_id IS NOT NULL THEN
      UPDATE public.landing_servers SET landing_count = GREATEST(landing_count - 1, 0) WHERE id = OLD.server_id;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.server_id IS DISTINCT FROM NEW.server_id THEN
      IF OLD.server_id IS NOT NULL THEN
        UPDATE public.landing_servers SET landing_count = GREATEST(landing_count - 1, 0) WHERE id = OLD.server_id;
      END IF;
      IF NEW.server_id IS NOT NULL THEN
        UPDATE public.landing_servers SET landing_count = landing_count + 1 WHERE id = NEW.server_id;
      END IF;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_landing_pages_recount ON public.landing_pages;
CREATE TRIGGER trg_landing_pages_recount
  AFTER INSERT OR UPDATE OR DELETE ON public.landing_pages
  FOR EACH ROW EXECUTE FUNCTION public._landing_pages_recount_server();

COMMENT ON TABLE public.landing_servers IS
  'Pool von Landing-Renderer-Servern. Neue Landings werden least-full verteilt.';
COMMENT ON TABLE public.cloudflare_accounts IS
  'Mehrere CF-Accounts unterstützt. API-Token liegt als env-var (Name in api_token_secret_name).';
COMMENT ON TABLE public.automation_log IS
  'Audit-Log für alle automatisierten Aktionen (Live-Switches, DNS-Setzungen, Bootstraps).';
