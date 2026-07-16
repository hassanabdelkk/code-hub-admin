// Zeigt aktuellen Lifecycle-Stage + History für eine Bewerbung.
// Ermöglicht Admin "Als Mitarbeiter übernehmen" (fasttrack_angenommen).
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, History, UserCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  getApplicationStageInfo,
  advanceApplicationStage,
} from "@/lib/application-stage.functions";

const STAGE_LABEL: Record<string, string> = {
  vermittlung_neu:            "Vermittlung: Neu",
  vermittlung_termin_gebucht: "Vermittlung: Termin gebucht",
  vermittlung_no_show:        "Vermittlung: Nicht erschienen",
  vermittlung_absage:         "Vermittlung: Absage",
  vermittlung_zusage:         "Vermittlung: Zusage",
  fasttrack_weitergeleitet:   "Fasttrack: Weitergeleitet",
  fasttrack_registriert:      "Fasttrack: Registriert",
  fasttrack_onboarding:       "Fasttrack: Onboarding",
  fasttrack_abgeschlossen:    "Fasttrack: Abgeschlossen",
  fasttrack_angenommen:       "Mitarbeiter angenommen",
  abgelehnt:                  "Abgelehnt",
  cold:                       "Kalt",
};

const STAGE_COLOR: Record<string, string> = {
  vermittlung_neu:            "bg-slate-100 text-slate-700",
  vermittlung_termin_gebucht: "bg-blue-100 text-blue-700",
  vermittlung_no_show:        "bg-amber-100 text-amber-800",
  vermittlung_absage:         "bg-rose-100 text-rose-700",
  vermittlung_zusage:         "bg-emerald-100 text-emerald-700",
  fasttrack_weitergeleitet:   "bg-indigo-100 text-indigo-700",
  fasttrack_registriert:      "bg-indigo-100 text-indigo-700",
  fasttrack_onboarding:       "bg-teal-100 text-teal-700",
  fasttrack_abgeschlossen:    "bg-teal-100 text-teal-700",
  fasttrack_angenommen:       "bg-emerald-500 text-white",
  abgelehnt:                  "bg-rose-100 text-rose-700",
  cold:                       "bg-slate-200 text-slate-600",
};

function fmt(d: string) {
  try {
    return new Date(d).toLocaleString("de-DE", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return d; }
}

export function StageHistoryCard({
  applicationId,
  canTakeover,
}: {
  applicationId: string;
  /** true = "Onboarding abgeschlossen" → Übernahme-Button darf sichtbar sein */
  canTakeover?: boolean;
}) {
  const getInfo = useServerFn(getApplicationStageInfo);
  const advance = useServerFn(advanceApplicationStage);
  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState<Awaited<ReturnType<typeof getInfo>> | null>(null);
  const [saving, setSaving] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      const res = await getInfo({ data: { applicationId } });
      setInfo(res);
    } catch (e: any) {
      // Pre-migration oder Rechte → still bleiben, UI nicht crashen.
      setInfo({ stage: null, stageChangedAt: null, history: [] });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, [applicationId]);

  async function takeover() {
    setSaving(true);
    try {
      await advance({ data: { applicationId, toStage: "fasttrack_angenommen", reason: "admin: übernahme" } });
      toast.success("Als Mitarbeiter übernommen.");
      await reload();
    } catch (e: any) {
      toast.error(e?.message ?? "Übernahme fehlgeschlagen");
    } finally {
      setSaving(false);
    }
  }

  const stage = info?.stage ?? null;
  const isAngenommen = stage === "fasttrack_angenommen";

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Lifecycle</span>
            {stage && (
              <Badge className={`text-[10px] ${STAGE_COLOR[stage] ?? "bg-muted"}`}>
                {STAGE_LABEL[stage] ?? stage}
              </Badge>
            )}
            {!stage && !loading && (
              <span className="text-xs text-muted-foreground">— (Migration ausstehend)</span>
            )}
          </div>
          {canTakeover && !isAngenommen && (
            <Button size="sm" onClick={takeover} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserCheck className="h-3.5 w-3.5" />}
              Als Mitarbeiter übernehmen
            </Button>
          )}
          {isAngenommen && (
            <Badge className="bg-emerald-500 text-white gap-1"><CheckCircle2 className="h-3 w-3" /> Übernommen</Badge>
          )}
        </div>

        {loading ? (
          <div className="text-xs text-muted-foreground">Lade Verlauf…</div>
        ) : info && info.history.length > 0 ? (
          <ol className="space-y-1.5 border-l pl-4 ml-1">
            {info.history.map((h, i) => (
              <li key={i} className="text-xs">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className={`text-[10px] ${STAGE_COLOR[h.to_stage] ?? "bg-muted"}`}>
                    {STAGE_LABEL[h.to_stage] ?? h.to_stage}
                  </Badge>
                  <span className="text-muted-foreground tabular-nums">{fmt(h.created_at)}</span>
                </div>
                {(h.from_stage || h.reason) && (
                  <div className="text-[10px] text-muted-foreground mt-0.5 ml-0.5">
                    {h.from_stage && <>von <span className="font-medium">{STAGE_LABEL[h.from_stage] ?? h.from_stage}</span></>}
                    {h.from_stage && h.reason && " · "}
                    {h.reason && <span className="italic">{h.reason}</span>}
                  </div>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <div className="text-xs text-muted-foreground">Noch keine Stage-Änderungen protokolliert.</div>
        )}
      </CardContent>
    </Card>
  );
}
