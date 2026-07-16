-- APPLY MANUALLY via: bash scripts/migrate.sh
-- Drip-Resend-Queue für Einladungs-Mails an akzeptierte Bewerber ohne Account.
-- Wird befüllt durch resendInvitesToUnregistered() (Spread über N Stunden, Default 24).
-- Verarbeitet durch Edge Function process-invite-resend-queue (per pg_cron alle 15min).

CREATE TABLE IF NOT EXISTS public.invite_resend_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text,
  first_name text,
  last_name text,
  scheduled_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'queued', -- queued | sent | failed | skipped
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  batch_id uuid NOT NULL,
  UNIQUE (application_id, batch_id)
);

CREATE INDEX IF NOT EXISTS idx_invite_resend_queue_due
  ON public.invite_resend_queue (status, scheduled_at)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS idx_invite_resend_queue_batch
  ON public.invite_resend_queue (batch_id, status);

GRANT SELECT ON public.invite_resend_queue TO authenticated;
GRANT ALL    ON public.invite_resend_queue TO service_role;

ALTER TABLE public.invite_resend_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read invite_resend_queue" ON public.invite_resend_queue;
CREATE POLICY "Admins read invite_resend_queue"
  ON public.invite_resend_queue
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

COMMENT ON TABLE public.invite_resend_queue IS
  'Drip-Queue für erneute Einladungs-Mails. scheduled_at wird über N Stunden verteilt; Worker sendet fällige Rows via Tenant-SMTP.';
