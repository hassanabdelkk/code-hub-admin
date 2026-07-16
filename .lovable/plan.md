## Ziel
Das Portal soll nach jedem Deploy stabil starten und der Landing-Generator darf nicht mehr regelmäßig mit „Unauthorized: Invalid token“ / „Liste laden fehlgeschlagen“ hängen bleiben.

## Was im Log auffällt
- Der Build läuft durch.
- Der Auth-Attacher-Guard läuft durch, also wurde `src/start.ts` diesmal nicht wieder falsch überschrieben.
- Danach ist `portal.service` nicht stabil aktiv, weil Port `3000` offenbar noch belegt ist.
- Zusätzlich gibt es alte Chunk-Datei-Fehler (`ENOENT ... .output/server/_ssr/...mjs`). Das passt zu einem nicht-atomaren Deploy: Browser/Server referenzieren während oder kurz nach dem Build alte Hash-Dateien, die schon ersetzt wurden.
- Es fehlt auf dem Portal-Server `SUPABASE_SERVICE_ROLE_KEY`; einige Admin-Funktionen importieren den Admin-Client noch auf Modulebene. Dadurch kann der Server bei bestimmten Routen/Server-Funktionen unnötig hart fehlschlagen.

## Plan
1. **Deploy-Skript robust machen**
   - Vor dem Restart prüfen, ob Port `3000` noch von einem alten Prozess belegt ist.
   - Falls ja: sauber stoppen, kurz warten, notfalls gezielt den alten Listener beenden.
   - Nach Restart nicht nur `systemctl is-active`, sondern auch einen lokalen HTTP-Healthcheck ausführen.

2. **Nicht-atomare `.output`-Deploys entschärfen**
   - Build zuerst in einen separaten Release-/Temp-Ordner schreiben oder die alte `.output` erst ersetzen, wenn der neue Build vollständig fertig ist.
   - Damit verschwinden die `ENOENT reading ... old-hash.mjs` Fehler, die beim Überschreiben laufender Builds entstehen.

3. **Admin-Client-Imports korrigieren**
   - Module-level Imports von `@/integrations/supabase/client.server` in Server-Fn-Dateien entfernen.
   - Stattdessen `supabaseAdmin` nur innerhalb der jeweiligen `.handler()` laden, nachdem der Admin geprüft wurde.
   - Betroffene Dateien: `admin-employees.functions.ts`, `admin-delete.functions.ts`, `admin-contract.functions.ts`, `contract-pdf.functions.ts`, `email-log-ack.functions.ts`.

4. **Guard gegen Rückfall ergänzen**
   - Einen zweiten Build-Guard hinzufügen, der verhindert, dass `client.server` wieder auf Modulebene in `.functions.ts` importiert wird.
   - So bricht der Deploy künftig früh ab, statt live mit Auth-/Runtime-Fehlern zu starten.

5. **Portal-Server-Konfiguration absichern**
   - `setup-server2.sh`/Deploy-Hinweise so anpassen, dass alle nötigen Runtime-Variablen im `portal.service` landen.
   - Falls der Service-Role-Key auf dem Portal bewusst nicht liegen soll, dann müssen die wenigen Funktionen, die ihn wirklich brauchen, anders abgesichert/ausgelagert werden. Für die aktuellen Admin-Aktionen wird er aber verwendet.

6. **Nach Umsetzung verifizieren**
   - Prüfen, dass der Build-Guard greift.
   - Prüfen, dass `start.ts` weiterhin nur den robusten Bearer-Attacher nutzt.
   - Prüfen, dass keine kritischen Module-level Admin-Client-Imports mehr vorhanden sind.
   - Dann kannst du mit einem kurzen Deploy-Befehl testen; falls Port 3000 belegt ist, soll das Skript ihn selbst reparieren.