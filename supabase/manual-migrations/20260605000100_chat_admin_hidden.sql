-- APPLY MANUALLY via: bash scripts/migrate.sh
-- Soft-Delete von Chats in der Admin-Ansicht.
-- Wenn der Mitarbeiter eine neue Nachricht schickt, wird admin_hidden_at
-- automatisch zurückgesetzt → Chat erscheint wieder in der Admin-Liste.

ALTER TABLE public.chat_conversations
  ADD COLUMN IF NOT EXISTS admin_hidden_at timestamptz;

CREATE INDEX IF NOT EXISTS chat_conversations_admin_hidden_idx
  ON public.chat_conversations (admin_hidden_at);

-- Stelle sicher, dass eine Conversation existiert, sobald ein Mitarbeiter
-- schreibt; setzt admin_hidden_at auf NULL, wenn vorher versteckt.
CREATE OR REPLACE FUNCTION public.chat_message_unhide_conversation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sender_is_admin boolean;
BEGIN
  -- Nur unhiden, wenn die neue Nachricht NICHT vom Admin kommt.
  SELECT public.has_role(NEW.sender_id, 'admin') INTO sender_is_admin;
  IF sender_is_admin THEN
    RETURN NEW;
  END IF;

  UPDATE public.chat_conversations
     SET admin_hidden_at = NULL,
         updated_at      = now()
   WHERE user_id = NEW.sender_id
     AND admin_hidden_at IS NOT NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chat_message_unhide_trigger ON public.chat_messages;
CREATE TRIGGER chat_message_unhide_trigger
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.chat_message_unhide_conversation();
