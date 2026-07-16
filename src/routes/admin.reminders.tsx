import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/EmptyState";
import { TableSkeleton, PageHeaderSkeleton } from "@/components/SkeletonLoaders";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BellRing, RefreshCw, CheckCircle2, XCircle, Send, Clock, Activity, Loader2, Eye, Mail } from "lucide-react";
import { getReminderHealth } from "@/lib/reminder-log.functions";

export const Route = createFileRoute("/admin/reminders")({
  component: AdminRemindersPage,
});

interface ReminderRow {
  id: string;
  email: string;
  tenant_id: string | null;
  reminder_type: string;
  attempt: number;
  sent_at: string;
  status: string;
  error: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  invite: "Einladung (Bewerber)",
  confirm_email: "E-Mail bestätigen",
  complete_registration: "Registrierung abschließen",
  no_recent_booking: "Keine Buchung (7+ Tage)",
  domain_recovery: "Domain-Recovery",
};

const REMINDER_TEMPLATE_NAMES: Record<string, string> = {
  invite: "reminder_invite",
  confirm_email: "reminder_confirm_email",
  complete_registration: "reminder_complete_registration",
  no_recent_booking: "reminder_no_recent_booking",
  domain_recovery: "reminder_domain_recovery",
};

export function AdminRemindersPage() {
  const { toast } = useToast();
  const healthFn = useServerFn(getReminderHealth);
  const [rows, setRows] = useState<ReminderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [running, setRunning] = useState<"send" | "dry" | null>(null);
  const [health, setHealth] = useState<any>(null);
  const [loadingHealth, setLoadingHealth] = useState(false);
  const [preview, setPreview] = useState<null | {
    loading: boolean;
    reminder: ReminderRow;
    log: any | null;
  }>(null);

  const openPreview = async (r: ReminderRow) => {
    setPreview({ loading: true, reminder: r, log: null });
    // Passenden email_send_log-Eintrag finden: gleiche E-Mail + Reminder-Typ.
    const t = new Date(r.sent_at).getTime();
    const from = new Date(t - 30 * 60_000).toISOString();
    const to = new Date(t + 30 * 60_000).toISOString();
    const template = REMINDER_TEMPLATE_NAMES[r.reminder_type] ?? `reminder_${r.reminder_type}`;
    const templates = r.reminder_type === "invite" ? [template, "invitation"] : [template];
    let { data } = await supabase
      .from("email_send_log")
      .select("id, message_id, template_name, recipient_email, status, error_message, metadata, rendered_html, rendered_subject, sender_email, tenant_id, created_at")
      .eq("recipient_email", r.email)
      .in("template_name", templates)
      .gte("created_at", from)
      .lte("created_at", to)
      .order("created_at", { ascending: false })
      .limit(1);
    if (!data?.length) {
      const start = new Date(r.sent_at);
      start.setHours(0, 0, 0, 0);
      const end = new Date(r.sent_at);
      end.setHours(23, 59, 59, 999);
      const fallback = await supabase
        .from("email_send_log")
        .select("id, message_id, template_name, recipient_email, status, error_message, metadata, rendered_html, rendered_subject, sender_email, tenant_id, created_at")
        .eq("recipient_email", r.email)
        .in("template_name", templates)
        .gte("created_at", start.toISOString())
        .lte("created_at", end.toISOString())
        .order("created_at", { ascending: false })
        .limit(1);
      data = fallback.data;
    }
    setPreview({ loading: false, reminder: r, log: (data ?? [])[0] ?? null });
  };

  const loadHealth = async () => {
    setLoadingHealth(true);
    try {
      const r = await healthFn({ data: {} });
      setHealth(r);
    } catch { /* silent */ } finally {
      setLoadingHealth(false);
    }
  };

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("reminder_log" as any)
      .select("*")
      .order("sent_at", { ascending: false })
      .limit(500);
    setRows((data as any) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); loadHealth(); }, []);

  const filtered = useMemo(() => rows.filter(r => {
    if (filterType !== "all" && r.reminder_type !== filterType) return false;
    if (filterStatus !== "all" && r.status !== filterStatus) return false;
    if (search && !r.email.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [rows, filterType, filterStatus, search]);

  const stats = useMemo(() => {
    const sent = rows.filter(r => r.status === "sent").length;
    const failed = rows.filter(r => r.status === "failed").length;
    const last24h = rows.filter(r => Date.now() - new Date(r.sent_at).getTime() < 86400_000).length;
    return { total: rows.length, sent, failed, last24h };
  }, [rows]);

  const trigger = async (dry: boolean) => {
    setRunning(dry ? "dry" : "send");
    try {
      const { data, error } = await supabase.functions.invoke("send-reminders", {
        body: dry ? { dry_run: true, ignore_quiet_hours: true } : { ignore_quiet_hours: true },
      });
      if (error) throw new Error(error.message);
      toast({
        title: dry ? "Dry-Run abgeschlossen" : "Erinnerungen verarbeitet",
        description: `Gesendet: ${(data as any)?.sent ?? 0} · Übersprungen: ${(data as any)?.skipped ?? 0} · Fehler: ${(data as any)?.failed ?? 0}`,
      });
      await load();
    } catch (e: any) {
      toast({ title: "Fehler", description: e.message, variant: "destructive" });
    } finally {
      setRunning(null);
    }
  };

  if (loading) return <div className="p-6 lg:p-8 space-y-5"><PageHeaderSkeleton /><TableSkeleton rows={8} cols={6} /></div>;

  return (
    <div className="p-6 lg:p-8 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-2xl bg-primary/10 grid place-items-center">
            <BellRing className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-heading font-bold">Erinnerungs-Mails</h1>
            <p className="text-sm text-muted-foreground">
              Automatischer Versand zwischen 08:00–20:00 Europe/Berlin · „Gesendet“ heißt: vom SMTP-Server angenommen
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => trigger(true)} disabled={running !== null}>
            <Clock className={`h-4 w-4 mr-1.5 ${running === "dry" ? "animate-spin" : ""}`} />
            Dry-Run (nur zählen)
          </Button>
          <Button size="sm" onClick={() => trigger(false)} disabled={running !== null}>
            <Send className={`h-4 w-4 mr-1.5 ${running === "send" ? "animate-spin" : ""}`} />
            Jetzt senden
          </Button>
          <Button variant="ghost" size="sm" onClick={load}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <HealthCard health={health} loading={loadingHealth} onRefresh={loadHealth} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4">
          <p className="text-2xl font-bold">{stats.total}</p>
          <p className="text-xs text-muted-foreground">Gesamt (letzte 500)</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-2xl font-bold text-status-success">{stats.sent}</p>
          <p className="text-xs text-muted-foreground">SMTP angenommen</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className={`text-2xl font-bold ${stats.failed > 0 ? "text-destructive" : ""}`}>{stats.failed}</p>
          <p className="text-xs text-muted-foreground">Fehlgeschlagen</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-2xl font-bold">{stats.last24h}</p>
          <p className="text-xs text-muted-foreground">Letzte 24 Stunden</p>
        </CardContent></Card>
      </div>

      <div className="flex gap-2 items-center flex-wrap">
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-64 h-9 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Typen</SelectItem>
            {Object.entries(TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-44 h-9 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Status</SelectItem>
            <SelectItem value="sent">Gesendet</SelectItem>
            <SelectItem value="failed">Fehler</SelectItem>
          </SelectContent>
        </Select>
        <Input placeholder="Empfänger suchen…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs h-9 text-sm" />
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={BellRing} title="Keine Erinnerungen" description="Noch keine Reminder-Mails versendet oder kein Treffer für diesen Filter." />
      ) : (
        <div className="border rounded-xl overflow-hidden bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase">Empfänger</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase">Typ</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase">Versuch</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase">Zeitpunkt</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase">Fehler</th>
                <th className="w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-muted/20">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {r.status === "sent"
                        ? <CheckCircle2 className="h-4 w-4 text-status-success" />
                        : <XCircle className="h-4 w-4 text-destructive" />}
                      <Badge variant="secondary" className="text-[10px]">{r.status}</Badge>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-medium text-xs">{r.email}</td>
                  <td className="px-4 py-3"><Badge variant="secondary" className="text-[10px]">{TYPE_LABELS[r.reminder_type] ?? r.reminder_type}</Badge></td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{r.attempt} / 5</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {new Date(r.sent_at).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="px-4 py-3 text-xs text-destructive max-w-[240px] truncate">{r.error ?? "–"}</td>
                  <td className="px-3 py-3">
                    <Button variant="ghost" size="icon" className="h-7 w-7" title="Vorschau" onClick={() => openPreview(r)}>
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="w-[min(100vw-2rem,900px)] max-w-none max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Mail className="h-4 w-4" /> Mail-Vorschau</DialogTitle>
            <DialogDescription>
              Zeigt den passenden Protokoll-Eintrag mit gerendertem HTML, wenn dieser Send bereits gespeichert wurde.
            </DialogDescription>
          </DialogHeader>
          {preview?.loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Lade Mail…</div>
          ) : preview && !preview.log ? (
            <div className="border rounded-lg p-6 bg-muted/30 text-center text-xs text-muted-foreground">
              Keine zugehörige Mail im Protokoll gefunden. Reminder-Mails aus Edge Functions werden eventuell nicht in <code>email_send_log</code> protokolliert.
            </div>
          ) : preview && preview.log ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-xs border rounded-lg p-3 bg-muted/30">
                <div><p className="text-[10px] font-semibold uppercase text-muted-foreground">Status</p><p className="text-xs">{preview.log.status}</p></div>
                <div><p className="text-[10px] font-semibold uppercase text-muted-foreground">Empfänger</p><p className="text-xs break-all">{preview.log.recipient_email}</p></div>
                <div><p className="text-[10px] font-semibold uppercase text-muted-foreground">Absender</p><p className="text-xs break-all">{preview.log.sender_email || preview.log.metadata?.from_email || "–"}</p></div>
                <div><p className="text-[10px] font-semibold uppercase text-muted-foreground">SMTP-Server</p><p className="text-xs break-all">{preview.log.metadata?.smtp_host ? `${preview.log.metadata.smtp_host}:${preview.log.metadata.smtp_port ?? "?"}` : "–"}</p></div>
                <div><p className="text-[10px] font-semibold uppercase text-muted-foreground">SMTP-User</p><p className="text-xs break-all">{preview.log.metadata?.smtp_username || "–"}</p></div>
                <div><p className="text-[10px] font-semibold uppercase text-muted-foreground">Zeitpunkt</p><p className="text-xs">{new Date(preview.log.created_at).toLocaleString("de-DE")}</p></div>
                <div className="col-span-2"><p className="text-[10px] font-semibold uppercase text-muted-foreground">Betreff</p><p className="text-xs">{preview.log.rendered_subject || preview.log.metadata?.subject || "–"}</p></div>
              </div>
              {preview.log.error_message && (
                <div className="border border-destructive/30 bg-destructive/5 rounded-lg p-3">
                  <p className="text-[10px] font-semibold uppercase text-destructive mb-1">Fehler</p>
                  <p className="text-xs text-destructive font-mono break-all">{preview.log.error_message}</p>
                </div>
              )}
              <div>
                <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-2">HTML-Vorschau</p>
                {preview.log.rendered_html ? (
                  <iframe srcDoc={preview.log.rendered_html} sandbox="" className="w-full h-[400px] border rounded-lg bg-white" title="Email Preview" />
                ) : (
                  <div className="border rounded-lg p-6 bg-muted/30 text-center text-xs text-muted-foreground">
                    Für diese Mail wurde kein gerendertes HTML gespeichert.
                  </div>
                )}
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setPreview(null)}>Schließen</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function formatAge(ms: number | null): string {
  if (ms === null) return "noch nie";
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "gerade eben";
  if (m < 60) return `vor ${m} Min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `vor ${h} Std`;
  return `vor ${Math.floor(h / 24)} Tagen`;
}

function HealthCard({ health, loading, onRefresh }: {
  health: {
    last_run_at: string | null;
    age_ms: number | null;
    severity: "green" | "yellow" | "red" | "unknown";
    counts_24h: { sent: number; failed: number; skipped: number };
    bounced: number;
  } | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  const sevColor = health?.severity === "green"
    ? "bg-emerald-100 text-emerald-700 border-emerald-200"
    : health?.severity === "yellow"
    ? "bg-amber-100 text-amber-700 border-amber-200"
    : health?.severity === "red"
    ? "bg-red-100 text-red-700 border-red-200"
    : "bg-muted text-muted-foreground";
  const sevLabel = health?.severity === "green" ? "Healthy"
    : health?.severity === "yellow" ? "Verzögert"
    : health?.severity === "red" ? "Stillstand"
    : "Unbekannt";

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Activity className="h-5 w-5 text-muted-foreground" />
            <div>
              <div className="text-sm font-medium flex items-center gap-2">
                Reminder-Cron
                <Badge variant="outline" className={sevColor}>{sevLabel}</Badge>
              </div>
              <div className="text-xs text-muted-foreground">
                Letzter Lauf: {loading ? "lädt…" : formatAge(health?.age_ms ?? null)}
                {health?.last_run_at ? ` · ${new Date(health.last_run_at).toLocaleString("de-DE")}` : ""}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <div className="text-center">
              <div className="font-semibold text-emerald-700">{health?.counts_24h.sent ?? 0}</div>
              <div className="text-muted-foreground">gesendet 24h</div>
            </div>
            <div className="text-center">
              <div className="font-semibold text-destructive">{health?.counts_24h.failed ?? 0}</div>
              <div className="text-muted-foreground">fehlgeschlagen</div>
            </div>
            <div className="text-center">
              <div className="font-semibold">{health?.counts_24h.skipped ?? 0}</div>
              <div className="text-muted-foreground">übersprungen</div>
            </div>
            <div className="text-center">
              <div className="font-semibold text-amber-700">{health?.bounced ?? 0}</div>
              <div className="text-muted-foreground">Bounces</div>
            </div>
            <Button size="sm" variant="ghost" onClick={onRefresh} disabled={loading}>
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}