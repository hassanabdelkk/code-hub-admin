-- APPLY MANUALLY: bash scripts/migrate.sh
-- Erweitert system_settings um ElevenLabs Agent ID + APINET API Key.

ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS elevenlabs_agent_id text,
  ADD COLUMN IF NOT EXISTS apinet_api_key      text,
  ADD COLUMN IF NOT EXISTS apinet_model        text DEFAULT 'gemini-2.5-flash';

COMMENT ON COLUMN public.system_settings.elevenlabs_agent_id IS
  'ElevenLabs Conversational AI Agent ID für Voice-Bewerbungsgespräche.';
COMMENT ON COLUMN public.system_settings.apinet_api_key IS
  'apinet.cloud API Key (OpenAI-kompatibel) als Alternative zum Lovable AI Gateway.';
COMMENT ON COLUMN public.system_settings.apinet_model IS
  'Default-Modell auf apinet (z.B. gemini-2.5-flash).';
