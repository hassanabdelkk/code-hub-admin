-- ============================================================
-- Backfill profiles.tenant_id via application_id → applications.tenant_id
-- Und stichprobenartige Kontrolle applications ↔ landing_pages.tenant_id
--
-- Ausführen auf Server 123 (Backend):
--   scp scripts/backfill/20260716_backfill_profiles_tenant_and_check.sql root@123.xxx:/tmp/
--   psql "$PG_URL" -f /tmp/20260716_backfill_profiles_tenant_and_check.sql
-- ============================================================

BEGIN;

-- 1) Profile ohne Tenant, aber mit application_id → aus applications ziehen
WITH candidates AS (
  SELECT p.user_id, a.tenant_id AS derived_tenant_id
  FROM public.profiles p
  JOIN public.applications a ON a.id = p.application_id
  WHERE p.tenant_id IS NULL
    AND a.tenant_id IS NOT NULL
)
UPDATE public.profiles p
SET tenant_id = c.derived_tenant_id, updated_at = now()
FROM candidates c
WHERE p.user_id = c.user_id;

-- 2) Profile ohne Tenant + ohne application_id, aber E-Mail matcht eindeutig
--    genau eine Bewerbung mit tenant_id → dort verankern
WITH email_matches AS (
  SELECT p.user_id,
         (ARRAY_AGG(DISTINCT a.tenant_id))[1] AS derived_tenant_id,
         COUNT(DISTINCT a.tenant_id) AS n_tenants
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.user_id
  JOIN public.applications a ON lower(a.email) = lower(u.email)
  WHERE p.tenant_id IS NULL
    AND a.tenant_id IS NOT NULL
  GROUP BY p.user_id
)
UPDATE public.profiles p
SET tenant_id = em.derived_tenant_id, updated_at = now()
FROM email_matches em
WHERE p.user_id = em.user_id
  AND em.n_tenants = 1;

-- 3) Report: wie viele Profile bleiben ohne Tenant?
DO $$
DECLARE
  still_null int;
BEGIN
  SELECT COUNT(*) INTO still_null FROM public.profiles WHERE tenant_id IS NULL;
  RAISE NOTICE 'Profile ohne tenant_id nach Backfill: %', still_null;
END $$;

-- 4) Sanity-Check: Bewerbungen, deren source_landing_id auf eine Landing eines
--    ANDEREN Tenants zeigt (Cross-Tenant-Leak-Kandidaten). Nur Ausgabe, kein Fix.
DO $$
DECLARE
  mismatches int;
BEGIN
  SELECT COUNT(*) INTO mismatches
  FROM public.applications a
  JOIN public.landing_pages lp ON lp.id = a.source_landing_id
  WHERE a.tenant_id IS NOT NULL
    AND lp.tenant_id IS NOT NULL
    AND a.tenant_id <> lp.tenant_id;
  RAISE NOTICE 'Cross-Tenant Bewerbung↔Landing Mismatches: %', mismatches;
END $$;

-- 5) Detail-View der Cross-Tenant-Mismatches ausgeben (für Review)
SELECT a.id AS application_id, a.email, a.tenant_id AS app_tenant,
       lp.id AS landing_id, lp.slug, lp.tenant_id AS landing_tenant, a.created_at
FROM public.applications a
JOIN public.landing_pages lp ON lp.id = a.source_landing_id
WHERE a.tenant_id IS NOT NULL
  AND lp.tenant_id IS NOT NULL
  AND a.tenant_id <> lp.tenant_id
ORDER BY a.created_at DESC
LIMIT 100;

COMMIT;
