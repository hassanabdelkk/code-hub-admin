-- ============================================================================
-- BIG UPDATE: Delete-Cascade, Einführungs-Loop-Fix, Chat-Attachments
-- ============================================================================

-- 1) Dynamische User-Cascade-Lösch-Funktion ---------------------------------
--    Findet alle public-Tabellen mit FK auf auth.users und löscht die Zeilen
--    automatisch. So müssen wir nicht jede neue Tabelle hart codieren.
CREATE OR REPLACE FUNCTION public.admin_delete_user_cascade(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec RECORD;
  sql TEXT;
BEGIN
  -- Nur Admins dürfen das aufrufen
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Nicht autorisiert';
  END IF;

  -- Schutz: keine Admins löschen
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'admin') THEN
    RAISE EXCEPTION 'Admin-Accounts können nicht über diese Funktion gelöscht werden.';
  END IF;

  -- Alle FK-Spalten in public, die auf auth.users(id) zeigen, dynamisch löschen
  FOR rec IN
    SELECT tc.table_schema, tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema   = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema   = 'public'
      AND ccu.table_schema  = 'auth'
      AND ccu.table_name    = 'users'
      AND tc.table_name    <> 'profiles' -- profiles ganz am Ende
  LOOP
    sql := format('DELETE FROM %I.%I WHERE %I = $1',
                  rec.table_schema, rec.table_name, rec.column_name);
    BEGIN
      EXECUTE sql USING _user_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skip %.% (%): %', rec.table_schema, rec.table_name, rec.column_name, SQLERRM;
    END;
  END LOOP;

  -- Selbstreferenzen entkoppeln (team_leader_id)
  UPDATE public.profiles SET team_leader_id = NULL WHERE team_leader_id = _user_id;

  -- Chat-Messages (beide Richtungen)
  DELETE FROM public.chat_messages WHERE sender_id = _user_id OR receiver_id = _user_id;

  -- Activity-Log
  BEGIN
    DELETE FROM public.activity_log WHERE actor_id = _user_id OR entity_id = _user_id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- Profile zum Schluss
  DELETE FROM public.profiles WHERE user_id = _user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_user_cascade(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_user_cascade(uuid) TO service_role;

-- 2) Einführungs-Loop-Fix ---------------------------------------------------
--    Trigger nur dann feuern, wenn noch KEINE "Einführung abgeschlossen!"-
--    Nachricht für diesen User existiert.
CREATE OR REPLACE FUNCTION public.send_system_chat_on_profile_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.team_leader_id IS NULL THEN RETURN NEW; END IF;

  IF OLD.contract_signed_at IS NULL AND NEW.contract_signed_at IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.chat_messages
      WHERE receiver_id = NEW.user_id AND message = 'Vertrag unterschrieben!'
    ) THEN
      INSERT INTO public.chat_messages (sender_id, receiver_id, message)
      VALUES (NEW.team_leader_id, NEW.user_id, 'Vertrag unterschrieben!');
    END IF;
  END IF;

  IF OLD.onboarding_status IS DISTINCT FROM 'abgeschlossen'
     AND NEW.onboarding_status = 'abgeschlossen' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.chat_messages
      WHERE receiver_id = NEW.user_id AND message = 'Einführung abgeschlossen!'
    ) THEN
      INSERT INTO public.chat_messages (sender_id, receiver_id, message)
      VALUES (NEW.team_leader_id, NEW.user_id, 'Einführung abgeschlossen!');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 3) Chat-Attachments -------------------------------------------------------
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS attachment_url  TEXT,
  ADD COLUMN IF NOT EXISTS attachment_name TEXT,
  ADD COLUMN IF NOT EXISTS attachment_type TEXT;

-- Storage-Bucket für Chat-Anhänge (privat)
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-attachments', 'chat-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- RLS-Policies für chat-attachments:
-- Sender und Empfänger der jeweiligen Chat-Message dürfen Datei lesen/hochladen.
-- Pfad-Konvention: {sender_id}/{filename}
DROP POLICY IF EXISTS "chat_attachments_select" ON storage.objects;
CREATE POLICY "chat_attachments_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND (
      -- Eigene Uploads
      (storage.foldername(name))[1] = auth.uid()::text
      OR
      -- Empfänger einer Message mit diesem attachment_url
      EXISTS (
        SELECT 1 FROM public.chat_messages cm
        WHERE cm.attachment_url LIKE '%' || storage.objects.name
          AND (cm.sender_id = auth.uid() OR cm.receiver_id = auth.uid())
      )
      -- Admins dürfen alles
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
    )
  );

DROP POLICY IF EXISTS "chat_attachments_insert" ON storage.objects;
CREATE POLICY "chat_attachments_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-attachments'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "chat_attachments_delete" ON storage.objects;
CREATE POLICY "chat_attachments_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
    )
  );
