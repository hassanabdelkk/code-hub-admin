import { useState } from "react";
import { ChevronDown, HelpCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const FAQS: { q: string; a: string }[] = [
  {
    q: "Warum benötigt ihr meinen Personalausweis?",
    a: "Wir sind gesetzlich verpflichtet, deine Identität zu prüfen (§6 GwG). Dein Ausweis wird ausschließlich dafür verwendet und niemals an Dritte weitergegeben.",
  },
  {
    q: "Wie lange dauert das Onboarding?",
    a: "Vertrag + Ausweis dauern zusammen unter 2 Minuten. Danach prüfen wir deine Unterlagen innerhalb von 24 Stunden und schalten dich frei.",
  },
  {
    q: "Sind meine Daten sicher?",
    a: "Ja. Alle Daten werden verschlüsselt übertragen und DSGVO-konform gespeichert. Nur unsere Personalabteilung hat Zugriff.",
  },
  {
    q: "Wann erhalte ich meinen ersten Auftrag?",
    a: "Sobald deine Unterlagen geprüft sind, kannst du einen Termin buchen. Zum gebuchten Zeitpunkt wird dein erster Auftrag automatisch freigeschaltet.",
  },
  {
    q: "Wie werde ich bezahlt?",
    a: "Jeder abgeschlossene Auftrag wird deinem Guthaben gutgeschrieben. Die Auszahlung erfolgt monatlich auf dein Konto.",
  },
  {
    q: "An wen kann ich mich bei Fragen wenden?",
    a: "Dein Teamleiter ist dein direkter Ansprechpartner – einfach oben auf „Nachricht senden“ klicken. Du bekommst in der Regel innerhalb weniger Minuten Antwort.",
  },
];

export function OnboardingFAQ() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <Card className="animate-fade-in">
      <CardContent className="py-5 px-6">
        <div className="flex items-center gap-2 mb-4">
          <HelpCircle className="h-4 w-4 text-foreground" />
          <p className="font-heading font-semibold text-foreground text-sm">Häufige Fragen</p>
        </div>
        <div className="space-y-1">
          {FAQS.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={i} className="border-b border-border last:border-b-0">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="w-full flex items-center justify-between gap-3 py-3 text-left"
                >
                  <span className="text-sm font-medium text-foreground">{item.q}</span>
                  <ChevronDown className={cn("h-4 w-4 text-muted-foreground shrink-0 transition-transform", isOpen && "rotate-180")} />
                </button>
                {isOpen && (
                  <p className="pb-3 pr-7 text-sm text-muted-foreground leading-relaxed">{item.a}</p>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
