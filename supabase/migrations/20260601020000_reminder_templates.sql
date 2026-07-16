-- Reminder-Mail-Templates pro Tenant (vom Admin editierbar)
alter table public.tenants
  add column if not exists reminder_invite_subject     text,
  add column if not exists reminder_invite_body        text,
  add column if not exists reminder_confirm_subject    text,
  add column if not exists reminder_confirm_body       text,
  add column if not exists reminder_completion_subject text,
  add column if not exists reminder_completion_body    text,
  add column if not exists reminder_no_booking_subject text,
  add column if not exists reminder_no_booking_body    text;
