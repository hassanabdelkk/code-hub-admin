-- Repair: Herzlichen-Glückwunsch-Template + SMTP-Health-Schema
-- APPLY MANUALLY via: bash scripts/migrate.sh

CREATE TABLE IF NOT EXISTS public.tenant_smtp_health (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  consecutive_fails int NOT NULL DEFAULT 0,
  last_fail_at timestamptz,
  last_fail_error text,
  last_verify_at timestamptz,
  last_verify_ok boolean,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.tenant_smtp_health TO authenticated;
GRANT ALL ON public.tenant_smtp_health TO service_role;

ALTER TABLE public.tenant_smtp_health ADD COLUMN IF NOT EXISTS consecutive_fails int NOT NULL DEFAULT 0;
ALTER TABLE public.tenant_smtp_health ADD COLUMN IF NOT EXISTS last_fail_at timestamptz;
ALTER TABLE public.tenant_smtp_health ADD COLUMN IF NOT EXISTS last_fail_error text;
ALTER TABLE public.tenant_smtp_health ADD COLUMN IF NOT EXISTS last_verify_at timestamptz;
ALTER TABLE public.tenant_smtp_health ADD COLUMN IF NOT EXISTS last_verify_ok boolean;
ALTER TABLE public.tenant_smtp_health ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.tenant_smtp_health ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read smtp_health" ON public.tenant_smtp_health;
CREATE POLICY "Admins read smtp_health"
  ON public.tenant_smtp_health
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

UPDATE public.tenants
SET
  welcome_email_subject = COALESCE(NULLIF(welcome_email_subject, ''), 'Herzlichen Glückwunsch – {{tenant_name}}'),
  welcome_email_body = 'Hallo {{first_name}},

Ihr Profil hat uns überzeugt – lassen Sie uns direkt starten!

Wie geht es weiter?
1. Registrieren Sie sich im Mitarbeiterportal
2. Führen Sie anschließend das Onboarding durch

{{cta:Jetzt registrieren|{{portal_link}}}}

Ich wünsche Ihnen einen erfolgreichen Start!

Mit freundlichen Grüßen
{{sender_name}}'
WHERE welcome_email_body IS NULL
   OR welcome_email_body = ''
   OR welcome_email_body ILIKE '%dein Zugang für%'
   OR welcome_email_body ILIKE '%Bitte registriere dich im Mitarbeiterportal und schließe anschließend dein Profil ab%';

UPDATE public.tenant_smtp_health h
SET consecutive_fails = 0,
    last_verify_ok = true,
    updated_at = now()
FROM public.tenants t
WHERE h.tenant_id = t.id
  AND t.name = 'Personalservice Süd GmbH';

UPDATE public.tenants
SET emails_paused = false,
    emails_paused_reason = NULL,
    emails_paused_at = NULL,
    emails_paused_by = NULL
WHERE name = 'Personalservice Süd GmbH'
  AND emails_paused = true;