-- Fix employee signup: auth.users trigger must create the profile with the
-- tenant_id from raw_user_meta_data. Without this, profile insert can fail on
-- installs where profile insert triggers depend on tenant context.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, tenant_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'tenant_id', '')::uuid
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;