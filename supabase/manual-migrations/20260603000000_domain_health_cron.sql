-- ============================================================================
-- DOMAIN HEALTH CRON
-- Pingt alle 5 Min die Tenant-Domains via /api/public/domain-health-cron.
-- Bei "down" wird ein activity_log-Eintrag geschrieben (Admin sieht ihn auf
-- /admin/activity). Auth via ?key=<CRON_SECRET>.
--
-- Es werden ZWEI Portal-Domains nacheinander gepingt (mb-portal.com + .de),
-- damit der Health-Job nicht ausfällt, wenn eine der beiden Domains down ist.
-- Der Job ruft das Frontend-Portal an, NICHT die Supabase-API.
-- ============================================================================

-- Voraussetzungen
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- TODO BEFORE APPLYING:
--   Ersetze unten <CRON_SECRET> durch den echten Wert (gleicher Wert wie in
--   den Edge-Function-Secrets und im Frontend-Worker-Env).
--
--   Schnellster Weg: per sed an pipe schicken, z.B.
--     sed "s/<CRON_SECRET>/$DEIN_SECRET/g" 20260603000000_domain_health_cron.sql \
--       | psql "$TARGET_DB_URL"

-- Alten Job entfernen (idempotent)
DO $$
BEGIN
  PERFORM cron.unschedule('domain-health-cron-com');
EXCEPTION WHEN OTHERS THEN NULL;
END$$;

DO $$
BEGIN
  PERFORM cron.unschedule('domain-health-cron-de');
EXCEPTION WHEN OTHERS THEN NULL;
END$$;

-- Alter Single-Job-Name (Migration-Vorgängerversion) — auch entfernen
DO $$
BEGIN
  PERFORM cron.unschedule('domain-health-cron');
EXCEPTION WHEN OTHERS THEN NULL;
END$$;

-- Primary: mb-portal.com — alle 5 Min auf Minute 0
SELECT cron.schedule(
  'domain-health-cron-com',
  '*/5 * * * *',
  $$
  SELECT net.http_get(
    url := 'https://mb-portal.com/api/public/domain-health-cron?key=<CRON_SECRET>',
    timeout_milliseconds := 30000
  );
  $$
);

-- Fallback: mb-portal.de — alle 5 Min, 2 Min versetzt (Minute 2,7,12,...)
-- Falls .com down ist, läuft das Monitoring trotzdem weiter.
SELECT cron.schedule(
  'domain-health-cron-de',
  '2-59/5 * * * *',
  $$
  SELECT net.http_get(
    url := 'https://mb-portal.de/api/public/domain-health-cron?key=<CRON_SECRET>',
    timeout_milliseconds := 30000
  );
  $$
);
