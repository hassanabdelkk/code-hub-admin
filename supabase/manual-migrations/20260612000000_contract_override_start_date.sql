-- APPLY MANUALLY via: bash scripts/migrate.sh
-- Erlaubt dem Admin im "Individuellen Arbeitsvertrag"-Dialog ein Startdatum
-- (Arbeitsverhältnis-Beginn) zu setzen. Wird beim Speichern auch in
-- profiles.employment_start_date gespiegelt (für bereits registrierte
-- Mitarbeiter), damit alle bestehenden Render-/PDF-Pfade es nutzen.

ALTER TABLE public.employee_contract_overrides
  ADD COLUMN IF NOT EXISTS start_date date;

COMMENT ON COLUMN public.employee_contract_overrides.start_date IS
  'Optionales Startdatum des Arbeitsverhältnisses, vom Admin gesetzt.';
