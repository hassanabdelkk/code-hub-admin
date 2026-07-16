-- APPLY MANUALLY via: bash scripts/migrate.sh
-- Anosim-Nummern werden zeitlich begrenzt gemietet (z. B. 30 Tage).
-- expires_at speichert das Mietende, last_test_at + last_test_ok dokumentieren
-- den letzten "Verbindung testen"-Check.

ALTER TABLE public.sms_channels
  ADD COLUMN IF NOT EXISTS expires_at      timestamptz,
  ADD COLUMN IF NOT EXISTS rental_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_test_at    timestamptz,
  ADD COLUMN IF NOT EXISTS last_test_ok    boolean,
  ADD COLUMN IF NOT EXISTS last_test_note  text;

CREATE INDEX IF NOT EXISTS sms_channels_expires_at_idx
  ON public.sms_channels (expires_at)
  WHERE expires_at IS NOT NULL;

COMMENT ON COLUMN public.sms_channels.expires_at IS
  'Ende des aktuellen Miet-/Reservierungs-Zeitraums beim Provider. NULL = unbegrenzt.';
