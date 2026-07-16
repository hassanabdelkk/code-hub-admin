import { useEffect } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ArrowRight } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  emoji?: string;
  title: string;
  description?: string;
  /** Schritte erledigt (z. B. 3 von 5) */
  stepDone?: number;
  stepTotal?: number;
  /** Optionaler CTA — z. B. "Weiter zu Identität" */
  nextLabel?: string;
  onNext?: () => void;
  /** Auto-Close nach ms; 0 = nie */
  autoCloseMs?: number;
}

/**
 * Micro-Win Success-Modal: ersetzt stille toasts bei Schlüssel-Schritten
 * (Identität, Vertrag, Personaldaten, Onboarding). Visualisiert Fortschritt
 * und schubst den User zum nächsten Schritt.
 */
export function StepSuccessModal({
  open, onOpenChange,
  emoji = "🎉", title, description,
  stepDone, stepTotal,
  nextLabel, onNext,
  autoCloseMs = 0,
}: Props) {
  useEffect(() => {
    if (!open || !autoCloseMs) return;
    const t = setTimeout(() => onOpenChange(false), autoCloseMs);
    return () => clearTimeout(t);
  }, [open, autoCloseMs, onOpenChange]);

  const pct = stepDone && stepTotal ? Math.round((stepDone / stepTotal) * 100) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm text-center">
        <DialogTitle className="sr-only">{title}</DialogTitle>
        {description && <DialogDescription className="sr-only">{description}</DialogDescription>}
        <div className="pt-2 pb-1 space-y-4">
          <div className="text-6xl animate-fade-in">{emoji}</div>
          <div className="space-y-1">
            <h2 className="text-xl font-heading font-bold text-foreground">{title}</h2>
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
          {pct !== null && (
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Schritt {stepDone} von {stepTotal}</span>
                <span className="font-semibold text-primary">{pct}%</span>
              </div>
              <Progress value={pct} className="h-2" />
            </div>
          )}
          {nextLabel && onNext && (
            <Button
              onClick={() => { onOpenChange(false); onNext(); }}
              className="w-full gap-2 h-11 mt-2"
            >
              {nextLabel} <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
