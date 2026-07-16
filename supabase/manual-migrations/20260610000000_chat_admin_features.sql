-- APPLY MANUALLY via: bash scripts/migrate.sh
-- Chat-Features: Ungelesen-Markierung, Admin-Notiz pro Chat.
-- Roter Punkt für unbeantwortete Chats wird clientseitig aus
-- chat_messages abgeleitet (letzte Nachricht vom Mitarbeiter + Alter).

ALTER TABLE public.chat_conversations
  ADD COLUMN IF NOT EXISTS admin_unread          boolean      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS admin_note            text,
  ADD COLUMN IF NOT EXISTS admin_note_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS admin_note_updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS chat_conversations_admin_unread_idx
  ON public.chat_conversations (admin_unread) WHERE admin_unread = true;
