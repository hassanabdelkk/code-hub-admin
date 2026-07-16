import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, RefreshCw, Loader2, CheckCircle2, AlertTriangle, XCircle, HelpCircle } from "lucide-react";
import { getCronHealth, type CronStatus } from "@/lib/cron-health.functions";

function ageLabel(min: number | null): string {
  if (min === null) return "noch nie";
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} Min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `vor ${h} Std`;
  return `vor ${Math.floor(h / 24)} Tagen`;
}

function sevBadge(s: CronStatus["severity"]) {
  if (s === "green") return { Icon: CheckCircle2, cls: "bg-emerald-100 text-emerald-700 border-emerald-200", label: "Healthy" };
  if (s === "yellow") return { Icon: AlertTriangle, cls: "bg-amber-100 text-amber-700 border-amber-200", label: "Verzögert" };
  if (s === "red") return { Icon: XCircle, cls: "bg-red-100 text-red-700 border-red-200", label: "Stillstand" };
  return { Icon: HelpCircle, cls: "bg-muted text-muted-foreground border-border", label: "Unbekannt" };
}

export function CronHealthPanel() {
  const fn = useServerFn(getCronHealth);
  const [data, setData] = useState<{ items: CronStatus[]; generated_at: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try { setData(await fn({ data: {} } as any)); } catch { /* silent */ } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Activity className="h-5 w-5 text-muted-foreground" />
          <div>
            <h2 className="text-base font-semibold">Cron-Health</h2>
            <p className="text-xs text-muted-foreground">
              Indirekt gemessen anhand der jüngsten Datenbank-Aktivität jedes Jobs. Stillstand = Cron läuft vermutlich nicht.
            </p>
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(data?.items ?? []).map((c) => {
          const { Icon, cls, label } = sevBadge(c.severity);
          return (
            <Card key={c.key}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">{c.label}</div>
                    <div className="text-[11px] text-muted-foreground font-mono">{c.schedule}</div>
                  </div>
                  <Badge variant="outline" className={`${cls} flex items-center gap-1`}>
                    <Icon className="h-3 w-3" /> {label}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">{c.description}</p>
                <div className="flex items-center justify-between text-xs pt-1 border-t">
                  <span className="text-muted-foreground">Letzte Aktivität</span>
                  <span className="font-medium">{ageLabel(c.age_min)}</span>
                </div>
                {c.hint && <p className="text-[10px] text-muted-foreground italic">{c.hint}</p>}
                {c.severity === "red" && (
                  <p className="text-[11px] text-destructive">
                    Verdacht: Cron-Job nicht installiert oder Edge-Function fehlerhaft. Prüfen via
                    {" "}<code className="font-mono">SELECT * FROM cron.job WHERE jobname = '{c.key}';</code>
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
        {loading && !data && (
          <Card><CardContent className="p-4 text-xs text-muted-foreground">Lade Cron-Status…</CardContent></Card>
        )}
      </div>
    </div>
  );
}
