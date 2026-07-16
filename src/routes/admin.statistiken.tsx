// Statistiken — Funnel „Bewerber → Mitarbeiter".
//
// Oben: Gesamt-Trichter (alle Stufen mit absoluten Zahlen + Conversion).
// Unten: Tageskohorten-Tabelle in Funnel-Reihenfolge.
// Zeitraum 7 / 30 / 90 / 180 Tage, optional auf ein Unternehmen einschränken.

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getCohortStats, type FunnelRow, type FunnelTotals, type SourceFunnel } from "@/lib/landing-cohorts.functions";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/statistiken")({
  component: StatistikenPage,
});

const PRESETS = [
  { d: 7,   label: "Letzte 7 Tage" },
  { d: 30,  label: "Letzte 30 Tage" },
  { d: 90,  label: "Letzte 90 Tage" },
  { d: 180, label: "Letzte 180 Tage" },
];

type Totals = FunnelTotals & { freigegeben: number; mitarbeiter: number; avg_conversion: number };

function StatistikenPage() {
  const fn = useServerFn(getCohortStats);
  const [days, setDays] = useState(7);
  const [tenantId, setTenantId] = useState<string>("");
  const [tenants, setTenants] = useState<Array<{ id: string; name: string }>>([]);
  const [rows, setRows] = useState<FunnelRow[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [bySource, setBySource] = useState<SourceFunnel[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("tenants").select("id, name").order("name").then(({ data }) => {
      setTenants((data ?? []) as Array<{ id: string; name: string }>);
    });
  }, []);

  const reload = () => {
    setLoading(true); setErr(null);
    const payload: any = { days };
    if (tenantId) payload.tenant_id = tenantId;
    fn({ data: payload })
      .then((r: any) => {
        setRows(r.rows ?? []);
        setTotals(r.totals ?? null);
        setBySource(r.by_source ?? []);
        if (r.error) setErr(r.error);
      })
      .catch((e: any) => setErr(e?.message ?? "Fehler"))
      .finally(() => setLoading(false));
  };
  useEffect(reload, [days, tenantId]);

  const fmtDate = (k: string) => {
    const [y, m, d] = k.split("-");
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    const weekday = date.toLocaleDateString("de-DE", { weekday: "short" });
    return { dm: `${d}.${m}`, wd: weekday };
  };

  return (
    <div className="p-6 space-y-6 max-w-[1900px]">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-primary" /> Funnel — Bewerber zu Mitarbeiter
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Jede Bewerbung wird ihrer Kohorte (Tag der Bewerbung) zugeordnet und durch alle Stufen verfolgt — auch wenn Registrierung und Onboarding später passieren. Test-Bewerbungen sind ausgeschlossen.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            title="Auf ein Unternehmen einschränken"
          >
            <option value="">Alle Unternehmen</option>
            {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            {PRESETS.map(p => <option key={p.d} value={p.d}>{p.label}</option>)}
          </select>
          <Button variant="outline" size="icon" onClick={reload} disabled={loading} title="Neu laden">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* KPI-Leiste */}
      {totals && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Kpi label="Beworben gesamt" value={totals.beworben} tone="default" />
          <Kpi label="Mitarbeiter (onboarded)" value={totals.onboarded} tone="success" />
          <Kpi label="End-to-End Conversion" value={`${totals.gesamt_conversion}%`} tone="success" />
          <Kpi label="Ø Bewerbungen/Tag" value={totals.avg_per_day} tone="default" />
          <Kpi label="Ø Mitarbeiter/Tag" value={totals.avg_employees_per_day} tone="primary" />
          <Kpi
            label="Größter Drop"
            value={totals.biggest_drop_stage ? `−${totals.biggest_drop_pct}%` : "—"}
            sub={totals.biggest_drop_stage ?? undefined}
            tone="warn"
            icon={<TrendingDown className="h-4 w-4" />}
          />
        </div>
      )}

      {/* Gesamt-Trichter */}
      {totals && <FunnelChart totals={totals} />}

      {/* Per-Vermittlung Funnel */}
      {bySource.length > 0 && <SourceBreakdown sources={bySource} />}

      {/* Tageskohorten */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Tageskohorten</CardTitle>
          <CardDescription>
            Jede Zeile = ein Tag (zugewiesen nach dem Datum der Bewerbung). Prozent-Badges zeigen Konversion zur vorherigen Stufe.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {err && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive mb-3">
              {err}
            </div>
          )}
          {loading && rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Lade …</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Keine Daten im gewählten Zeitraum.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[11px] uppercase tracking-wider text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2 px-3 font-medium">Datum</th>
                    <th className="text-right py-2 px-3 font-medium">Beworben</th>
                    <th className="text-right py-2 px-3 font-medium">Termin gebucht</th>
                    <th className="text-right py-2 px-3 font-medium">Wahrgenommen</th>
                    <th className="text-right py-2 px-3 font-medium">No-Show</th>
                    <th className="text-right py-2 px-3 font-medium">Angenommen</th>
                    <th className="text-right py-2 px-3 font-medium">Abgelehnt</th>
                    <th className="text-right py-2 px-3 font-medium">Reg-Mail</th>
                    <th className="text-right py-2 px-3 font-medium">Registriert</th>
                    <th className="text-right py-2 px-3 font-medium">Onboarded</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const d = fmtDate(r.date);
                    return (
                      <tr key={r.date} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="py-3 px-3">
                          <div className="font-semibold">{d.dm}</div>
                          <div className="text-[11px] text-muted-foreground">({d.wd})</div>
                        </td>
                        <td className="text-right py-3 px-3 font-semibold tabular-nums">{r.beworben}</td>
                        <td className="text-right py-3 px-3 tabular-nums">
                          <span className="font-semibold">{r.termin_gebucht}</span>
                          {r.beworben > 0 && <ConvBadge value={r.conv_termin} className="ml-2" />}
                        </td>
                        <td className="text-right py-3 px-3 tabular-nums">
                          <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{r.termin_wahrgenommen}</span>
                          {r.termin_gebucht > 0 && <ConvBadge value={r.conv_wahrgenommen} className="ml-2" />}
                        </td>
                        <td className="text-right py-3 px-3 tabular-nums">
                          <span className={cn("font-semibold", r.no_show > 0 ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>{r.no_show}</span>
                        </td>
                        <td className="text-right py-3 px-3 tabular-nums">
                          <span className="text-emerald-700 dark:text-emerald-300 font-semibold">{r.angenommen}</span>
                          {r.termin_wahrgenommen > 0 && <ConvBadge value={r.conv_angenommen} className="ml-2" />}
                        </td>
                        <td className="text-right py-3 px-3 tabular-nums">
                          <span className={cn("font-semibold", r.abgelehnt > 0 ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>{r.abgelehnt}</span>
                        </td>
                        <td className="text-right py-3 px-3 tabular-nums">
                          <span className="text-sky-600 dark:text-sky-400 font-semibold">{r.reg_mail}</span>
                        </td>
                        <td className="text-right py-3 px-3 tabular-nums">
                          <span className="font-semibold">{r.registriert}</span>
                          {r.angenommen > 0 && <ConvBadge value={r.conv_registriert} className="ml-2" />}
                        </td>
                        <td className="text-right py-3 px-3 tabular-nums">
                          <span className="text-emerald-700 dark:text-emerald-300 font-bold">{r.onboarded}</span>
                          {r.registriert > 0 && <ConvBadge value={r.conv_onboarded} className="ml-2" />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Was zeigen die Spalten?</CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-1.5">
          <p><strong className="text-foreground">Beworben:</strong> Neue Bewerbungen am Tag (ohne Test, nur Vermittlung/Fast-Track).</p>
          <p><strong className="text-foreground">Termin gebucht:</strong> Calendly-Termin wurde gesetzt (booking_status = scheduled oder completed).</p>
          <p><strong className="text-foreground">Wahrgenommen:</strong> Termin tatsächlich gehalten — booking_status = completed oder Interview wurde abgeschlossen.</p>
          <p><strong className="text-foreground">No-Show:</strong> Termin gebucht, aber nicht erschienen (booking_status = no_show).</p>
          <p><strong className="text-foreground">Angenommen / Abgelehnt:</strong> Finale Bewertung nach Interview (status oder Interview-Empfehlung).</p>
          <p><strong className="text-foreground">Reg-Mail:</strong> Registrierungs-/Einladungs-Mail an die Bewerber-Adresse versendet.</p>
          <p><strong className="text-foreground">Registriert:</strong> Bewerber hat ein Profil angelegt.</p>
          <p><strong className="text-foreground">Onboarded:</strong> Onboarding-Status = abgeschlossen — ab hier ist die Person Mitarbeiter:in.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function FunnelChart({ totals }: { totals: Totals }) {
  const stages = [
    { key: "beworben",            label: "Beworben",             value: totals.beworben,            color: "bg-slate-500" },
    { key: "termin_gebucht",      label: "Termin gebucht",       value: totals.termin_gebucht,      color: "bg-blue-500" },
    { key: "termin_wahrgenommen", label: "Termin wahrgenommen",  value: totals.termin_wahrgenommen, color: "bg-cyan-500" },
    { key: "angenommen",          label: "Angenommen",           value: totals.angenommen,          color: "bg-emerald-500" },
    { key: "registriert",         label: "Registriert",          value: totals.registriert,         color: "bg-teal-500" },
    { key: "onboarded",           label: "Mitarbeiter (onboarded)", value: totals.onboarded,        color: "bg-emerald-700" },
  ];
  const max = Math.max(1, ...stages.map(s => s.value));

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Gesamt-Trichter</CardTitle>
        <CardDescription>
          Absolute Zahlen pro Stufe im gewählten Zeitraum. Prozente = Conversion zur jeweils vorherigen Stufe.
          {totals.no_show > 0 && <> · <span className="text-rose-600 dark:text-rose-400 font-medium">{totals.no_show} No-Shows</span></>}
          {totals.abgelehnt > 0 && <> · <span className="text-rose-600 dark:text-rose-400 font-medium">{totals.abgelehnt} abgelehnt</span></>}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {stages.map((s, i) => {
          const prev = i > 0 ? stages[i - 1].value : null;
          const conv = prev && prev > 0 ? Math.round((s.value / prev) * 1000) / 10 : null;
          const widthPct = Math.max(4, Math.round((s.value / max) * 100));
          return (
            <div key={s.key} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground tabular-nums w-5 text-right">{i + 1}.</span>
                  <span className="font-medium">{s.label}</span>
                  {conv !== null && (
                    <span className={cn(
                      "text-[10px] font-semibold px-1.5 py-0.5 rounded tabular-nums",
                      conv >= 50 ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                        : conv >= 20 ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                        : "bg-rose-500/15 text-rose-700 dark:text-rose-300",
                    )}>
                      {conv}% von Stufe {i}
                    </span>
                  )}
                </div>
                <span className="font-bold tabular-nums">{s.value}</span>
              </div>
              <div className="h-7 bg-muted/40 rounded overflow-hidden">
                <div className={cn("h-full transition-all", s.color)} style={{ width: `${widthPct}%` }} />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function SourceBreakdown({ sources }: { sources: SourceFunnel[] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Funnel nach Vermittlung</CardTitle>
        <CardDescription>
          Pro Vermittlungs-Landing: von Bewerbung → Termin gebucht → wahrgenommen → angenommen → registriert → onboarded.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-muted-foreground border-b">
              <tr>
                <th className="text-left py-2 px-3 font-medium">Vermittlung</th>
                <th className="text-right py-2 px-3 font-medium">Bewerbungen</th>
                <th className="text-right py-2 px-3 font-medium">Termin gebucht</th>
                <th className="text-right py-2 px-3 font-medium">Wahrgenommen</th>
                <th className="text-right py-2 px-3 font-medium">Angenommen</th>
                <th className="text-right py-2 px-3 font-medium">Registriert</th>
                <th className="text-right py-2 px-3 font-medium">Onboarded</th>
                <th className="text-right py-2 px-3 font-medium">E2E</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => {
                const e2e = s.beworben > 0 ? Math.round((s.onboarded / s.beworben) * 1000) / 10 : 0;
                return (
                  <tr key={s.key} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="py-3 px-3 font-medium">{s.label}</td>
                    <td className="text-right py-3 px-3 font-semibold tabular-nums">{s.beworben}</td>
                    <td className="text-right py-3 px-3 tabular-nums">{s.termin_gebucht}</td>
                    <td className="text-right py-3 px-3 tabular-nums text-emerald-600 dark:text-emerald-400">{s.termin_wahrgenommen}</td>
                    <td className="text-right py-3 px-3 tabular-nums text-emerald-700 dark:text-emerald-300 font-semibold">{s.angenommen}</td>
                    <td className="text-right py-3 px-3 tabular-nums">{s.registriert}</td>
                    <td className="text-right py-3 px-3 tabular-nums font-bold text-emerald-700 dark:text-emerald-300">{s.onboarded}</td>
                    <td className="text-right py-3 px-3 tabular-nums">
                      <span className={cn(
                        "text-[10px] font-semibold px-1.5 py-0.5 rounded",
                        e2e >= 20 ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                          : e2e >= 5 ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                          : "bg-rose-500/15 text-rose-700 dark:text-rose-300",
                      )}>{e2e}%</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function Kpi({
  label, value, tone, sub, icon,
}: {
  label: string;
  value: number | string;
  tone: "default" | "primary" | "success" | "warn";
  sub?: string;
  icon?: React.ReactNode;
}) {
  const toneClass =
    tone === "primary" ? "text-primary"
    : tone === "success" ? "text-emerald-500"
    : tone === "warn" ? "text-rose-500"
    : "text-foreground";
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1">
          {icon} {label}
        </p>
        <p className={cn("text-2xl font-bold mt-1 tabular-nums", toneClass)}>{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground mt-0.5 truncate" title={sub}>{sub}</p>}
      </CardContent>
    </Card>
  );
}

function ConvBadge({ value, className }: { value: number; className?: string }) {
  const tone =
    value >= 50 ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
    : value >= 20 ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
    : "bg-rose-500/15 text-rose-700 dark:text-rose-300";
  return (
    <span className={cn("inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded tabular-nums", tone, className)}>
      {value}%
    </span>
  );
}
