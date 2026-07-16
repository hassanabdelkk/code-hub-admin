-- =============================================================================
-- Backfill applications.tenant_id for legacy rows.
-- Run on the self-hosted backend (server 123) with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 20260716_backfill_applications_tenant.sql
--
-- Idempotent: each step only touches rows still NULL.
-- Order of precedence (strongest signal first):
--   1) source_landing_id -> landing_pages.tenant_id
--   2) target_landing_id -> landing_pages.tenant_id
--   3) source_slug       -> landing_pages(source_slug|slug).tenant_id (published preferred)
--   4) profile with matching email (auth.users) -> profiles.tenant_id
--   5) invitation_tokens matching application_id or email -> invitation_tokens.tenant_id
-- =============================================================================

BEGIN;

-- 1) via source_landing_id
UPDATE public.applications a
SET tenant_id = lp.tenant_id
FROM public.landing_pages lp
WHERE a.tenant_id IS NULL
  AND a.source_landing_id = lp.id
  AND lp.tenant_id IS NOT NULL;

-- 2) via target_landing_id
UPDATE public.applications a
SET tenant_id = lp.tenant_id
FROM public.landing_pages lp
WHERE a.tenant_id IS NULL
  AND a.target_landing_id = lp.id
  AND lp.tenant_id IS NOT NULL;

-- 3) via source_slug (published pages win, then most recent)
UPDATE public.applications a
SET tenant_id = lp.tenant_id
FROM (
  SELECT DISTINCT ON (key) key, tenant_id
  FROM (
    SELECT COALESCE(source_slug, slug) AS key, tenant_id, is_published, updated_at
    FROM public.landing_pages
    WHERE tenant_id IS NOT NULL
      AND COALESCE(source_slug, slug) IS NOT NULL
  ) x
  ORDER BY key, is_published DESC, updated_at DESC NULLS LAST
) lp
WHERE a.tenant_id IS NULL
  AND a.source_slug IS NOT NULL
  AND lp.key = a.source_slug;

-- 4) via matching profile (auth.users email)
UPDATE public.applications a
SET tenant_id = p.tenant_id
FROM public.profiles p
JOIN auth.users u ON u.id = p.user_id
WHERE a.tenant_id IS NULL
  AND p.tenant_id IS NOT NULL
  AND lower(u.email) = lower(a.email);

-- 5) via invitation_tokens
UPDATE public.applications a
SET tenant_id = it.tenant_id
FROM public.invitation_tokens it
WHERE a.tenant_id IS NULL
  AND it.tenant_id IS NOT NULL
  AND (it.application_id = a.id OR lower(it.email) = lower(a.email));

COMMIT;

-- Speed up tenant-scoped queries (safe if exists).
CREATE INDEX IF NOT EXISTS idx_applications_tenant_id
  ON public.applications(tenant_id);

-- Report + tenant breakdown so you see the result immediately.
\echo '--- Remaining NULL tenant_id ---'
SELECT count(*) AS remaining_null FROM public.applications WHERE tenant_id IS NULL;

\echo '--- Applications per tenant (top 20) ---'
SELECT t.name, count(a.*) AS applications
FROM public.applications a
LEFT JOIN public.tenants t ON t.id = a.tenant_id
GROUP BY t.name
ORDER BY applications DESC
LIMIT 20;

\echo '--- Sample of still-orphan rows (max 20) ---'
SELECT id, email, source_slug, source_landing_id, created_at
FROM public.applications
WHERE tenant_id IS NULL
ORDER BY created_at DESC
LIMIT 20;

-- =============================================================================
-- After you verified `remaining_null = 0`, enforce it schema-side (separate run):
--
--   ALTER TABLE public.applications
--     ALTER COLUMN tenant_id SET NOT NULL;
--
-- If a residual tail remains, either:
--   (a) delete/orphan-tag those rows first, or
--   (b) skip NOT NULL for now and re-run this script after the next data import.
-- =============================================================================
