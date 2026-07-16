-- APPLY MANUALLY via: bash scripts/migrate.sh
-- Hard-Bounce-Handling: Empfänger mit dauerhaft toten E-Mail-Adressen
-- werden markiert und beim nächsten Reminder-/Recovery-Lauf übersprungen,
-- damit unsere Sender-Reputation nicht durch wiederholte 5.x.x-Bounces leidet.
--
-- Wert wird gesetzt von send-reminders Edge-Function bei SMTP-Response-Code >= 500.
-- Reset nur manuell durch Admin (Button im UI).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS email_bounced_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_bounce_reason text;

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS email_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS email_bounced_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_bounce_reason text;

-- Check-Constraint nur einmal anlegen (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_email_status_check') THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_email_status_check
      CHECK (email_status IN ('active', 'bounced', 'complained'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'applications_email_status_check') THEN
    ALTER TABLE public.applications
      ADD CONSTRAINT applications_email_status_check
      CHECK (email_status IN ('active', 'bounced', 'complained'));
  END IF;
END $$;

COMMENT ON COLUMN public.profiles.email_status IS
  'active = darf angeschrieben werden. bounced = letzte Mail wurde mit SMTP 5.x.x abgelehnt. complained = Spam-Beschwerde. Reset nur manuell.';
COMMENT ON COLUMN public.applications.email_status IS
  'active = darf angeschrieben werden. bounced = letzte Mail wurde mit SMTP 5.x.x abgelehnt. complained = Spam-Beschwerde. Reset nur manuell.';
