// ── Shared email log types, status config ──

export interface EmailLog {
  id: string;
  message_id: string | null;
  template_name: string;
  recipient_email: string;
  status: string;
  error_message: string | null;
  metadata: any;
  created_at: string;
  acknowledged_at?: string | null;
}

export const EMAIL_STATUS_COLORS: Record<string, string> = {
  sent: "bg-accent text-accent-foreground border border-accent font-semibold",
  failed: "bg-destructive text-destructive-foreground border border-destructive font-semibold",
  dlq: "bg-destructive text-destructive-foreground border border-destructive font-semibold",
  bounced: "bg-destructive text-destructive-foreground border border-destructive font-semibold",
  complained: "bg-status-pending/20 text-status-pending border border-status-pending/30 font-medium",
  suppressed: "bg-status-pending/20 text-status-pending border border-status-pending/30 font-medium",
};

export const EMAIL_STATUS_LABELS: Record<string, string> = {
  sent: "Gesendet",
  failed: "Fehlgeschlagen",
  dlq: "Endgültig fehlgeschlagen",
  bounced: "Gebounced",
  complained: "Beschwerde",
  suppressed: "Unterdrückt",
};

export const EMAIL_TYPE_LABELS: Record<string, string> = {
  invitation: "Einladung",
  test_email: "Test",
  auth_emails: "Auth / Reset",
  "contact-confirmation": "Kontakt",
  auth_recovery: "Passwort-Reset",
  auth_signup: "Bestätigung",
  auth_confirmation: "Bestätigung",
  auth_invite: "Einladung",
  auth_magiclink: "Magic Link",
  reminder_invite: "Reminder · Einladung",
  reminder_confirm_email: "Reminder · E-Mail bestätigen",
  reminder_complete_registration: "Reminder · Onboarding",
  reminder_no_recent_booking: "Reminder · Keine Buchung",
  reminder_domain_recovery: "Reminder · Domain-Recovery",
};

export interface EmailStats {
  total: number;
  sent: number;
  failed: number;
  bounced: number;
  suppressed: number;
  successRate: number;
  /** Unbearbeitete Fails der letzten 24h (treibt den "Aktion erforderlich"-Banner) */
  openFailures24h: number;
  actionRequired: boolean;
}

const STATUS_PRIORITY: Record<string, number> = {
  sent: 6,
  bounced: 5,
  complained: 5,
  suppressed: 4,
  dlq: 3,
  failed: 2,
  pending: 1,
};

export function emailLogKey(log: EmailLog): string {
  const tenant = log.metadata?.tenant_id || log.metadata?.tenant_name || "global";
  const sentDay = new Date(log.created_at).toISOString().slice(0, 10);
  if (log.template_name === "invitation" || log.template_name.startsWith("reminder_")) {
    return ["logical", tenant, log.template_name, log.recipient_email.toLowerCase(), sentDay].join("|");
  }

  const metaMessageId = typeof log.metadata?.message_id === "string" ? log.metadata.message_id : null;
  const messageId = log.message_id || metaMessageId;
  if (messageId) return `message:${messageId}`;

  return [tenant, log.template_name, log.recipient_email.toLowerCase(), sentDay].join("|");
}

export function dedupeEmailLogs<T extends EmailLog>(logs: T[]): T[] {
  const latest = new Map<string, T>();
  for (const log of logs) {
    const key = emailLogKey(log);
    const current = latest.get(key);
    if (!current) {
      latest.set(key, log);
      continue;
    }
    const logTime = new Date(log.created_at).getTime();
    const currentTime = new Date(current.created_at).getTime();
    if (logTime > currentTime || (logTime === currentTime && (STATUS_PRIORITY[log.status] ?? 0) > (STATUS_PRIORITY[current.status] ?? 0))) {
      latest.set(key, log);
    }
  }
  return Array.from(latest.values()).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

/**
 * Compute email stats from the latest state per logical email.
 * `actionRequired` zählt nur nicht-acknowledgte Fails der letzten 24h —
 * alte permanente Fehler verschwinden nach Ack aus dem Banner.
 */
export function computeEmailStats(logs: EmailLog[]): EmailStats {
  const finalLogs = dedupeEmailLogs(logs).filter(l => l.status !== "pending");
  const total = finalLogs.length;
  const sent = finalLogs.filter(l => l.status === "sent").length;
  const failed = finalLogs.filter(l => ["failed", "dlq"].includes(l.status)).length;
  const bounced = finalLogs.filter(l => l.status === "bounced").length;
  const suppressed = finalLogs.filter(l => l.status === "suppressed").length;
  const successRate = total > 0 ? Math.round((sent / total) * 100) : 100;

  const cutoff = Date.now() - 24 * 3600_000;
  const openFailures24h = finalLogs.filter(l =>
    ["failed", "dlq", "bounced"].includes(l.status)
    && !l.acknowledged_at
    && new Date(l.created_at).getTime() >= cutoff
  ).length;

  return {
    total,
    sent,
    failed,
    bounced,
    suppressed,
    openFailures24h,
    actionRequired: openFailures24h > 0,
    successRate,
  };
}
