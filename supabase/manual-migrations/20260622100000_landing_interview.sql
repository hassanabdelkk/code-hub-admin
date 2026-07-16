-- APPLY MANUALLY via: bash scripts/migrate.sh (oder im Supabase SQL Editor)
-- ============================================================================
-- KI-BEWERBUNGSGESPRÄCH pro Landing Page.
-- Admin wählt im Landing-Generator: KI-Chat (schriftlich) ODER KI-Telefon
-- (ElevenLabs Voice) ODER „beides" (Bewerber wählt selbst).
-- ============================================================================

-- 1) landing_pages: Modus + Voice-ID + optionaler Override-Prompt
ALTER TABLE public.landing_pages
  ADD COLUMN IF NOT EXISTS interview_mode          text NOT NULL DEFAULT 'chat',
  ADD COLUMN IF NOT EXISTS interview_voice_id      text,
  ADD COLUMN IF NOT EXISTS interview_system_prompt text;

ALTER TABLE public.landing_pages
  DROP CONSTRAINT IF EXISTS landing_pages_interview_mode_check;
ALTER TABLE public.landing_pages
  ADD CONSTRAINT landing_pages_interview_mode_check
  CHECK (interview_mode IN ('chat','voice','both'));

COMMENT ON COLUMN public.landing_pages.interview_mode IS
  'KI-Bewerbungsgespräch: chat = nur schriftlich, voice = nur Telefon (ElevenLabs), both = Bewerber wählt.';
COMMENT ON COLUMN public.landing_pages.interview_voice_id IS
  'ElevenLabs Voice-ID für Voice-Modus (z.B. XrExE9yKIg1WjnnlVkGX = Matilda).';
COMMENT ON COLUMN public.landing_pages.interview_system_prompt IS
  'Optionaler Override für den Interview-Prompt. NULL = Tenant/Default-Prompt.';

-- 2) applications: tatsächlich genutzter Modus + Verlauf + KI-Auswertung
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS interview_mode           text,
  ADD COLUMN IF NOT EXISTS interview_status         text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS interview_messages       jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS interview_summary        text,
  ADD COLUMN IF NOT EXISTS interview_score          int,
  ADD COLUMN IF NOT EXISTS interview_recommendation text,
  ADD COLUMN IF NOT EXISTS interview_started_at     timestamptz,
  ADD COLUMN IF NOT EXISTS interview_completed_at   timestamptz;

ALTER TABLE public.applications
  DROP CONSTRAINT IF EXISTS applications_interview_mode_check;
ALTER TABLE public.applications
  ADD CONSTRAINT applications_interview_mode_check
  CHECK (interview_mode IS NULL OR interview_mode IN ('chat','voice'));

ALTER TABLE public.applications
  DROP CONSTRAINT IF EXISTS applications_interview_status_check;
ALTER TABLE public.applications
  ADD CONSTRAINT applications_interview_status_check
  CHECK (interview_status IN ('pending','running','done','taken_over','skipped'));

ALTER TABLE public.applications
  DROP CONSTRAINT IF EXISTS applications_interview_recommendation_check;
ALTER TABLE public.applications
  ADD CONSTRAINT applications_interview_recommendation_check
  CHECK (interview_recommendation IS NULL
         OR interview_recommendation IN ('invite','reject','unsure'));

CREATE INDEX IF NOT EXISTS idx_applications_interview_status
  ON public.applications(interview_status);

COMMENT ON COLUMN public.applications.interview_messages IS
  'Verlauf als JSON-Array: [{role:"user"|"assistant", text, ts}]. Gleiches Schema für Chat und Voice-Transcript.';
COMMENT ON COLUMN public.applications.interview_recommendation IS
  'KI-Empfehlung am Ende: invite = einladen, reject = absagen, unsure = unsicher.';
