// Vermittlungs-Übersicht: Landings + eigenes Booking-System (kein Calendly / Fast-Track mehr).
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listLandingPages } from "@/lib/landing-pages.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Handshake, CalendarClock, Globe, Plus, ExternalLink } from "lucide-react";

export const Route = createFileRoute("/admin/vermittlung")({
  component: VermittlungOverview,
});

function VermittlungOverview() {
  const listLandings = useServerFn(listLandingPages);
  const lQ = useQuery({ queryKey: ["landings-broker"], queryFn: () => listLandings() });

  const allLandings: any[] = (lQ.data as any)?.rows ?? [];
  const brokerLandings = allLandings.filter((l) => l.flow_type === "broker");

  return (
    <div className="container max-w-6xl py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Handshake className="h-6 w-6" /> Vermittlung
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Bewerbungen kommen über deine Landing-Page rein und werden direkt im eigenen Portal
          bearbeitet — inklusive Terminbuchung über das integrierte Booking-System.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <StatCard
          icon={<Globe className="h-5 w-5" />}
          label="Vermittlungs-Landings"
          value={brokerLandings.length}
          to="/admin/landing-generator"
          cta="Landing anlegen"
        />
        <StatCard
          icon={<CalendarClock className="h-5 w-5" />}
          label="Terminverfügbarkeit"
          value="→"
          to="/admin/verfuegbarkeit"
          cta="Verfügbarkeit pflegen"
        />
        <StatCard
          icon={<Handshake className="h-5 w-5" />}
          label="Bewerbungen"
          value="→"
          to="/admin/bewerbungen"
          cta="Bewerbungen öffnen"
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Vermittlungs-Landings</CardTitle>
            <CardDescription>Landings mit Flow-Typ „Vermittlung" (broker)</CardDescription>
          </div>
          <Link to="/admin/landing-generator">
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Neue Landing</Button>
          </Link>
        </CardHeader>
        <CardContent>
          {lQ.isLoading && <p className="text-sm text-muted-foreground">Lade…</p>}
          {!lQ.isLoading && brokerLandings.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Noch keine Vermittlungs-Landings. Erstelle eine im{" "}
              <Link to="/admin/landing-generator" className="underline">Landing-Generator</Link>{" "}
              und wähle dort den Modus „Vermittlung".
            </p>
          )}
          <ul className="space-y-2">
            {brokerLandings.map((l) => (
              <li key={l.id} className="flex items-center justify-between border rounded-md p-3">
                <div className="min-w-0">
                  <div className="font-medium truncate">{l.branding?.firmenname || l.slug}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {l.domain || "—"} · /{l.source_slug || l.slug}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {l.is_published ? <Badge variant="default">live</Badge> : <Badge variant="secondary">Entwurf</Badge>}
                  {l.domain && (
                    <a href={`https://${l.domain}`} target="_blank" rel="noopener" className="text-muted-foreground hover:text-foreground">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>So funktioniert der Flow</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>1. Bewerber füllt das Formular auf deiner Vermittlungs-Landing aus.</p>
          <p>2. Bewerbung wird im Portal unter <Link to="/admin/bewerbungen" className="underline">Bewerbungen</Link> mit Status <code>pending</code> gespeichert.</p>
          <p>3. Bewerber bucht direkt einen freien Termin aus deiner <Link to="/admin/verfuegbarkeit" className="underline">Verfügbarkeit</Link> (integriertes Booking, kein Calendly).</p>
          <p>4. Automatische Bestätigungs-E-Mail mit Kalender-Anhang (.ics) geht raus, 30-Min-Reminder folgt.</p>
          <p>5. KI-Bewerbungsgespräch startet zum Termin über den Interview-Link; Entscheidung wird im Chat mitgeteilt.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ icon, label, value, to, cta }: { icon: React.ReactNode; label: string; value: number | string; to: string; cta: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-2">{icon} {label}</CardDescription>
        <CardTitle className="text-3xl">{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <Link to={to}><Button size="sm" variant="outline" className="w-full">{cta}</Button></Link>
      </CardContent>
    </Card>
  );
}
