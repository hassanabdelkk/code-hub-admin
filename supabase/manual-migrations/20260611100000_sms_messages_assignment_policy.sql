-- Mitarbeiter sehen SMS-Nachrichten ihrer zugewiesenen Channels,
-- auch wenn user_id beim Insert (z.B. Cron-Poll vor Zuweisung) leer war.

DROP POLICY IF EXISTS "Users view sms for assigned channels" ON public.sms_messages;
CREATE POLICY "Users view sms for assigned channels"
ON public.sms_messages
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.sms_assignments a
    WHERE a.sms_channel_id = sms_messages.channel_id
      AND a.user_id = auth.uid()
      AND a.is_active = true
  )
);

-- Backfill: bestehende inbound-SMS ohne user_id auf aktuelle aktive Zuweisung mappen
UPDATE public.sms_messages m
SET user_id = a.user_id
FROM public.sms_assignments a
WHERE m.user_id IS NULL
  AND a.sms_channel_id = m.channel_id
  AND a.is_active = true;
