-- APPLY MANUALLY via: bash scripts/migrate.sh
-- Fix: Mitarbeiter sehen zugewiesene Aufträge/Termine erst NACH release_at.
-- Wenn Admin einen Termin (mit Auftrag) für die Zukunft zuweist, ist die
-- Zuweisung bis dahin komplett unsichtbar → wirkt wie "nicht zugewiesen".
--
-- Lösung: SELECT sieht ALLE eigenen zugewiesenen Aufträge (auch vor release_at).
-- UPDATE bleibt weiterhin per release_at gesperrt (Task kann nicht vorzeitig
-- bearbeitet werden).

DROP POLICY IF EXISTS "Users view own assignments" ON public.task_assignments;

CREATE POLICY "Users view own assignments"
  ON public.task_assignments
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    AND status <> 'entwurf'::public.task_assignment_status
  );
