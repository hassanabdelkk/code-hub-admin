import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  listLandingServers,
  createLandingServer,
  deleteLandingServer,
  updateLandingServer,
  rotateBootstrapToken,
  requestThemeResync,
} from "@/lib/landing-servers.functions";
import {
  listCloudflareAccounts,
  createCloudflareAccount,
  updateCloudflareAccount,
  deleteCloudflareAccount,
  verifyCloudflareToken,
  syncCloudflareZones,
} from "@/lib/cloudflare.functions";
import { listAutomationLog } from "@/lib/automation-log.functions";
import { Loader2, Plus, Copy, RefreshCw, Trash2, CheckCircle2, AlertCircle, Power, KeyRound, Cloud, Server, Activity } from "lucide-react";

export const Route = createFileRoute("/admin/infrastructure")({
  component: InfrastructurePage,
});

function InfrastructurePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Infrastruktur</h1>
        <p className="text-sm text-muted-foreground">Landing-Server-Pool, Cloudflare-Accounts & Automatisierung.</p>
      </div>
      <Tabs defaultValue="servers" className="space-y-4">
        <TabsList>
          <TabsTrigger value="servers"><Server className="w-4 h-4 mr-2" />Server</TabsTrigger>
          <TabsTrigger value="cloudflare"><Cloud className="w-4 h-4 mr-2" />Cloudflare</TabsTrigger>
          <TabsTrigger value="operations"><Activity className="w-4 h-4 mr-2" />Operations</TabsTrigger>
        </TabsList>
        <TabsContent value="servers"><ServersTab /></TabsContent>
        <TabsContent value="cloudflare"><CloudflareTab /></TabsContent>
        <TabsContent value="operations"><OperationsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// TAB: Server
// ════════════════════════════════════════════════════════════════════════════
function ServersTab() {
  const { toast } = useToast();
  const list = useServerFn(listLandingServers);
  const create = useServerFn(createLandingServer);
  const del = useServerFn(deleteLandingServer);
  const update = useServerFn(updateLandingServer);
  const rotate = useServerFn(rotateBootstrapToken);
  const resync = useServerFn(requestThemeResync);

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [openNew, setOpenNew] = useState(false);
  const [form, setForm] = useState({ name: "", hostname: "", ip: "", capacity: 100, notes: "" });
  const [busy, setBusy] = useState(false);
  const [bootstrapFor, setBootstrapFor] = useState<{ id: string; name: string; token: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const r = await list({ data: {} as any });
      setRows(r.rows);
    } catch (e: any) {
      setLoadError(e?.message ?? String(e));
      // kein Toast bei Migrations-Fehler — Banner zeigt das viel klarer
      if (!/landing_servers|schema cache|relation .* does not exist/i.test(e?.message ?? "")) {
        toast({ title: "Fehler", description: e.message, variant: "destructive" });
      }
    } finally { setLoading(false); }
  };
  useEffect(() => {
    reload();
    const timer = window.setInterval(reload, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const onCreate = async () => {
    setBusy(true);
    try {
      const row = await create({ data: form });
      toast({ title: "Server angelegt", description: row.name });
      setOpenNew(false);
      setForm({ name: "", hostname: "", ip: "", capacity: 100, notes: "" });
      setBootstrapFor({ id: row.id, name: row.name, token: row.bootstrap_token });
      reload();
    } catch (e: any) { toast({ title: "Fehler", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };

  const onDelete = async (id: string, name: string) => {
    if (!confirm(`Server "${name}" wirklich löschen?`)) return;
    try {
      await del({ data: { id } });
      toast({ title: "Server gelöscht" });
      reload();
    } catch (e: any) { toast({ title: "Fehler", description: e.message, variant: "destructive" }); }
  };

  const onTogglePause = async (row: any) => {
    const next = row.status === "paused" ? "online" : "paused";
    try {
      await update({ data: { id: row.id, status: next } });
      reload();
    } catch (e: any) { toast({ title: "Fehler", description: e.message, variant: "destructive" }); }
  };

  const onRotate = async (id: string, name: string) => {
    if (!confirm("Token rotieren? Der alte funktioniert danach nicht mehr.")) return;
    try {
      const r = await rotate({ data: { id } });
      setBootstrapFor({ id, name, token: r.bootstrap_token });
      toast({ title: "Token rotiert" });
    } catch (e: any) { toast({ title: "Fehler", description: e.message, variant: "destructive" }); }
  };

  const onResync = async (id: string, name: string) => {
    try {
      await resync({ data: { id } });
      toast({ title: "Themes-Resync angefordert", description: `${name}: Server lädt Themes beim nächsten Heartbeat (≤60s) neu.` });
      reload();
    } catch (e: any) { toast({ title: "Fehler", description: e.message, variant: "destructive" }); }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Landing-Server-Pool</CardTitle>
          <CardDescription>Alle Server, auf denen Landings gehostet werden. Verteilung: least-full.</CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={reload}><RefreshCw className="w-4 h-4 mr-2" />Aktualisieren</Button>
          <Dialog open={openNew} onOpenChange={setOpenNew}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="w-4 h-4 mr-2" />Server hinzufügen</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Neuen Landing-Server registrieren</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Landing-Pool-EU-1" /></div>
                <div><Label>Hostname / FQDN</Label><Input value={form.hostname} onChange={(e) => setForm({ ...form, hostname: e.target.value })} placeholder="landing-1.mb-infra.com" /></div>
                <div><Label>IP-Adresse (öffentlich, IPv4)</Label><Input value={form.ip} onChange={(e) => setForm({ ...form, ip: e.target.value })} placeholder="138.201.x.x" /></div>
                <div><Label>Kapazität (max. Landings)</Label><Input type="number" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) || 100 })} /></div>
                <div><Label>Notiz (optional)</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpenNew(false)}>Abbrechen</Button>
                <Button onClick={onCreate} disabled={busy || !form.name || !form.ip || !form.hostname}>
                  {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Anlegen
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {loadError && /landing_servers|schema cache|relation .* does not exist/i.test(loadError) ? (
          <div className="rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 p-4 text-sm space-y-2">
            <p className="font-semibold text-amber-900 dark:text-amber-200 flex items-center gap-2">
              <AlertCircle className="w-4 h-4" /> Datenbank-Migration fehlt
            </p>
            <p className="text-amber-800 dark:text-amber-300">
              Die Tabelle <code className="font-mono">landing_servers</code> existiert noch nicht. Führe diese SQL-Datei im Supabase SQL-Editor aus:
            </p>
            <pre className="bg-amber-100 dark:bg-amber-900/40 p-2 rounded text-xs font-mono">supabase/manual-migrations/20260618000000_landing_infrastructure.sql</pre>
            <p className="text-amber-800 dark:text-amber-300 text-xs">
              Vollständige Anleitung inkl. Reihenfolge aller Migrationen: <code className="font-mono">docs/MIGRATIONS.md</code>
            </p>
            <Button size="sm" variant="outline" className="mt-1" onClick={reload}>
              <RefreshCw className="w-3 h-3 mr-2" />Nochmal versuchen
            </Button>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="py-10 px-4 max-w-2xl mx-auto">
            <div className="text-center mb-6">
              <Server className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="font-medium">Noch kein Landing-Server registriert</p>
              <p className="text-xs text-muted-foreground mt-1">So bringst du deinen ersten Server online:</p>
            </div>
            <ol className="space-y-3 text-sm">
              <li className="flex gap-3">
                <span className="flex-none w-7 h-7 rounded-full bg-primary/10 text-primary font-semibold flex items-center justify-center text-xs">1</span>
                <div>
                  <p className="font-medium">VPS bestellen</p>
                  <p className="text-xs text-muted-foreground">Hetzner Cloud, Netcup o.ä. — Ubuntu 22.04+, mind. 2 GB RAM, öffentliche IPv4.</p>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="flex-none w-7 h-7 rounded-full bg-primary/10 text-primary font-semibold flex items-center justify-center text-xs">2</span>
                <div>
                  <p className="font-medium">Hier oben „Server hinzufügen" klicken</p>
                  <p className="text-xs text-muted-foreground">Name, Hostname, IP, Kapazität eintragen → Anlegen.</p>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="flex-none w-7 h-7 rounded-full bg-primary/10 text-primary font-semibold flex items-center justify-center text-xs">3</span>
                <div>
                  <p className="font-medium">One-Liner per SSH auf dem VPS ausführen</p>
                  <p className="text-xs text-muted-foreground">Der Befehl wird dir nach „Anlegen" angezeigt. Installiert Bun + Caddy + Renderer in ~1 Minute.</p>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="flex-none w-7 h-7 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold flex items-center justify-center text-xs">✓</span>
                <div>
                  <p className="font-medium">Fertig — Status springt automatisch auf „Online"</p>
                  <p className="text-xs text-muted-foreground">Ab dann kannst du Landings über den Landing-Generator hier hosten.</p>
                </div>
              </li>
            </ol>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Hostname / IP</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Auslastung</TableHead>
                <TableHead>Letzter Heartbeat</TableHead>
                <TableHead className="text-right">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => <ServerRow key={r.id} row={r} onTogglePause={onTogglePause} onDelete={onDelete} onRotate={onRotate} onResync={onResync} onShowBootstrap={(t) => setBootstrapFor({ id: r.id, name: r.name, token: t })} />)}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {bootstrapFor && <BootstrapDialog server={bootstrapFor} onClose={() => setBootstrapFor(null)} />}
    </Card>
  );
}

function ServerRow({ row, onTogglePause, onDelete, onRotate, onResync, onShowBootstrap }: any) {
  const heartbeatAge = row.last_heartbeat_at ? Date.now() - new Date(row.last_heartbeat_at).getTime() : null;
  const isStale = heartbeatAge !== null && heartbeatAge > 5 * 60_000;
  const effectiveStatus = row.status === "paused" ? "paused" : row.status === "pending" ? "pending" : row.status === "offline" || isStale ? "offline" : "online";
  const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    online: "default", pending: "outline", paused: "secondary", offline: "destructive",
  };
  const statusLabel: Record<string, string> = { online: "Online", pending: "Wartend", paused: "Pausiert", offline: "Offline" };
  const resyncReq = row.themes_resync_requested_at ? new Date(row.themes_resync_requested_at).getTime() : 0;
  const resyncDone = row.themes_resync_done_at ? new Date(row.themes_resync_done_at).getTime() : 0;
  const resyncPending = resyncReq > 0 && resyncReq > resyncDone;
  return (
    <TableRow>
      <TableCell className="font-medium">{row.name}</TableCell>
      <TableCell className="font-mono text-xs">{row.hostname}<br /><span className="text-muted-foreground">{row.ip}</span></TableCell>
      <TableCell><Badge variant={statusVariant[effectiveStatus]}>{statusLabel[effectiveStatus]}</Badge></TableCell>
      <TableCell>{row.landing_count} / {row.capacity}</TableCell>
      <TableCell className="text-xs text-muted-foreground">{row.last_heartbeat_at ? formatAgo(row.last_heartbeat_at) : "noch keiner"}</TableCell>
      <TableCell className="text-right space-x-1">
        <Button variant="ghost" size="sm" onClick={() => onShowBootstrap(row.bootstrap_token)} title="Bootstrap-Befehl"><Copy className="w-4 h-4" /></Button>
        <Button variant="ghost" size="sm" onClick={() => onRotate(row.id, row.name)} title="Token rotieren"><KeyRound className="w-4 h-4" /></Button>
        <Button variant="ghost" size="sm" onClick={() => onResync(row.id, row.name)} title={resyncPending ? "Resync läuft (≤60s)…" : "Themes neu laden"} disabled={resyncPending}><RefreshCw className={`w-4 h-4 ${resyncPending ? "animate-spin text-primary" : ""}`} /></Button>
        <Button variant="ghost" size="sm" onClick={() => onTogglePause(row)} title="Pausieren/Aktivieren"><Power className="w-4 h-4" /></Button>
        <Button variant="ghost" size="sm" onClick={() => onDelete(row.id, row.name)} title="Löschen"><Trash2 className="w-4 h-4 text-destructive" /></Button>
      </TableCell>
    </TableRow>
  );
}

function getPublicBootstrapOrigin(): string {
  if (typeof window === "undefined") return "";
  const { hostname, origin } = window.location;

  const previewMatch = hostname.match(/^id-preview--([0-9a-f-]{36})\.lovable\.app$/i);
  const internalMatch = hostname.match(/^([0-9a-f-]{36})\.lovableproject\.com$/i);
  const projectId = previewMatch?.[1] ?? internalMatch?.[1];

  if (projectId) return `https://project--${projectId}-dev.lovable.app`;
  return origin;
}

function BootstrapDialog({ server, onClose }: { server: { id: string; name: string; token: string }; onClose: () => void }) {
  const origin = getPublicBootstrapOrigin();
  const [clean, setClean] = useState(false);
  const qs = `token=${server.token}${clean ? "&clean=1" : ""}`;
  const bootstrapUrl = `${origin}/api/public/landing-server-bootstrap?${qs}`;
  const cmd = `tmp=$(mktemp); trap 'rm -f "$tmp"' EXIT; if curl -fsSL "${bootstrapUrl}" -o "$tmp" && grep -q '^#!/usr/bin/env bash' "$tmp"; then if [ "$(id -u)" -eq 0 ]; then bash "$tmp"; else sudo bash "$tmp"; fi; else echo "Bootstrap konnte nicht geladen werden (Fehler/HTML statt Script)."; [ -s "$tmp" ] && head -n 3 "$tmp"; fi`;
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Server „{server.name}" einrichten</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 p-3 text-xs space-y-1">
            <div className="font-semibold text-emerald-800 dark:text-emerald-300">Empfohlener Ablauf (1 Server kann mehrere Landing-Pages hosten)</div>
            <ol className="list-decimal ml-4 space-y-0.5 text-emerald-900/80 dark:text-emerald-200/80">
              <li>Beim Hoster einen <b>frischen Ubuntu/Debian-VPS</b> neu aufsetzen lassen (Reset / Reinstall).</li>
              <li>Per SSH als <code className="font-mono">root</code> (oder mit <code className="font-mono">sudo</code>) einloggen.</li>
              <li>Befehl unten kopieren &amp; ausführen — Script installiert Bun + Caddy, Renderer, systemd-Services.</li>
              <li>Nach ~1 Min erscheint der Server hier als „Online" (Heartbeat alle 60s).</li>
            </ol>
          </div>

          <label className="flex items-start gap-2 rounded-md border border-amber-300 dark:border-amber-800 p-3 bg-amber-50 dark:bg-amber-950/30 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={clean}
              onChange={(e) => setClean(e.target.checked)}
            />
            <div>
              <div className="font-medium text-amber-900 dark:text-amber-200">
                Clean Install <span className="font-normal">(<code className="font-mono">clean=1</code>)</span> — nur bei bestehender Installation aktivieren
              </div>
              <div className="text-xs text-amber-800/80 dark:text-amber-200/70 mt-1 space-y-1">
                <p>
                  <b>Frisch aufgesetzter VPS / nach Reset:</b> <span className="text-emerald-700 dark:text-emerald-400">NICHT nötig</span> — Kästchen aus lassen.
                </p>
                <p>
                  <b>VPS lief schon mit nginx/apache/altem Caddy oder altem landing-server:</b> aktivieren. Stoppt &amp; entfernt
                  Webserver, räumt Ports 80/443/3001 frei und löscht <code className="font-mono">/opt/landing-server</code>.
                </p>
                <p className="text-red-700 dark:text-red-400">
                  ⚠️ Nur auf Servern aktivieren, auf denen sonst nichts Wichtiges mehr läuft.
                </p>
              </div>
            </div>
          </label>

          <div className="relative">
            <pre className="bg-muted p-3 rounded text-xs overflow-x-auto whitespace-pre-wrap break-all">{cmd}</pre>
            <Button size="sm" variant="ghost" className="absolute top-1 right-1" onClick={() => navigator.clipboard.writeText(cmd)} title="Befehl kopieren">
              <Copy className="w-3 h-3" />
            </Button>
          </div>
          <div className="text-muted-foreground text-xs space-y-1">
            <p>Das Script ist idempotent — du kannst es bei Bedarf erneut ausführen (z.B. um den Renderer zu aktualisieren).</p>
            <p className="text-amber-600 dark:text-amber-400">⚠️ Token = Zugang zum Server-Account. Nicht öffentlich teilen.</p>
          </div>
        </div>
        <DialogFooter><Button onClick={onClose}>Schließen</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// TAB: Cloudflare
// ════════════════════════════════════════════════════════════════════════════
function CloudflareTab() {
  const { toast } = useToast();
  const list = useServerFn(listCloudflareAccounts);
  const create = useServerFn(createCloudflareAccount);
  const update = useServerFn(updateCloudflareAccount);
  const del = useServerFn(deleteCloudflareAccount);
  const verify = useServerFn(verifyCloudflareToken);
  const sync = useServerFn(syncCloudflareZones);

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [openNew, setOpenNew] = useState(false);
  const [form, setForm] = useState({ name: "", account_id: "", api_token: "", is_default: false });
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [editFor, setEditFor] = useState<{ id: string; name: string } | null>(null);
  const [editToken, setEditToken] = useState("");

  const reload = async () => {
    setLoading(true);
    try { const r = await list({ data: {} as any }); setRows(r.rows); }
    catch (e: any) { toast({ title: "Fehler", description: e.message, variant: "destructive" }); }
    finally { setLoading(false); }
  };
  useEffect(() => { reload(); }, []);

  const onCreate = async () => {
    setBusy(true);
    try {
      await create({ data: form });
      toast({ title: "CF-Account angelegt" });
      setOpenNew(false);
      setForm({ name: "", account_id: "", api_token: "", is_default: false });
      reload();
    } catch (e: any) { toast({ title: "Fehler", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };

  const onSaveToken = async () => {
    if (!editFor) return;
    setBusy(true);
    try {
      await update({ data: { id: editFor.id, api_token: editToken } });
      toast({ title: "Token aktualisiert" });
      setEditFor(null);
      setEditToken("");
      reload();
    } catch (e: any) { toast({ title: "Fehler", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Wie funktioniert's?</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2 text-muted-foreground">
          <p>Jeder Cloudflare-Account, in dem Kunden-Domains liegen, wird hier 1× hinterlegt. Der API-Token wird direkt im Portal eingetragen — beliebig viele Accounts möglich, jederzeit änderbar.</p>
          <p><strong>Token-Typ:</strong> Cloudflare → My Profile → API Tokens → Create Custom Token. Nicht „Global API Key" und nicht Account-Permissions.</p>
          <p><strong>Zone Permissions:</strong> Zone → Zone → Read und Zone → DNS → Edit. Zone Resources: Specific zone oder All zones from an account.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Cloudflare-Accounts</CardTitle>
            <CardDescription>{rows.length} Account(s) hinterlegt</CardDescription>
          </div>
          <Dialog open={openNew} onOpenChange={setOpenNew}>
            <DialogTrigger asChild><Button size="sm"><Plus className="w-4 h-4 mr-2" />Account hinzufügen</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Cloudflare-Account hinzufügen</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Name (intern)</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="DGI Holding" /></div>
                <div><Label>Cloudflare Account-ID</Label><Input value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })} placeholder="aus CF-Dashboard → Übersicht rechts" /></div>
                <div>
                  <Label>API-Token</Label>
                  <Input type="password" value={form.api_token} onChange={(e) => setForm({ ...form, api_token: e.target.value })} placeholder="cfat_…" autoComplete="off" />
                  <p className="text-xs text-muted-foreground mt-1">User API Token aus „My Profile“. Benötigt Zone → Zone → Read + Zone → DNS → Edit.</p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpenNew(false)}>Abbrechen</Button>
                <Button onClick={onCreate} disabled={busy || !form.name || !form.account_id || !form.api_token}>
                  {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Anlegen
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {loading ? <Loader2 className="w-6 h-6 animate-spin text-muted-foreground mx-auto my-6" /> : rows.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground"><Cloud className="w-10 h-10 mx-auto mb-2 opacity-50" />Noch kein CF-Account.</div>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Account-ID</TableHead><TableHead>Token</TableHead><TableHead className="text-right">Aktionen</TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}{r.is_default && <Badge className="ml-2" variant="outline">Default</Badge>}</TableCell>
                    <TableCell className="font-mono text-xs">{r.account_id}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.api_token ? <Badge variant="outline">gesetzt</Badge> : <Badge variant="destructive">fehlt</Badge>}
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button size="sm" variant="outline" onClick={() => { setEditFor({ id: r.id, name: r.name }); setEditToken(""); }}>
                        <KeyRound className="w-4 h-4 mr-1" />Token
                      </Button>
                      <Button size="sm" variant="outline" disabled={working === r.id} onClick={async () => {
                        setWorking(r.id);
                        try { const v = await verify({ data: { id: r.id } }); toast({ title: "Token gültig", description: `Status: ${v.status} · sichtbare Zonen: ${v.zonesVisible}` }); }
                        catch (e: any) { toast({ title: "Token-Fehler", description: e.message, variant: "destructive" }); }
                        finally { setWorking(null); }
                      }}><CheckCircle2 className="w-4 h-4 mr-1" />Verify</Button>
                      <Button size="sm" variant="outline" disabled={working === r.id} onClick={async () => {
                        setWorking(r.id);
                        try { const s = await sync({ data: { account_id: r.id } }); toast({ title: "Zonen synchronisiert", description: `${s.count} von ${s.found ?? s.count} Zonen gespeichert` }); }
                        catch (e: any) { toast({ title: "Sync fehlgeschlagen", description: e.message, variant: "destructive" }); }
                        finally { setWorking(null); }
                      }}><RefreshCw className="w-4 h-4 mr-1" />Sync Zonen</Button>
                      <Button size="sm" variant="ghost" onClick={async () => {
                        if (!confirm("Account entfernen?")) return;
                        await del({ data: { id: r.id } }); reload();
                      }}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editFor} onOpenChange={(o) => { if (!o) { setEditFor(null); setEditToken(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>API-Token ändern — {editFor?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Label>Neuer API-Token</Label>
            <Input type="password" value={editToken} onChange={(e) => setEditToken(e.target.value)} placeholder="cfat_…" autoComplete="off" />
            <p className="text-xs text-muted-foreground">Der alte Token wird überschrieben.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditFor(null); setEditToken(""); }}>Abbrechen</Button>
            <Button onClick={onSaveToken} disabled={busy || editToken.length < 20}>
              {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// TAB: Operations (Audit-Log)
// ════════════════════════════════════════════════════════════════════════════
function OperationsTab() {
  const { toast } = useToast();
  const list = useServerFn(listAutomationLog);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setLoading(true);
    try { const r = await list({ data: { limit: 200 } as any }); setRows(r.rows); }
    catch (e: any) { toast({ title: "Fehler", description: e.message, variant: "destructive" }); }
    finally { setLoading(false); }
  };
  useEffect(() => { reload(); }, []);

  const sv: Record<string, "default" | "secondary" | "destructive" | "outline"> = { ok: "default", warn: "secondary", error: "destructive" };
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div><CardTitle>Automation-Log</CardTitle><CardDescription>Letzte 200 Aktionen</CardDescription></div>
        <Button variant="outline" size="sm" onClick={reload}><RefreshCw className="w-4 h-4 mr-2" />Aktualisieren</Button>
      </CardHeader>
      <CardContent>
        {loading ? <Loader2 className="w-6 h-6 animate-spin text-muted-foreground mx-auto my-6" /> : rows.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">Noch keine Einträge.</div>
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead>Wann</TableHead><TableHead>Aktion</TableHead><TableHead>Ziel</TableHead><TableHead>Status</TableHead><TableHead>Details</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatAgo(r.created_at)}</TableCell>
                  <TableCell className="font-mono text-xs">{r.action}</TableCell>
                  <TableCell className="text-xs">{r.target ?? "—"}</TableCell>
                  <TableCell><Badge variant={sv[r.status] ?? "outline"}>{r.status}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-md truncate">
                    {r.error ? <span className="text-destructive">{r.error}</span> : JSON.stringify(r.payload ?? {})}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function formatAgo(iso: string): string {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return `vor ${sec}s`;
  if (sec < 3600) return `vor ${Math.floor(sec / 60)}min`;
  if (sec < 86400) return `vor ${Math.floor(sec / 3600)}h`;
  return new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
