-- APPLY MANUALLY ON SELF-HOSTED DB
-- Fix: AI/API keys in /admin/ai-settings must persist and be readable as masked values.

ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS gemini_api_key           text,
  ADD COLUMN IF NOT EXISTS gemini_model             text DEFAULT 'google/gemini-2.5-flash',
  ADD COLUMN IF NOT EXISTS elevenlabs_api_key       text,
  ADD COLUMN IF NOT EXISTS elevenlabs_agent_id      text,
  ADD COLUMN IF NOT EXISTS apinet_api_key           text,
  ADD COLUMN IF NOT EXISTS apinet_model             text DEFAULT 'gemini-2.5-flash',
  ADD COLUMN IF NOT EXISTS default_voice_id         text,
  ADD COLUMN IF NOT EXISTS default_system_prompt    text,
  ADD COLUMN IF NOT EXISTS default_decision_prompt  text;

INSERT INTO public.system_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

GRANT SELECT, INSERT, UPDATE ON public.system_settings TO authenticated;
GRANT ALL ON public.system_settings TO service_role;
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'system_settings'
      AND policyname = 'Admins insert system_settings'
  ) THEN
    CREATE POLICY "Admins insert system_settings"
      ON public.system_settings
      FOR INSERT
      TO authenticated
      WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'system_settings'
      AND policyname = 'Admins read system_settings'
  ) THEN
    CREATE POLICY "Admins read system_settings"
      ON public.system_settings
      FOR SELECT
      TO authenticated
      USING (public.has_role(auth.uid(), 'admin'::public.app_role));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'system_settings'
      AND policyname = 'Admins update system_settings'
  ) THEN
    CREATE POLICY "Admins update system_settings"
      ON public.system_settings
      FOR UPDATE
      TO authenticated
      USING (public.has_role(auth.uid(), 'admin'::public.app_role))
      WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';