import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  checkDomainsHealth,
  setPrimaryDomain,
  getAffectedRecipients,
  setTenantEmailsPaused,
  type AffectedRecipient,
} from "@/lib/tenant-domains.functions";
import { CheckCircle2, XCircle, AlertCircle, RefreshCw, Loader2, Users, Star, ExternalLink, Download, MailX, MailCheck } from "lucide-react";

export const Route = createFileRoute("/admin/domains")({
  component: AdminDomainsPage,
});

interface DomainRow {
  tenant_id: string;
  tenant_name: string;
  domain: string;
  is_primary: boolean;
  is_root: boolean;
  status: "ok" | "down" | "slow" | "unknown";
  http_status: number | null;
  latency_ms: number | null;
  error: string | null;
}

function AdminDomainsPage() {
  const { toast } = useToast();
  const checkFn = useServerFn(checkDomainsHealth);
  const setPrimaryFn = useServerFn(setPrimaryDomain);
  const getAffectedFn = useServerFn(getAffectedRecipients);
  const setPausedFn = useServerFn(setTenantEmailsPaused);

  const [rows, setRows] = useState<DomainRow[]>([]);
  const [pauseState, setPauseState] = useState<Record<string, { paused: boolean; at: string | null; reason: string | null; by: string | null }>>({});
  const [loading, setLoading] = useState(true);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [openTenantId, setOpenTenantId] = useState<string | null>(null);
  const [affected, setAffected] = useState<Record<string, AffectedRecipient[]>>({});
  const [loadingAffected, setLoadingAffected] = useState<string | null>(null);
  const [settingPrimary, setSettingPrimary] = useState<string | null>(null);
  const [togglingPause, setTogglingPause] = useState<string | null>(null);

  const runCheck = async () => {
    setLoading(true);
    try {
      const res = await checkFn({ data: {} as any });
      setRows(res.domains as DomainRow[]);
      setPauseState((res as any).pause_state ?? {});
      setCheckedAt(res.checked_at);
    } catch (e: any) {
      toast({ title: "Health-Check fehlgeschlagen", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { runCheck(); }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, { name: string; domains: DomainRow[] }>();
    for (const r of rows) {
      if (!map.has(r.tenant_id)) map.set(r.tenant_id, { name: r.tenant_name, domains: [] });
      map.get(r.tenant_id)!.domains.push(r);
    }
    return Array.from(map.entries()).map(([id, v]) => ({ id, ...v }));
  }, [rows]);

  const handleSetPrimary = async (tenant_id: string, domain: string) => {
    setSettingPrimary(`${tenant_id}:${domain}`);
    try {
      await setPrimaryFn({ data: { tenant_id, domain } });
      toast({ title: "Versand-Domain aktualisiert", description: `Neue Mails gehen jetzt über portal.${domain}` });
      await runCheck();
    } catch (e: any) {
      toast({ title: "Fehler", description: e.message, variant: "destructive" });
    } finally {
      setSettingPrimary(null);
    }
  };

  const toggleAffected = async (tenant_id: string) => {
    if (openTenantId === tenant_id) { setOpenTenantId(null); return; }
    setOpenTenantId(tenant_id);
    if (!affected[tenant_id]) {
      setLoadingAffected(tenant_id);
      try {
        const res = await getAffectedFn({ data: { tenant_id } });
        setAffected((p) => ({ ...p, [tenant_id]: res.recipients }));
      } catch (e: any) {
        toast({ title: "Fehler", description: e.message, variant: "destructive" });
      } finally {
        setLoadingAffected(null);
      }
    }
  };

  const handleTogglePause = async (tenant_id: string, currentlyPaused: boolean) => {
    let reason: string | null = null;
    if (!currentlyPaused) {
      reason = window.prompt(
        "Grund für die Pause (optional, wird im Activity-Log gespeichert):",
        "",
      );
      if (reason === null) return; // Abbruch
      reason = reason.trim() || null;
    } else {
      if (!window.confirm("Mail-Versand für diesen Tenant wieder AKTIVIEREN? Reminder-/Recovery-Mails gehen ab sofort wieder raus.")) return;
    }
    setTogglingPause(tenant_id);
    try {
      await setPausedFn({ data: { tenant_id, paused: !currentlyPaused, reason } });
      toast({
        title: currentlyPaused ? "Mail-Versand reaktiviert" : "Mail-Versand pausiert",
        description: currentlyPaused
          ? "Reminder/Recovery werden wieder versendet."
          : "Es werden keine Reminder-/Recovery-Mails mehr versendet, bis du wieder aktivierst.",
      });
      await runCheck();
    } catch (e: any) {
      toast({ title: "Fehler", description: e.message, variant: "destructive" });
    } finally {
      setTogglingPause(null);
    }
  };

  const exportCsv = (tenant_id: string, tenant_name: string, primary_domain: string) => {
    const list = affected[tenant_id] ?? [];
    if (list.length === 0) {
      toast({ title: "Keine Daten", description: 'Erst "Betroffene Empfänger anzeigen" laden.', variant: "destructive" });
      return;
    }
    const header = ["Typ", "Name", "E-Mail", "Telefon", "Status", "Neuer Portal-Link"];
    const rows = list.map((r) => [
      r.kind,
      r.name ?? "",
      r.email ?? "",
      r.phone ?? "",
      r.status,
      `https://portal.${primary_domain}/`,
    ]);
    const escape = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = [header, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
    // BOM for Excel UTF-8 compatibility
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const date = new Date().toISOString().split("T")[0];
    const safeName = tenant_name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    a.href = url;
    a.download = `betroffene-empfaenger-${safeName}-${date}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };



  return (
    <div className="p-5 max-w-5xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-heading font-bold">Domain-Übersicht</h1>
          <p className="text-xs text-muted-foreground">
            Status aller Portal-Domains. Klicke „Aktiv setzen" um auf eine andere Domain zu wechseln.
            {checkedAt && <> · Zuletzt geprüft: {new Date(checkedAt).toLocaleTimeString("de-DE")}</>}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={runCheck} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
          Erneut prüfen
        </Button>
      </div>

      {/* Hilfe-Aufklapper: Was tun bei Domain-Ausfall? */}
      <details className="border rounded-lg bg-muted/30 group">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium flex items-center gap-2 hover:bg-muted/50 transition-colors">
          <AlertCircle className="h-4 w-4 text-amber-500" />
          Was tun, wenn eine Domain ausfällt?
          <span className="ml-auto text-[10px] text-muted-foreground group-open:hidden">Klicken zum Aufklappen</span>
        </summary>
        <div className="px-4 pb-4 pt-1 text-xs text-foreground space-y-2 border-t">
          <p>
            <strong>Beispiel:</strong> <code className="bg-background px-1 rounded">digital-dgigmbh.de</code> ist down,
            <code className="bg-background px-1 rounded">digital-dgigmbh.com</code> soll übernehmen:
          </p>
          <ol className="list-decimal pl-5 space-y-1.5">
            <li>In der Tabelle unten beim Tenant die <strong>.com</strong>-Zeile suchen.</li>
            <li>Auf <strong>„Aktiv setzen"</strong> klicken (Stern wechselt zur neuen Domain).</li>
            <li>Ab sofort gehen alle neuen Mails von <code className="bg-background px-1 rounded">noreply@digital-dgigmbh.com</code> raus.</li>
            <li>Der Recovery-Cron schickt automatisch an alle Mitarbeiter eine Mail mit dem neuen Login-Link.</li>
          </ol>
          <p className="pt-2 text-muted-foreground">
            <strong>Voraussetzung:</strong> Die Alias-Domain muss vorher schon hinzugefügt + DNS-verifiziert sein.
            Sonst kannst du im Notfall nicht umstellen. Lege deshalb für jeden Tenant <strong>vorab</strong> mindestens
            eine Backup-Domain an.
          </p>
        </div>
      </details>

      {loading && rows.length === 0 && (
        <div className="text-center text-muted-foreground py-10 text-sm">Prüfe Domains…</div>
      )}

      {grouped.map((t) => {
        const primary = t.domains.find((d) => d.is_primary)?.domain ?? t.domains[0]?.domain ?? "";
        const anyDown = t.domains.some((d) => d.status === "down");
        const ps = pauseState[t.id];
        const paused = !!ps?.paused;
        return (
          <Card key={t.id} className={paused ? "border-amber-500/50" : anyDown ? "border-destructive/40" : ""}>
            <CardContent className="pt-4 pb-4 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h2 className="text-base font-semibold flex items-center gap-2 flex-wrap">
                    {t.name}
                    {paused && (
                      <Badge variant="outline" className="gap-1 border-amber-500 text-amber-700 dark:text-amber-400">
                        <MailX className="h-3 w-3" /> MAILS PAUSIERT
                      </Badge>
                    )}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Aktive Versand-Domain: <code className="bg-muted px-1.5 py-0.5 rounded">portal.{primary}</code>
                  </p>
                </div>
                {anyDown && !paused && (
                  <Badge variant="destructive" className="gap-1">
                    <AlertCircle className="h-3 w-3" /> Mindestens eine Domain down
                  </Badge>
                )}
              </div>

              {paused && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs space-y-1">
                  <p className="font-medium text-amber-900 dark:text-amber-200">
                    Reminder-, Recovery- und Onboarding-Mails sind für diesen Tenant gestoppt.
                  </p>
                  <p className="text-amber-800 dark:text-amber-300">
                    {ps?.by === "auto:domain_down"
                      ? "Automatisch pausiert weil alle Domains down waren."
                      : "Manuell pausiert."}
                    {ps?.reason && <> · Grund: {ps.reason}</>}
                    {ps?.at && <> · Seit {new Date(ps.at).toLocaleString("de-DE")}</>}
                  </p>
                </div>
              )}

              <div className="border rounded-lg divide-y">
                {t.domains.map((d) => (
                  <div key={d.domain} className="flex items-center justify-between p-3 gap-3 flex-wrap">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <StatusDot status={d.status} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <code className="text-sm font-mono truncate">portal.{d.domain}</code>
                          {d.is_primary && (
                            <Badge variant="default" className="gap-1 h-5 text-[10px]">
                              <Star className="h-2.5 w-2.5" /> AKTIV
                            </Badge>
                          )}
                          {d.is_root && !d.is_primary && (
                            <Badge variant="outline" className="h-5 text-[10px]">Root</Badge>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          {d.status === "down" ? (
                            <span className="text-destructive">Nicht erreichbar: {d.error}</span>
                          ) : (
                            <>HTTP {d.http_status ?? "?"} · {d.latency_ms}ms</>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <a
                        href={`https://portal.${d.domain}/`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1"
                      >
                        <ExternalLink className="h-3 w-3" /> Öffnen
                      </a>
                      {!d.is_primary && d.status !== "down" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleSetPrimary(t.id, d.domain)}
                          disabled={settingPrimary === `${t.id}:${d.domain}`}
                        >
                          {settingPrimary === `${t.id}:${d.domain}` ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <>Aktiv setzen</>
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={() => toggleAffected(t.id)}>
                  <Users className="h-3.5 w-3.5 mr-1" />
                  {openTenantId === t.id ? "Empfänger ausblenden" : "Betroffene Empfänger anzeigen"}
                </Button>
                <Button
                  size="sm"
                  variant={paused ? "default" : "outline"}
                  onClick={() => handleTogglePause(t.id, paused)}
                  disabled={togglingPause === t.id}
                  className={paused ? "" : "text-amber-700 dark:text-amber-400 border-amber-500/50 hover:bg-amber-50 dark:hover:bg-amber-950/30"}
                >
                  {togglingPause === t.id ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  ) : paused ? (
                    <MailCheck className="h-3.5 w-3.5 mr-1" />
                  ) : (
                    <MailX className="h-3.5 w-3.5 mr-1" />
                  )}
                  {paused ? "Mail-Versand reaktivieren" : "Mail-Versand pausieren"}
                </Button>
                {openTenantId === t.id && (affected[t.id]?.length ?? 0) > 0 && (
                  <Button size="sm" variant="outline" onClick={() => exportCsv(t.id, t.name, primary)}>
                    <Download className="h-3.5 w-3.5 mr-1" />
                    CSV exportieren
                  </Button>
                )}
              </div>


              {openTenantId === t.id && (
                <div className="border rounded-lg overflow-hidden">
                  {loadingAffected === t.id ? (
                    <div className="p-4 text-center text-muted-foreground text-sm">
                      <Loader2 className="h-4 w-4 animate-spin inline mr-1" /> Laden…
                    </div>
                  ) : affected[t.id]?.length === 0 ? (
                    <div className="p-4 text-center text-muted-foreground text-sm">Keine aktiven Empfänger.</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="text-left p-2">Typ</th>
                            <th className="text-left p-2">Name</th>
                            <th className="text-left p-2">E-Mail</th>
                            <th className="text-left p-2">Telefon</th>
                            <th className="text-left p-2">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {(affected[t.id] ?? []).map((r) => (
                            <tr key={`${r.kind}-${r.id}`}>
                              <td className="p-2"><Badge variant="outline" className="text-[10px]">{r.kind}</Badge></td>
                              <td className="p-2 font-medium">{r.name || "–"}</td>
                              <td className="p-2 text-muted-foreground">{r.email ?? "–"}</td>
                              <td className="p-2 text-muted-foreground">{r.phone ?? "–"}</td>
                              <td className="p-2 text-muted-foreground">{r.status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      {!loading && grouped.length === 0 && (
        <div className="text-center text-muted-foreground py-10 text-sm">Keine aktiven Tenants gefunden.</div>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: "ok" | "down" | "slow" | "unknown" }) {
  if (status === "ok") return <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />;
  if (status === "down") return <XCircle className="h-4 w-4 text-destructive shrink-0" />;
  if (status === "slow") return <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />;
  return <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0" />;
}
