-- APPLY MANUALLY auf Backend-DB.
-- Pro Landing Page: Name der KI-Recruiterin (default Sabine Schneider).
ALTER TABLE public.landing_pages
  ADD COLUMN IF NOT EXISTS recruiter_name text DEFAULT 'Sabine Schneider';

COMMENT ON COLUMN public.landing_pages.recruiter_name IS
  'Name der KI-Recruiterin für Bewerbungsgespräche. Wird in {recruiter}-Platzhalter im System-Prompt ersetzt.';

NOTIFY pgrst, 'reload schema';
