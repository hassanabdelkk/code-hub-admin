# Ziel

Wenn `mb-portal.com` (Frontend + `api.mb-portal.com`) ausfällt (Registrar-Sperre, DNS-Problem, Domain-Streit), soll das gesamte System auf einer **zweiten, komplett unabhängigen Domain** innerhalb von <30 Min wieder erreichbar sein — **ohne Code-Änderung, ohne Rebuild, ohne DB-Migration**.

Server (Portal-Host `190.97.167.124`, Backend-Host `190.97.167.123`) und DB bleiben dieselben — nur die Domain wechselt.

---

## Architektur-Prinzip

Das System darf **nirgends** eine Domain hart einbrennen. Aktuell tut es das an mindestens 3 Stellen (Frontend-Build via `VITE_SUPABASE_URL`, Backend-CORS, Supabase Auth `SITE_URL` / `redirect_urls`, ggf. E-Mail-Templates). Das ist der eigentliche Blocker — nicht die DNS.

Lösung: **Zwei Domains dauerhaft parallel aktiv** (aktiv-aktiv), beide zeigen auf dieselben Server, beide sind in Supabase Auth freigeschaltet, beide haben TLS. Der "Failover" ist dann nur noch: primäre Domain aus der Kommunikation nehmen, Nutzer die andere URL schicken.

```text
     mb-portal.com ─┐                    ┌─ 190.97.167.124 (Portal / Frontend)
                    ├──► DNS A/AAAA ────►│
  mb-portal-eu.com ─┘                    └─ 190.97.167.123 (Supabase / api)
     (Standby)
```

---

## Schritte

### 1. Zweite Domain beschaffen (einmalig, manuell durch dich)
- Anderer **Registrar** als die Hauptdomain (wichtig — sonst gleicher Ausfallgrund).
- Andere **TLD** empfohlen (`.eu`, `.app`, `.de`), damit auch TLD-Registry-Ausfälle abgedeckt sind.
- Beispielname im Rest des Plans: `mb-portal-eu.com` (Platzhalter).

### 2. DNS auf beiden Domains identisch setzen
Für **beide** Domains dieselben Records:
- `@` A → `190.97.167.124` (Portal)
- `api` A → `190.97.167.123` (Backend/Supabase)
- TTL auf **300s** (5 Min) — damit spätere Änderungen schnell greifen.

### 3. TLS für beide Domains am Portal-Host + Backend-Host
- Caddy/Nginx auf Portal-Host: `server_name mb-portal.com mbportal.com mb-portal-eu.com;` mit Let's Encrypt für alle Namen.
- Analog Backend-Host für `api.mb-portal.com` + `api.mb-portal-eu.com`.
- Beide Zerts jetzt schon ausstellen — nicht erst im Notfall (LE-Rate-Limits, DNS-Propagation).

### 4. App domain-agnostisch machen (das ist der einzige Code-/Config-Teil)
An diesen Stellen darf keine feste Domain mehr stehen:

**Frontend (`/opt/apps/portal/.env` auf Portal-Host):**
- `VITE_SUPABASE_URL` bleibt auf Primär (`https://api.mb-portal.com`), aber der Client fällt bei Fehler auf einen zweiten Endpoint zurück — ODER (einfacher): Frontend liest `SUPABASE_URL` **zur Laufzeit** aus `/config.json`, das vom Reverse Proxy pro Host gesetzt wird. Empfehlung: **runtime config**, damit kein Rebuild bei Switch nötig.

**Backend / Supabase Env:**
- `SITE_URL` → primäre Domain, aber `ADDITIONAL_REDIRECT_URLS` enthält **beide** Domains (`https://mb-portal.com/*,https://mb-portal-eu.com/*`).
- `GOTRUE_URI_ALLOW_LIST` beide Domains.
- CORS in PostgREST/Kong: beide Origins whitelisten.

**E-Mails (Auth-Templates, transactional):**
- Links per `{{ .SiteURL }}` — Supabase setzt das automatisch. Nicht hart schreiben.

**Deploy-Skript (`scripts/deploy.sh`):**
- Keine Domain hart drin. Health-Check auf `localhost:PORT`, nicht auf `mb-portal.com`.

### 5. Runbook „Domain-Switch in 15 Min" (dokumentiert unter `/opt/apps/portal/RUNBOOK.md`)

```text
Voraussetzung: Primär mb-portal.com ist down, Standby mb-portal-eu.com ist eingerichtet.

1. Prüfen: curl -I https://mb-portal-eu.com   → 200
            curl -I https://api.mb-portal-eu.com/health → 200
2. In Supabase-Dashboard (self-hosted Studio):
   Auth → URL Config → SITE_URL auf https://mb-portal-eu.com setzen.
   (Redirect-Liste enthält sie bereits.)
3. /opt/apps/portal/.env auf Portal-Host:
   VITE_SUPABASE_URL=https://api.mb-portal-eu.com
   VITE_SITE_URL=https://mb-portal-eu.com
   → sudo systemctl restart portal
   (nur nötig, falls NICHT runtime-config; mit runtime-config entfällt Schritt 3.)
4. Nutzer-Kommunikation: Statusseite / E-Mail / Discord mit neuer URL.
5. Sobald Primär wieder da: Schritte 2–3 rückwärts, kein Notfall.
```

### 6. Statusseite auf dritter Domain (optional, empfohlen)
Einfache statische Seite bei einem dritten Provider (Cloudflare Pages, GitHub Pages), die immer erreichbar bleibt und die jeweils **aktuell gültige** URL anzeigt. Nutzer lernen: "wenn nichts geht → status.mb-portal.io schauen".

---

## Was NICHT eingebaut wird

- ❌ Kein automatischer DNS-Failover (Cloudflare LB) — schützt nicht vor Registrar-Sperre der Hauptdomain, teuer, komplex.
- ❌ Kein zweiter DB-Stack / keine Replikation — anderes Problem (Server-Ausfall), nicht Domain-Ausfall. Wenn gewünscht, separater Plan.
- ❌ Keine Änderungen an Login/Business-Logik.

---

## Reihenfolge der Umsetzung

1. **Du**: zweite Domain kaufen (anderer Registrar, andere TLD), Namen an mich zurückmelden.
2. **Ich (im Build-Modus)**: Runtime-Config-Mechanismus im Frontend einbauen (`/config.json` statt `VITE_*` zur Build-Zeit), damit Domain-Switch **ohne Rebuild** geht. Das ist die einzige echte Code-Änderung.
3. **Du auf den Servern**: DNS beider Domains setzen, Caddy/Nginx auf beide `server_name` erweitern, LE-Zerts ausstellen, Supabase Auth Redirect-Liste erweitern.
4. **Ich**: `RUNBOOK.md` + `scripts/switch-domain.sh` (idempotent) ins Repo legen.
5. **Gemeinsam**: einmal in Ruhe durchspielen (Trockenlauf: Switch auf Standby, 5 Min laufen lassen, zurückschwenken).

---

## Offene Frage vor Start

Bevor Schritt 2 losgeht: **Ist die zweite Domain schon gekauft, oder soll ich den Runtime-Config-Umbau + Runbook mit Platzhaltern (`SECONDARY_DOMAIN`) vorbereiten, damit du sie später nur eintragen musst?**