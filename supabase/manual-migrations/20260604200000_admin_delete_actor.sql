-- APPLY MANUALLY via: bash scripts/migrate.sh
-- Fix: admin_delete_user_cascade wurde via service_role (supabaseAdmin) gerufen,
-- daher war auth.uid() NULL und der has_role()-Check schlug fehl
-- ("Nicht autorisiert"). Neue Signatur nimmt _actor_id explizit entgegen.

CREATE OR REPLACE FUNCTION public.admin_delete_user_cascade(_user_id uuid, _actor_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec RECORD;
  sql TEXT;
BEGIN
  IF _actor_id IS NULL OR NOT public.has_role(_actor_id, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Nicht autorisiert';
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'admin') THEN
    RAISE EXCEPTION 'Admin-Accounts können nicht über diese Funktion gelöscht werden.';
  END IF;

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
      AND tc.table_name    <> 'profiles'
  LOOP
    sql := format('DELETE FROM %I.%I WHERE %I = $1',
                  rec.table_schema, rec.table_name, rec.column_name);
    BEGIN
      EXECUTE sql USING _user_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skip %.% (%): %', rec.table_schema, rec.table_name, rec.column_name, SQLERRM;
    END;
  END LOOP;

  UPDATE public.profiles SET team_leader_id = NULL WHERE team_leader_id = _user_id;

  BEGIN
    DELETE FROM public.chat_messages WHERE sender_id = _user_id OR receiver_id = _user_id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    DELETE FROM public.activity_log WHERE actor_id = _user_id OR entity_id = _user_id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  DELETE FROM public.profiles WHERE user_id = _user_id;
END;
$$;

-- Alte 1-Parameter-Variante entfernen (sonst kollidiert PostgREST-Overload-Resolution)
DROP FUNCTION IF EXISTS public.admin_delete_user_cascade(uuid);

GRANT EXECUTE ON FUNCTION public.admin_delete_user_cascade(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_user_cascade(uuid, uuid) TO service_role;
