// Einheitliches Status-Badge für Bewerbungen / Mitarbeiter.
// Status-Quelle ist `applications.status` (bzw. abgeleiteter Wert).
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type AppStatus = "new" | "accepted" | "registered" | "active" | "rejected" | string;

const MAP: Record<string, { label: string; cls: string }> = {
  new:        { label: "Neu",            cls: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100" },
  accepted:   { label: "Akzeptiert",     cls: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200" },
  registered: { label: "Registriert",    cls: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200" },
  active:     { label: "Freigeschaltet", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" },
  rejected:   { label: "Abgelehnt",      cls: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200" },
};

// Normalisiert bestehende DB-Werte (neu/eingegangen/akzeptiert/abgelehnt) +
// optional registered_at / active-Flags zu einem einheitlichen Token.
export function normalizeAppStatus(input: {
  status?: string | null;
  registered_at?: string | null;
  is_active?: boolean | null;
}): AppStatus {
  const s = (input.status ?? "").toLowerCase();
  if (s === "abgelehnt" || s === "rejected") return "rejected";
  if (input.is_active) return "active";
  if (input.registered_at) return "registered";
  if (s === "akzeptiert" || s === "accepted") return "accepted";
  return "new";
}

export function ApplicationStatusBadge({
  status,
  className,
}: {
  status: AppStatus;
  className?: string;
}) {
  const m = MAP[status] ?? { label: status, cls: "bg-muted text-muted-foreground" };
  return (
    <Badge variant="secondary" className={cn("text-[10px]", m.cls, className)}>
      {m.label}
    </Badge>
  );
}
