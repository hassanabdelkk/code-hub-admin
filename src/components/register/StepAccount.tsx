import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArrowRight, UserPlus, LifeBuoy, Mail } from "lucide-react";
import { useTenant } from "@/contexts/TenantContext";

interface Props {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  setFirstName: (v: string) => void;
  setLastName: (v: string) => void;
  setEmail: (v: string) => void;
  setPassword: (v: string) => void;
  onNext: () => void;
  loading: boolean;
}

export default function StepAccount({ firstName, lastName, email, password, setFirstName, setLastName, setEmail, setPassword, onNext, loading }: Props) {
  const { tenant } = useTenant();
  const supportEmail = tenant?.company_email || tenant?.sender_email || "support@cac-vermittlung.de";
  return (
    <div className="space-y-5">
      <div className="text-center mb-6">
        <div className="h-14 w-14 rounded-2xl bg-primary flex items-center justify-center mx-auto mb-3 shadow-lg shadow-primary/20">
          <UserPlus className="h-6 w-6 text-primary-foreground" />
        </div>
        <h1 className="text-2xl font-heading font-bold text-foreground">Willkommen im Team!</h1>
        <p className="text-sm text-muted-foreground mt-1">Erstelle dein Konto in nur 3 Minuten</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Vorname *</label>
          <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Max" className="h-11" />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Nachname *</label>
          <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Mustermann" className="h-11" />
        </div>
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">E-Mail *</label>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="max@beispiel.de" className="h-11" />
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">Passwort *</label>
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min. 6 Zeichen" className="h-11" />
      </div>
      <Button onClick={onNext} disabled={loading} className="w-full h-12 text-base font-semibold gap-2">
        {loading ? "Wird erstellt…" : "Weiter"}
        {!loading && <ArrowRight className="h-4 w-4" />}
      </Button>
      <div className="pt-2 flex flex-col items-center gap-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <LifeBuoy className="h-3.5 w-3.5" />
          <span>Benötigen Sie Hilfe? Bei Problemen einfach melden:</span>
        </div>
        <a
          href={`mailto:${supportEmail}?subject=${encodeURIComponent("Hilfe bei der Registrierung")}`}
          className="inline-flex items-center gap-1.5 text-primary hover:underline font-medium"
        >
          <Mail className="h-3.5 w-3.5" />
          {supportEmail}
        </a>
      </div>
      <p className="text-center">
        <a href="/login" className="text-xs text-muted-foreground hover:text-foreground transition-colors">Bereits ein Konto? → Anmelden</a>
      </p>
    </div>
  );
}
