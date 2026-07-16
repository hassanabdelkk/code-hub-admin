// Öffentliche Chat-Oberfläche für das Bewerbungsgespräch.
// Aufruf: /interview/<appId>?landing=<slug>&portal=<base>
// Nach Abschluss: Danke-Screen; die Entscheidung/E-Mail läuft serverseitig.

import { createFileRoute, useParams, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, Send, CheckCircle2, UserPlus } from "lucide-react";

type Msg = { role: "user" | "assistant"; text: string; ts: string };

async function postInterview(body: unknown) {
  const res = await fetch("/api/public/interview-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    throw new Error(
      res.ok
        ? `Unerwartete Antwort vom Server (kein JSON, Status ${res.status}). Bitte Frontend neu deployen.`
        : `Serverfehler ${res.status}. Bitte erneut versuchen oder Support kontaktieren.`,
    );
  }
  let data: any = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { throw new Error("Antwort konnte nicht gelesen werden."); }
  // "Noch zu früh" ist kein Fehler — Frontend rendert Wartescreen mit Countdown.
  if (res.status === 425 || data?.not_yet) return { __notYet: true as const, scheduled_at: data?.scheduled_at ?? null, message: data?.error ?? null };
  if (!res.ok) throw new Error(data?.error ?? `Fehler ${res.status}`);
  return data;
}

export const Route = createFileRoute("/interview/$appId")({
  validateSearch: (s: Record<string, unknown>) => ({
    landing: typeof s.landing === "string" ? s.landing : "",
    portal: typeof s.portal === "string" ? s.portal : "",
  }),
  component: InterviewPage,
});

function InterviewPage() {
  const { appId } = useParams({ from: "/interview/$appId" });
  const { landing, portal } = useSearch({ from: "/interview/$appId" }) as { landing: string; portal: string };

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [ended, setEnded] = useState(false);
  const [appStatus, setAppStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [scheduledAt, setScheduledAt] = useState<number | null>(null);
  const [branding, setBranding] = useState<{ firmenname?: string; primary_color?: string; logo_url?: string | null; recruiter_name?: string; recruiter_avatar_url?: string | null } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);


  

  // Branding laden
  useEffect(() => {
    if (!landing) return;
    supabase
      .from("landing_pages")
      .select("logo_url, branding")
      .eq("slug", landing)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setBranding({ ...(data.branding as any), logo_url: data.logo_url });
      });
  }, [landing]);

  // Init: Bewerbung + Verlauf laden — erst NACH Einwilligung
  useEffect(() => {
    if (!consent) return;
    let cancelled = false;
    async function init() {
      try {
        const data = await postInterview({ applicationId: appId, action: "init" });
        if (cancelled) return;
        if ((data as any).__notYet) {
          const sched = (data as any).scheduled_at ? new Date((data as any).scheduled_at).getTime() : null;
          setScheduledAt(sched);
          setInitializing(false);
          return;
        }
        setScheduledAt(null);
        setMessages(data.history ?? []);
        if (data.ended) setEnded(true);
        if (data.application_status) setAppStatus(data.application_status);
        setStartedAt(data.interview_started_at ? new Date(data.interview_started_at).getTime() : Date.now());
        setInitializing(false);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message ?? "Unbekannter Fehler");
        setInitializing(false);
      }
    }
    init();
    return () => { cancelled = true; };
  }, [appId, consent]);

  // Auto-Retry sobald der Termin (minus 5 Min Vorlauf) erreicht ist.
  useEffect(() => {
    if (!scheduledAt) return;
    const readyAt = scheduledAt - 5 * 60 * 1000;
    const check = async () => {
      if (Date.now() < readyAt) return;
      try {
        const data = await postInterview({ applicationId: appId, action: "init" });
        if ((data as any).__notYet) return;
        setScheduledAt(null);
        setMessages(data.history ?? []);
        if (data.ended) setEnded(true);
        if (data.application_status) setAppStatus(data.application_status);
        setStartedAt(data.interview_started_at ? new Date(data.interview_started_at).getTime() : Date.now());
      } catch { /* still waiting */ }
    };
    const id = setInterval(check, 5000);
    check();
    return () => clearInterval(id);
  }, [scheduledAt, appId]);

  // Kein hartes Zeitlimit mehr im Frontend.
  // Das Gespräch endet ausschließlich durch:
  //  1. [INTERVIEW_END] von der KI (sauberer Abschluss mit rotem Faden),
  //  2. "Gespräch beenden"-Button des Bewerbers,
  //  3. Server-Auto-Timeout nach 45 Min Inaktivität (Migration 20260715).
  // Grund: Ein starres 15-Min-Limit killte Interviews mitten im Abschluss.


  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  // KI Chat ist bewusst ein reiner Text-Chat — keine TTS, keine Stimme.
  // Sprachausgabe läuft ausschließlich über /interview/voice/$appId (KI Telefon).


  async function send() {
    const text = input.trim();
    if (!text || loading || ended) return;
    setInput("");
    setLoading(true);
    // optimistic
    setMessages((prev) => [...prev, { role: "user", text, ts: new Date().toISOString() }]);
    const startedAt = Date.now();
    try {
      const data = await postInterview({ applicationId: appId, action: "message", text });
      // Menschlichere Antwortzeit: kurze Denkpause + „Tipp"-Zeit abhängig von Antwortlänge
      const reply = (data.history ?? []).slice(-1)[0]?.text ?? "";
      const chars = reply.length;
      // ~35ms pro Zeichen "Tippen", + 900ms Denkpause, gedeckelt bei 6s
      const targetMs = Math.min(6000, 900 + chars * 35);
      const elapsed = Date.now() - startedAt;
      const wait = Math.max(0, targetMs - elapsed);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      setMessages(data.history ?? []);
      if (data.ended) setEnded(true);
      if (data.application_status) setAppStatus(data.application_status);
    } catch (e: any) {
      setError(e?.message ?? "Unbekannter Fehler");
    } finally {
      setLoading(false);
    }
  }

  async function endInterview() {
    if (loading || ended || messages.length === 0) return;
    if (!window.confirm("Möchten Sie das Gespräch wirklich beenden?")) return;
    setLoading(true);
    try {
      const data = await postInterview({ applicationId: appId, action: "end" });
      if (data?.application_status) setAppStatus(data.application_status);
      setEnded(true);
    } catch (e: any) {
      setError(e?.message ?? "Unbekannter Fehler");
    } finally {
      setLoading(false);
    }
  }

  const company = branding?.firmenname || "uns";
  const primary = branding?.primary_color || "#2563eb";




  // Consent-Gate (DSGVO + EU AI Act)
  if (!consent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-950 p-4">
        <div className="max-w-lg w-full bg-white dark:bg-slate-900 rounded-2xl border border-border p-6 space-y-4 shadow-sm">
          {branding?.logo_url && <img src={branding.logo_url} alt={company} className="h-10 object-contain" />}
          <h1 className="text-xl font-semibold">Bewerbungsgespräch mit {company}</h1>
          <div className="text-sm text-muted-foreground space-y-2">
            <p><strong>Das Gespräch wird digital geführt</strong> und automatisiert ausgewertet.</p>
            <p>Das Gespräch dauert in der Regel <strong>15 bis 30 Minuten</strong> (max. 45 Min.) und besteht aus einigen Fragen zu Ihrer Person, Motivation und Verfügbarkeit — nehmen Sie sich die Zeit, die Sie brauchen.</p>
            <p>Ihre Antworten werden zur Bewerbungsauswertung gespeichert und für maximal 6 Monate aufbewahrt. Es findet keine Audio-Aufnahme statt.</p>
          </div>
          <Button
            size="lg"
            className="w-full"
            style={{ background: primary }}
            onClick={() => setConsent(true)}
          >
            Verstanden, Gespräch starten
          </Button>
        </div>
      </div>
    );
  }

  // Warte-Screen: Termin liegt in der Zukunft (>5 Min Vorlauf noch nicht erreicht).
  if (scheduledAt && Date.now() < scheduledAt - 5 * 60 * 1000) {
    return (
      <WaitingScreen
        scheduledAt={scheduledAt}
        company={company}
        primary={primary}
        logoUrl={branding?.logo_url || null}
        recruiterName={branding?.recruiter_name || "Sabine Schneider"}
      />
    );
  }



  const recruiterName = branding?.recruiter_name || "Sabine Schneider";
  const avatarUrl = branding?.recruiter_avatar_url || null;
  const initials = recruiterName.split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase();
  const status = loading ? `${recruiterName.split(" ")[0]} schreibt …` : ended ? "Gespräch beendet" : "online";

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950">
      {/* Chat-Header */}
      <header className="bg-white dark:bg-slate-900 border-b border-border sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="relative shrink-0">
            {avatarUrl ? (
              <img src={avatarUrl} alt={recruiterName} className="h-10 w-10 rounded-full object-cover" />
            ) : (
              <div className="h-10 w-10 rounded-full flex items-center justify-center text-white text-sm font-semibold" style={{ background: primary }}>
                {initials}
              </div>
            )}
            {!ended && (
              <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-slate-900" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-[15px] font-semibold text-foreground truncate">{recruiterName}</h1>
            <p className="text-xs truncate text-muted-foreground">
              {status} · {company}
            </p>
          </div>
        </div>
      </header>



      <main className="flex-1 max-w-2xl w-full mx-auto px-4 pb-4 flex flex-col">
        {error && (
          <div className="my-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Chat-Verlauf — ruhiges Business-Design */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-1.5 py-4 min-h-[200px]">
          {initializing && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin" style={{ color: primary }} />
            </div>
          )}
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const grouped = prev && prev.role === m.role;
            return (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"} ${grouped ? "mt-0.5" : "mt-2"}`}>
                <div
                  className={`max-w-[80%] px-4 py-2.5 text-[14.5px] leading-relaxed whitespace-pre-wrap ${
                    m.role === "user"
                      ? "text-white rounded-2xl rounded-br-sm"
                      : "bg-white dark:bg-slate-900 text-foreground rounded-2xl rounded-bl-sm border border-border"
                  }`}
                  style={m.role === "user" ? { background: primary } : undefined}
                >
                  {m.text}
                </div>
              </div>
            );
          })}
          {loading && !ended && (
            <div className="flex justify-start mt-2">
              <div className="bg-white dark:bg-slate-900 border border-border rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
                <div className="flex items-end gap-1.5 h-4">
                  <span className="typing-dot" style={{ animationDelay: "0ms" }} />
                  <span className="typing-dot" style={{ animationDelay: "180ms" }} />
                  <span className="typing-dot" style={{ animationDelay: "360ms" }} />
                </div>
              </div>
            </div>
          )}
        </div>

        {ended ? (
          appStatus === "akzeptiert" ? (
            <WelcomeAccepted
              company={company}
              primary={primary}
              recruiter={recruiterName}
              portal={portal}
            />
          ) : (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-border p-6 text-center space-y-3">
              <CheckCircle2 className="h-10 w-10 mx-auto" style={{ color: primary }} />
              <h2 className="text-lg font-semibold">Vielen Dank für das Gespräch!</h2>
              <p className="text-sm text-muted-foreground">
                Ihre Antworten wurden gespeichert. Wir melden uns in Kürze bei Ihnen.
              </p>
            </div>
          )
        ) : (
          <div className="sticky bottom-0 bg-transparent pt-2">
            <div className="flex items-end gap-2">
              <div className="flex-1 bg-white dark:bg-slate-900 rounded-full border border-border shadow-sm flex items-center px-4 py-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder="Nachricht schreiben…"
                  disabled={loading || initializing}
                  className="flex-1 bg-transparent text-[15px] focus:outline-none placeholder:text-muted-foreground"
                />
              </div>
              <button
                onClick={send}
                disabled={loading || initializing || !input.trim()}
                className="h-11 w-11 rounded-full flex items-center justify-center text-white shadow-sm transition disabled:opacity-40"
                style={{ background: primary }}
                aria-label="Senden"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
            {messages.length > 2 && (
              <div className="text-center mt-2">
                <button
                  onClick={endInterview}
                  disabled={loading}
                  className="text-xs text-muted-foreground hover:text-destructive underline disabled:opacity-50"
                >
                  Gespräch beenden
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function WelcomeAccepted({
  company,
  primary,
  recruiter,
  portal,
}: {
  company: string;
  primary: string;
  recruiter: string;
  portal: string;
}) {
  const base = (portal || "").replace(/\/+$/, "") || (typeof window !== "undefined" ? window.location.origin : "");
  const registerHref = `${base}/register`;
  return (
    <div className="mt-4 bg-white dark:bg-slate-900 rounded-2xl border-2 p-6 space-y-5 text-center shadow-lg" style={{ borderColor: primary }}>
      <div className="text-5xl leading-none animate-bounce">🎉</div>
      <div className="space-y-2">
        <h2 className="text-2xl font-bold leading-tight">Herzlichen Glückwunsch!</h2>
        <p className="text-[15px] text-foreground leading-relaxed">
          Ihr Profil hat uns <strong>überzeugt</strong> — willkommen bei {company}!
        </p>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Registrieren Sie sich jetzt im Mitarbeiter-Portal. Direkt nach der
          Registrierung liegt Ihr <strong>Arbeitsvertrag</strong> dort für Sie zur
          Durchsicht und digitalen Unterschrift bereit.
        </p>
        <div className="mt-3 mx-auto max-w-sm rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 px-3 py-2 text-xs text-amber-900 dark:text-amber-200 text-left">
          ⏱️ <strong>Wenn Sie sich heute noch registrieren</strong>, kann Ihr Teamleiter Ihren Vertrag oft schon <strong>morgen früh</strong> freigeben — dann starten Sie noch <strong>diese Woche</strong>.
        </div>
        <div className="mt-3 mx-auto max-w-sm rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-200">
          📬 Sie erhalten in ca. <strong>1 Minute</strong> eine Bestätigungs-E-Mail mit Ihrem persönlichen Portal-Link. Bitte auch den Spam-Ordner prüfen.
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Bitte für die Registrierung bereithalten: <strong>Personalausweis</strong>, <strong>IBAN</strong>, <strong>Steuer-ID</strong>.
        </p>
      </div>

      <Button
        asChild
        size="lg"
        className="w-full font-semibold text-base h-12 shadow-md hover:shadow-lg transition-shadow"
        style={{ background: primary }}
      >
        <a href={registerHref}>
          <UserPlus className="h-5 w-5 mr-2" />
          Jetzt im Mitarbeiter-Portal registrieren
        </a>
      </Button>

      <p className="text-xs text-muted-foreground leading-relaxed">
        ⏱️ Dauert nur 5 Minuten · 📄 Vertrag digital unterschreiben · 🚀 Sofort startklar
      </p>

      <p className="text-xs text-muted-foreground pt-3 border-t border-border">
        Herzliche Grüße, {recruiter} · HR bei {company}
      </p>
    </div>
  );
}

function WaitingScreen({
  scheduledAt,
  company,
  primary,
  logoUrl,
  recruiterName,
}: {
  scheduledAt: number;
  company: string;
  primary: string;
  logoUrl: string | null;
  recruiterName: string;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const diffMs = Math.max(0, scheduledAt - now);
  const totalMin = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const minutes = totalMin % 60;
  const seconds = Math.floor((diffMs % 60000) / 1000);

  const dateStr = new Date(scheduledAt).toLocaleDateString("de-DE", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: "Europe/Berlin",
  });
  const timeStr = new Date(scheduledAt).toLocaleTimeString("de-DE", {
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin",
  });

  let humanCountdown: string;
  if (days > 0) humanCountdown = `in ${days} ${days === 1 ? "Tag" : "Tagen"} und ${hours} Std.`;
  else if (hours > 0) humanCountdown = `in ${hours} Std. ${minutes} Min.`;
  else if (minutes > 0) humanCountdown = `in ${minutes} Min. ${seconds.toString().padStart(2, "0")} Sek.`;
  else humanCountdown = `in ${seconds} Sekunden`;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-950 p-4">
      <div className="max-w-lg w-full bg-white dark:bg-slate-900 rounded-2xl border border-border p-8 space-y-5 shadow-lg text-center">
        {logoUrl && <img src={logoUrl} alt={company} className="h-10 object-contain mx-auto" />}
        <div className="text-5xl leading-none">⏰</div>
        <div>
          <h1 className="text-2xl font-bold leading-tight mb-1">Sie sind etwas zu früh</h1>
          <p className="text-sm text-muted-foreground">
            Ihr Bewerbungsgespräch mit {recruiterName} ist gebucht für:
          </p>
        </div>

        <div className="rounded-xl border-2 p-4" style={{ borderColor: primary }}>
          <p className="text-sm text-muted-foreground">{dateStr}</p>
          <p className="text-3xl font-bold mt-1" style={{ color: primary }}>{timeStr} Uhr</p>
        </div>

        <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-border p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Ihr Gespräch beginnt</p>
          <p className="text-lg font-semibold">{humanCountdown}</p>
        </div>

        <div className="text-left text-sm text-muted-foreground space-y-2 bg-blue-50 dark:bg-blue-950/30 rounded-lg p-4 border border-blue-100 dark:border-blue-900">
          <p className="font-semibold text-foreground">So bereiten Sie sich optimal vor:</p>
          <ul className="space-y-1.5 list-none">
            <li>✅ Sorgen Sie für eine ruhige Umgebung</li>
            <li>✅ Halten Sie eine stabile Internetverbindung bereit</li>
            <li>✅ Denken Sie kurz über Ihre Motivation und Verfügbarkeit nach</li>
          </ul>
        </div>

        <p className="text-xs text-muted-foreground">
          Diese Seite lädt sich automatisch neu — sobald es losgeht, startet Ihr Gespräch direkt.
          Sie können das Fenster gerne geöffnet lassen.
        </p>
      </div>
    </div>
  );
}


