-- APPLY MANUALLY via Supabase SQL Editor (bash scripts/migrate.sh).
-- ============================================================================
-- 1) Vermittlung → Fasttrack Verknüpfung
-- 2) Source/Target Landing-Tracking auf applications
-- 3) Cold-Status (Anti-Spam-Hard-Cap nach 3 Remindern pro Stage)
-- ============================================================================

-- 1) landing_pages.linked_fasttrack_landing_id
ALTER TABLE public.landing_pages
  ADD COLUMN IF NOT EXISTS linked_fasttrack_landing_id uuid
    REFERENCES public.landing_pages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_landing_pages_linked_fasttrack
  ON public.landing_pages(linked_fasttrack_landing_id)
  WHERE linked_fasttrack_landing_id IS NOT NULL;

COMMENT ON COLUMN public.landing_pages.linked_fasttrack_landing_id IS
  'Bei flow_type=broker: Ziel-Fasttrack-Landing, auf die der CTA umleitet (mit ?ref=<broker_landing_id>).';

-- 2) applications: Source / Target Landing-Tracking
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS source_landing_id uuid REFERENCES public.landing_pages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_landing_id uuid REFERENCES public.landing_pages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_applications_source_landing
  ON public.applications(source_landing_id) WHERE source_landing_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_applications_target_landing
  ON public.applications(target_landing_id) WHERE target_landing_id IS NOT NULL;

COMMENT ON COLUMN public.applications.source_landing_id IS
  'Vermittlung-Landing, von der die Bewerbung ursprünglich kam (via ?ref= URL-Param).';
COMMENT ON COLUMN public.applications.target_landing_id IS
  'Landing, auf der die Bewerbung tatsächlich erzeugt wurde (Fasttrack-Page).';

-- 3) applications: Cold-Status (Anti-Spam)
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS status_cold boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cold_at timestamptz,
  ADD COLUMN IF NOT EXISTS cold_reason text;

CREATE INDEX IF NOT EXISTS idx_applications_cold
  ON public.applications(status_cold) WHERE status_cold = true;

COMMENT ON COLUMN public.applications.status_cold IS
  'TRUE = max. Reminder pro Stage erreicht. Automatische Reminder werden gestoppt — manueller Eingriff im Admin nötig.';
