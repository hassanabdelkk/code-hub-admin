import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_employee/contract")({
  component: ContractPage,
});

import { useState, useEffect } from "react";
import { useNavigate } from "@/lib/router-compat";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, CheckCircle2, Loader2, Download, Briefcase } from "lucide-react";
import StepContract from "@/components/register/StepContract";
import { SupportCTA } from "@/components/SupportCTA";
import { StepSuccessModal } from "@/components/StepSuccessModal";
import { translateDbError } from "@/lib/db-errors";
import { useServerFn } from "@tanstack/react-start";
import { generateContractPdf, getContractSignatureUrls } from "@/lib/contract-pdf.functions";
import { getMyContractOverride } from "@/lib/employee-contract-override.functions";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarDays } from "lucide-react";
import { format, addDays, startOfDay, isBefore } from "date-fns";
import { de } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { applyEmploymentStartDate, formatGermanDate, resolveContractPlaceholders } from "@/lib/contract-utils";
import { Checkbox } from "@/components/ui/checkbox";
import { SignatureCanvas } from "@/components/SignatureCanvas";

const EMPLOYMENT_LABELS: Record<string, string> = {
  minijob: "Minijob", teilzeit: "Teilzeit", vollzeit: "Vollzeit",
};

const toDateOnly = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const dateOnlyToLocalDate = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
};

function extractStoragePath(value: string | null): string | null {
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) return value.replace(/^signatures\//, "");
  const match = value.match(/\/storage\/v1\/object\/(?:public|sign)\/signatures\/([^?]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function StartDateStep({ userId, onSaved, onBack }: { userId: string; onSaved: (d: string) => void; onBack: () => void }) {
  const { toast } = useToast();
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const minDate = addDays(startOfDay(new Date()), 7);

  const handleSave = async () => {
    if (!date) return;
    setSaving(true);
    const iso = toDateOnly(date);
    const { error } = await supabase.from("profiles").update({ employment_start_date: iso }).eq("user_id", userId);
    setSaving(false);
    if (error) {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
      return;
    }
    onSaved(iso);
  };

  return (
    <div className="p-6 lg:p-8 max-w-2xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button>
        <h1 className="text-xl font-heading font-bold">Startdatum wählen</h1>
      </div>
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <CalendarDays className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="font-semibold text-foreground">Wann möchtest du starten?</p>
              <p className="text-xs text-muted-foreground mt-1">
                Wähle dein gewünschtes Startdatum. Dieses Datum erscheint im Arbeitsvertrag.
              </p>
            </div>
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn("w-full justify-start text-left font-normal h-11", !date && "text-muted-foreground")}>
                <CalendarDays className="h-4 w-4 mr-2" />
                {date ? format(date, "PPP", { locale: de }) : "Startdatum wählen"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={date}
                onSelect={setDate}
                disabled={(d) => isBefore(d, minDate)}
                initialFocus
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
          <p className="text-[10px] text-muted-foreground">Mindestens 7 Tage in der Zukunft</p>
          <Button onClick={handleSave} disabled={!date || saving} className="w-full">
            {saving ? "Wird gespeichert…" : "Weiter zum Vertrag"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

interface Contract {
  id: string;
  generated_content: string;
  signed_name: string;
  signature_image_url: string | null;
  company_signature_url: string | null;
  signed_at: string;
  pdf_url: string | null;
  employment_type: string;
}

function ContractPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [contract, setContract] = useState<Contract | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [tenant, setTenant] = useState<any>(null);

  const [signing, setSigning] = useState(false);
  const [successOpen, setSuccessOpen] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [signatureName, setSignatureName] = useState("");

  const [employeeSigUrl, setEmployeeSigUrl] = useState<string | null>(null);
  const [companySigUrl, setCompanySigUrl] = useState<string | null>(null);
  const [empSigError, setEmpSigError] = useState(false);
  const [compSigError, setCompSigError] = useState(false);

  const generatePdfFn = useServerFn(generateContractPdf);
  const getSigUrlsFn = useServerFn(getContractSignatureUrls);
  const getOverrideFn = useServerFn(getMyContractOverride);

  const [override, setOverride] = useState<{ html_body: string | null; pdf_url: string | null; monthly_salary_cents?: number | null; weekly_hours?: number | null; updated_at?: string | null } | null>(null);
  const [overrideLoading, setOverrideLoading] = useState(true);
  const [overridePdfUrl, setOverridePdfUrl] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || !user) return;
    const loadData = async () => {
      const [{ data: contracts }, { data: profileData }, ovRes] = await Promise.all([
        supabase.from("contracts").select("*").eq("user_id", user.id).order("signed_at", { ascending: false }).limit(1),
        supabase.from("profiles").select("full_name, street, zip_code, city, address, employment_type, employment_start_date, contract_signed_at, tenant_id").eq("user_id", user.id).maybeSingle(),
        getOverrideFn().catch(() => ({ override: null })),
      ]);
      if (contracts && contracts.length > 0) setContract(contracts[0] as unknown as Contract);
      setProfile(profileData);
      if (profileData?.full_name && !signatureName) setSignatureName(profileData.full_name);
      if (profileData?.tenant_id) {
        const { data: t } = await supabase
          .from("tenants")
          .select("name, company_ceo_name, company_address, company_city")
          .eq("id", profileData.tenant_id)
          .maybeSingle();
        setTenant(t);
      }
      const ov = (ovRes as any)?.override ?? null;
      setOverride(ov);
      if (ov?.pdf_url) {
        const { data: signed } = await supabase.storage.from("documents").createSignedUrl(ov.pdf_url, 3600);
        setOverridePdfUrl(signed?.signedUrl ?? null);
      }
      setOverrideLoading(false);
      setLoading(false);
    };
    loadData();
  }, [user, authLoading]);

  // Signed URLs für Unterschriften laden, sobald ein Vertrag vorliegt
  useEffect(() => {
    if (!contract?.id) return;
    let cancelled = false;
    setEmpSigError(false);
    setCompSigError(false);
    setEmployeeSigUrl(null);
    setCompanySigUrl(null);
    getSigUrlsFn({ data: { contractId: contract.id } })
      .then((res) => {
        if (cancelled) return;
        setEmployeeSigUrl(res.employeeUrl ?? null);
        setCompanySigUrl(res.companyUrl ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setEmployeeSigUrl(null);
        setCompanySigUrl(null);
      });
    return () => { cancelled = true; };
  }, [contract?.id]);

  useEffect(() => {
    if (!contract?.signature_image_url || employeeSigUrl) return;
    const path = extractStoragePath(contract.signature_image_url);
    if (!path) return;
    let cancelled = false;
    supabase.storage.from("signatures").createSignedUrl(path, 3600).then(({ data }) => {
      if (!cancelled) setEmployeeSigUrl(data?.signedUrl ?? null);
    });
    return () => { cancelled = true; };
  }, [contract?.signature_image_url, employeeSigUrl]);

  const handleSignContract = async (contentOverride?: string, sigOverride?: string | null) => {
    if (!user || !profile) return;
    if (!agreed || !signatureName.trim()) {
      toast({ title: "Fehler", description: "Bitte stimme zu und gib deinen Namen ein.", variant: "destructive" });
      return;
    }
    if (!profile.employment_type) {
      toast({
        title: "Beschäftigungsart fehlt",
        description: "Deine Beschäftigungsart (Minijob, Teilzeit oder Vollzeit) wurde noch nicht vom Administrator festgelegt. Bitte kontaktiere uns, bevor du den Vertrag unterschreibst.",
        variant: "destructive",
      });
      return;
    }
    setSigning(true);
    try {
      const now = new Date().toISOString();

      // Signatur hochladen
      let signaturePath: string | null = null;
      if (sigOverride) {
        const blob = await fetch(sigOverride).then((r) => r.blob());
        const filePath = `${user.id}/${Date.now()}.png`;
        const { data: uploaded, error: upErr } = await supabase.storage
          .from("signatures")
          .upload(filePath, blob, { contentType: "image/png", upsert: true });
        if (upErr) {
          console.error("Signatur-Upload fehlgeschlagen:", upErr);
          toast({
            title: "Unterschrift konnte nicht gespeichert werden",
            description: upErr.message,
            variant: "destructive",
          });
          setSigning(false);
          return;
        }
        if (uploaded?.path) signaturePath = uploaded.path;
      }

      // Vertrag in DB
      const { data: inserted, error: insertErr } = await supabase
        .from("contracts")
        .insert({
          user_id: user.id,
          tenant_id: profile.tenant_id,
          employment_type: profile.employment_type as any,
          generated_content: applyEmploymentStartDate(contentOverride ?? "", formatGermanDate(profile.employment_start_date)),
          signed_name: signatureName.trim(),
          signature_image_url: signaturePath,
          signed_at: now,
          metadata: { signed_from: "portal" },
        } as any)
        .select("id")
        .single();
      if (insertErr) throw insertErr;

      // PDF im Hintergrund generieren (TanStack server fn, kein Edge Function)
      generatePdfFn({ data: { contractId: inserted.id } })
        .catch((e) => console.warn("PDF-Gen:", e));

      await supabase.from("profiles").update({
        contract_signed_at: now,
        signature_url: signaturePath || `text:${signatureName.trim()}`,
      }).eq("user_id", user.id);

      // Neu laden
      const { data: contracts } = await supabase.from("contracts").select("*").eq("user_id", user.id).order("signed_at", { ascending: false }).limit(1);
      if (contracts && contracts.length > 0) setContract(contracts[0] as unknown as Contract);
      setSuccessOpen(true);
    } catch (err: any) {
      toast({ title: "Vertrag konnte nicht gespeichert werden", description: translateDbError(err?.message), variant: "destructive" });
    } finally {
      setSigning(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!contract) return;
    setDownloading(true);
    try {
      // Immer (neu) generieren: stellt sicher, dass beide Unterschriften eingebettet sind.
      const result = await generatePdfFn({ data: { contractId: contract.id } });
      if (!result?.signedUrl) throw new Error("PDF konnte nicht erstellt werden");
      setContract({ ...contract, pdf_url: result.pdfPath });
      window.open(result.signedUrl, "_blank");
    } catch (err: any) {
      toast({
        title: "Download fehlgeschlagen",
        description: err?.message ?? "Bitte später erneut versuchen.",
        variant: "destructive",
      });
    } finally {
      setDownloading(false);
    }
  };

  if (authLoading || loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  // Wenn der Admin nach dem letzten Vertrag einen neuen individuellen Vertrag
  // hinterlegt hat, MUSS dieser zur Unterschrift gezeigt werden — sonst sähe
  // der Mitarbeiter ewig den alten signierten Vertrag.
  const overrideNewer = !!(
    override && (override.html_body || override.pdf_url) && override.updated_at && contract &&
    new Date(override.updated_at).getTime() > new Date(contract.signed_at).getTime()
  );

  if (contract && !overrideNewer) {
    return (
      <div className="p-6 lg:p-8 max-w-2xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")}><ArrowLeft className="h-4 w-4" /></Button>
            <div>
              <h1 className="text-xl font-heading font-bold">Dein Arbeitsvertrag</h1>
              <p className="text-xs text-muted-foreground">{EMPLOYMENT_LABELS[contract.employment_type] ?? "Vertrag"}</p>
            </div>
          </div>
          <Badge className="bg-accent/15 text-accent">Unterzeichnet</Badge>
        </div>

        <Card className="border-accent/30">
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center gap-3 mb-4">
              <CheckCircle2 className="h-5 w-5 text-accent" />
              <div>
                <p className="font-semibold text-foreground">Vertrag unterzeichnet</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(contract.signed_at).toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" })} um {new Date(contract.signed_at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr
                </p>
                <p className="text-xs text-muted-foreground">Unterschrieben als: <strong>{contract.signed_name}</strong></p>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-muted/30 p-5 max-h-96 overflow-y-auto text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap font-mono">
              {resolveContractPlaceholders(contract.generated_content, {
                firstName: (profile?.full_name ?? "").split(" ")[0],
                lastName: (profile?.full_name ?? "").split(" ").slice(1).join(" "),
                address: [profile?.street, profile?.zip_code && profile?.city ? `${profile.zip_code} ${profile.city}` : profile?.city].filter(Boolean).join(", "),
                city: profile?.city ?? "",
                employmentType: profile?.employment_type ?? contract.employment_type,
                companyName: tenant?.name ?? "",
                companyCeoName: tenant?.company_ceo_name ?? "",
                companyAddress: tenant?.company_address ?? "",
                startDate: formatGermanDate(profile?.employment_start_date),
              })}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Deine Unterschrift</p>
                  {employeeSigUrl && !empSigError ? (
                    <img
                      src={employeeSigUrl}
                      alt="Unterschrift Arbeitnehmer"
                      className="h-16 border rounded-lg p-2 bg-card object-contain"
                      onError={() => setEmpSigError(true)}
                    />
                  ) : (
                    <div className="h-16 border rounded-lg bg-card flex items-center justify-center px-3 text-center">
                      <span className="font-serif italic text-base text-foreground truncate">{contract.signed_name || "Digital unterschrieben"}</span>
                    </div>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-1">{contract.signed_name}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Unterschrift Arbeitgeber</p>
                  {companySigUrl && !compSigError ? (
                    <img
                      src={companySigUrl}
                      alt="Unterschrift Arbeitgeber"
                      className="h-16 border rounded-lg p-2 bg-card object-contain"
                      onError={() => setCompSigError(true)}
                    />
                  ) : (
                    <div className="h-16 border rounded-lg border-dashed bg-muted/20 flex items-center justify-center text-[10px] text-muted-foreground px-2 text-center">
                      Noch keine Firmen-Unterschrift hinterlegt
                    </div>
                  )}
                </div>
              </div>

            <Button className="w-full gap-2" onClick={handleDownloadPdf} disabled={downloading}>
              {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {downloading ? "PDF wird erstellt…" : "Vertrag als PDF herunterladen"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Noch kein Vertrag → Signing-Flow direkt im Portal
  if ((!contract || overrideNewer)) {
    const fullName = profile?.full_name ?? "";
    const [first, ...rest] = fullName.split(" ");
    const lastName = rest.join(" ");

    // ───── Individueller Vertrag vom Admin? ─────
    // Sowohl HTML-Override als auch PDF-Override umgehen die Beschäftigungs-/
    // Startdatum-Wahl und werden direkt zur Unterschrift gezeigt.
    if (override && (override.html_body || override.pdf_url)) {
      return (
        <OverrideSigning
          override={override}
          overridePdfUrl={overridePdfUrl}
          profile={profile}
          signing={signing}
          agreed={agreed}
          setAgreed={setAgreed}
          signatureName={signatureName}
          setSignatureName={setSignatureName}
          onSign={(content, sig) => handleSignContract(content, sig)}
          onBack={() => navigate("/dashboard")}
        />
      );
    }


    // Inline-Auswahl der Beschäftigungsart, wenn noch nicht gesetzt
    if (!profile?.employment_type) {
      const setEmployment = async (type: "minijob" | "teilzeit" | "vollzeit") => {
        if (!user) return;
        const { error } = await supabase
          .from("profiles")
          .update({ employment_type: type as any })
          .eq("user_id", user.id);
        if (error) {
          toast({ title: "Fehler", description: error.message, variant: "destructive" });
          return;
        }
        setProfile({ ...profile, employment_type: type });
      };
      return (
        <div className="p-6 lg:p-8 max-w-2xl mx-auto space-y-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")}><ArrowLeft className="h-4 w-4" /></Button>
            <h1 className="text-xl font-heading font-bold">Beschäftigungsart wählen</h1>
          </div>
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <Briefcase className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-semibold text-foreground">Wie möchtest du bei uns arbeiten?</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Wähle deine Beschäftigungsart aus. Danach laden wir den passenden Arbeitsvertrag.
                  </p>
                </div>
              </div>
              <div className="grid gap-2">
                {(["minijob", "teilzeit", "vollzeit"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setEmployment(t)}
                    className="text-left rounded-xl border border-border hover:border-primary/40 hover:bg-primary/5 transition-colors px-4 py-3"
                  >
                    <p className="font-medium text-foreground text-sm">{EMPLOYMENT_LABELS[t]}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {t === "minijob" && "Geringfügige Beschäftigung bis 603 € im Monat"}
                      {t === "teilzeit" && "Teilzeit mit 25 Stunden / Woche"}
                      {t === "vollzeit" && "Volle Anstellung mit 40 Stunden / Woche"}
                    </p>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    // Inline-Auswahl des Startdatums, wenn noch nicht gesetzt
    if (!profile?.employment_start_date) {
      return <StartDateStep
        userId={user!.id}
        onSaved={(d) => setProfile({ ...profile, employment_start_date: d })}
        onBack={() => navigate("/dashboard")}
      />;
    }

    const overrideSalaryStr = override?.monthly_salary_cents != null
      ? `${(override.monthly_salary_cents / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
      : undefined;
    const overrideHoursStr = override?.weekly_hours != null ? String(override.weekly_hours) : undefined;

    return (
      <div className="p-6 lg:p-8 max-w-2xl mx-auto space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")}><ArrowLeft className="h-4 w-4" /></Button>
          <h1 className="text-xl font-heading font-bold">Arbeitsvertrag unterschreiben</h1>
        </div>
        <Card>
          <CardContent className="pt-6">
            <StepContract
              firstName={first ?? ""}
              lastName={lastName}
              street={profile?.street ?? ""}
              zipCode={profile?.zip_code ?? ""}
              city={profile?.city ?? ""}
              employmentType={profile?.employment_type ?? "minijob"}
              startDate={profile?.employment_start_date ? dateOnlyToLocalDate(profile.employment_start_date) : undefined}
              agreed={agreed}
              setAgreed={setAgreed}
              signatureName={signatureName}
              setSignatureName={setSignatureName}
              onNext={handleSignContract}
              onBack={() => navigate("/dashboard")}
              loading={signing}
              userId={user?.id ?? null}
              tenantId={profile?.tenant_id ?? null}
              monthlySalary={overrideSalaryStr}
              weeklyHours={overrideHoursStr}
            />
          </CardContent>
        </Card>
        <SupportCTA topic="Arbeitsvertrag" hint="Etwas am Vertrag unklar? Schreib uns kurz — wir antworten meist innerhalb weniger Minuten." />
        <StepSuccessModal
          open={successOpen}
          onOpenChange={setSuccessOpen}
          emoji="📝"
          title="Vertrag unterschrieben!"
          description="Letzter Schritt: Lade jetzt deinen Personalausweis hoch."
          stepDone={3}
          stepTotal={4}
          nextLabel="Identität bestätigen"
          onNext={() => navigate("/verification")}
        />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-2xl mx-auto">
      <Card>
        <CardContent className="pt-8 pb-8 text-center space-y-4">
          <CheckCircle2 className="h-10 w-10 text-accent mx-auto" />
          <h3 className="text-lg font-heading font-bold">Vertrag unterschrieben</h3>
          <p className="text-sm text-muted-foreground">Unterschrieben am {new Date(profile.contract_signed_at).toLocaleDateString("de-DE")}</p>
          <Button variant="outline" onClick={() => navigate("/dashboard")}>Zum Dashboard</Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Individueller, vom Admin hinterlegter Vertrag (Text oder PDF) — Signing-UI
// ──────────────────────────────────────────────────────────────────────────────

function OverrideSigning({
  override,
  overridePdfUrl,
  profile,
  signing,
  agreed,
  setAgreed,
  signatureName,
  setSignatureName,
  onSign,
  onBack,
}: {
  override: { html_body: string | null; pdf_url: string | null; monthly_salary_cents?: number | null; weekly_hours?: number | null };
  overridePdfUrl: string | null;
  profile: any;
  signing: boolean;
  agreed: boolean;
  setAgreed: (v: boolean) => void;
  signatureName: string;
  setSignatureName: (v: string) => void;
  onSign: (content?: string, signatureDataUrl?: string | null) => void;
  onBack: () => void;
}) {
  const [sigDataUrl, setSigDataUrl] = useState<string | null>(null);

  const monthlySalary = override.monthly_salary_cents != null
    ? `${(override.monthly_salary_cents / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
    : undefined;
  const weeklyHours = override.weekly_hours != null ? String(override.weekly_hours) : undefined;

  const resolved = override.html_body
    ? resolveContractPlaceholders(override.html_body, {
        firstName: (profile?.full_name ?? "").split(" ")[0] ?? "",
        lastName: (profile?.full_name ?? "").split(" ").slice(1).join(" "),
        address: [profile?.street, profile?.zip_code && profile?.city ? `${profile.zip_code} ${profile.city}` : profile?.city].filter(Boolean).join(", "),
        city: profile?.city ?? "",
        employmentType: profile?.employment_type ?? "",
        companyName: "",
        companyCeoName: "",
        companyAddress: "",
        startDate: formatGermanDate(profile?.employment_start_date),
        monthlySalary,
        weeklyHours,
      })
    : "";

  const canSubmit = agreed && signatureName.trim().length > 1 && !!sigDataUrl;

  const handleSubmit = () => {
    const content = override.html_body
      ? resolved
      : `[PDF-Vertrag]\nDieser Arbeitsvertrag wurde dir individuell vom Admin als PDF zur Verfügung gestellt.\nReferenz: ${override.pdf_url}`;
    onSign(content, sigDataUrl);
  };

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-xl font-heading font-bold">Individueller Arbeitsvertrag</h1>
      </div>

      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="pt-4 pb-4">
          <p className="text-xs text-foreground">
            Dein Admin hat dir einen individuellen Arbeitsvertrag bereitgestellt. Bitte lies ihn aufmerksam durch und unterschreibe unten.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-4">
          {override.pdf_url && overridePdfUrl && (
            <div className="border rounded-lg overflow-hidden bg-muted/20">
              <iframe src={overridePdfUrl} className="w-full h-[500px]" title="Arbeitsvertrag PDF" />
              <div className="px-3 py-2 border-t bg-card flex justify-end">
                <a
                  href={overridePdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                >
                  <Download className="h-3 w-3" /> PDF herunterladen
                </a>
              </div>
            </div>
          )}

          {override.html_body && (
            <div className="max-h-[500px] overflow-y-auto border rounded-lg p-5 bg-muted/20 text-sm leading-relaxed whitespace-pre-wrap font-mono">
              {resolved}
            </div>
          )}

          <div className="space-y-3 pt-2 border-t border-border">
            <div className="flex items-start gap-2">
              <Checkbox id="ov-agree" checked={agreed} onCheckedChange={(v) => setAgreed(!!v)} />
              <label htmlFor="ov-agree" className="text-xs leading-relaxed text-foreground cursor-pointer">
                Ich habe den Vertrag gelesen, verstanden und stimme den Bedingungen zu.
              </label>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground">Voller Name (für die digitale Unterschrift)</label>
              <input
                type="text"
                value={signatureName}
                onChange={(e) => setSignatureName(e.target.value)}
                className="w-full h-10 px-3 border rounded-md text-sm"
                placeholder="Max Mustermann"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-foreground mb-2 block">Unterschrift</label>
              <SignatureCanvas onSignatureChange={setSigDataUrl} />
            </div>

            <Button onClick={handleSubmit} disabled={!canSubmit || signing} className="w-full gap-2">
              {signing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {signing ? "Wird gespeichert…" : "Vertrag unterschreiben"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
