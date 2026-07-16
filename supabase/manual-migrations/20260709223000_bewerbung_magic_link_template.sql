-- Ergänzt die aktive Vermittlungs-Vorlage "Interview-Einladung".
-- Manuell anwenden auf Self-Hosted Backend:
-- docker exec -i supabase-db psql -U postgres -d postgres < 20260709223000_bewerbung_magic_link_template.sql

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS bewerbung_magic_link_subject text,
  ADD COLUMN IF NOT EXISTS bewerbung_magic_link_body text,
  ADD COLUMN IF NOT EXISTS bewerbung_magic_link_button text;

COMMENT ON COLUMN public.tenants.bewerbung_magic_link_subject IS
  'Betreff für Vermittlung: Interview-Einladung nach Calendly-Buchung.';
COMMENT ON COLUMN public.tenants.bewerbung_magic_link_body IS
  'Textkörper für Vermittlung: Interview-Einladung mit Magic-Link-Platzhaltern.';
COMMENT ON COLUMN public.tenants.bewerbung_magic_link_button IS
  'Button-Beschriftung für Vermittlung: Interview-Einladung.';

NOTIFY pgrst, 'reload schema';