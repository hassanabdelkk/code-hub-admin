-- APPLY MANUALLY via: bash scripts/migrate.sh
-- Email-Pause pro Tenant. Wenn aktiv, werden ALLE Reminder-/Recovery-Mails
-- für diesen Tenant übersprungen (Welcome/Reset etc. laufen unverändert,
-- weil sie userseitig getriggert sind und sofort relevant bleiben).
--
-- Auto-Pause: gesetzt durch /api/public/domain-health-cron wenn ALLE
--             Portal-Domains eines Tenants als "down" gemeldet werden.
-- Auto-Resume gibt es bewusst NICHT — Admin muss manuell freigeben,
-- damit nach Restore nicht plötzlich Hunderte Mails rausgehen.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS emails_paused boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS emails_paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS emails_paused_reason text,
  ADD COLUMN IF NOT EXISTS emails_paused_by text;  -- 'auto:domain_down' | actor user id

COMMENT ON COLUMN public.tenants.emails_paused IS
  'Wenn true, werden Reminder-/Recovery-Mails für diesen Tenant nicht versendet.';
COMMENT ON COLUMN public.tenants.emails_paused_by IS
  'auto:domain_down (vom Health-Cron gesetzt) oder die User-ID des Admins.';
