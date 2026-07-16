import { useState, useEffect, useCallback, useMemo } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  getContractOverride,
  saveContractOverrideHtml,
  saveContractOverridePdf,
  saveContractOverrideSalary,
  deleteContractOverride,
} from "@/lib/employee-contract-override.functions";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2, FileText, Pencil, Trash2, Loader2, Check, Search, Wallet, UserCheck, Mail,
} from "lucide-react";

interface EmployeeOption {
  user_id: string;
  full_name: string;
}
interface ApplicantOption {
  application_id: string;
  email: string;
  full_name: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employees: EmployeeOption[];
  applicants?: ApplicantOption[];
  initialUserId?: string | null;
}

type Target =
  | { kind: "employee"; user_id: string; full_name: string }
  | { kind: "applicant"; application_id: string; email: string; full_name: string };

function targetPayload(t: Target) {
  return t.kind === "employee"
    ? { user_id: t.user_id }
    : { email: t.email, application_id: t.application_id };
}
function targetKey(t: Target) {
  return t.kind === "employee" ? `e:${t.user_id}` : `a:${t.application_id}`;
}
function targetStorageKey(t: Target) {
  return t.kind === "employee" ? t.user_id : `app-${t.application_id}`;
}

export function IndividualContractDialog({ open, onOpenChange, employees, applicants = [], initialUserId }: Props) {
  const { toast } = useToast();
  const getOv = useServerFn(getContractOverride);
  const saveHtml = useServerFn(saveContractOverrideHtml);
  const savePdf = useServerFn(saveContractOverridePdf);
  const saveSalary = useServerFn(saveContractOverrideSalary);
  const deleteOv = useServerFn(deleteContractOverride);

  const [target, setTarget] = useState<Target | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [mode, setMode] = useState<"editor" | "pdf">("editor");
  const [html, setHtml] = useState("");
  const [existing, setExisting] = useState<any>(null);
  const [pdfSignedUrl, setPdfSignedUrl] = useState<string | null>(null);
  const [salaryEuro, setSalaryEuro] = useState<string>("");
  const [hours, setHours] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");


  const combined = useMemo<Target[]>(() => {
    const emps: Target[] = employees.map((e) => ({ kind: "employee", user_id: e.user_id, full_name: e.full_name || e.user_id }));
    const apps: Target[] = applicants.map((a) => ({ kind: "applicant", application_id: a.application_id, email: a.email, full_name: a.full_name || a.email }));
    return [...emps, ...apps];
  }, [employees, applicants]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? combined.filter((o) =>
          o.full_name.toLowerCase().includes(q) ||
          (o.kind === "applicant" && o.email.toLowerCase().includes(q)),
        )
      : combined;
    return list.slice(0, 50);
  }, [combined, search]);

  // Reset
  useEffect(() => {
    if (open) {
      const pre = initialUserId
        ? combined.find((o) => o.kind === "employee" && o.user_id === initialUserId) ?? null
        : null;
      setTarget(pre);
      setSearch("");
      setHtml("");
      setExisting(null);
      setPdfSignedUrl(null);
      setSalaryEuro("");
      setHours("");
      setStartDate("");
      setMode("editor");
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialUserId]);

  const reload = useCallback(async (t: Target) => {
    setLoading(true);
    try {
      const res = await getOv({ data: targetPayload(t) as any });
      const ov = (res as any).override;
      setExisting(ov);
      if (ov?.html_body) {
        setHtml(ov.html_body);
        setMode("editor");
      } else if (ov?.pdf_url) {
        setMode("pdf");
        const { data } = await supabase.storage.from("documents").createSignedUrl(ov.pdf_url, 600);
        setPdfSignedUrl(data?.signedUrl ?? null);
      } else {
        setHtml("");
        setPdfSignedUrl(null);
      }
      setSalaryEuro(ov?.monthly_salary_cents != null ? (ov.monthly_salary_cents / 100).toString().replace(".", ",") : "");
      setHours(ov?.weekly_hours != null ? String(ov.weekly_hours).replace(".", ",") : "");
      setStartDate(ov?.start_date ?? "");

    } catch (e: any) {
      toast({ title: "Fehler beim Laden", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [getOv, toast]);

  useEffect(() => {
    if (target) reload(target);
  }, [target, reload]);

  const parseSalaryCents = (): number | null => {
    const s = salaryEuro.trim().replace(/\./g, "").replace(",", ".");
    if (!s) return null;
    const n = Number(s);
    if (!isFinite(n) || n < 0) return null;
    return Math.round(n * 100);
  };
  const parseHours = (): number | null => {
    const s = hours.trim().replace(",", ".");
    if (!s) return null;
    const n = Number(s);
    if (!isFinite(n) || n < 0) return null;
    return n;
  };

  const handleSaveSalary = async () => {
    if (!target) return;
    setSaving(true);
    try {
      await saveSalary({ data: {
        ...targetPayload(target),
        monthly_salary_cents: parseSalaryCents(),
        weekly_hours: parseHours(),
        start_date: startDate.trim() ? startDate : null,
      } as any });
      toast({ title: "Gespeichert" });
      await reload(target);
    } catch (e: any) {
      toast({ title: "Fehler", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };


  const handleSaveHtml = async () => {
    if (!target) return;
    if (html.trim().length < 10) {
      toast({ title: "Vertragstext zu kurz", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await saveHtml({ data: { ...targetPayload(target), html_body: html } as any });
      if (parseSalaryCents() !== null || parseHours() !== null || startDate.trim()) {
        await saveSalary({ data: { ...targetPayload(target), monthly_salary_cents: parseSalaryCents(), weekly_hours: parseHours(), start_date: startDate.trim() ? startDate : null } as any });
      }

      toast({
        title: "Individueller Vertrag gespeichert",
        description: target.kind === "employee"
          ? "Mitarbeiter sieht ihn beim nächsten Login."
          : "Wird beim Registrieren des Bewerbers automatisch zugeordnet.",
      });
      await reload(target);
    } catch (e: any) {
      toast({ title: "Fehler", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleUploadPdf = async (file: File) => {
    if (!target) return;
    if (file.type !== "application/pdf") {
      toast({ title: "Nur PDF-Dateien", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const path = `contract-overrides/${targetStorageKey(target)}/${Date.now()}.pdf`;
      const { error: upErr } = await supabase.storage.from("documents").upload(path, file, { contentType: "application/pdf", upsert: false });
      if (upErr) throw upErr;
      await savePdf({ data: { ...targetPayload(target), pdf_url: path } as any });
      toast({ title: "PDF hochgeladen" });
      await reload(target);
    } catch (e: any) {
      toast({ title: "Upload fehlgeschlagen", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async () => {
    if (!target) return;
    if (!confirm("Override wirklich entfernen?")) return;
    try {
      await deleteOv({ data: targetPayload(target) as any });
      setHtml(""); setExisting(null); setPdfSignedUrl(null); setSalaryEuro(""); setHours("");
      toast({ title: "Override entfernt" });
    } catch (e: any) {
      toast({ title: "Fehler", description: e.message, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Individueller Arbeitsvertrag</DialogTitle>
        </DialogHeader>

        {!target ? (
          <div className="space-y-3">
            <Label className="text-xs">Mitarbeiter oder Bewerber wählen</Label>
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name oder E-Mail suchen…"
                className="pl-8 h-9 text-sm"
                autoFocus
              />
            </div>
            <div className="border rounded-lg divide-y divide-border max-h-80 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="text-xs text-muted-foreground p-4 text-center">Keine Treffer.</p>
              ) : (
                filtered.map((o) => (
                  <button
                    key={targetKey(o)}
                    onClick={() => setTarget(o)}
                    className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted/40 transition-colors flex items-center justify-between gap-2"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      {o.kind === "employee" ? (
                        <UserCheck className="h-3.5 w-3.5 text-primary shrink-0" />
                      ) : (
                        <Mail className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                      )}
                      <span className="truncate">{o.full_name}</span>
                      {o.kind === "applicant" && (
                        <span className="text-[11px] text-muted-foreground truncate">· {o.email}</span>
                      )}
                    </span>
                    <Badge variant="outline" className="text-[9px] shrink-0">
                      {o.kind === "employee" ? "Mitarbeiter" : "Bewerber"}
                    </Badge>
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2">
              <div className="min-w-0">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  {target.kind === "employee" ? "Mitarbeiter" : "Bewerber (noch kein Konto)"}
                </p>
                <p className="text-sm font-medium truncate">{target.full_name}</p>
                {target.kind === "applicant" && (
                  <p className="text-[11px] text-muted-foreground truncate">{target.email}</p>
                )}
              </div>
              <Button size="sm" variant="ghost" className="text-xs" onClick={() => setTarget(null)}>
                Wechseln
              </Button>
            </div>

            {target.kind === "applicant" && (
              <div className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                Der Vertrag wird per E-Mail vorgemerkt. Sobald sich der Bewerber registriert, wird er automatisch zugeordnet und beim Login angezeigt.
              </div>
            )}

            {existing && (
              <div className="flex items-center gap-2 text-[11px] text-accent bg-accent/10 px-3 py-2 rounded-lg">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>Override aktiv – zuletzt aktualisiert {new Date(existing.updated_at).toLocaleString("de-DE")}</span>
                <Button size="sm" variant="ghost" className="ml-auto h-6 text-xs text-destructive" onClick={handleDelete}>
                  <Trash2 className="h-3 w-3 mr-1" /> Entfernen
                </Button>
              </div>
            )}

            <div className="rounded-lg border p-3 space-y-3">
              <div className="flex items-center gap-2">
                <Wallet className="h-3.5 w-3.5 text-primary" />
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Individuelles Gehalt, Wochenstunden & Startdatum
                </p>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Überschreibt die Defaults (Minijob 556 € / Teilzeit 1.200 € / Vollzeit 2.400 €). Leer lassen für Default.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-[11px]">Monatsgehalt (€)</Label>
                  <Input inputMode="decimal" value={salaryEuro} onChange={(e) => setSalaryEuro(e.target.value)} placeholder="z. B. 603 oder 1300,50" className="h-9 text-sm" />
                </div>
                <div>
                  <Label className="text-[11px]">Wochenstunden</Label>
                  <Input inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="z. B. 20" className="h-9 text-sm" />
                </div>
                <div className="col-span-2">
                  <Label className="text-[11px]">Startdatum Arbeitsverhältnis</Label>
                  <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-9 text-sm" />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Wird bei bereits registrierten Mitarbeitern direkt ins Profil übernommen und ersetzt den Platzhalter <code className="bg-muted px-1 rounded">{"{{start_date}}"}</code>.
                  </p>
                </div>
              </div>
              <Button size="sm" onClick={handleSaveSalary} disabled={saving || loading} className="gap-1.5">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}

                Gehalt, Stunden & Startdatum speichern
              </Button>
            </div>

            <div className="flex gap-2 border-b border-border">
              <button type="button" onClick={() => setMode("editor")} className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${mode === "editor" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                <Pencil className="h-3.5 w-3.5 inline mr-1" /> Text-Editor
              </button>
              <button type="button" onClick={() => setMode("pdf")} className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${mode === "pdf" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                <FileText className="h-3.5 w-3.5 inline mr-1" /> PDF hochladen
              </button>
            </div>

            {loading ? (
              <p className="text-xs text-muted-foreground animate-pulse">Laden…</p>
            ) : mode === "editor" ? (
              <div className="space-y-2">
                <p className="text-[11px] text-muted-foreground">
                  Platzhalter wie <code className="bg-muted px-1 rounded">{"{{first_name}}"}</code>,{" "}
                  <code className="bg-muted px-1 rounded">{"{{monthly_salary}}"}</code>,{" "}
                  <code className="bg-muted px-1 rounded">{"{{weekly_hours}}"}</code>,{" "}
                  <code className="bg-muted px-1 rounded">{"{{start_date}}"}</code> werden beim Anzeigen ersetzt.
                </p>
                <Textarea value={html} onChange={(e) => setHtml(e.target.value)} placeholder="Vertragstext einfügen oder schreiben…" rows={14} className="font-mono text-xs" />
                <Button size="sm" onClick={handleSaveHtml} disabled={saving} className="gap-1.5">
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Speichern & zur Unterschrift senden
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {pdfSignedUrl && (
                  <div className="border rounded-lg overflow-hidden bg-muted/20">
                    <iframe src={pdfSignedUrl} className="w-full h-[400px]" title="Aktueller Override-PDF" />
                  </div>
                )}
                <div>
                  <input type="file" accept="application/pdf" onChange={(e) => e.target.files?.[0] && handleUploadPdf(e.target.files[0])} disabled={uploading} className="text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-primary file:text-primary-foreground file:font-medium file:cursor-pointer file:hover:bg-primary/90" />
                  {uploading && (
                    <p className="text-[11px] text-muted-foreground mt-1">
                      <Loader2 className="h-3 w-3 inline animate-spin mr-1" /> Wird hochgeladen…
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
