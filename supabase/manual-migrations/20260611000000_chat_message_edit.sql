-- Chat-Nachrichten: Bearbeiten/Löschen durch den Sender (z. B. Admin/Teamleiter)
-- + edited_at-Spalte für Anzeige "bearbeitet".

alter table public.chat_messages
  add column if not exists edited_at timestamptz;

-- Policies: nur eigener Sender darf updaten/löschen.
drop policy if exists "chat_messages_update_own" on public.chat_messages;
create policy "chat_messages_update_own"
  on public.chat_messages
  for update
  to authenticated
  using (sender_id = auth.uid())
  with check (sender_id = auth.uid());

drop policy if exists "chat_messages_delete_own" on public.chat_messages;
create policy "chat_messages_delete_own"
  on public.chat_messages
  for delete
  to authenticated
  using (sender_id = auth.uid());
