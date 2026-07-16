-- APPLY MANUALLY via Supabase SQL Editor.
-- ============================================================================
-- CLOUDFLARE: API-Token direkt in der DB (statt env-Secret-Name)
-- Erlaubt beliebig viele CF-Accounts ohne neue Runtime-Secrets.
-- ============================================================================

ALTER TABLE public.cloudflare_accounts
  ADD COLUMN IF NOT EXISTS api_token text;

-- Bestehende Spalte bleibt erhalten (Backwards-Compat), wird aber nicht mehr benutzt.
ALTER TABLE public.cloudflare_accounts
  ALTER COLUMN api_token_secret_name DROP NOT NULL;

COMMENT ON COLUMN public.cloudflare_accounts.api_token IS
  'Cloudflare API-Token (Plaintext). Per-Account editierbar im Admin-Portal.';
