-- Deploy on backend server:
--   docker exec -i supabase-db psql -U postgres -d postgres < 20260711000000_bewerbung_magic_link_template.sql
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS bewerbung_magic_link_subject text,
  ADD COLUMN IF NOT EXISTS bewerbung_magic_link_body    text,
  ADD COLUMN IF NOT EXISTS bewerbung_magic_link_button  text;
