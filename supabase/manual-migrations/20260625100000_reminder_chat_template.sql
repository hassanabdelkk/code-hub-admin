-- Chat-Reminder Template Felder (admin manueller "📨 Erinnerung senden" Button).
alter table public.tenants
  add column if not exists reminder_chat_subject text,
  add column if not exists reminder_chat_body text;
