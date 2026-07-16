import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ShieldOff, RotateCcw } from "lucide-react";

type SuppressedRow = {
  source: "profiles" | "applications";
  email: string;
  email_status: string;
  email_bounced_at: string | null;
  email_bounce_reason: string | null;
};

export function BounceSuppressionPanel() {
  const [rows, setRows] = useState<SuppressedRow[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const { toast } = useToast();

  const load = async () => {
    setLoading(true);
    const [{ data: profs }, { data: apps }] = await Promise.all([
      supabase
        .from("profiles")
        .select("email, email_status, email_bounced_at, email_bounce_reason")
        .neq("email_status", "active")
        .order("email_bounced_at", { ascending: false })
        .limit(200),
      supabase
        .from("applications")
        .select("email, email_status, email_bounced_at, email_bounce_reason")
        .neq("email_status", "active")
        .order("email_bounced_at", { ascending: false })
        .limit(200),
    ]);
    const merged: SuppressedRow[] = [
      ...((profs as any[]) ?? []).map((r) => ({ ...r, source: "profiles" as const })),
      ...((apps as any[]) ?? []).map((r) => ({ ...r, source: "applications" as const })),
    ];
    setRows(merged);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const unblock = async (email: string) => {
    setBusy(email);
    try {
      await Promise.all([
        supabase
          .from("profiles")
          .update({ email_status: "active", email_bounced_at: null, email_bounce_reason: null })
          .ilike("email", email),
        supabase
          .from("applications")
          .update({ email_status: "active", email_bounced_at: null, email_bounce_reason: null })
          .ilike("email", email),
      ]);
      toast({ title: "Sperre aufgehoben", description: email });
      await load();
    } catch (err: any) {
      toast({ title: "Fehler", description: err?.message ?? String(err), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  if (loading) return null;
  if (rows.length === 0) return null;

  return (
    <Card className="border-amber-200/60 bg-amber-50/40 dark:border-amber-900/40 dark:bg-amber-950/20">
      <CardContent className="p-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-amber-500/15 flex items-center justify-center">
              <ShieldOff className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">
                {rows.length} gesperrte E-Mail-Adresse{rows.length === 1 ? "" : "n"}
              </p>
              <p className="text-xs text-muted-foreground">
                Diese Adressen werden bei Reminder-, Reset- und Signup-Mails übersprungen. Klicke zum Aufklappen.
              </p>
            </div>
          </div>
          <Badge variant="outline" className="text-xs">{open ? "Schließen" : "Anzeigen"}</Badge>
        </button>

        {open && (
          <div className="mt-4 divide-y divide-amber-200/40 dark:divide-amber-900/30 border-t border-amber-200/40 dark:border-amber-900/30">
            {rows.map((r, i) => (
              <div key={`${r.source}-${r.email}-${i}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{r.email}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {r.email_status} · {r.source}
                    {r.email_bounce_reason ? ` · ${r.email_bounce_reason}` : ""}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs gap-1.5"
                  disabled={busy === r.email}
                  onClick={() => unblock(r.email)}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {busy === r.email ? "…" : "Sperre aufheben"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
