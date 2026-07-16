-- Deaktiviert den gelöschten Mail-Flow "30 Min vor Termin".
-- Manuell auf dem Backend ausführen:
-- docker exec -i supabase-db psql -U postgres -d postgres < 20260709224000_disable_appointment_reminders_cron.sql

DO $$
BEGIN
  PERFORM cron.unschedule('send-appointment-reminders');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'send-appointment-reminders war nicht geplant oder konnte nicht unscheduled werden: %', SQLERRM;
END $$;