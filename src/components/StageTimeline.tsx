import { Check } from "lucide-react";

export type StageState = "done" | "current" | "todo" | "failed";

export type Stage = {
  key: string;
  label: string;
  state: StageState;
};

/**
 * Kompakte horizontale Stage-Timeline (5-6 Punkte pro Zeile).
 * done = grün gefüllt, current = pulsierender Ring, todo = grau, failed = rot.
 */
export function StageTimeline({ stages, compact = false }: { stages: Stage[]; compact?: boolean }) {
  const dot = compact ? "h-2.5 w-2.5" : "h-3.5 w-3.5";
  const line = compact ? "h-[2px]" : "h-[2px]";
  return (
    <div className="flex items-center gap-0 min-w-max">
      {stages.map((s, i) => {
        const isLast = i === stages.length - 1;
        const color =
          s.state === "done"    ? "bg-emerald-500 border-emerald-500 text-white"
          : s.state === "current" ? "bg-primary border-primary text-primary-foreground ring-2 ring-primary/30 animate-pulse"
          : s.state === "failed"  ? "bg-rose-500 border-rose-500 text-white"
          : "bg-muted border-border text-muted-foreground";
        const nextLine =
          s.state === "done" ? "bg-emerald-500"
          : s.state === "failed" ? "bg-rose-400"
          : "bg-border";
        return (
          <div key={s.key} className="flex items-center group" title={s.label}>
            <div className="flex flex-col items-center gap-1">
              <div className={`${dot} rounded-full border-2 grid place-items-center transition-colors ${color}`}>
                {s.state === "done" && !compact && <Check className="h-2 w-2" strokeWidth={4} />}
              </div>
              {!compact && (
                <span className={`text-[9px] leading-none whitespace-nowrap ${
                  s.state === "current" ? "text-foreground font-medium"
                  : s.state === "done" ? "text-emerald-700 dark:text-emerald-400"
                  : s.state === "failed" ? "text-rose-600"
                  : "text-muted-foreground"
                }`}>{s.label}</span>
              )}
            </div>
            {!isLast && <div className={`${line} w-6 ${nextLine} ${compact ? "" : "mb-4"}`} />}
          </div>
        );
      })}
    </div>
  );
}
