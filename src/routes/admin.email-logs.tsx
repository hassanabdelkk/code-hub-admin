import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/email-logs")({
  component: AdminEmailLogsPage,
});

import { useState, useEffect, useMemo } from "react";
import { fetchAll } from "@/lib/fetch-all";
import { usePagination } from "@/hooks/use-pagination";
import { PaginationBar } from "@/components/PaginationBar";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TableSkeleton, PageHeaderSkeleton } from "@/components/SkeletonLoaders";
import { EmptyState } from "@/components/EmptyState";
import { Mail, RefreshCw, RotateCcw, CheckCircle2, XCircle, AlertTriangle, Eye, Send, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  type EmailLog,
  EMAIL_STATUS_COLORS,
  EMAIL_STATUS_LABELS,
  EMAIL_TYPE_LABELS,
  computeEmailStats,
  dedupeEmailLogs,
} from "@/lib/email-stats";
import { acknowledgeFailedEmails } from "@/lib/email-log-ack.functions";
import { BounceSuppressionPanel } from "@/components/BounceSuppressionPanel";

type EmailLogFull = EmailLog & {
  rendered_html?: string | null;
  rendered_subject?: string | null;
  sender_email?: string | null;
  tenant_id?: string | null;
  acknowledged_at?: string | null;
};

export function AdminEmailLogsPage() {
  const { user } = useAuth();
  const [logs, setLogs] = useState<EmailLogFull[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [resending, setResending] = useState<string | null>(null);
  const [previewLog, setPreviewLog] = useState<EmailLogFull | null>(null);
  const [sendingTest, setSendingTest] = useState(false);
  const [acking, setAcking] = useState(false);
  const ackFn = useServerFn(acknowledgeFailedEmails);
  const { toast } = useToast();

  const loadData = async () => {
    setLoading(true);
    try {
      // Letzte 30 Tage komplett laden (paginiert via fetchAll, kein 1000er-Limit).
      const since = new Date(Date.now() - 30 * 86400_000).toISOString();
      const rows = await fetchAll<EmailLogFull>(() =>
        supabase
          .from("email_send_log")
          .select("*")
          .neq("status", "pending")
          .gte("created_at", since)
          .order("created_at", { ascending: false }),
      );
      setLogs(dedupeEmailLogs(rows));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const stats = useMemo(() => computeEmailStats(logs), [logs]);

  const filtered = useMemo(() => {
    return logs.filter((l) => {
      if (filterStatus !== "all" && l.status !== filterStatus) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!l.recipient_email.toLowerCase().includes(q) && !(l.template_name || "").toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [logs, filterStatus, search]);

  const { paged, page, setPage, pageCount, rangeFrom, rangeTo, total } = usePagination(filtered, 100);

  const resendEmail = async (log: EmailLog) => {
    setResending(log.id);
    try {
      const { data, error } = await supabase.functions.invoke("send-invitation-email", {
        body: {
          to: log.recipient_email,
          fullName: log.metadata?.full_name || log.recipient_email,
          firstName: log.metadata?.first_name,
          lastName: log.metadata?.last_name,
          registrationLink: log.metadata?.registration_link || window.location.origin,
          tenantId: log.metadata?.tenant_id,
        },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast({ title: "E-Mail erneut gesendet" });
      loadData();
    } catch (err: any) {
      toast({ title: "Fehler beim Versand", description: err.message, variant: "destructive" });
    } finally {
      setResending(null);
    }
  };

  // Testkopie an den eingeloggten Admin schicken (nur für Invitation-Mails sinnvoll,
  // da nur dort die Edge-Function "send-invitation-email" alle Daten kennt).
  const sendTestToMe = async (log: EmailLogFull) => {
    if (!user?.email) {
      toast({ title: "Keine Admin-E-Mail bekannt", variant: "destructive" });
      return;
    }
    setSendingTest(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-invitation-email", {
        body: {
          to: user.email,
          fullName: log.metadata?.full_name || "Test Empfänger",
          firstName: log.metadata?.first_name || "Test",
          lastName: log.metadata?.last_name || "Empfänger",
          registrationLink: log.metadata?.registration_link || window.location.origin,
          tenantId: log.metadata?.tenant_id || log.tenant_id,
          isTest: true,
        },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast({ title: "Test-Mail verschickt", description: `An ${user.email}` });
    } catch (err: any) {
      toast({ title: "Test-Versand fehlgeschlagen", description: err.message, variant: "destructive" });
    } finally {
      setSendingTest(false);
    }
  };

  const handleAckAll = async () => {
    setAcking(true);
    try {
      const r = await ackFn();
      toast({ title: "Bearbeitet markiert", description: `${r.acknowledged} Fehler-Einträge abgehakt.` });
      await loadData();
    } catch (e: any) {
      toast({ title: "Fehler", description: String(e?.message ?? e), variant: "destructive" });
    } finally {
      setAcking(false);
    }
  };

  if (loading) return <div className="p-6 lg:p-8 space-y-5"><PageHeaderSkeleton /><TableSkeleton rows={8} cols={5} /></div>;

  return (
    <div className="p-6 lg:p-8 space-y-5">
      {/* Hero Status Banner */}
      <div className={`rounded-2xl p-5 border-2 ${
        stats.actionRequired
          ? "bg-destructive/5 border-destructive/40"
          : stats.total === 0
          ? "bg-muted/40 border-border"
          : "bg-status-success/5 border-status-success/40"
      }`}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className={`h-14 w-14 rounded-2xl flex items-center justify-center shrink-0 ${
              stats.actionRequired
                ? "bg-destructive/15"
                : stats.total === 0
                ? "bg-muted"
                : "bg-status-success/15"
            }`}>
              {stats.actionRequired ? (
                <AlertTriangle className="h-7 w-7 text-destructive" />
              ) : stats.total === 0 ? (
                <Mail className="h-7 w-7 text-muted-foreground" />
              ) : (
                <CheckCircle2 className="h-7 w-7 text-status-success" />
              )}
            </div>
            <div>
              <h1 className="text-2xl font-heading font-bold text-foreground">
                {stats.actionRequired
                  ? "Aktion erforderlich"
                  : stats.total === 0
                  ? "Noch keine E-Mails versendet"
                  : "Alles läuft sauber"}
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                {stats.actionRequired
                  ? `${stats.openFailures24h} neue Fehler in den letzten 24h. Prüfe SMTP-Login oder Bounce-Liste — danach „Bearbeitet"-Button klicken.`
                  : `${stats.sent} von ${stats.total} E-Mails vom SMTP-Server angenommen · Annahmequote ${stats.successRate}%`}
              </p>
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            {stats.actionRequired && (
              <Button variant="outline" size="sm" className="h-9 text-xs gap-1.5" onClick={handleAckAll} disabled={acking}>
                <Check className="h-3.5 w-3.5" /> {acking ? "…" : "Als bearbeitet markieren"}
              </Button>
            )}
            <Button variant="outline" size="sm" className="h-9 text-xs gap-1.5" onClick={loadData}>
              <RefreshCw className="h-3.5 w-3.5" /> Aktualisieren
            </Button>
          </div>
        </div>
      </div>

      {/* Bounce Suppression */}
      <BounceSuppressionPanel />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">

        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-accent/10 flex items-center justify-center">
              <CheckCircle2 className="h-5 w-5 text-accent" />
            </div>
            <div>
              <p className="text-2xl font-bold text-accent">{stats.sent}</p>
              <p className="text-xs text-muted-foreground">SMTP angenommen</p>
            </div>
          </CardContent>
        </Card>
        <Card className={stats.failed > 0 ? "border-destructive/30" : ""}>
          <CardContent className="p-4 flex items-center gap-3">
            <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${stats.failed > 0 ? "bg-destructive/10" : "bg-muted"}`}>
              <XCircle className={`h-5 w-5 ${stats.failed > 0 ? "text-destructive" : "text-muted-foreground"}`} />
            </div>
            <div>
              <p className={`text-2xl font-bold ${stats.failed > 0 ? "text-destructive" : "text-foreground"}`}>{stats.failed}</p>
              <p className="text-xs text-muted-foreground">Fehlgeschlagen</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Mail className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{stats.total}</p>
              <p className="text-xs text-muted-foreground">Gesamt</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${stats.successRate >= 95 ? "bg-accent/10" : "bg-destructive/10"}`}>
              {stats.successRate >= 95 ? (
                <CheckCircle2 className="h-5 w-5 text-accent" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-destructive" />
              )}
            </div>
            <div>
              <p className={`text-2xl font-bold ${stats.successRate >= 95 ? "text-accent" : "text-destructive"}`}>{stats.successRate}%</p>
              <p className="text-xs text-muted-foreground">Annahmequote</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex gap-2 items-center flex-wrap">
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-44 h-9 text-xs"><SelectValue placeholder="Alle Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Status</SelectItem>
            <SelectItem value="sent">✅ Gesendet</SelectItem>
            <SelectItem value="failed">❌ Fehlgeschlagen</SelectItem>
            <SelectItem value="suppressed">⚠️ Unterdrückt</SelectItem>
            <SelectItem value="bounced">🔴 Gebounced</SelectItem>
          </SelectContent>
        </Select>
        <Input placeholder="Empfänger suchen…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs h-9 text-sm" />
        <p className="text-xs text-muted-foreground ml-auto">Einträge sind nach Empfänger/Typ zusammengefasst; sichtbar ist der neueste Status.</p>
      </div>

      {/* Log Table */}
      {filtered.length === 0 ? (
        <EmptyState icon={Mail} title="Keine E-Mails" description="Keine E-Mails mit diesem Filter gefunden." />
      ) : (
        <div className="border rounded-xl overflow-hidden bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Empfänger</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Typ</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">SMTP</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Zeitpunkt</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Fehler</th>
                <th className="w-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {paged.map((log) => {
                const canResend = ["failed", "dlq"].includes(log.status);
                const smtpHost = log.metadata?.smtp_host;

                return (
                  <tr
                    key={log.id}
                    className={`hover:bg-muted/30 transition-colors cursor-pointer ${canResend ? "bg-destructive/[0.02]" : ""}`}
                    onClick={() => setPreviewLog(log)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {log.status === "sent" ? (
                          <CheckCircle2 className="h-4 w-4 text-accent" />
                        ) : (
                          <XCircle className="h-4 w-4 text-destructive" />
                        )}
                        <Badge variant="secondary" className={`text-[10px] ${EMAIL_STATUS_COLORS[log.status] ?? "bg-muted text-muted-foreground"}`}>
                          {EMAIL_STATUS_LABELS[log.status] ?? log.status}
                        </Badge>
                        {log.acknowledged_at && ["failed", "dlq", "bounced"].includes(log.status) && (
                          <Badge variant="outline" className="text-[10px] gap-1"><Check className="h-2.5 w-2.5" />bearbeitet</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground text-xs">{log.recipient_email}</td>
                    <td className="px-4 py-3">
                      <Badge variant="secondary" className="text-[10px]">
                        {EMAIL_TYPE_LABELS[log.template_name] ?? log.template_name}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-muted-foreground">{smtpHost || "–"}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {new Date(log.created_at).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="px-4 py-3 text-xs text-destructive max-w-[200px] truncate">
                      {log.error_message || "–"}
                    </td>
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary"
                          onClick={() => setPreviewLog(log)} title="Vorschau">
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        {canResend && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary"
                            onClick={() => resendEmail(log)} disabled={resending === log.id} title="Erneut senden">
                            <RotateCcw className={`h-3.5 w-3.5 ${resending === log.id ? "animate-spin" : ""}`} />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="border-t border-border bg-muted/20">
            <PaginationBar page={page} pageCount={pageCount} setPage={setPage} rangeFrom={rangeFrom} rangeTo={rangeTo} total={total} />
          </div>
        </div>
      )}

      {/* Vorschau-Modal */}
      <Dialog open={!!previewLog} onOpenChange={(open) => !open && setPreviewLog(null)}>
        <DialogContent className="w-[min(100vw-2rem,900px)] max-w-none max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-4 w-4" /> Mail-Vorschau
            </DialogTitle>
            <DialogDescription>
              „Gesendet“ bedeutet: Der SMTP-Server hat die Mail angenommen; endgültige Zustellung hängt vom Empfänger-Postfach ab.
            </DialogDescription>
          </DialogHeader>
          {previewLog && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-xs border rounded-lg p-3 bg-muted/30">
                <DetailRow label="Status" value={EMAIL_STATUS_LABELS[previewLog.status] ?? previewLog.status} />
                <DetailRow label="Typ" value={EMAIL_TYPE_LABELS[previewLog.template_name] ?? previewLog.template_name} />
                <DetailRow label="Empfänger" value={previewLog.recipient_email} />
                <DetailRow label="Absender" value={previewLog.sender_email || previewLog.metadata?.from_email || "–"} />
                <DetailRow label="Tenant" value={previewLog.metadata?.tenant_name || "–"} />
                <DetailRow label="Reply-To" value={previewLog.metadata?.reply_to || "–"} />
                <DetailRow
                  label="SMTP-Server"
                  value={previewLog.metadata?.smtp_host
                    ? `${previewLog.metadata.smtp_host}:${previewLog.metadata.smtp_port ?? "?"}${previewLog.metadata.smtp_secure ? " (TLS)" : ""}`
                    : "–"}
                />
                <DetailRow label="SMTP-User" value={previewLog.metadata?.smtp_username || "–"} />
                <DetailRow label="Zeitpunkt" value={new Date(previewLog.created_at).toLocaleString("de-DE")} />
                <DetailRow label="Betreff" value={previewLog.rendered_subject || previewLog.metadata?.subject || "–"} />
                <DetailRow label="Message-ID" value={previewLog.message_id || previewLog.metadata?.message_id || "–"} />
              </div>

              {previewLog.error_message && (
                <div className="border border-destructive/30 bg-destructive/5 rounded-lg p-3">
                  <p className="text-[10px] font-semibold uppercase text-destructive mb-1">Fehler</p>
                  <p className="text-xs text-destructive font-mono break-all">{previewLog.error_message}</p>
                </div>
              )}

              <div>
                <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-2">HTML-Vorschau</p>
                {previewLog.rendered_html ? (
                  <iframe
                    srcDoc={previewLog.rendered_html}
                    sandbox=""
                    className="w-full h-[400px] border rounded-lg bg-white"
                    title="Email Preview"
                  />
                ) : (
                  <div className="border rounded-lg p-6 bg-muted/30 text-center text-xs text-muted-foreground">
                    Für diese Mail wurde kein gerendertes HTML gespeichert.
                    <br />
                    Neu versendete Mails ab dem Update sind in der Vorschau zu sehen.
                  </div>
                )}
              </div>

              {previewLog.metadata && Object.keys(previewLog.metadata).length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Metadaten anzeigen (JSON)</summary>
                  <pre className="mt-2 bg-muted/30 p-3 rounded-lg overflow-x-auto text-[10px]">
                    {JSON.stringify(previewLog.metadata, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            {previewLog?.template_name === "invitation" && user?.email && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => previewLog && sendTestToMe(previewLog)}
                disabled={sendingTest}
                className="gap-1.5"
              >
                <Send className="h-3.5 w-3.5" /> Test an mich senden ({user.email})
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setPreviewLog(null)}>Schließen</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</p>
      <p className="text-xs text-foreground break-all">{value}</p>
    </div>
  );
}

