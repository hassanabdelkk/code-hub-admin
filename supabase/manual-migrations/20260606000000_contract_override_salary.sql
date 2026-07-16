-- APPLY MANUALLY via: bash scripts/migrate.sh
-- Erweitert employee_contract_overrides um optionales individuelles Monatsgehalt
-- und Wochenstunden. Erlaubt außerdem Overrides ohne html_body/pdf_url
-- (nur Gehalt/Stunden überschreiben).

ALTER TABLE public.employee_contract_overrides
  ADD COLUMN IF NOT EXISTS monthly_salary_cents integer,
  ADD COLUMN IF NOT EXISTS weekly_hours numeric(5,2);

-- Alte CHECK-Constraint (html_body OR pdf_url) entfernen, damit ein Admin
-- z. B. nur das Gehalt setzen kann.
ALTER TABLE public.employee_contract_overrides
  DROP CONSTRAINT IF EXISTS employee_contract_overrides_one_source;

-- Neue, weichere Constraint: irgendetwas muss gesetzt sein.
ALTER TABLE public.employee_contract_overrides
  ADD CONSTRAINT employee_contract_overrides_any_value
  CHECK (
    html_body IS NOT NULL
    OR pdf_url IS NOT NULL
    OR monthly_salary_cents IS NOT NULL
    OR weekly_hours IS NOT NULL
  );
