-- APPLY MANUALLY via: bash scripts/migrate.sh  (oder im Supabase SQL Editor)
-- Multi-Domain-Fallback: aktive Versand-Domain pro Tenant.
-- primary_domain gesetzt → neue Mails nutzen diese Domain.
-- primary_domain NULL    → Fallback auf tenants.domain.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS primary_domain text;

COMMENT ON COLUMN public.tenants.primary_domain IS
  'Aktive Versand-Domain für neue Mails. NULL = nutzt tenants.domain. Muss in domain oder domain_aliases enthalten sein.';

CREATE OR REPLACE VIEW public.tenants_public
WITH (security_invoker=on) AS
SELECT id, name, domain, domain_aliases, primary_domain, primary_color, logo_url,
  team_leader_name, team_leader_title, team_leader_avatar_url,
  team_leader_online, team_leader_response_time,
  whatsapp_number, company_ceo_name, company_address, company_city,
  company_signature_url, hero_title, hero_subtitle, features, is_active,
  ai_enabled
FROM public.tenants
WHERE is_active = true;
