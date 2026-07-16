import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Mail, RefreshCw, CheckCircle2, XCircle, Clock, AlertTriangle, Search, FileText, ScrollText, Pencil,
} from "lucide-react";


export const Route = createFileRoute("/admin/email-center")({
  component: AdminEmailCenterPage,
});

/**
 * E-Mail-Center v2 — Reset & minimal.
 * Zeigt ausschließlich das, was der aktuelle Flow tatsächlich versendet.
 * Alles wird live aus email_send_log berechnet (dedupliziert per message_id).
 */

// Aktive Templates im neuen Flow (Bewerbung -> Interview -> Onboarding).
const ACTIVE_TEMPLATES: { key: string; label: string; group: string; trigger: string }[] = [
  // Vermittlungs-Flow (Broker) — Bewerber-Reminder aus send-application-reminders
  { key: "vermittlung_no_booking_24h", label: "Vermittlung: Kein Termin (24h)",  group: "Vermittlung", trigger: "24h nach Bewerbung ohne Calendly-Buchung" },
  { key: "vermittlung_no_booking_72h", label: "Vermittlung: Kein Termin (72h)",  group: "Vermittlung", trigger: "72h nach Bewerbung ohne Calendly-Buchung" },
  { key: "vermittlung_no_show_24h",    label: "Vermittlung: No-Show (24h)",      group: "Vermittlung", trigger: "24h nach verpasstem Termin" },
  { key: "bewerbung_magic_link",       label: "Vermittlung: Interview-Einladung", group: "Vermittlung", trigger: "30 Minuten vor dem Termin" },
  // Fast-Track / Onboarding
  { key: "invitation",                       label: "Herzlichen Glückwunsch", group: "Onboarding", trigger: "Sofort nach Fast-Track-Zusage" },
  { key: "reminder_complete_registration",   label: "Registrierung abschließen",    group: "Reminder",   trigger: "3 Reminder – 24h / 48h / 72h nach Zusage" },
  { key: "reminder_onboarding_incomplete",   label: "Onboarding (Perso/Vertrag)",   group: "Reminder",   trigger: "3 Reminder – nach Registrierung ohne KYC/Vertrag" },
  { key: "reminder_confirm_email",           label: "E-Mail bestätigen",            group: "Reminder",   trigger: "3 Reminder bei unbestätigter Mail" },
  { key: "appointment_reminder",             label: "No-Show Interview",            group: "Reminder",   trigger: "3 Reminder – 2h / 24h / 72h nach verpasstem Termin" },
  { key: "reminder_no_recent_booking",       label: "Keine Buchung (7 Tage)",       group: "Reminder",   trigger: "1 Reminder nach 7 Tagen ohne Auftragsbuchung" },
  { key: "chat_reminder",                    label: "Chat-Reminder (manuell)",      group: "Support",    trigger: "Wird vom Admin manuell ausgelöst" },
  { key: "password_reset",                   label: "Passwort zurücksetzen",        group: "Auth",       trigger: "User löst Reset aus" },
];

type Row = { message_id: string; template_name: string; recipient_email: string; status: string; error_message: string | null; created_at: string };

function AdminEmailCenterPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<"24h" | "7d" | "30d">("7d");
  const [q, setQ] = useState("");

  const load = async () => {
    setLoading(true);
    const since = new Date(Date.now() - (range === "24h" ? 1 : range === "7d" ? 7 : 30) * 86400_000).toISOString();
    const { data } = await supabase
      .from("email_send_log")
      .select("message_id,template_name,recipient_email,status,error_message,created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(5000);
    // Dedup per message_id (neueste Zeile gewinnt)
    const seen = new Set<string>();
    const dedup: Row[] = [];
    for (const r of (data as Row[] | null) ?? []) {
      const key = r.message_id || `${r.template_name}:${r.recipient_email}:${r.created_at}`;
      if (seen.has(key)) continue;
      seen.add(key);
      dedup.push(r);
    }
    setRows(dedup);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [range]);

  const stats = useMemo(() => {
    const s = { total: rows.length, sent: 0, failed: 0, pending: 0 };
    for (const r of rows) {
      if (r.status === "sent") s.sent++;
      else if (r.status === "dlq" || r.status === "failed" || r.status === "bounced") s.failed++;
      else if (r.status === "pending") s.pending++;
    }
    return s;
  }, [rows]);

  const perTemplate = useMemo(() => {
    const m = new Map<string, { sent: number; failed: number; pending: number; last?: string }>();
    for (const r of rows) {
      const cur = m.get(r.template_name) ?? { sent: 0, failed: 0, pending: 0 };
      if (r.status === "sent") cur.sent++;
      else if (r.status === "dlq" || r.status === "failed" || r.status === "bounced") cur.failed++;
      else if (r.status === "pending") cur.pending++;
      if (!cur.last || r.created_at > cur.last) cur.last = r.created_at;
      m.set(r.template_name, cur);
    }
    return m;
  }, [rows]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    if (!ql) return rows.slice(0, 100);
    return rows.filter(r =>
      r.recipient_email?.toLowerCase().includes(ql) ||
      r.template_name?.toLowerCase().includes(ql)
    ).slice(0, 100);
  }, [rows, q]);

  return (
    <div className="p-6 lg:p-8 space-y-5 max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-2xl bg-primary/10 grid place-items-center">
            <Mail className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-heading font-bold">E-Mail-Center</h1>
            <p className="text-sm text-muted-foreground">Aktive Templates im neuen Flow — live aus email_send_log.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(["24h", "7d", "30d"] as const).map(k => (
            <Button key={k} size="sm" variant={range === k ? "default" : "outline"} onClick={() => setRange(k)} className="h-8 text-xs">
              {k === "24h" ? "24 h" : k === "7d" ? "7 Tage" : "30 Tage"}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={load} disabled={loading} className="h-8">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Cross-Nav */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground mr-1">Weiter zu:</span>
        <Link to="/admin/email-templates">
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5">
            <Pencil className="h-3 w-3" /> Templates bearbeiten
          </Button>
        </Link>
        <Link to="/admin/email-logs">
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5">
            <ScrollText className="h-3 w-3" /> Roh-Log ansehen
          </Button>
        </Link>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Gesamt" value={stats.total} icon={Mail} tone="muted" />
        <Kpi label="Versendet" value={stats.sent} icon={CheckCircle2} tone="emerald" />
        <Kpi label="Ausstehend" value={stats.pending} icon={Clock} tone="amber" />
        <Kpi label="Fehlgeschlagen" value={stats.failed} icon={XCircle} tone="rose" />
      </div>

      {/* Aktive Templates */}
      <Card>
        <CardContent className="p-0">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">Aktive Mail-Templates</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">Klick auf ein Template öffnet den Editor.</div>
            </div>
            <div className="text-xs text-muted-foreground">Zeitraum: {range === "24h" ? "24 h" : range === "7d" ? "7 Tage" : "30 Tage"}</div>
          </div>
          <div className="divide-y">
            {ACTIVE_TEMPLATES.map(t => {
              const s = perTemplate.get(t.key) ?? { sent: 0, failed: 0, pending: 0 };
              const total = s.sent + s.failed + s.pending;
              const lastRel = s.last ? relativeTime(s.last) : null;
              return (
                <Link
                  key={t.key}
                  to="/admin/email-templates"
                  className="px-4 py-3 flex items-center gap-4 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{t.label}</span>
                      <Badge variant="secondary" className="text-[10px]">{t.group}</Badge>
                      {total === 0 && (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground border-dashed">
                          Kein Versand im Zeitraum
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {t.trigger}
                      {lastRel && <span className="ml-1.5">· Zuletzt {lastRel}</span>}
                    </div>
                  </div>
                  <div className="hidden sm:flex items-center gap-4 text-xs tabular-nums">
                    <span className="text-emerald-600">✓ {s.sent}</span>
                    <span className="text-amber-600">⏳ {s.pending}</span>
                    <span className="text-rose-600">✗ {s.failed}</span>
                  </div>
                  <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                </Link>
              );
            })}
          </div>
        </CardContent>
      </Card>


      {/* Fehler-Feed */}
      {stats.failed > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="px-4 py-3 border-b flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-rose-500" />
              <div className="text-sm font-semibold">Probleme</div>
              <Badge variant="destructive" className="text-[10px]">{stats.failed}</Badge>
            </div>
            <div className="divide-y max-h-72 overflow-auto">
              {rows.filter(r => r.status === "dlq" || r.status === "failed" || r.status === "bounced").slice(0, 30).map((r, i) => (
                <div key={i} className="px-4 py-2 text-xs flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{r.template_name} → {r.recipient_email}</div>
                    {r.error_message && <div className="text-rose-600 truncate">{r.error_message}</div>}
                  </div>
                  <div className="text-[10px] text-muted-foreground shrink-0">{new Date(r.created_at).toLocaleString("de-DE")}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Log-Explorer */}
      <Card>
        <CardContent className="p-0">
          <div className="px-4 py-3 border-b flex items-center gap-2">
            <div className="text-sm font-semibold flex-1">Verlauf</div>
            <div className="relative w-64">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={e => setQ(e.target.value)} placeholder="E-Mail oder Template…" className="h-8 pl-8 text-xs" />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/30">
                <tr>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Template</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Empfänger</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Status</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Wann</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((r, i) => (
                  <tr key={i} className="hover:bg-muted/20">
                    <td className="px-4 py-1.5 font-mono text-[11px]">{r.template_name}</td>
                    <td className="px-4 py-1.5 text-muted-foreground">{r.recipient_email}</td>
                    <td className="px-4 py-1.5"><StatusBadge status={r.status} /></td>
                    <td className="px-4 py-1.5 text-[10px] text-muted-foreground tabular-nums">{new Date(r.created_at).toLocaleString("de-DE")}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">Nichts zu sehen.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} Min.`;
  const h = Math.floor(min / 60);
  if (h < 24) return `vor ${h} Std.`;
  const d = Math.floor(h / 24);
  if (d < 7) return `vor ${d} Tag${d === 1 ? "" : "en"}`;
  return new Date(iso).toLocaleDateString("de-DE");
}


function Kpi({ label, value, icon: Icon, tone }: { label: string; value: number; icon: any; tone: "muted" | "emerald" | "amber" | "rose" }) {
  const c = {
    muted:   "bg-muted/40 text-foreground",
    emerald: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
    amber:   "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
    rose:    "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  }[tone];
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`h-9 w-9 rounded-lg grid place-items-center ${c}`}><Icon className="h-4 w-4" /></div>
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-xl font-heading font-bold tabular-nums">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    sent:       "bg-emerald-100 text-emerald-700",
    pending:    "bg-amber-100 text-amber-800",
    dlq:        "bg-rose-100 text-rose-700",
    failed:     "bg-rose-100 text-rose-700",
    bounced:    "bg-rose-100 text-rose-700",
    suppressed: "bg-slate-200 text-slate-700",
  };
  return <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium ${map[status] ?? "bg-muted text-muted-foreground"}`}>{status}</span>;
}
