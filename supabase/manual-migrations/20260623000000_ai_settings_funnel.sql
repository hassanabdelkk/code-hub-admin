-- APPLY MANUALLY: bash scripts/migrate.sh
-- ============================================================================
-- Stufe 1: KI-Infrastruktur (ohne Keys nutzbar).
--  - system_settings:  globale Gemini- + ElevenLabs-Keys + Default-Prompts.
--  - landing_pages:    decision_prompt (Override pro Landing).
--  - applications:     registered_at + ai_decision/ai_reason (Klar-Schema).
-- ============================================================================

-- 1) system_settings: globale KI-Defaults
ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS gemini_api_key           text,
  ADD COLUMN IF NOT EXISTS gemini_model             text DEFAULT 'google/gemini-2.5-flash',
  ADD COLUMN IF NOT EXISTS elevenlabs_api_key       text,
  ADD COLUMN IF NOT EXISTS default_voice_id         text,
  ADD COLUMN IF NOT EXISTS default_system_prompt    text,
  ADD COLUMN IF NOT EXISTS default_decision_prompt  text;

COMMENT ON COLUMN public.system_settings.gemini_api_key IS
  'Globaler Gemini API Key (aistudio.google.com). Wird für KI-Bewerbungsgespräche genutzt.';
COMMENT ON COLUMN public.system_settings.elevenlabs_api_key IS
  'Globaler ElevenLabs API Key für Voice-Bewerbungsgespräche.';
COMMENT ON COLUMN public.system_settings.default_system_prompt IS
  'Standard-Prompt für KI-Bewerbungsgespräche. Wird pro Landing-Page überschreibbar.';
COMMENT ON COLUMN public.system_settings.default_decision_prompt IS
  'Standard-Prompt für KI-Entscheidung (Zusage/Absage). Erwartet JSON-Antwort.';

-- 2) landing_pages: Decision-Prompt-Override
ALTER TABLE public.landing_pages
  ADD COLUMN IF NOT EXISTS interview_decision_prompt text;

COMMENT ON COLUMN public.landing_pages.interview_decision_prompt IS
  'Optionaler Override für den KI-Entscheidungs-Prompt. NULL = Default.';

-- 3) applications: Registrierungs-Zeitpunkt + KI-Entscheidung explizit
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS registered_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_decision   text,
  ADD COLUMN IF NOT EXISTS ai_reason     text;

ALTER TABLE public.applications
  DROP CONSTRAINT IF EXISTS applications_ai_decision_check;
ALTER TABLE public.applications
  ADD CONSTRAINT applications_ai_decision_check
  CHECK (ai_decision IS NULL OR ai_decision IN ('zusage','absage','pending'));

CREATE INDEX IF NOT EXISTS idx_applications_registered_at
  ON public.applications(registered_at);

COMMENT ON COLUMN public.applications.registered_at IS
  'Wann der Bewerber sich im Mitarbeiter-Portal registriert hat (für Funnel).';
COMMENT ON COLUMN public.applications.ai_decision IS
  'KI-Entscheidung nach Interview: zusage | absage | pending.';
