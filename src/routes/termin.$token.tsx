import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Loader2, CalendarX, CalendarClock, CalendarCheck } from "lucide-react";
import {
  getAppointmentByCancelToken,
  cancelAppointment,
} from "@/lib/appointments.functions";
import { useToast } from "@/hooks/use-toast";

export const Route = createFileRoute("/termin/$token")({
  head: () => ({
    meta: [
      { title: "Termin verwalten" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CancelPage,
});

function CancelPage() {
  const { token } = Route.useParams();
  const { toast } = useToast();
  const qc = useQueryClient();
  const detailFn = useServerFn(getAppointmentByCancelToken);
  const cancelFn = useServerFn(cancelAppointment);

  const [reason, setReason] = useState("");
  const [cancelledMagicToken, setCancelledMagicToken] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const detail = useQuery({
    queryKey: ["appointment-detail", token],
    queryFn: () => detailFn({ data: { cancel_token: token } }),
  });

  const cancelMut = useMutation({
    mutationFn: () => cancelFn({ data: { cancel_token: token, reason: reason || undefined } }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast({
          title: "Nicht möglich",
          description: res.error?.startsWith("already_")
            ? "Dieser Termin wurde bereits storniert."
            : "Der Termin konnte nicht storniert werden.",
          variant: "destructive",
        });
        qc.invalidateQueries({ queryKey: ["appointment-detail"] });
        return;
      }
      setCancelledMagicToken(res.magic_token);
    },
    onError: (e: any) => toast({ title: "Fehler", description: e?.message, variant: "destructive" }),
  });

  if (detail.isLoading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  if (!detail.data?.ok) {
    return (
      <Center title="Termin nicht gefunden">
        Der Link ist ungültig oder abgelaufen.
      </Center>
    );
  }

  const a = detail.data;
  const start = new Date(a.starts_at);
  const end = new Date(a.ends_at);
  const isCancelled = a.status === "cancelled" || cancelledMagicToken;

  if (isCancelled) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 py-10 px-4">
        <div className="max-w-lg mx-auto">
          <Card>
            <CardHeader className="text-center">
              <div className="mx-auto mb-3 h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
                <CalendarX className="h-6 w-6 text-destructive" />
              </div>
              <CardTitle>Termin abgesagt</CardTitle>
              <CardDescription>
                Ihr ursprünglicher Termin am {format(start, "d. MMMM yyyy 'um' HH:mm 'Uhr'", { locale: de })} ist storniert.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-center">
              {(cancelledMagicToken || a.magic_token) ? (
                <Link
                  to="/termin/buchen/$token"
                  params={{ token: cancelledMagicToken || a.magic_token! }}
                  className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90"
                >
                  <CalendarClock className="h-4 w-4" /> Neuen Termin buchen
                </Link>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Bitte kontaktieren Sie uns direkt, um einen neuen Termin zu vereinbaren.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 py-10 px-4">
      <div className="max-w-lg mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>Ihr Bewerbungsgespräch</CardTitle>
            <CardDescription>
              {a.tenant_name ? `mit ${a.tenant_name}` : null}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border p-4 bg-muted/40 text-center">
              <div className="text-sm text-muted-foreground">
                {format(start, "EEEE, d. MMMM yyyy", { locale: de })}
              </div>
              <div className="text-2xl font-semibold mt-1">
                {format(start, "HH:mm")} – {format(end, "HH:mm")} Uhr
              </div>
            </div>

            <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
              <div className="flex items-start gap-3">
                <CalendarClock className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                <div>
                  <div className="font-medium">Termin passt zeitlich nicht?</div>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Wählen Sie einfach einen neuen Termin – der alte wird automatisch storniert.
                  </p>
                </div>
              </div>
              {a.magic_token ? (
                <Link
                  to="/termin/buchen/$token"
                  params={{ token: a.magic_token }}
                  className="block w-full text-center rounded-md bg-primary text-primary-foreground px-4 py-2.5 text-sm font-semibold hover:opacity-90"
                >
                  Neuen Termin wählen
                </Link>
              ) : null}
            </div>

            <div className="pt-2 border-t">
              <button
                type="button"
                onClick={() => setConfirmOpen(true)}
                className="w-full text-sm text-muted-foreground hover:text-destructive underline-offset-4 hover:underline"
              >
                Ich möchte trotzdem endgültig absagen
              </button>
            </div>
          </CardContent>
        </Card>

        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Termin endgültig absagen?</DialogTitle>
              <DialogDescription>
                Ohne Termin können wir Ihre Bewerbung nicht weiter bearbeiten. Wenn der Zeitpunkt nicht passt, buchen Sie stattdessen einfach einen neuen Slot.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <label className="text-sm font-medium">Grund (optional)</label>
              <Textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="z.B. Andere Stelle angenommen"
                rows={3}
              />
            </div>
            <DialogFooter className="gap-2 sm:gap-2">
              {a.magic_token ? (
                <Link
                  to="/termin/buchen/$token"
                  params={{ token: a.magic_token }}
                  className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold hover:opacity-90"
                >
                  <CalendarCheck className="h-4 w-4 mr-2" /> Lieber umbuchen
                </Link>
              ) : null}
              <Button
                variant="ghost"
                onClick={() => { setConfirmOpen(false); cancelMut.mutate(); }}
                disabled={cancelMut.isPending}
                className="text-destructive hover:text-destructive"
              >
                {cancelMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Trotzdem absagen
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </div>
    </div>
  );
}

function Center({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <Card className="max-w-md w-full">
        <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">{children}</CardContent>
      </Card>
    </div>
  );
}
