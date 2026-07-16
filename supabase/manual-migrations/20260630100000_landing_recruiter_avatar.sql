-- APPLY MANUALLY auf Backend-DB.
-- Profilbild der KI-Recruiterin pro Landing Page.
ALTER TABLE public.landing_pages
  ADD COLUMN IF NOT EXISTS recruiter_avatar_url text;

COMMENT ON COLUMN public.landing_pages.recruiter_avatar_url IS
  'Profilbild-URL der KI-Recruiterin (z. B. Sabine Schneider). Public Storage URL.';

-- Public Bucket für Recruiter-Avatare anlegen (idempotent).
INSERT INTO storage.buckets (id, name, public)
VALUES ('recruiter-avatars', 'recruiter-avatars', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Lese-Policy: jeder darf Avatare lesen.
DROP POLICY IF EXISTS "recruiter avatars read" ON storage.objects;
CREATE POLICY "recruiter avatars read" ON storage.objects FOR SELECT
  USING (bucket_id = 'recruiter-avatars');

-- Schreib-Policy: nur eingeloggte Admins.
DROP POLICY IF EXISTS "recruiter avatars write" ON storage.objects;
CREATE POLICY "recruiter avatars write" ON storage.objects FOR ALL
  TO authenticated
  USING (bucket_id = 'recruiter-avatars' AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (bucket_id = 'recruiter-avatars' AND public.has_role(auth.uid(), 'admin'));

NOTIFY pgrst, 'reload schema';
