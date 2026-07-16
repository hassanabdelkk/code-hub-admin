import { createFileRoute } from "@tanstack/react-router";
import { useParams, useNavigate } from "@/lib/router-compat";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAdminData } from "@/contexts/AdminDataContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/EmptyState";
import { IndividualContractDialog } from "@/components/admin/IndividualContractDialog";
import { updateEmployeeEmployment } from "@/lib/admin-employees.functions";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, User, CalendarDays, Mic, Mail, UserCheck, FileText,
  ClipboardList, CheckCircle2, XCircle, Clock, HelpCircle, MapPin,
  CreditCard, ShieldCheck, BriefcaseBusiness, Pencil, Check, Loader2,
} from "lucide-react";
import { TableSkeleton } from "@/components/SkeletonLoaders";
import { StageHistoryCard } from "@/components/StageHistoryCard";

export const Route = createFileRoute("/admin/personen/$id")({
  component: PersonDetailPage,
});

type Status = "done" | "current" | "pending" | "skipped" | "failed";

type StepDef = {
  key: string;
  icon: any;
  title: string;
  status: Status;
  meta?: string;
  body?: React.ReactNode;
};

function fmt(d?: string | Date | null) {
  if (!d) return "";
  try {
    return new Date(d).toLocaleString("de-DE", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return ""; }
}

function fmtDate(d?: string | Date | null) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("de-DE", {
      day: "2-digit", month: "2-digit", year: "numeric",
    });
  } catch { return "—"; }
}

function value(v: unknown) {
  const s = v == null ? "" : String(v).trim();
  return s || "—";
}

function splitName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { first: parts[0] || "—", last: "—" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

function PersonDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { applications, profiles, kycList, allBookings, assignments, loading, loadData } = useAdminData();
  const [kycDocUrls, setKycDocUrls] = useState<Record<string, string>>({});
  const [fullApplication, setFullApplication] = useState<any | null>(null);
  const [contractDialogOpen, setContractDialogOpen] = useState(false);
  const [empType, setEmpType] = useState<string>("");
  const [empStart, setEmpStart] = useState<string>("");
  const [savingEmp, setSavingEmp] = useState(false);
  const { toast } = useToast();
  const updateEmp = useServerFn(updateEmployeeEmployment);

  const resolved = useMemo(() => {
    const apps = applications as any[];
    const profs = profiles as any[];
    const appById = new Map(apps.map((a) => [a.id, a]));
    const appByUserId = new Map(apps.filter((a) => a.user_id).map((a) => [a.user_id, a]));
    const profById = new Map(profs.map((p) => [p.id, p]));
    const profByUserId = new Map(profs.map((p) => [p.user_id, p]));
    const profByApplicationId = new Map(profs.filter((p) => p.application_id).map((p) => [p.application_id, p]));

    const app = appById.get(id);
    if (app) {
      const prof = profByApplicationId.get(app.id) || (app.user_id ? profByUserId.get(app.user_id) : null) || null;
      return { app, prof };
    }
    const prof = profByUserId.get(id) || profById.get(id);
    if (prof) {
      const app = (prof.application_id ? appById.get(prof.application_id) : null) || (prof.user_id ? appByUserId.get(prof.user_id) : null) || null;
      return { app, prof };
    }
    return { app: null, prof: null };
  }, [id, applications, profiles]);

  const resolvedAppId = resolved.app?.id ?? null;
  useEffect(() => {
    let cancelled = false;
    setFullApplication(null);
    if (!resolvedAppId) return () => { cancelled = true; };

    async function loadFullApplication() {
      const { data, error } = await supabase
        .from("applications")
        .select("*")
        .eq("id", resolvedAppId)
        .maybeSingle();
      if (!cancelled && !error && data) setFullApplication(data);
    }

    loadFullApplication();
    return () => { cancelled = true; };
  }, [resolvedAppId]);

  const appForDisplay = useMemo(() => {
    if (!resolved.app) return null;
    return fullApplication?.id === resolved.app.id ? { ...resolved.app, ...fullApplication } : resolved.app;
  }, [resolved.app, fullApplication]);

  const booking = useMemo(() => {
    if (!resolved.app) return null;
    for (const b of allBookings as any[]) {
      const appId = b.application_id || b.app_id;
      if (appId === resolved.app.id) return b;
    }
    return null;
  }, [resolved.app, allBookings]);

  const myAssignments = useMemo(() => {
    if (!resolved.prof?.user_id) return [];
    return (assignments as any[]).filter((a) => a.user_id === resolved.prof.user_id);
  }, [resolved.prof, assignments]);

  const kyc = useMemo(() => {
    if (!resolved.prof?.user_id) return null;
    return (kycList as any[]).find((k) => k.user_id === resolved.prof.user_id) ?? null;
  }, [resolved.prof, kycList]);

  useEffect(() => {
    let cancelled = false;
    async function loadKycUrls() {
      if (!kyc) { setKycDocUrls({}); return; }
      const fields = ["id_front_url", "id_back_url", "selfie_url"] as const;
      const entries = await Promise.all(
        fields
          .filter((field) => kyc[field])
          .map(async (field) => {
            const raw = String(kyc[field]);
            if (/^https?:\/\//i.test(raw)) return [field, raw] as const;
            const { data } = await supabase.storage.from("kyc-documents").createSignedUrl(raw, 3600);
            return [field, data?.signedUrl ?? ""] as const;
          }),
      );
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const [field, url] of entries) if (url) next[field] = url;
      setKycDocUrls(next);
    }
    loadKycUrls();
    return () => { cancelled = true; };
  }, [kyc]);

  useEffect(() => {
    setEmpType(resolved.prof?.employment_type ?? "");
    setEmpStart(resolved.prof?.employment_start_date ?? "");
  }, [resolved.prof]);

  const handleSaveEmployment = async () => {
    if (!resolved.prof?.user_id) return;
    setSavingEmp(true);
    try {
      await updateEmp({
        data: {
          user_id: resolved.prof.user_id,
          employment_type: (empType || null) as any,
          employment_start_date: empStart?.trim() ? empStart : null,
        } as any,
      });
      toast({ title: "Beschäftigung aktualisiert" });
      await loadData();
    } catch (e: any) {
      toast({ title: "Fehler", description: e.message, variant: "destructive" });
    } finally {
      setSavingEmp(false);
    }
  };

  if (loading) {
    return <div className="p-6"><TableSkeleton /></div>;
  }

  if (!resolved.app && !resolved.prof) {
    return (
      <div className="p-6">
        <Button variant="ghost" size="sm" onClick={() => navigate("/admin/bewerbungen")} className="mb-4 gap-1.5">
          <ArrowLeft className="h-3.5 w-3.5" /> Zurück
        </Button>
        <EmptyState icon={User} title="Person nicht gefunden" description="Diese ID konnte weder Bewerbung noch Mitarbeiter zugeordnet werden." />
      </div>
    );
  }

  const { prof } = resolved as { app: any | null; prof: any | null };
  const app = appForDisplay as any | null;
  const name =
    prof?.full_name ||
    app?.full_name ||
    `${app?.first_name ?? ""} ${app?.last_name ?? ""}`.trim() ||
    prof?.email ||
    app?.email ||
    "—";
  const email = prof?.email || app?.email || "—";
  const phone = prof?.phone || app?.phone || "—";
  const split = splitName(name === "—" ? "" : name);
  const firstName = app?.first_name || prof?.first_name || split.first;
  const lastName = app?.last_name || prof?.last_name || split.last;
  const backTo = prof ? "/admin/mitarbeiter" : "/admin/bewerbungen";

  const scheduledAt =
    (booking?.booking_date && booking?.booking_time
      ? new Date(`${booking.booking_date}T${booking.booking_time}`)
      : booking?.scheduled_at ? new Date(booking.scheduled_at) : null) ??
    (app?.scheduled_at ? new Date(app.scheduled_at) : null);

  const now = Date.now();
  const rec = app?.interview_recommendation as string | null;
  const interviewDone = !!app?.interview_completed_at;
  const interviewStarted = !!app?.interview_started_at;
  const overdue = scheduledAt && !interviewDone && scheduledAt.getTime() < now - 30 * 60_000;

  const messages: any[] = Array.isArray(app?.interview_messages) ? app!.interview_messages : [];
  const score = app?.interview_score as number | null;

  // ---- Steps ----
  const steps: StepDef[] = [];

  // 1) Bewerbung
  steps.push({
    key: "application",
    icon: FileText,
    title: "Bewerbung eingegangen",
    status: app ? "done" : "skipped",
    meta: app?.created_at ? fmt(app.created_at) : "—",
    body: app ? (
      <div className="text-xs text-muted-foreground space-y-0.5">
        <div>Quelle: <span className="text-foreground">{app.source_slug || "—"}</span></div>
        <div>Flow: <span className="text-foreground">{app.flow_type === "broker" ? "Vermittlung" : app.flow_type ?? "—"}</span></div>
      </div>
    ) : null,
  });

  // 2) Termin — nutzt applications.scheduled_at + booking_status (Calendly-Webhook).
  const bookingStatus: string | null = app?.booking_status ?? null;
  const cancelled = bookingStatus === "cancelled";
  
  const hasScheduledAt = !!scheduledAt;
  const isScheduledState = bookingStatus === "scheduled" || hasScheduledAt;

  let apptTitle = "Kein Termin gebucht";
  let apptStatus: Status = app ? "pending" : "skipped";
  let apptMeta = "—";
  if (cancelled) {
    apptTitle = "Termin abgesagt";
    apptStatus = "failed";
    apptMeta = hasScheduledAt ? fmt(scheduledAt!) : "abgesagt";
  } else if (bookingStatus === "no_show") {
    apptTitle = "Termin nicht wahrgenommen";
    apptStatus = "failed";
    apptMeta = hasScheduledAt ? fmt(scheduledAt!) : "no-show";
  } else if (interviewDone && hasScheduledAt) {
    apptTitle = "Termin wahrgenommen";
    apptStatus = "done";
    apptMeta = fmt(scheduledAt!);
  } else if (isScheduledState) {
    apptTitle = "Interview gebucht";
    apptStatus = overdue ? "failed" : "current";
    apptMeta = hasScheduledAt ? fmt(scheduledAt!) : "Termin bestätigt";
  }

  steps.push({
    key: "appointment",
    icon: CalendarDays,
    title: apptTitle,
    status: apptStatus,
    meta: apptMeta,
    body: (
      <div className="text-xs text-muted-foreground space-y-1">
        {bookingStatus && (
          <div>Status: <span className="text-foreground font-medium">{bookingStatus}</span></div>
        )}
        {overdue && !interviewStarted && !interviewDone && !cancelled && bookingStatus !== "no_show" && (
          <div className="text-amber-700 dark:text-amber-300">⚠️ Termin liegt zurück, aber kein Interview registriert (No-Show?)</div>
        )}
        {!hasScheduledAt && !bookingStatus && app && (
          <div className="text-[11px]">Bewerbung eingegangen, aber noch kein Calendly-Termin gebucht.</div>
        )}
      </div>
    ),
  });


  // 3) Interview
  const interviewStatus: Status = rec === "invite" || rec === "reject"
    ? "done"
    : interviewDone
      ? "current"
      : interviewStarted
        ? "current"
        : scheduledAt ? "pending" : "skipped";

  steps.push({
    key: "interview",
    icon: Mic,
    title: "Bewerbungsgespräch",
    status: interviewStatus,
    meta: app?.interview_completed_at
      ? fmt(app.interview_completed_at)
      : app?.interview_started_at ? `Läuft seit ${fmt(app.interview_started_at)}` : "—",
    body: (app && (messages.length > 0 || rec)) ? (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {app.interview_mode && (
            <Badge variant="outline" className="text-[10px]">
              {app.interview_mode === "voice" ? "🎙️ Telefon" : "💬 Chat"}
            </Badge>
          )}
          {typeof score === "number" && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Score:</span>
              <span className="font-semibold">{score}/100</span>
              <div className="h-1.5 w-24 rounded-full bg-border overflow-hidden">
                <div
                  className="h-full"
                  style={{
                    width: `${Math.max(0, Math.min(100, score))}%`,
                    background: score >= 70 ? "#10b981" : score >= 40 ? "#f59e0b" : "#ef4444",
                  }}
                />
              </div>
            </div>
          )}
          {rec === "invite" && <Badge className="bg-emerald-100 text-emerald-800 border-0 text-[10px]">✅ Empfohlen</Badge>}
          {rec === "reject" && <Badge className="bg-rose-100 text-rose-800 border-0 text-[10px]">❌ Nicht empfohlen</Badge>}
          {rec === "unsure" && <Badge className="bg-amber-100 text-amber-800 border-0 text-[10px]">⚠️ Unsicher</Badge>}
        </div>
        {app.interview_summary && (
          <p className="text-xs text-foreground whitespace-pre-wrap bg-muted/40 border border-border rounded p-2">
            {app.interview_summary}
          </p>
        )}
        {messages.length > 0 && (
          <details className="text-xs" open>
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              Transkript ({messages.length} Nachrichten)
            </summary>

            <div className="mt-2 space-y-1.5">
              {messages.map((m: any, i: number) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-[11px] whitespace-pre-wrap ${
                    m.role === "user"
                      ? "bg-primary/10 border border-primary/20"
                      : "bg-muted border border-border"
                  }`}>
                    <p className="text-[9px] text-muted-foreground mb-0.5">
                      {m.role === "user" ? "Bewerber" : "Recruiter"}
                      {m.ts && ` · ${new Date(m.ts).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`}
                    </p>
                    {m.text}
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    ) : null,
  });

  // 4) Entscheidung / Einladung
  const invited = app?.status === "akzeptiert" || rec === "invite";
  const rejected = app?.status === "abgelehnt" || rec === "reject";
  steps.push({
    key: "decision",
    icon: Mail,
    title: invited ? "Einladung gesendet" : rejected ? "Abgelehnt" : "Entscheidung",
    status: invited ? "done" : rejected ? "failed" : interviewDone ? "current" : "pending",
    meta: invited || rejected ? "Automatisch durch KI" : "—",
  });

  // 5) Registriert
  steps.push({
    key: "registered",
    icon: UserCheck,
    title: "Im Portal registriert",
    status: prof ? "done" : invited ? "current" : "pending",
    meta: prof?.created_at ? fmt(prof.created_at) : "—",
  });

  // 6) Vertrag / Onboarding
  const contractSigned = !!prof?.contract_signed_at || !!prof?.contract_pdf_url;
  const onboardingDone = prof?.onboarding_status === "abgeschlossen";
  steps.push({
    key: "onboarding",
    icon: FileText,
    title: onboardingDone ? "Onboarding abgeschlossen" : contractSigned ? "Vertrag unterzeichnet" : "Onboarding",
    status: onboardingDone ? "done" : contractSigned ? "current" : prof ? "pending" : "skipped",
    meta: prof?.contract_signed_at ? fmt(prof.contract_signed_at) : "—",
  });

  // 7) Aufträge
  steps.push({
    key: "tasks",
    icon: ClipboardList,
    title: `Aufträge (${myAssignments.length})`,
    status: myAssignments.length > 0 ? "done" : prof ? "pending" : "skipped",
    body: myAssignments.length > 0 ? (
      <div className="text-xs space-y-1">
        {myAssignments.slice(0, 5).map((a: any) => (
          <div key={a.id} className="flex justify-between gap-2 text-muted-foreground">
            <span className="truncate">{a.title || a.template_id || a.id}</span>
            <span className="tabular-nums">{fmt(a.created_at)}</span>
          </div>
        ))}
        {myAssignments.length > 5 && (
          <div className="text-[10px] text-muted-foreground">+{myAssignments.length - 5} weitere</div>
        )}
      </div>
    ) : null,
  });

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate(backTo)} className="gap-1.5">
          <ArrowLeft className="h-3.5 w-3.5" /> Zurück zu {prof ? "Mitarbeiter" : "Bewerbungen"}
        </Button>
        <div />

      </div>

      {/* Header */}
      <Card>
        <CardContent className="pt-5 pb-5 flex items-center gap-4">
          <div className="h-14 w-14 rounded-full bg-primary/10 grid place-items-center text-lg font-semibold text-primary">
            {name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-heading font-bold truncate">{name}</h1>
            <p className="text-sm text-muted-foreground truncate">{email}</p>
            <p className="text-xs text-muted-foreground truncate">{phone}</p>
          </div>
          <div className="flex flex-col gap-1 items-end">
            {prof && <Badge className="bg-indigo-100 text-indigo-700 border-0 text-[10px]">👤 Mitarbeiter</Badge>}
            {!prof && app && <Badge variant="outline" className="text-[10px]">Bewerbung</Badge>}
          </div>
        </CardContent>
      </Card>

      {app?.id && (
        <StageHistoryCard applicationId={app.id} canTakeover={onboardingDone} />
      )}

      {prof && (
        <Card>
          <CardContent className="pt-4 pb-4 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-full bg-primary/10 grid place-items-center">
                  <BriefcaseBusiness className="h-4 w-4 text-primary" />
                </div>
                <h2 className="font-semibold text-sm">Beschäftigung & Arbeitsvertrag</h2>
              </div>
              <Button size="sm" variant="outline" onClick={() => setContractDialogOpen(true)} className="gap-1.5">
                <Pencil className="h-3.5 w-3.5" /> AV bearbeiten (Text / PDF / Gehalt)
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] items-end">
              <div>
                <Label className="text-[11px]">Beschäftigungsart</Label>
                <Select value={empType || "__none"} onValueChange={(v) => setEmpType(v === "__none" ? "" : v)}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">— nicht gesetzt —</SelectItem>
                    <SelectItem value="minijob">Minijob</SelectItem>
                    <SelectItem value="teilzeit">Teilzeit</SelectItem>
                    <SelectItem value="vollzeit">Vollzeit</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[11px]">Startdatum Arbeitsverhältnis</Label>
                <Input type="date" value={empStart} onChange={(e) => setEmpStart(e.target.value)} className="h-9 text-sm" />
              </div>
              <Button size="sm" onClick={handleSaveEmployment} disabled={savingEmp} className="gap-1.5">
                {savingEmp ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Speichern
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Für individuelles Gehalt, Wochenstunden oder einen abweichenden Vertragstext / PDF „AV bearbeiten" öffnen.
            </p>
          </CardContent>
        </Card>
      )}

      <IndividualContractDialog
        open={contractDialogOpen}
        onOpenChange={setContractDialogOpen}
        employees={prof ? [{ user_id: prof.user_id, full_name: prof.full_name || email }] : []}
        applicants={[]}
        initialUserId={prof?.user_id ?? null}
      />


      <div className="grid gap-4 lg:grid-cols-3">
        <InfoSection
          icon={User}
          title="Persönliche Daten"
          items={[
            ["Vorname", firstName],
            ["Nachname", lastName],
            ["E-Mail", email],
            ["Telefonnummer", phone],
            ["Staatsangehörigkeit", prof?.nationality || app?.nationality],
            ["Geburtsort", prof?.birth_place || app?.birth_place],
            ["Geburtsdatum", fmtDate(prof?.birth_date || app?.birth_date)],
          ]}
        />
        <InfoSection
          icon={MapPin}
          title="Anschrift"
          items={[
            ["Anschrift", prof?.address || app?.address],
            ["Straße", prof?.street],
            ["Postleitzahl", prof?.zip_code || app?.postal_code],
            ["Ort", prof?.city || app?.city],
            ["Wohnhaft seit", fmtDate(prof?.living_since)],
            ["Voradresse", prof?.previous_address],
          ]}
        />
        <InfoSection
          icon={CreditCard}
          title="Lohn & Versicherung"
          items={[
            ["SV-Nummer", prof?.social_security_number],
            ["Steuer-ID", prof?.tax_number],
            ["IBAN", prof?.iban],
            ["Krankenversicherung", prof?.health_insurance],
            ["Familienstand", prof?.family_status],
          ]}
        />
        <InfoSection
          icon={BriefcaseBusiness}
          title="Beschäftigung"
          items={[
            ["Status", prof?.status || app?.status],
            ["Onboarding", prof?.onboarding_status],
            ["Beschäftigungsart", prof?.employment_type],
            ["Startdatum", fmtDate(prof?.employment_start_date)],
            ["Registriert", fmt(prof?.created_at)],
          ]}
        />
        <InfoSection
          icon={ShieldCheck}
          title="Ausweis / Prüfung"
          items={[
            ["KYC-Status", kyc?.status],
            ["Ausweis Vorderseite", kyc?.id_front_url ? <FileLink href={kycDocUrls.id_front_url} label={kycDocUrls.id_front_url ? "Öffnen" : "Lädt…"} /> : "—"],
            ["Ausweis Rückseite", kyc?.id_back_url ? <FileLink href={kycDocUrls.id_back_url} label={kycDocUrls.id_back_url ? "Öffnen" : "Lädt…"} /> : "—"],
            ["Selfie", kyc?.selfie_url ? <FileLink href={kycDocUrls.selfie_url} label={kycDocUrls.selfie_url ? "Öffnen" : "Lädt…"} /> : "—"],
          ]}
        />
        <InfoSection
          icon={FileText}
          title="Vertrag"
          items={[
            ["Unterschrieben", prof?.contract_signed_at ? fmt(prof.contract_signed_at) : "—"],
            ["Signatur", prof?.signature_url ? <FileLink href={prof.signature_url} label="Öffnen" /> : "—"],
            ["Admin-Notizen", prof?.admin_notes],
          ]}
        />
      </div>

      {/* Timeline */}
      <div className="relative">
        <div className="absolute left-[19px] top-2 bottom-2 w-px bg-border" />
        <ol className="space-y-4">
          {steps.map((s) => (
            <TimelineStep key={s.key} step={s} />
          ))}
        </ol>
      </div>
    </div>
  );
}

function InfoSection({ icon: Icon, title, items }: { icon: any; title: string; items: Array<[string, React.ReactNode]> }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-primary/10 grid place-items-center">
            <Icon className="h-4 w-4 text-primary" />
          </div>
          <h2 className="font-semibold text-sm">{title}</h2>
        </div>
        <dl className="space-y-2">
          {items.map(([label, raw]) => (
            <div key={label} className="grid grid-cols-[120px_1fr] gap-3 text-xs">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-medium text-foreground break-words">{typeof raw === "string" ? value(raw) : raw}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function FileLink({ href, label }: { href: string; label: string }) {
  if (!href) return <span className="text-muted-foreground">{label}</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-primary hover:underline">
      {label}
    </a>
  );
}

function TimelineStep({ step }: { step: StepDef }) {
  const Icon = step.icon;
  const colorMap: Record<Status, string> = {
    done: "bg-emerald-500 text-white border-emerald-500",
    current: "bg-blue-500 text-white border-blue-500",
    pending: "bg-background text-muted-foreground border-border",
    skipped: "bg-muted text-muted-foreground border-border",
    failed: "bg-rose-500 text-white border-rose-500",
  };
  const statusIcon: Record<Status, any> = {
    done: CheckCircle2,
    current: Clock,
    pending: HelpCircle,
    skipped: HelpCircle,
    failed: XCircle,
  };
  const StatusIcon = statusIcon[step.status];

  return (
    <li className="flex gap-4">
      <div className={`relative z-10 h-10 w-10 rounded-full border-2 grid place-items-center shrink-0 ${colorMap[step.status]}`}>
        <Icon className="h-4 w-4" />
      </div>
      <Card className="flex-1">
        <CardContent className="pt-3 pb-3 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-sm">{step.title}</p>
              <StatusIcon className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            {step.meta && <p className="text-xs text-muted-foreground tabular-nums">{step.meta}</p>}
          </div>
          {step.body}
        </CardContent>
      </Card>
    </li>
  );
}
