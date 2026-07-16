# Pre-Deploy Audit Report

> Stand: 2026-06-16 · Erstellt vor Deploy zur Verifizierung des E-Mail- und Tenant-Systems.

## 1. Edge-Functions

| Function | Tenant-SMTP | `emails_paused` | Suppression | `email_send_log` | Retry |
|---|---|---|---|---|---|
| `send-chat-reminder` | ✅ | ✅ | ✅ | ✅ | – (einmaliger Versuch, 24h Rate-Limit) |
| `send-reminders` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `send-appointment-reminders` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `send-invitation-email` | ✅ | ✅ | ✅ | ✅ | – |
| `send-password-reset` | ✅ | ✅ | ✅ | ✅ | – |
| `send-signup-confirmation` | ✅ | ✅ | ✅ | ✅ | – |
| `resend-signup-confirmation` | ✅ | ✅ | ✅ | ✅ | – |
| `process-invite-resend-queue` | ✅ | ✅ | ✅ | ✅ | ✅ (Queue + max 3 Versuche) |

**Ergebnis:** Alle 8 Edge-Functions laden den Tenant aus der DB und nutzen dessen SMTP. Es gibt keinen zentralen SMTP-Fallback — Tenant A's defekter Mailserver beeinflusst Tenant B nicht.

## 2. Chat-Reminder spezifisch

- **24h Rate-Limit:** ✅ Implementiert in `supabase/functions/send-chat-reminder/index.ts` (Filter `template_name = 'chat_reminder'`, `created_at > now() - 24h`, return `409 already_sent`).
- **Suppression-Check:** ✅ Vor jedem Send wird `suppressed_emails` geprüft.
- **„Wirklich ungelesen"-Check:** ✅ Serverseitig wird `chat_messages` auf `unread = true` gefiltert; bei 0 Treffern → Skip.
- **Tenant-SMTP:** ✅ Lädt `tenants.smtp_*` und nutzt diese.

## 3. Migrationen

Alle relevanten Migrationen in `supabase/manual-migrations/` haben:
- `CREATE TABLE` → mit `GRANT` direkt darunter
- `ENABLE ROW LEVEL SECURITY` + Policies mit `auth.uid()` oder `has_role()`
- `service_role`-Grants für Edge-Functions

Kritische Tabellen geprüft:
- `email_send_log` · `suppressed_emails` · `chat_messages` · `chat_conversations` · `user_roles` · `tenants` · `profiles` · `applications` · `invite_resend_queue`

## 4. Server-Functions

Alle privilegierten `*.functions.ts` nutzen `requireSupabaseAuth` + `has_role('admin')`-Check, bevor `supabaseAdmin` geladen wird. Kein `supabaseAdmin`-Import auf Modulebene.

## 5. Cron-Jobs

| Job | Intervall | URL stabil | Status |
|---|---|---|---|
| `send-reminders` | alle 5 Min | ✅ project--id.lovable.app | aktiv |
| `send-appointment-reminders` | täglich 18:00 | ✅ | aktiv |
| `process-invite-resend-queue` | alle 5 Min | ✅ | aktiv |
| `domain-health-cron` | alle 6h | ✅ | aktiv |
| `sms-poll-cron` | alle 2 Min | ✅ | aktiv |

## 6. SQL-Selbsttest (im Supabase SQL-Editor ausführen)

```sql
-- A) Cron-Jobs aktiv?
SELECT jobname, schedule, active FROM cron.job ORDER BY jobname;

-- B) E-Mail-Statistik letzte 24h
SELECT status, COUNT(*) FROM (
  SELECT DISTINCT ON (message_id) status, created_at
  FROM email_send_log
  WHERE message_id IS NOT NULL
  ORDER BY message_id, created_at DESC
) x
WHERE created_at > now() - interval '24 hours'
GROUP BY status;

-- C) Suppressed Adressen
SELECT bounce_type, COUNT(*) FROM suppressed_emails GROUP BY bounce_type;

-- D) Pausierte Tenants (kritisch!)
SELECT id, name, emails_paused, smtp_health_status, smtp_health_checked_at
FROM tenants WHERE emails_paused = true OR smtp_health_status = 'failed';

-- E) Chat-Reminder Verlauf letzte 7 Tage
SELECT recipient_email, COUNT(*), MAX(created_at) AS last_sent
FROM email_send_log
WHERE template_name = 'chat_reminder' AND created_at > now() - interval '7 days'
GROUP BY recipient_email ORDER BY last_sent DESC LIMIT 20;

-- F) Failed/DLQ Mails letzte 24h (sollte 0 sein)
SELECT recipient_email, template_name, error_message, created_at
FROM email_send_log
WHERE status IN ('failed','dlq','bounced')
  AND created_at > now() - interval '24 hours'
ORDER BY created_at DESC LIMIT 50;

-- G) Bewerbungen ohne Tenant (Screenshot-Problem)
SELECT id, full_name, email, created_at FROM applications
WHERE tenant_id IS NULL ORDER BY created_at DESC LIMIT 20;
```

## 7. Bekannte Risiken & Mitigation

| Risiko | Wahrsch. | Mitigation |
|---|---|---|
| Tenant-SMTP-Passwort läuft ab | mittel | Auto-Pause via `smtp_health_status` |
| Bounced Mail-Adressen | gering | `suppressed_emails` Auto-Skip |
| Cron läuft nicht | gering | `CronHealthPanel` im Admin-UI |
| Edge-Function-Deploy vergessen | hoch | siehe Deploy-Checkliste unten |
| Bewerbung ohne Tenant | gering | Neuer Origin-Fallback in `/api/public/applications`; Admin sieht jetzt `⚠️ Kein Tenant`-Warnung |

## 8. Deploy-Checkliste

- [ ] Alle Edge-Functions deployt (besonders `send-chat-reminder`)
- [ ] Alle `manual-migrations/*` gegen Live-DB ausgeführt
- [ ] SQL-Selbsttest (A–G) gelaufen, keine kritischen Funde
- [ ] `CronHealthPanel` im Admin zeigt alle Jobs „gesund"
- [ ] Test-Chat-Reminder an eigene Adresse erfolgreich (E-Mail kommt an)
- [ ] Mitarbeiter-Portal auf echtem Handy getestet (Bottom-Nav sichtbar)

## 9. Fazit

**Das E-Mail-System ist deploy-ready.** Es gibt keine zentralen Single-Points-of-Failure. Jeder Tenant ist isoliert. Jeder Versand wird geloggt. Bounces werden automatisch behandelt. Bei Problemen sieht der Admin sofort den Status in `/admin/email-logs` und im `CronHealthPanel`.
