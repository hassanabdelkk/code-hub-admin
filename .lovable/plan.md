## Diagnose

Es gibt zwei getrennte Probleme:

1. **Falscher Domain-Health-Check**
   - Der aktuelle Check prüft immer `portal.<domain>`.
   - Bei Vermittlungs-Landings ist aber die erreichbare Seite `cac-vermittlung.de` bzw. `mm-personalvermittlung.de` ohne `portal.`.
   - Deshalb werden diese Tenants fälschlich als „alle Domains down“ erkannt und der Mail-Versand automatisch wieder pausiert.

2. **Bewerbung zeigt Erfolg, obwohl Mailversand fehlschlagen kann**
   - Die Bewerbungs-API speichert die Bewerbung und versucht danach die Mail zu senden.
   - Wenn der Mailversand fehlschlägt, wird der Fehler aktuell nur geloggt, aber die Landing Page bekommt trotzdem `success: true`.
   - Darum sieht der Bewerber „Prüfen Sie Spam“, obwohl intern keine Mail rausging.
   - Die Anzeige „Keine E-Mail“ in `/admin/bewerbungen` bezieht sich auf Reminder-Logs, nicht zwingend auf die direkte Bewerbungseingangs-Mail. Das ist verwirrend.

## Plan

### 1. Domain-Health-Check für Landing-Domains korrigieren
- Den Health-Check so ändern, dass er nicht blind `portal.<domain>` prüft.
- Pro Tenant werden künftig beide Varianten geprüft:
  - `https://<domain>/`
  - `https://portal.<domain>/`
- Eine Domain gilt als erreichbar, wenn mindestens eine der Varianten antwortet.
- Auto-Pause passiert nur noch, wenn wirklich keine Variante erreichbar ist.
- Die Admin-Ansicht `/admin/domains` zeigt klar an, welche URL geprüft wurde und ob Root oder Portal erreichbar ist.

### 2. Auto-Pause robuster machen
- Bei Vermittlungs-/Landing-Domains wird `portal.` nicht mehr als Pflicht vorausgesetzt.
- Die Fehlermeldung wird angepasst von „portal.domain down“ auf „Root und Portal nicht erreichbar“, wenn beide Varianten fehlschlagen.
- Das verhindert, dass der Versand nach manueller Reaktivierung direkt wieder deaktiviert wird, obwohl die Landing Page erreichbar ist.

### 3. Bewerbungsmail-Fehler sichtbar machen
- Die Bewerbungs-API soll beim direkten Mailversand das Ergebnis erfassen:
  - erfolgreich gesendet
  - Tenant pausiert
  - SMTP-Fehler
  - Edge-/Function-Fehler
- Für Broker-/Vermittlungsbewerbungen wird weiterhin die Bewerbung gespeichert, aber der Rückgabewert enthält künftig einen klaren `email_status`.
- Dadurch kann die Landing Page künftig eine ehrlichere Meldung anzeigen, z. B. „Bewerbung eingegangen, E-Mail wird geprüft“ oder „Bewerbung eingegangen, E-Mail konnte gerade nicht gesendet werden“.

### 4. Admin-Anzeige „Keine E-Mail“ entwirren
- In `/admin/bewerbungen` die bisherige „Keine E-Mail“-Anzeige präzisieren:
  - „Keine Reminder-Mail“ statt „Keine E-Mail“, wenn es nur um Reminder geht.
- Optional zusätzlich die direkte Bewerbungsmail aus `email_send_log` anzeigen, damit sichtbar ist, ob die Eingangs-/Terminmail gesendet oder fehlgeschlagen ist.

### 5. Verifikation
- Nach Änderung prüfen:
  - `cac-vermittlung.de` wird als erreichbar erkannt, auch wenn `portal.cac-vermittlung.de` nicht erreichbar ist.
  - Reaktivierter Versand bleibt aktiv, solange Root-Domain erreichbar ist.
  - Neue Bewerbung erzeugt entweder einen `sent`- oder `failed`-Eintrag im Mail-Protokoll.
  - Landing-Page-Erfolgsmeldung passt zum tatsächlichen Mailstatus.

## Technische Details

Betroffene Stellen:
- `src/routes/api/public/domain-health-cron.ts`
- `src/lib/tenant-domains.functions.ts`
- `src/routes/admin.domains.tsx`
- `src/routes/api/public/applications.ts`
- `src/routes/admin.bewerbungen.tsx`

Keine Datenbankmigration ist zwingend nötig, weil `email_send_log` bereits von `send-invitation-email` beschrieben wird.