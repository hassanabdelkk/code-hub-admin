import { createFileRoute } from "@tanstack/react-router";
import { useNavigate } from "@/lib/router-compat";
import { useMemo, useState } from "react";
import { useAdminData } from "@/contexts/AdminDataContext";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/EmptyState";
import { Users, Search, ExternalLink, Check, X, Trash2, UserPlus, Copy } from "lucide-react";
import { TableSkeleton, PageHeaderSkeleton } from "@/components/SkeletonLoaders";
import { STATUS_CONFIG, ONBOARDING_STATUS_CONFIG, type EmployeeStatus } from "@/lib/status";
import { StageTimeline, type Stage } from "@/components/StageTimeline";
import { toast } from "sonner";
import { purgeInactivePeople, deleteEmployeeAccount, bulkDeleteEmployees } from "@/lib/admin-delete.functions";
import { createEmployeeAccount } from "@/lib/admin-employees.functions";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { usePagination } from "@/hooks/use-pagination";
import { PaginationBar } from "@/components/PaginationBar";

export const Route = createFileRoute("/admin/mitarbeiter")({
  component: AdminMitarbeiterPage,
});

function AdminMitarbeiterPage() {
  const { applications, profiles, adminUserIds, emailConfirmedUserIds, loadingProfiles: loading, loadData } = useAdminData();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"alle" | "wartet" | "aktiv" | "abgelehnt">("alle");
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const runBulkDelete = useServerFn(bulkDeleteEmployees);

  const rows = useMemo(() => {
    const appById = new Map((applications as any[]).map((a) => [a.id, a]));
    const appByUserId = new Map((applications as any[]).filter((a) => a.user_id).map((a) => [a.user_id, a]));
    return (profiles as any[])
      .filter(p => !adminUserIds.has(p.user_id))
      .map(p => {
        const app = (p.application_id ? appById.get(p.application_id) : null) || (p.user_id ? appByUserId.get(p.user_id) : null) || null;
        return {
          id: p.user_id,
          name: p.full_name || app?.full_name || `${app?.first_name ?? ""} ${app?.last_name ?? ""}`.trim() || app?.email || "—",
          email: p.email || app?.email || "—",
          phone: p.phone || app?.phone || "—",
          status: p.status as EmployeeStatus,
          onboarding: p.onboarding_status as keyof typeof ONBOARDING_STATUS_CONFIG,
          createdAt: p.created_at,
          contractSigned: !!p.contract_signed_at,
          emailConfirmed: !!(p.user_id && emailConfirmedUserIds.has(p.user_id)),
          idUploaded: !!(p.id_front_url || p.id_back_url || p.onboarding_status === "abgeschlossen"),
        };
      })
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  }, [applications, profiles, adminUserIds, emailConfirmedUserIds]);

  function stagesFor(r: typeof rows[number]): Stage[] {
    const s = (state: Stage["state"], label: string, key: string): Stage => ({ key, label, state });
    const registered: Stage["state"] = "done";
    const email: Stage["state"] =
      r.status === "abgelehnt" ? "failed" :
      r.emailConfirmed ? "done" : "current";
    const perso: Stage["state"] =
      r.status === "abgelehnt" ? "failed" :
      r.idUploaded ? "done" :
      r.emailConfirmed ? "current" : "todo";
    const vertrag: Stage["state"] =
      r.status === "abgelehnt" ? "failed" :
      r.contractSigned ? "done" :
      r.idUploaded ? "current" : "todo";
    const aktiv: Stage["state"] =
      r.status === "angenommen" ? "done" :
      r.status === "abgelehnt" ? "failed" :
      (r.contractSigned && r.idUploaded) ? "current" : "todo";
    return [
      s(registered, "Registriert", "reg"),
      s(email, "E-Mail", "mail"),
      s(perso, "Perso", "id"),
      s(vertrag, "Vertrag", "contract"),
      s(aktiv, "Freigegeben", "active"),
    ];
  }

  const counts = useMemo(() => ({
    alle: rows.length,
    wartet: rows.filter(r => r.status === "registriert" && r.onboarding === "abgeschlossen").length,
    aktiv: rows.filter(r => r.status === "angenommen").length,
    abgelehnt: rows.filter(r => r.status === "abgelehnt").length,
  }), [rows]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return rows.filter(r => {
      if (tab === "wartet" && !(r.status === "registriert" && r.onboarding === "abgeschlossen")) return false;
      if (tab === "aktiv" && r.status !== "angenommen") return false;
      if (tab === "abgelehnt" && r.status !== "abgelehnt") return false;
      if (!ql) return true;
      return r.name.toLowerCase().includes(ql) || r.email.toLowerCase().includes(ql) || r.phone.toLowerCase().includes(ql);
    });
  }, [rows, q, tab]);
  const pagination = usePagination(filtered, 50);

  const allVisibleSelected = filtered.length > 0 && filtered.every(r => selected.has(r.id));
  const toggleAllVisible = () => {
    const next = new Set(selected);
    if (allVisibleSelected) filtered.forEach(r => next.delete(r.id));
    else filtered.forEach(r => next.add(r.id));
    setSelected(next);
  };
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  async function doBulkDelete() {
    setBulkBusy(true);
    try {
      const r: any = await runBulkDelete({ data: { user_ids: Array.from(selected) } });
      toast.success(`Gelöscht: ${r.deleted}${r.failures?.length ? ` (${r.failures.length} Fehler)` : ""}`);
      setSelected(new Set());
      setBulkOpen(false);
      await loadData();
    } catch (e: any) {
      toast.error(e?.message ?? "Bulk-Löschen fehlgeschlagen");
    } finally {
      setBulkBusy(false);
    }
  }

  async function setStatus(userId: string, status: EmployeeStatus) {
    setBusy(userId);
    try {
      const { error } = await supabase.from("profiles").update({ status }).eq("user_id", userId);
      if (error) throw error;
      toast.success(status === "angenommen" ? "Mitarbeiter freigeschaltet" : "Status aktualisiert");
    } catch (e: any) {
      toast.error(e?.message ?? "Fehler");
    } finally {
      setBusy(null);
    }
  }

  if (loading) return (
    <div className="p-6 space-y-4"><PageHeaderSkeleton /><TableSkeleton /></div>
  );

  const TABS: { key: typeof tab; label: string; emoji: string }[] = [
    { key: "alle", label: "Alle", emoji: "👥" },
    { key: "wartet", label: "Wartet auf Prüfung", emoji: "🟡" },
    { key: "aktiv", label: "Aktiv", emoji: "✅" },
    { key: "abgelehnt", label: "Abgelehnt", emoji: "❌" },
  ];

  return (
    <div className="p-6 lg:p-8 space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-2xl bg-primary/10 grid place-items-center">
            <Users className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-heading font-bold">Mitarbeiter</h1>
            <p className="text-sm text-muted-foreground">
              Registrierte Personen. Nach abgeschlossenem Onboarding freischalten.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <CreateEmployeeButton onCreated={loadData} />
          <PurgeButton />
          <div className="relative w-72">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Name, E-Mail, Telefon…" value={q} onChange={e => setQ(e.target.value)} className="pl-9" />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {TABS.map(t => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                active ? "bg-primary text-primary-foreground" : "bg-muted/60 text-foreground hover:bg-muted"
              }`}
            >
              <span>{t.emoji}</span><span>{t.label}</span>
              <span className={`ml-1 tabular-nums ${active ? "opacity-90" : "text-muted-foreground"}`}>
                {counts[t.key]}
              </span>
            </button>
          );
        })}
      </div>

      {selected.size > 0 && (
        <div className="sticky top-2 z-10 flex items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-2 shadow-sm">
          <div className="text-sm">
            <b>{selected.size}</b> Mitarbeiter ausgewählt
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Auswahl aufheben</Button>
            <AlertDialog open={bulkOpen} onOpenChange={setBulkOpen}>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="destructive" className="gap-1.5">
                  <Trash2 className="h-4 w-4" /> {selected.size} löschen
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{selected.size} Mitarbeiter endgültig löschen?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Profile, Auth-Accounts, Dokumente, KYC und Aufgaben-Einreichungen werden entfernt. Aktion nicht rückgängig zu machen.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={bulkBusy}>Abbrechen</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={bulkBusy}
                    onClick={(e) => { e.preventDefault(); doBulkDelete(); }}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {bulkBusy ? "Läuft…" : "Endgültig löschen"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      )}

      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState icon={Users} title="Keine Mitarbeiter" description="Für diesen Filter sind aktuell keine Einträge vorhanden." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 border-b">
                  <tr>
                    <th className="w-10 px-3 py-2.5">
                      <Checkbox checked={allVisibleSelected} onCheckedChange={toggleAllVisible} aria-label="Alle auswählen" />
                    </th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Name</th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">E-Mail</th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Telefon</th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Onboarding-Fortschritt</th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Registriert</th>
                    <th className="px-4 py-2.5 text-right text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Aktion</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {pagination.paged.map(r => {
                    const wartet = r.status === "registriert" && r.onboarding === "abgeschlossen";
                    const st = STATUS_CONFIG[r.status];
                    return (
                      <tr key={r.id} className={`hover:bg-muted/20 ${selected.has(r.id) ? "bg-primary/5" : ""}`}>
                        <td className="px-3 py-3">
                          <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggleOne(r.id)} aria-label="Auswählen" />
                        </td>
                        <td className="px-4 py-3 font-medium">
                          <div>{r.name}</div>
                          <div className="text-[10px] text-muted-foreground font-normal mt-0.5">
                            <span className={`inline-block px-1.5 py-0.5 rounded ${st?.color}`}>{st?.label}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{r.email}</td>
                        <td className="px-4 py-3 text-muted-foreground tabular-nums">{r.phone}</td>
                        <td className="px-4 py-3">
                          <StageTimeline stages={stagesFor(r)} />
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums">
                          {r.createdAt ? new Date(r.createdAt).toLocaleDateString("de-DE") : "—"}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center justify-end gap-1.5">
                            {wartet && (
                              <>
                                <Button
                                  size="sm" variant="default"
                                  disabled={busy === r.id}
                                  onClick={() => setStatus(r.id, "angenommen")}
                                  className="h-7 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700"
                                >
                                  <Check className="h-3 w-3" /> Annehmen
                                </Button>
                                <Button
                                  size="sm" variant="outline"
                                  disabled={busy === r.id}
                                  onClick={() => setStatus(r.id, "abgelehnt")}
                                  className="h-7 gap-1 text-xs"
                                >
                                  <X className="h-3 w-3" /> Ablehnen
                                </Button>
                              </>
                            )}
                            <Button variant="ghost" size="sm" onClick={() => navigate(`/admin/personen/${r.id}`)} className="h-7 gap-1.5 text-xs">
                              Öffnen <ExternalLink className="h-3 w-3" />
                            </Button>
                            <DeleteEmployeeButton userId={r.id} name={r.name} onDeleted={loadData} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="border-t px-3 py-2">
              <PaginationBar {...pagination} />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

function PurgeButton() {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ apps: number; profs: number } | null>(null);

  async function loadPreview() {
    setBusy(true);
    try {
      const r: any = await purgeInactivePeople({ data: { confirm: "ALLES LÖSCHEN AUSSER AKTIVE", dry_run: true } });
      setPreview({ apps: r.applications_to_delete, profs: r.profiles_to_delete });
    } catch (e: any) {
      toast.error(e?.message ?? "Fehler");
    } finally {
      setBusy(false);
    }
  }

  async function doPurge() {
    setBusy(true);
    try {
      const r: any = await purgeInactivePeople({ data: { confirm: "ALLES LÖSCHEN AUSSER AKTIVE", dry_run: false } });
      toast.success(`Gelöscht: ${r.deleted_applications} Bewerbungen, ${r.deleted_profiles} Profile${r.failures?.length ? ` (${r.failures.length} Fehler)` : ""}`);
      setPreview(null);
    } catch (e: any) {
      toast.error(e?.message ?? "Fehler");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog onOpenChange={(o) => { if (o) loadPreview(); else setPreview(null); }}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 text-destructive border-destructive/40 hover:bg-destructive/10">
          <Trash2 className="h-3.5 w-3.5" /> Inaktive löschen
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Alle nicht-aktiven Personen löschen?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm">
              <p>Es bleiben nur <b>aktive Mitarbeiter</b> (Status „angenommen") und Admins erhalten.</p>
              {preview ? (
                <div className="rounded-md border p-3 bg-muted/40">
                  <div>Bewerbungen: <b>{preview.apps}</b></div>
                  <div>Profile + Auth-Accounts: <b>{preview.profs}</b></div>
                </div>
              ) : (
                <p className="text-muted-foreground">Vorschau wird geladen…</p>
              )}
              <p className="text-destructive font-medium">Diese Aktion ist nicht rückgängig zu machen.</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy || !preview || (preview.apps === 0 && preview.profs === 0)}
            onClick={(e) => { e.preventDefault(); doPurge(); }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {busy ? "Läuft…" : "Endgültig löschen"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DeleteEmployeeButton({ userId, name, onDeleted }: { userId: string; name: string; onDeleted: () => void | Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const runDelete = useServerFn(deleteEmployeeAccount);
  async function doDelete() {
    setBusy(true);
    try {
      await runDelete({ data: { user_id: userId, confirm: "MITARBEITER LÖSCHEN" } });
      toast.success("Mitarbeiter gelöscht");
      setOpen(false);
      setText("");
      await onDeleted();
    } catch (e: any) {
      toast.error(e?.message ?? "Löschen fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }
  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (busy) return; setOpen(o); if (!o) setText(""); }}>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10"
          title="Mitarbeiter löschen"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Mitarbeiter endgültig löschen?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm">
              <p>
                <b>{name}</b> wird inklusive Profil, Auth-Account, Dokumenten,
                KYC-Uploads und Aufgaben-Einreichungen unwiderruflich gelöscht.
              </p>
              <p className="text-destructive font-medium">
                Zur Bestätigung tippe <code>MITARBEITER LÖSCHEN</code>:
              </p>
              <Input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="MITARBEITER LÖSCHEN"
                autoFocus
              />
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy || text !== "MITARBEITER LÖSCHEN"}
            onClick={(e) => { e.preventDefault(); doDelete(); }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {busy ? "Läuft…" : "Endgültig löschen"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function CreateEmployeeButton({ onCreated }: { onCreated: () => void | Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [empType, setEmpType] = useState<"minijob" | "teilzeit" | "vollzeit" | "">("");
  const [recoveryLink, setRecoveryLink] = useState<string | null>(null);
  const runCreate = useServerFn(createEmployeeAccount);

  function reset() {
    setEmail(""); setFirstName(""); setLastName(""); setPhone(""); setEmpType(""); setRecoveryLink(null);
  }

  async function submit() {
    if (!email || !firstName || !lastName) {
      toast.error("Bitte E-Mail, Vor- und Nachname ausfüllen");
      return;
    }
    setBusy(true);
    try {
      const r: any = await runCreate({
        data: {
          email: email.trim(),
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          phone: phone.trim() || undefined,
          employment_type: empType || undefined,
        },
      });
      toast.success("Mitarbeiter angelegt");
      setRecoveryLink(r?.recovery_link ?? null);
      await onCreated();
    } catch (e: any) {
      toast.error(e?.message ?? "Anlegen fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (busy) return; setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <UserPlus className="h-4 w-4" /> Mitarbeiter anlegen
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mitarbeiter-Konto anlegen</DialogTitle>
          <DialogDescription>
            Erstellt einen Auth-Account und ein Profil. Anschließend erhältst du einen Passwort-Link zum Weitergeben.
          </DialogDescription>
        </DialogHeader>

        {recoveryLink ? (
          <div className="space-y-3">
            <div className="rounded-md border border-emerald-300/50 bg-emerald-50 dark:bg-emerald-950/30 p-3 text-sm">
              Konto wurde erstellt. Sende dem Mitarbeiter den folgenden Link, damit er sein Passwort setzen kann:
            </div>
            <div className="flex items-center gap-2">
              <Input readOnly value={recoveryLink} className="font-mono text-xs" />
              <Button
                variant="outline" size="sm"
                onClick={() => { navigator.clipboard.writeText(recoveryLink); toast.success("Link kopiert"); }}
                className="gap-1.5"
              >
                <Copy className="h-3.5 w-3.5" /> Kopieren
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label className="text-xs">E-Mail *</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="max@example.com" />
            </div>
            <div>
              <Label className="text-xs">Vorname *</Label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Nachname *</Label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Telefon</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+49…" />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Anstellung</Label>
              <select
                className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={empType}
                onChange={(e) => setEmpType(e.target.value as any)}
              >
                <option value="">— nicht festgelegt —</option>
                <option value="minijob">Minijob (40h)</option>
                <option value="teilzeit">Teilzeit (120h)</option>
                <option value="vollzeit">Vollzeit (160h)</option>
              </select>
            </div>
          </div>
        )}

        <DialogFooter>
          {recoveryLink ? (
            <Button onClick={() => { setOpen(false); reset(); }}>Fertig</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Abbrechen</Button>
              <Button onClick={submit} disabled={busy}>{busy ? "Anlegen…" : "Anlegen"}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
