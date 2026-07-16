-- APPLY MANUALLY via: bash scripts/migrate.sh
-- Fast-Track-Flow: 'classic' = Admin akzeptiert manuell, 'fast' = sofort 'akzeptiert'.

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS flow_type text NOT NULL DEFAULT 'classic'
    CHECK (flow_type IN ('classic', 'fast'));

CREATE INDEX IF NOT EXISTS idx_applications_flow_type
  ON public.applications(flow_type);

COMMENT ON COLUMN public.applications.flow_type IS
  'classic = manueller Admin-Workflow; fast = Auto-Akzept + Direkt-Redirect zur Registrierung.';
