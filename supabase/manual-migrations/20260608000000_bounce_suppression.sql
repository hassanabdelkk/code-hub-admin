-- APPLY MANUALLY via: bash scripts/migrate.sh  (oder im Supabase SQL Editor)
-- Auto-Suppression nach 3 Bounces / Hard-Fails in 30 Tagen.
-- Schützt Sender-Reputation: keine weiteren Sends an dauerhaft tote Adressen.
--
-- Funktionsweise:
--   1. Trigger auf email_send_log AFTER INSERT.
--   2. Wenn neuer Eintrag status IN ('bounced','dlq','failed') hat:
--      zählt fehlgeschlagene Sends pro (tenant_id, recipient_email) in 30 Tagen.
--   3. Bei >= 3 → INSERT INTO suppressed_emails (tenant_id, email) ON CONFLICT DO NOTHING.
--
-- Wird bei Bedarf manuell aufgehoben (UI: BounceSuppressionPanel + resetEmailStatus).

-- Stelle sicher dass suppressed_emails existiert (defensiv).
CREATE TABLE IF NOT EXISTS public.suppressed_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  email text NOT NULL,
  reason text NOT NULL DEFAULT 'manual',
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppressed_emails TO authenticated;
GRANT ALL ON public.suppressed_emails TO service_role;

ALTER TABLE public.suppressed_emails ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='suppressed_emails' AND policyname='admins_manage_suppressed') THEN
    CREATE POLICY admins_manage_suppressed ON public.suppressed_emails
      FOR ALL TO authenticated
      USING (public.has_role(auth.uid(), 'admin'))
      WITH CHECK (public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;

-- Unique-Constraint (tenant_id, email) — NULL tenant_id = global
CREATE UNIQUE INDEX IF NOT EXISTS suppressed_emails_tenant_email_uniq
  ON public.suppressed_emails (COALESCE(tenant_id::text, 'global'), lower(email));

-- Trigger-Funktion: zähle Bounces in den letzten 30 Tagen, ab 3 → sperren
CREATE OR REPLACE FUNCTION public.auto_suppress_on_bounce()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_count int;
BEGIN
  IF NEW.status NOT IN ('bounced','dlq','failed') THEN
    RETURN NEW;
  END IF;
  IF NEW.recipient_email IS NULL OR length(NEW.recipient_email) < 3 THEN
    RETURN NEW;
  END IF;

  -- tenant_id aus metadata JSON (falls vorhanden) oder NULL
  v_tenant := NULL;
  BEGIN
    v_tenant := (NEW.metadata->>'tenant_id')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_tenant := NULL;
  END;

  SELECT count(*) INTO v_count
  FROM public.email_send_log
  WHERE lower(recipient_email) = lower(NEW.recipient_email)
    AND status IN ('bounced','dlq','failed')
    AND created_at > now() - interval '30 days';

  IF v_count >= 3 THEN
    INSERT INTO public.suppressed_emails (tenant_id, email, reason, source)
    VALUES (v_tenant, lower(NEW.recipient_email), 'auto:3x_bounce_30d', 'trigger')
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_suppress_on_bounce ON public.email_send_log;
CREATE TRIGGER trg_auto_suppress_on_bounce
  AFTER INSERT ON public.email_send_log
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_suppress_on_bounce();

COMMENT ON FUNCTION public.auto_suppress_on_bounce IS
  'Nach 3 Bounces/Fails einer Adresse in 30 Tagen → Eintrag in suppressed_emails. Reset nur manuell durch Admin.';
