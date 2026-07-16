-- APPLY MANUALLY via: bash scripts/migrate.sh
-- Tracking "zuletzt online" (Heartbeat aus dem Browser, alle 60s) zusätzlich
-- zu auth.users.last_sign_in_at (das nur den letzten Login zeigt).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

CREATE INDEX IF NOT EXISTS profiles_last_seen_at_idx
  ON public.profiles (last_seen_at DESC NULLS LAST);
