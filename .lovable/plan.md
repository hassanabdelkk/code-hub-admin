## Befund

Die Bewerbung kommt im Portal an, also erreicht der Submit `/api/public/applications` korrekt. Der Ausfall liegt danach im Mail-Versandpfad.

Aktuell versucht die Bewerbungs-Route die Eingangsbestätigung über die alte Funktion `send-invitation-email` zu senden. Diese Funktion nutzt mandantenbezogene SMTP-Daten und bricht ab, wenn SMTP fehlt, pausiert ist oder nicht verifiziert werden kann. Außerdem ist im Projekt noch kein Lovable-E-Mail-Domain-Setup aktiv; der moderne Lovable-Emails-Pfad ist daher nicht einsatzbereit.

Zusätzlich erklärt das dein Log-Problem: Die Bewerbung kann erfolgreich gespeichert werden, während der Mailfehler intern nur als `email_status.failed` in der JSON-Antwort bzw. in anderen Laufzeitlogs sichtbar wird — nicht zwingend in deinem `journalctl`-Stream, je nachdem, wo die alte Function läuft.

## Plan

1. **Mail-Fehler eindeutig sichtbar machen**
   - In `/api/public/applications` bei jedem Mailversuch strukturierte Logs mit `requestId`, `application_id`, `template`, `tenant_id`, `recipient`, `status` und `reason` ausgeben.
   - Die Antwort enthält weiterhin `email_status`, damit man im Browser/Request sofort sieht, ob gesendet, übersprungen oder fehlgeschlagen wurde.

2. **Alten SMTP-Pfad sauber absichern**
   - Vor dem Aufruf von `send-invitation-email` prüfen, ob der Mandant aktiv ist, SMTP vollständig konfiguriert ist und E-Mails nicht pausiert sind.
   - Wenn nicht, keine stille Fehlannahme mehr: `email_status.failed` mit klarer Ursache wie `smtp_not_configured`, `tenant_emails_paused` oder `tenant_inactive`.
   - Dadurch landet der Grund sichtbar in den Portal-Logs und optional in der Admin-Oberfläche.

3. **Eingangsbestätigung robust machen**
   - Für normale Bewerbungen weiterhin nur beim ersten Submit senden, um Doppel-/Spam-Mails zu vermeiden.
   - Keine Bestätigung bei Testbewerbungen oder Duplikaten.
   - Fasttrack bleibt separat, weil dort bereits die Einladung verschickt wird.

4. **Admin-Nachvollziehbarkeit prüfen/ergänzen**
   - Sicherstellen, dass fehlgeschlagene `application_received`-Versuche in `email_send_log` sichtbar sind oder zumindest im Bewerbungs-Response/Serverlog eindeutig auftauchen.
   - Falls die alte Function wegen fehlender Pflichtdaten gar keinen Log-Eintrag schreibt, ergänze ich in der Bewerbungs-Route einen eigenen Diagnose-Logeintrag.

5. **Empfohlener Zielzustand: Lovable Emails statt Tenant-SMTP**
   - Für bessere Zustellbarkeit und weniger SMTP-Probleme sollte die Eingangsbestätigung langfristig über Lovable Emails laufen.
   - Dafür muss zuerst ein eigener Sender-Domain eingerichtet werden. Ohne Domain kann Lovable keine App-E-Mails senden.
   - Nach Domain-Setup würde ich die Bewerbungsbestätigung als App-Mail-Template anlegen und den Bewerbungs-Submit auf diesen modernen Versandpfad umstellen.

## Umsetzung nach Freigabe

Ich ändere zunächst nur den bestehenden Portal-Code so, dass die Ursache eindeutig sichtbar wird und keine Mailfehler mehr „verschluckt“ werden. Danach sehen wir anhand der Logs sofort, ob SMTP fehlt/pausiert/fehlschlägt oder ob die alte Function nicht deployed/erreichbar ist.

Wenn du anschließend Lovable Emails nutzen willst, richte ich den modernen App-Mail-Pfad ein, sobald die Sender-Domain konfiguriert ist.