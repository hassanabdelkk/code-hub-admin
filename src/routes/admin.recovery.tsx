import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, Send, Users, AlertTriangle, History, Eye, RefreshCw,
  CheckCircle2, XCircle, Clock, Activity, FileDown, Search,
} from "lucide-react";
import {
  enqueueDomainRecoveryMails,
  getAffectedRecipients,
  getRecoveryStatus,
  getRecoveryPreview,
  listBouncedRecipients,
  resetEmailStatus,
  type AffectedRecipient,
  type RecoveryStatusEntry,
  type BouncedRecipient,
} from "@/lib/tenant-domains.functions";
import { listReminderLog, getReminderHealth, type ReminderLogRow } from "@/lib/reminder-log.functions";
import { MailX, Undo2 } from "lucide-react";

export const Route = createFileRoute("/admin/recovery")({
  component: AdminRecoveryPage,
});

interface Tenant { id: string; name: string; domain: string | null; primary_domain: string | null }

export function AdminRecoveryPage() {
  const { toast } = useToast();
  const sendFn = useServerFn(enqueueDomainRecoveryMails);
  const affectedFn = useServerFn(getAffectedRecipients);
  const statusFn = useServerFn(getRecoveryStatus);
  const previewFn = useServerFn(getRecoveryPreview);
  const bouncedFn = useServerFn(listBouncedRecipients);
  const resetFn = useServerFn(resetEmailStatus);
  const healthFn = useServerFn(getReminderHealth);
  const logFn = useServerFn(listReminderLog);

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState<string>("");
  const [recipients, setRecipients] = useState<AffectedRecipient[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [sending, setSending] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [history, setHistory] = useState<Array<{ id: string; created_at: string; comment: string | null }>>([]);
  const [statusEntries, setStatusEntries] = useState<RecoveryStatusEntry[]>([]);
  const [changedAt, setChangedAt] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    subject: string; html: string; portal_link: string;
  } | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [loadingMailPreview, setLoadingMailPreview] = useState(false);

  const loadHistory = async (tid: string) => {
    const { data } = await (supabase as any)
      .from("activity_log")
      .select("id,created_at,comment")
      .eq("entity_type", "tenant")
      .eq("entity_id", tid)
      .eq("action", "domain_recovery_versendet")
      .order("created_at", { ascending: false })
      .limit(10);
    setHistory((data ?? []) as any);
  };

  const loadStatus = async (tid: string) => {
    setLoadingStatus(true);
    try {
      const r = await statusFn({ data: { tenant_id: tid } });
      setStatusEntries(r.entries);
      setChangedAt(r.changed_at);
    } catch (e: any) {
      toast({ title: "Status laden fehlgeschlagen", description: String(e?.message ?? e), variant: "destructive" });
    } finally {
      setLoadingStatus(false);
    }
  };

  const loadPreview = async (tid: string) => {
    setLoadingMailPreview(true);
    try {
      const r = await previewFn({ data: { tenant_id: tid } });
      setPreview(r);
    } catch (e: any) {
      toast({ title: "Vorschau fehlgeschlagen", description: String(e?.message ?? e), variant: "destructive" });
    } finally {
      setLoadingMailPreview(false);
    }
  };

  const [bounced, setBounced] = useState<BouncedRecipient[]>([]);
  const [loadingBounced, setLoadingBounced] = useState(false);
  const [resettingId, setResettingId] = useState<string | null>(null);

  // Health + Audit
  const [health, setHealth] = useState<{
    last_run_at: string | null; age_ms: number | null;
    severity: "green" | "yellow" | "red" | "unknown";
    counts_24h: { sent: number; failed: number; skipped: number };
    bounced: number;
  } | null>(null);
  const [loadingHealth, setLoadingHealth] = useState(false);
  const [logRows, setLogRows] = useState<ReminderLogRow[]>([]);
  const [logTotal, setLogTotal] = useState(0);
  const [logPage, setLogPage] = useState(1);
  const LOG_PAGE_SIZE = 50;
  const [loadingLog, setLoadingLog] = useState(false);
  const [logFilters, setLogFilters] = useState<{ email_query: string; type: string; status: string; range: "today" | "7d" | "30d" | "all" }>({
    email_query: "", type: "", status: "", range: "7d",
  });

  const loadBounced = async (tid: string) => {
    setLoadingBounced(true);
    try {
      const r = await bouncedFn({ data: { tenant_id: tid } });
      setBounced(r.bounced);
    } catch (e: any) {
      toast({ title: "Bounce-Liste fehlgeschlagen", description: String(e?.message ?? e), variant: "destructive" });
    } finally {
      setLoadingBounced(false);
    }
  };

  const loadHealth = async (tid: string | null) => {
    setLoadingHealth(true);
    try {
      const r = await healthFn({ data: { tenant_id: tid } });
      setHealth(r as any);
    } catch (e: any) {
      // silent
    } finally {
      setLoadingHealth(false);
    }
  };

  const loadLog = async (tid: string | null, page = logPage, filters = logFilters) => {
    setLoadingLog(true);
    try {
      const r = await logFn({
        data: {
          tenant_id: tid ?? undefined,
          email_query: filters.email_query || undefined,
          type: (filters.type || undefined) as any,
          status: (filters.status || undefined) as any,
          range: filters.range,
          page,
          page_size: LOG_PAGE_SIZE,
        },
      });
      setLogRows(r.rows);
      setLogTotal(r.total);
      setLogPage(r.page);
    } catch (e: any) {
      toast({ title: "Audit-Log fehlgeschlagen", description: String(e?.message ?? e), variant: "destructive" });
    } finally {
      setLoadingLog(false);
    }
  };

  const exportLogCsv = () => {
    const header = ["sent_at", "email", "reminder_type", "status", "attempt", "error"];
    const lines = [header.join(",")];
    for (const r of logRows) {
      lines.push([
        r.sent_at, r.email, r.reminder_type, r.status, String(r.attempt),
        `"${(r.error ?? "").replace(/"/g, '""')}"`,
      ].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reminder-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleReset = async (rec: BouncedRecipient) => {
    setResettingId(rec.id);
    try {
      await resetFn({ data: { kind: rec.kind, id: rec.id } });
      toast({ title: "E-Mail-Adresse wieder aktiv", description: rec.email });
      loadBounced(tenantId);
      loadHealth(tenantId || null);
    } catch (e: any) {
      toast({ title: "Reset fehlgeschlagen", description: String(e?.message ?? e), variant: "destructive" });
    } finally {
      setResettingId(null);
    }
  };

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any).from("tenants").select("id,name,domain,primary_domain").eq("is_active", true).order("name");
      setTenants((data ?? []) as Tenant[]);
    })();
    loadHealth(null);
  }, []);

  useEffect(() => {
    if (!tenantId) {
      setRecipients([]); setHistory([]); setStatusEntries([]); setChangedAt(null); setPreview(null); setBounced([]);
      loadHealth(null);
      loadLog(null, 1, logFilters);
      return;
    }
    setLoadingPreview(true);
    affectedFn({ data: { tenant_id: tenantId } })
      .then((r) => setRecipients(r.recipients))
      .catch((e) => toast({ title: "Fehler", description: String(e?.message ?? e), variant: "destructive" }))
      .finally(() => setLoadingPreview(false));
    loadHistory(tenantId);
    loadStatus(tenantId);
    loadPreview(tenantId);
    loadBounced(tenantId);
    loadHealth(tenantId);
    loadLog(tenantId, 1, logFilters);
  }, [tenantId]);

  const send = async (opts: { dryRun?: boolean; retryFailed?: boolean }) => {
    if (!tenantId) return;
    const isRetry = opts.retryFailed === true;
    if (isRetry) setRetrying(true); else setSending(true);
    setResult(null);
    try {
      const r = await sendFn({
        data: { tenant_id: tenantId, dry_run: opts.dryRun === true, retry_failed_only: isRetry },
      });
      setResult(r);
      if (!opts.dryRun) {
        loadHistory(tenantId);
        loadStatus(tenantId);
      }
      toast({
        title: opts.dryRun ? "Dry-Run abgeschlossen" : isRetry ? "Erneut-Senden abgeschlossen" : "Recovery-Mails versendet",
        description: `${r.sent ?? 0} gesendet · ${r.skipped ?? 0} übersprungen · ${r.failed ?? 0} fehlgeschlagen`,
      });
    } catch (e: any) {
      toast({ title: "Fehler", description: String(e?.message ?? e), variant: "destructive" });
    } finally {
      setSending(false); setRetrying(false);
    }
  };

  const selectedTenant = tenants.find(t => t.id === tenantId);
  const activeDomain = selectedTenant?.primary_domain ?? selectedTenant?.domain;

  const daysSinceChange = changedAt ? Math.floor((Date.now() - new Date(changedAt).getTime()) / 86400_000) : null;
  const daysBannerRemaining = daysSinceChange !== null ? Math.max(0, 30 - daysSinceChange) : null;

  const statusByEmail = new Map(statusEntries.map(e => [e.email, e]));
  const mitarbeiterCount = recipients.filter(r => r.kind === "mitarbeiter").length;
  const failedCount = statusEntries.filter(e => e.status === "failed").length;

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold">Domain-Recovery</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Sendet allen registrierten Mitarbeitern eines Tenants den neuen Portal-Link der aktuellen Primary-Domain.
          Nutze diese Aktion <strong>nach</strong> einem Domain-Wechsel auf <code>/admin/domains</code>.
          Bewerber sind ausgenommen — sie erhalten den neuen Link über die normalen Einladungs-Reminder.
        </p>
      </div>

      {/* Reminder-Cron-Health-Karte wurde nach /admin/reminders verschoben —
          dort ist der passende Kontext. */}




      <Card>
        <CardContent className="p-6 space-y-4">
          <label className="text-sm font-medium">Tenant auswählen</label>
          <select
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="">— bitte wählen —</option>
            {tenants.map(t => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.primary_domain ?? t.domain})
              </option>
            ))}
          </select>

          {selectedTenant && (
            <div className="rounded-md border bg-muted/40 p-4 text-sm space-y-2">
              <div>Aktive Versand-Domain: <Badge variant="secondary">portal.{activeDomain}</Badge></div>
              {changedAt ? (
                <div className="text-xs text-muted-foreground">
                  Domain-Wechsel vor <strong>{daysSinceChange} Tag{daysSinceChange === 1 ? "" : "en"}</strong> ·
                  Hinweis-Banner in regulären Reminder-Mails noch <strong>{daysBannerRemaining}</strong> Tag{daysBannerRemaining === 1 ? "" : "e"} aktiv.
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">Kein registrierter Domain-Wechsel — Recovery-Versand ist nicht idempotent geankert.</div>
              )}
            </div>
          )}

          {tenantId && (
            <div className="rounded-md border p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Users className="h-4 w-4" />
                Betroffene Empfänger
              </div>
              {loadingPreview ? (
                <div className="text-sm text-muted-foreground mt-2 flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" />Lade…</div>
              ) : (
                <div className="text-sm mt-2">
                  <div className="flex gap-2 flex-wrap">
                    <Badge variant="secondary">{recipients.length} gesamt</Badge>
                    <Badge variant="outline">{mitarbeiterCount} Mitarbeiter</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-2">
                    Versand gestaffelt (max. 20 Mails pro Cron-Lauf ≈ 240/12h pro Tenant). Pro Domain-Wechsel erhält jeder Empfänger genau eine Mail.
                    Deaktivierte/abgelehnte Profile sowie Adressen mit Hard-Bounce werden ausgeschlossen.
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" disabled={!tenantId || sending || retrying} onClick={() => send({ dryRun: true })}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Dry-Run"}
            </Button>
            <Button disabled={!tenantId || sending || retrying || recipients.length === 0} onClick={() => send({})}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
              Recovery-Mails jetzt senden
            </Button>
            <Button
              variant="secondary"
              disabled={!tenantId || sending || retrying || failedCount === 0}
              onClick={() => send({ retryFailed: true })}
              title={failedCount === 0 ? "Keine fehlgeschlagenen Mails seit dem Domain-Wechsel" : ""}
            >
              {retrying ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Fehlgeschlagene erneut senden ({failedCount})
            </Button>
          </div>

          {result && (
            <div className="rounded-md border bg-muted/40 p-4 text-sm">
              <div className="font-medium mb-2 flex items-center gap-2">
                {result.failed > 0 ? <AlertTriangle className="h-4 w-4 text-amber-500" /> : null}
                Ergebnis
              </div>
              <pre className="text-xs overflow-auto max-h-64">{JSON.stringify(result, null, 2)}</pre>
            </div>
          )}
        </CardContent>
      </Card>

      {tenantId && (
        <Tabs defaultValue="status">
          <TabsList>
            <TabsTrigger value="status"><Users className="h-3.5 w-3.5 mr-1.5" />Empfänger-Status</TabsTrigger>
            <TabsTrigger value="preview"><Eye className="h-3.5 w-3.5 mr-1.5" />Mail-Vorschau</TabsTrigger>
            <TabsTrigger value="history"><History className="h-3.5 w-3.5 mr-1.5" />Vergangene Läufe</TabsTrigger>
            <TabsTrigger value="bounced"><MailX className="h-3.5 w-3.5 mr-1.5" />Bounces ({bounced.length})</TabsTrigger>
            <TabsTrigger value="audit"><Activity className="h-3.5 w-3.5 mr-1.5" />Verlauf</TabsTrigger>
          </TabsList>

          <TabsContent value="audit">
            <Card>
              <CardContent className="p-6 space-y-3">
                <AuditLogPanel
                  rows={logRows}
                  total={logTotal}
                  page={logPage}
                  pageSize={LOG_PAGE_SIZE}
                  loading={loadingLog}
                  filters={logFilters}
                  onFiltersChange={(f) => { setLogFilters(f); loadLog(tenantId || null, 1, f); }}
                  onPageChange={(p) => loadLog(tenantId || null, p, logFilters)}
                  onExport={exportLogCsv}
                />
              </CardContent>
            </Card>
          </TabsContent>


          <TabsContent value="status">
            <Card>
              <CardContent className="p-6">
                {!changedAt ? (
                  <div className="text-sm text-muted-foreground">Kein Domain-Wechsel registriert — noch keine Recovery-Daten.</div>
                ) : loadingStatus ? (
                  <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" />Lade Status…</div>
                ) : (
                  <RecipientStatusTable recipients={recipients} statusByEmail={statusByEmail} />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="preview">
            <Card>
              <CardContent className="p-6 space-y-3">
                {loadingMailPreview || !preview ? (
                  <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" />Lade Vorschau…</div>
                ) : (
                  <>
                    <div className="text-xs text-muted-foreground">
                      So sieht die Recovery-Mail für deine Mitarbeiter aus. Text bearbeitbar unter
                      <a href="/admin/email-templates" className="underline mx-1">/admin/email-templates → Erinnerungen → Domain-Wechsel</a>.
                    </div>
                    <div className="text-sm"><span className="font-medium">Betreff:</span> {preview.subject}</div>
                    <div className="text-xs text-muted-foreground">Portal-Link: <code>{preview.portal_link}</code></div>
                    <iframe
                      title="Recovery-Mail-Vorschau"
                      srcDoc={preview.html}
                      className="w-full h-[600px] rounded-md border bg-white"
                    />
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history">
            <Card>
              <CardContent className="p-6">
                {history.length === 0 ? (
                  <div className="text-xs text-muted-foreground">Noch kein Bulk-Re-Send für diesen Tenant durchgeführt.</div>
                ) : (
                  <ul className="space-y-1.5 text-xs">
                    {history.map(h => (
                      <li key={h.id} className="flex gap-3 border-b pb-1.5 last:border-0">
                        <span className="text-muted-foreground whitespace-nowrap">
                          {new Date(h.created_at).toLocaleString("de-DE")}
                        </span>
                        <span>{h.comment ?? "—"}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="bounced">
            <Card>
              <CardContent className="p-6 space-y-3">
                <div className="text-xs text-muted-foreground">
                  Adressen mit dauerhaftem Hard-Bounce (SMTP 5.x.x) werden automatisch markiert und in allen Reminder-/Recovery-Läufen übersprungen, damit unsere Sender-Reputation nicht leidet. Reset, sobald die Adresse wieder erreichbar ist.
                </div>
                {loadingBounced ? (
                  <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" />Lade…</div>
                ) : bounced.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Keine gebouncten Adressen für diesen Tenant.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs text-muted-foreground">
                          <th className="py-2 px-2">Empfänger</th>
                          <th className="py-2 px-2">Typ</th>
                          <th className="py-2 px-2">Bounced am</th>
                          <th className="py-2 px-2">Grund</th>
                          <th className="py-2 px-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {bounced.map((b) => (
                          <tr key={`${b.kind}-${b.id}`} className="border-b last:border-0">
                            <td className="py-2 px-2">
                              <div className="font-medium">{b.name || "—"}</div>
                              <div className="text-xs text-muted-foreground">{b.email}</div>
                            </td>
                            <td className="py-2 px-2 text-xs">
                              <Badge variant="outline">{b.kind === "mitarbeiter" ? "Mitarbeiter" : "Bewerber"}</Badge>
                            </td>
                            <td className="py-2 px-2 text-xs text-muted-foreground">
                              {b.bounced_at ? new Date(b.bounced_at).toLocaleString("de-DE") : "—"}
                            </td>
                            <td className="py-2 px-2 text-xs text-destructive max-w-[280px] truncate" title={b.reason ?? ""}>
                              {b.reason ?? "—"}
                            </td>
                            <td className="py-2 px-2 text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={resettingId === b.id}
                                onClick={() => handleReset(b)}
                              >
                                {resettingId === b.id
                                  ? <Loader2 className="h-3 w-3 animate-spin" />
                                  : <><Undo2 className="h-3 w-3 mr-1" />Wieder zulassen</>}
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function RecipientStatusTable({
  recipients,
  statusByEmail,
}: {
  recipients: AffectedRecipient[];
  statusByEmail: Map<string, RecoveryStatusEntry>;
}) {
  if (recipients.length === 0) {
    return <div className="text-sm text-muted-foreground">Keine Empfänger.</div>;
  }
  // Sortierung: failed → pending → sent
  const rank = (s: string) => (s === "failed" ? 0 : s === "pending" ? 1 : 2);
  const rows = [...recipients].sort((a, b) => {
    const sa = a.email ? statusByEmail.get(a.email)?.status ?? "pending" : "pending";
    const sb = b.email ? statusByEmail.get(b.email)?.status ?? "pending" : "pending";
    return rank(sa) - rank(sb);
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2 px-2">Empfänger</th>
            <th className="py-2 px-2">Typ</th>
            <th className="py-2 px-2">Status</th>
            <th className="py-2 px-2">Zeitpunkt / Fehler</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const log = r.email ? statusByEmail.get(r.email) : undefined;
            const status = log?.status ?? "pending";
            return (
              <tr key={r.id + (r.email ?? "")} className="border-b last:border-0">
                <td className="py-2 px-2">
                  <div className="font-medium">{r.name || "—"}</div>
                  <div className="text-xs text-muted-foreground">{r.email ?? "—"}</div>
                </td>
                <td className="py-2 px-2 text-xs">
                  <Badge variant="outline">Mitarbeiter</Badge>
                </td>
                <td className="py-2 px-2">
                  <StatusBadge status={status} />
                </td>
                <td className="py-2 px-2 text-xs text-muted-foreground">
                  {log?.sent_at ? new Date(log.sent_at).toLocaleString("de-DE") : "—"}
                  {log?.error ? <div className="text-destructive mt-0.5">{log.error}</div> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "sent") return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-emerald-200"><CheckCircle2 className="h-3 w-3 mr-1" />gesendet</Badge>;
  if (status === "failed") return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />fehlgeschlagen</Badge>;
  if (status === "skipped") return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />übersprungen</Badge>;
  return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />ausstehend</Badge>;
}

function formatAge(ms: number | null): string {
  if (ms === null) return "—";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "gerade eben";
  if (m < 60) return `vor ${m} Min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `vor ${h} Std`;
  const d = Math.floor(h / 24);
  return `vor ${d} Tag${d === 1 ? "" : "en"}`;
}

function HealthCard({
  health, loading, onRefresh,
}: {
  health: {
    last_run_at: string | null; age_ms: number | null;
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
  const sevLabel = health?.severity === "green" ? "Healthy" : health?.severity === "yellow" ? "Verzögert" : health?.severity === "red" ? "Stillstand" : "Unbekannt";

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

function AuditLogPanel({
  rows, total, page, pageSize, loading, filters, onFiltersChange, onPageChange, onExport,
}: {
  rows: ReminderLogRow[];
  total: number; page: number; pageSize: number; loading: boolean;
  filters: { email_query: string; type: string; status: string; range: "today" | "7d" | "30d" | "all" };
  onFiltersChange: (f: typeof filters) => void;
  onPageChange: (p: number) => void;
  onExport: () => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const typeLabel: Record<string, string> = {
    invite: "Invite", confirm_email: "E-Mail bestätigen", complete_registration: "Onboarding",
    no_recent_booking: "Keine Buchung", domain_recovery: "Domain-Recovery",
  };
  return (
    <>
      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[180px]">
          <label className="text-xs text-muted-foreground">E-Mail-Suche</label>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <input
              value={filters.email_query}
              onChange={(e) => onFiltersChange({ ...filters, email_query: e.target.value })}
              placeholder="z.B. müller"
              className="w-full rounded-md border bg-background pl-7 pr-2 py-1.5 text-sm"
            />
          </div>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Typ</label>
          <select
            value={filters.type}
            onChange={(e) => onFiltersChange({ ...filters, type: e.target.value })}
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            <option value="">alle</option>
            {Object.entries(typeLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Status</label>
          <select
            value={filters.status}
            onChange={(e) => onFiltersChange({ ...filters, status: e.target.value })}
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            <option value="">alle</option>
            <option value="sent">gesendet</option>
            <option value="failed">fehlgeschlagen</option>
            <option value="skipped">übersprungen</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Zeitraum</label>
          <select
            value={filters.range}
            onChange={(e) => onFiltersChange({ ...filters, range: e.target.value as any })}
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            <option value="today">24h</option>
            <option value="7d">7 Tage</option>
            <option value="30d">30 Tage</option>
            <option value="all">alle</option>
          </select>
        </div>
        <Button size="sm" variant="outline" onClick={onExport} disabled={rows.length === 0}>
          <FileDown className="h-3 w-3 mr-1.5" />CSV
        </Button>
      </div>

      <div className="text-xs text-muted-foreground">
        {loading ? "Lädt…" : `${total} Einträge · Seite ${page}/${totalPages}`}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 px-2">Zeit</th>
              <th className="py-2 px-2">Empfänger</th>
              <th className="py-2 px-2">Typ</th>
              <th className="py-2 px-2">Status</th>
              <th className="py-2 px-2">Info</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading ? (
              <tr><td colSpan={5} className="py-6 text-center text-sm text-muted-foreground">Keine Einträge im gewählten Zeitraum.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="border-b last:border-0">
                <td className="py-2 px-2 text-xs text-muted-foreground whitespace-nowrap">{new Date(r.sent_at).toLocaleString("de-DE")}</td>
                <td className="py-2 px-2 text-xs">{r.email}</td>
                <td className="py-2 px-2 text-xs"><Badge variant="outline">{typeLabel[r.reminder_type] ?? r.reminder_type}</Badge></td>
                <td className="py-2 px-2"><StatusBadge status={r.status} /></td>
                <td className="py-2 px-2 text-xs max-w-[280px] truncate" title={r.error ?? ""}>
                  {r.error ? <span className={r.status === "failed" ? "text-destructive" : "text-muted-foreground"}>{r.error}</span> : <span className="text-muted-foreground">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-between items-center pt-2">
        <Button size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => onPageChange(page - 1)}>← Zurück</Button>
        <span className="text-xs text-muted-foreground">Seite {page} von {totalPages}</span>
        <Button size="sm" variant="outline" disabled={page >= totalPages || loading} onClick={() => onPageChange(page + 1)}>Weiter →</Button>
      </div>
    </>
  );
}
