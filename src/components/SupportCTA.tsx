import { useTenant } from "@/contexts/TenantContext";
import { MessageCircle, Mail } from "lucide-react";

interface Props {
  /** Kontext-spezifische Frage, die im Mail-Subject landet */
  topic: string;
  /** Kurzer Hilfetext (zeile 2) */
  hint: string;
}

/**
 * Smart Support-CTA — nur an Conversion-Hotspots eingebaut (Vertrag, Identität,
 * Personaldaten). Nutzt die tenant-spezifische Kontakt-E-Mail (company_email,
 * Fallback sender_email/reply_to). Bewusst klein und freundlich gehalten,
 * keine roten Farben, kein Druck.
 */
export function SupportCTA({ topic, hint }: Props) {
  const { tenant } = useTenant();
  const supportEmail =
    (tenant as any)?.company_email ||
    (tenant as any)?.reply_to_email ||
    (tenant as any)?.sender_email ||
    "";

  if (!supportEmail) return null;

  const mailto = `mailto:${supportEmail}?subject=${encodeURIComponent(
    `Frage zu ${topic}`,
  )}&body=${encodeURIComponent(
    `Hallo,\n\nich habe eine kurze Frage zum Schritt "${topic}":\n\n\n\nDanke!`,
  )}`;

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-4 flex items-start gap-3">
      <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
        <MessageCircle className="h-4 w-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">Stuck? Frag uns kurz.</p>
        <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>
        <a
          href={mailto}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline mt-2"
        >
          <Mail className="h-3.5 w-3.5" />
          {supportEmail}
        </a>
      </div>
    </div>
  );
}
