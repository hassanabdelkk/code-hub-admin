-- APPLY MANUALLY via: bash scripts/migrate.sh
-- Dedup-Index für SMS-Polling (Anosim & andere Provider)
-- Verhindert, dass dieselbe SMS bei wiederholtem Polling doppelt eingefügt wird.

CREATE UNIQUE INDEX IF NOT EXISTS sms_messages_channel_provider_msgid_uniq
  ON public.sms_messages (channel_id, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- Performance-Index für Match per Telefonnummer beim Polling
CREATE INDEX IF NOT EXISTS sms_channels_phone_number_idx
  ON public.sms_channels (phone_number);
