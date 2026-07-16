// Öffentliche Zwischenseite: "Sie werden mit [Firma] verbunden…"
// Aufruf: /bewerbung/verbinden?app=<uuid>&landing=<slug>&first_name=&last_name=&email=&phone=
//
// Lädt Landing-Zeile per anon-Key, zeigt Loader-Modal mit Firmen-Branding,
// leitet nach `redirect_delay_ms` automatisch zu Calendly weiter (mit
// vorausgefüllten Daten + utm_content=<application_id> für Webhook-Matching).

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/bewerbung/verbinden")({
  component: BewerbungVerbindenPage,
});

type LandingRow = {
  calendly_url: string | null;
  intermediate_company_name: string | null;
  intermediate_logo_url: string | null;
  redirect_delay_ms: number | null;
  logo_url: string | null;
  branding: { firmenname?: string; primary_color?: string } | null;
};

function buildCalendlyUrl(base: string, params: Record<string, string>): string {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v);
  }
  return url.toString();
}

function BewerbungVerbindenPage() {
  const search = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const slug = search.get("landing") ?? "";
  const appId = search.get("app") ?? "";
  const firstName = search.get("first_name") ?? "";
  const lastName = search.get("last_name") ?? "";
  const email = search.get("email") ?? "";
  const phone = search.get("phone") ?? "";

  const [landing, setLanding] = useState<LandingRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!slug) { setError("Fehlender Parameter: landing"); return; }
      const { data, error } = await supabase
        .from("landing_pages")
        .select("calendly_url, intermediate_company_name, intermediate_logo_url, redirect_delay_ms, logo_url, branding")
        .eq("slug", slug)
        .eq("is_published", true)
        .maybeSingle();
      if (cancelled) return;
      if (error) { setError(error.message); return; }
      if (!data) { setError("Landing nicht gefunden"); return; }
      setLanding(data as any);
    }
    load();
    return () => { cancelled = true; };
  }, [slug]);

  const calendlyTarget = useMemo(() => {
    if (!landing?.calendly_url) return null;
    return buildCalendlyUrl(landing.calendly_url, {
      first_name: firstName,
      last_name: lastName,
      email,
      a1: phone,
      utm_source: "portal",
      utm_content: appId,
    });
  }, [landing, firstName, lastName, email, phone, appId]);

  // Auto-redirect nach delay
  useEffect(() => {
    if (!calendlyTarget) return;
    const delay = Math.max(0, landing?.redirect_delay_ms ?? 2500);
    if (delay === 0) return; // 0 = manueller Button
    setCountdown(Math.ceil(delay / 1000));
    const tick = setInterval(() => {
      setCountdown((c) => (c === null ? null : Math.max(0, c - 1)));
    }, 1000);
    const redirect = setTimeout(() => {
      window.location.href = calendlyTarget;
    }, delay);
    return () => { clearInterval(tick); clearTimeout(redirect); };
  }, [calendlyTarget, landing?.redirect_delay_ms]);

  const company = landing?.intermediate_company_name || landing?.branding?.firmenname || "unserem Partnerunternehmen";
  const primary = landing?.branding?.primary_color || "#2563eb";
  const logo = landing?.intermediate_logo_url || landing?.logo_url;
  const manualOnly = (landing?.redirect_delay_ms ?? 2500) === 0;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-950 p-4">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl p-8 text-center">
        {logo && (
          <img src={logo} alt={company} className="h-16 mx-auto mb-6 object-contain" />
        )}

        {error ? (
          <>
            <h1 className="text-xl font-semibold text-red-600 mb-2">Es ist ein Fehler aufgetreten</h1>
            <p className="text-sm text-muted-foreground">{error}</p>
          </>
        ) : !landing ? (
          <>
            <Loader2 className="h-10 w-10 animate-spin mx-auto mb-4" style={{ color: primary }} />
            <p className="text-sm text-muted-foreground">Lade…</p>
          </>
        ) : !landing.calendly_url ? (
          <>
            <h1 className="text-xl font-semibold mb-2">Bewerbung eingegangen</h1>
            <p className="text-sm text-muted-foreground">
              Vielen Dank für Ihre Bewerbung. Wir melden uns in Kürze bei Ihnen.
            </p>
          </>
        ) : (
          <>
            <Loader2 className="h-10 w-10 animate-spin mx-auto mb-4" style={{ color: primary }} />
            <h1 className="text-lg font-semibold mb-2">
              Sie werden mit <span style={{ color: primary }}>{company}</span> verbunden…
            </h1>
            <p className="text-sm text-muted-foreground mb-6">
              Bitte schließen Sie dieses Fenster nicht. Sie werden gleich zur Terminbuchung weitergeleitet.
            </p>

            {manualOnly ? (
              <Button
                size="lg"
                className="w-full"
                style={{ background: primary }}
                onClick={() => { if (calendlyTarget) window.location.href = calendlyTarget; }}
              >
                Jetzt Termin buchen
              </Button>
            ) : (
              <>
                {countdown !== null && countdown > 0 && (
                  <p className="text-xs text-muted-foreground mb-3">
                    Weiterleitung in {countdown} Sekunde{countdown === 1 ? "" : "n"}…
                  </p>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { if (calendlyTarget) window.location.href = calendlyTarget; }}
                >
                  Sofort weiter zur Terminbuchung
                </Button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
