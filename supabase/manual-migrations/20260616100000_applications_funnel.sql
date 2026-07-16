-- APPLY MANUALLY: bash scripts/migrate.sh
-- Funnel-Tracking pro Landing-Page + Test-Markierung für Live-Vorschau-Submits.
--
-- source_slug:  freier Bezeichner je Landing-Page (z.B. "kw24-fast-de").
--               wird von der generierten Landing automatisch mitgeschickt.
-- is_test:      TRUE = Submit aus der Admin-Vorschau (mit "[TEST]" Prefix
--               im Namen). Wird in der normalen Bewerber-Liste ausgeblendet.

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS source_slug text,
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_applications_source_slug
  ON public.applications(source_slug) WHERE source_slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_applications_is_test
  ON public.applications(is_test);

COMMENT ON COLUMN public.applications.source_slug IS
  'Quell-Slug der Landing-Page (Funnel-Tracking). Leer = unbekannt/Import/manuell.';
COMMENT ON COLUMN public.applications.is_test IS
  'TRUE = Test-Bewerbung aus Admin-Vorschau. In der Liste standardmäßig ausgeblendet.';
