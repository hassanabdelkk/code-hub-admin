
## Was ist passiert?

Der Build ist **erfolgreich** durchgelaufen und das neue Release wurde aktiviert:

```
▸ 3/5  Build atomar aktivieren
  ✓ Release aktiviert: /opt/apps/portal/.releases/20260716-175926
```

Dann brach der Deploy an Schritt **4/5 „Manual-Migrations prüfen"** ab:

```
· 20260602000000_tenant_primary_domain.sql → einspielen…
psql: error: FATAL: Tenant or user not found
```

**Folge:** Schritt 5/5 (`systemctl restart portal.service`) wurde **nicht** ausgeführt. Das Portal läuft also noch mit dem alten Symlink → die neue `form-section.js` ist zwar gebaut, aber nicht live.

## Warum der psql-Fehler?

Zwei kombinierte Ursachen:

1. **`TARGET_DB_URL` in `.env` ist falsch/veraltet** — `FATAL: Tenant or user not found` ist der klassische Supabase-Pooler-Fehler, wenn der Username (`postgres.<projectref>`) auf ein nicht mehr existierendes Cloud-Projekt zeigt oder das Format falsch ist. Auf `.124` soll dort die self-hosted DB auf `.123` stehen — nicht die alte Lovable-Cloud-URL.
2. **State-File `.deploy-migrations-applied` ist leer** → das Skript versucht **alle 60+ historischen Migrations** neu einzuspielen, obwohl sie längst in der DB sind. Beim ersten Fehler bricht `set -e` sofort ab.

## Lösung — zwei Schritte

### Schritt 1 — Portal jetzt sofort auf neuen Release umschalten (30 Sek.)

Auf `.124`:

```bash
systemctl restart portal.service
systemctl status portal.service --no-pager | head -15
```

Damit ist die neue `form-section.js` mit den Termin-CTAs im Portal-Build aktiv. Dann Landing-Pages neu generieren (Admin → Landing-Generator) — die statischen HTMLs auf dem Landing-Server holen sich dann die neue Datei.

### Schritt 2 — Deploy-Skript entschärfen, damit das nicht wieder passiert

Zwei kleine Anpassungen in `scripts/deploy.sh` Schritt 4:

- **State-File vorpopulieren**, falls leer: alle bereits vorhandenen `manual-migrations/*.sql` einmalig als „angewendet" markieren. Neue Migrations werden ab jetzt normal erkannt und eingespielt.
- **Migrations-Fehler nicht fatal**: wenn `psql` fehlschlägt, `warn` loggen und weitermachen — der Service-Restart darf davon nicht abhängen. Neue Migrations bitte weiterhin bewusst manuell prüfen; das war vor unserer Deploy-Automatisierung auch der Prozess.

Optional zusätzlich: einen kurzen Preflight, der `TARGET_DB_URL` einmal mit `psql -c 'select 1'` testet und bei Fehler direkt sagt „Connection kaputt — Migrations-Schritt übersprungen".

## Reihenfolge nach Approval

1. Ich passe `scripts/deploy.sh` an (State-File-Vorpopulierung + Fehler-Tolerierung).
2. Du machst auf `.124`: `systemctl restart portal.service` (bringt die aktuelle Build-Version sofort live).
3. Danach `git pull` auf `.124` (holt die deploy.sh-Änderung); künftige `bash scripts/deploy.sh`-Läufe brechen dann nicht mehr am Migrations-Schritt ab.
4. Landing-Pages im Admin neu generieren → Vermittlungs-Popup zeigt den Termin-Button.
