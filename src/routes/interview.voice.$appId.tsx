// Voice-Bewerbungsgespräch mit ElevenLabs Conversational AI.
// Aufruf: /interview/voice/<appId>?landing=<slug>
// - holt Conversation Token + System Prompt + Voice ID + Branding von /api/public/interview-voice
// - startet Echtzeit-Verbindung via @elevenlabs/react
// - persistiert jede Transkript-Nachricht serverseitig
// - beendet das Gespräch (Server fasst zusammen + setzt Status)

import { createFileRoute, useParams, useSearch } from "@tanstack/react-router";
import { useConversation, ConversationProvider } from "@elevenlabs/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, Mic, MicOff, PhoneOff, CheckCircle2, AlertCircle } from "lucide-react";

type Msg = { role: "user" | "assistant"; text: string };

type SessionConfig = {
  token: string;
  agentId: string;
  voiceId: string | null;
  systemPrompt: string;
  firstMessage: string;
  companyName: string;
  recruiterName: string;
  recruiterAvatarUrl: string | null;
  applicantFirstName: string;
};

type EndResult = {
  recommendation?: "invite" | "reject" | "unsure";
  application_status?: string;
  empty?: boolean;
};

async function postVoice(body: unknown) {
  const res = await fetch("/api/public/interview-voice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    throw new Error(
      res.ok
        ? `Unerwartete Antwort (kein JSON, Status ${res.status}). Bitte Frontend neu deployen.`
        : `Serverfehler ${res.status}.`,
    );
  }
  let data: any = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { throw new Error("Antwort konnte nicht gelesen werden."); }
  if (!res.ok) throw new Error(data?.error ?? `Fehler ${res.status}`);
  return data;
}

export const Route = createFileRoute("/interview/voice/$appId")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    landing: typeof s.landing === "string" ? s.landing : "",
  }),
  component: VoiceInterviewPageWrapper,
});

function VoiceInterviewPageWrapper() {
  return (
    <ConversationProvider>
      <VoiceInterviewPage />
    </ConversationProvider>
  );
}

function VoiceInterviewPage() {
  const { appId } = useParams({ from: "/interview/voice/$appId" });
  const { landing } = useSearch({ from: "/interview/voice/$appId" }) as { landing: string };

  const [consent, setConsent] = useState(false);
  const [config, setConfig] = useState<SessionConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [endResult, setEndResult] = useState<EndResult | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [transcript, setTranscript] = useState<Msg[]>([]);
  const [branding, setBranding] = useState<{ firmenname?: string; primary_color?: string; logo_url?: string | null } | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [remainingSec, setRemainingSec] = useState(600);
  const MAX_SEC = 600;
  const finalizedRef = useRef(false);
  const startedAtRef = useRef<number | null>(null);
  const transcriptCountRef = useRef(0);
  useEffect(() => { startedAtRef.current = startedAt; }, [startedAt]);
  useEffect(() => { transcriptCountRef.current = transcript.length; }, [transcript.length]);

  // Branding-Vorschau (Logo/Farben) für hübsche Header-Karte
  useEffect(() => {
    if (!landing) return;
    supabase
      .from("landing_pages")
      .select("logo_url, branding")
      .eq("slug", landing)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setBranding({ ...(data.branding as any), logo_url: (data as any).logo_url });
      });
  }, [landing]);

  const conversation = useConversation({
    onConnect: () => {
      setStartedAt((cur) => cur ?? Date.now());
    },
    onDisconnect: async () => {
      if (finalizedRef.current) return;
      // Fast disconnect ohne jede Nachricht → wahrscheinlich Agent-Konfigurationsfehler
      // (ElevenLabs: Overrides für first_message / system_prompt / language / voice
      // müssen im Agent unter "Security" freigegeben sein). Nicht als "Gespräch
      // beendet" anzeigen, sondern klare Fehlermeldung geben.
      const elapsed = startedAtRef.current ? (Date.now() - startedAtRef.current) / 1000 : 0;
      if (transcriptCountRef.current === 0 && elapsed < 4) {
        setError(
          "Die Verbindung zum Personal-Assistenten wurde direkt wieder getrennt. " +
          "Bitte in ElevenLabs (Agent → Security) die Overrides für first_message, " +
          "system_prompt, language und voice freigeben und erneut versuchen.",
        );
        return;
      }
      finalizedRef.current = true;
      try {
        setFinalizing(true);
        const r = await postVoice({ action: "end", applicationId: appId });
        setEndResult(r as EndResult);
      } catch (e: any) {
        setError(e?.message ?? "Auswertung fehlgeschlagen");
      } finally {
        setEnded(true);
        setFinalizing(false);
      }
    },
    onError: (e: any) => {
      console.error("[voice] error:", e);
      setError(typeof e === "string" ? e : e?.message ?? "Verbindungsfehler");
    },
    onMessage: (msg: any) => {
      // ElevenLabs liefert Transkripte als { source, message }
      const role: "user" | "assistant" = msg?.source === "user" ? "user" : "assistant";
      const text = String(msg?.message ?? "").trim();
      if (!text) return;
      setTranscript((prev) => [...prev, { role, text }]);
      // fire-and-forget persistieren
      postVoice({ action: "save", applicationId: appId, role, text }).catch((err) => {
        console.warn("[voice] save failed:", err);
      });
    },
  });

  const status = conversation.status;
  const isSpeaking = conversation.isSpeaking;
  const connected = status === "connected";
  const connecting = status === "connecting";

  // Countdown — sobald connected
  useEffect(() => {
    if (!startedAt || ended) return;
    const tick = () => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      const left = Math.max(0, MAX_SEC - elapsed);
      setRemainingSec(left);
      if (left === 0 && connected) {
        try { Promise.resolve(conversation.endSession()).catch(() => {}); } catch { /* noop */ }
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt, ended, connected, conversation]);

  const startSession = useCallback(async () => {
    setError(null);
    setLoadingConfig(true);
    try {
      // Proaktiv Permission prüfen (Chrome/Edge/Firefox)
      try {
        if (navigator.permissions) {
          const status = await (navigator.permissions as any).query({ name: "microphone" });
          if (status.state === "denied") {
            throw new Error("Mikrofon-Zugriff ist in Ihrem Browser blockiert. Bitte klicken Sie auf das Schloss-Symbol in der Adressleiste, erlauben Sie den Mikrofon-Zugriff und laden Sie die Seite anschließend neu.");
          }
        }
      } catch (permErr: any) {
        if (typeof permErr?.message === "string" && permErr.message.startsWith("Mikrofon-Zugriff")) throw permErr;
        // Safari unterstützt permissions.query nicht – einfach fortfahren
      }

      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (mediaErr: any) {
        const name = mediaErr?.name;
        if (name === "NotAllowedError" || name === "SecurityError") {
          throw new Error("Sie haben den Mikrofon-Zugriff abgelehnt. Bitte klicken Sie auf das Schloss-Symbol in der Adressleiste, erlauben Sie den Zugriff und versuchen Sie es erneut.");
        }
        if (name === "NotFoundError" || name === "DevicesNotFoundError") {
          throw new Error("Es wurde kein Mikrofon gefunden. Bitte schließen Sie ein Mikrofon oder Headset an und versuchen Sie es erneut.");
        }
        if (name === "NotReadableError" || name === "TrackStartError") {
          throw new Error("Ihr Mikrofon wird gerade von einer anderen Anwendung verwendet (z. B. Zoom, Teams, Discord). Bitte schließen Sie diese und versuchen Sie es erneut.");
        }
        throw new Error("Das Mikrofon konnte nicht aktiviert werden. Bitte prüfen Sie Ihre Browser-Einstellungen und versuchen Sie es erneut.");
      }

      const cfg = (await postVoice({ action: "token", applicationId: appId })) as SessionConfig & { ok: boolean };
      setConfig(cfg);
      const overrides: any = {
        agent: {
          prompt: { prompt: cfg.systemPrompt },
          firstMessage: cfg.firstMessage,
          language: "de",
        },
      };
      if (cfg.voiceId) overrides.tts = { voiceId: cfg.voiceId };
      await conversation.startSession({
        conversationToken: cfg.token,
        connectionType: "webrtc",
        overrides,
      } as any);
    } catch (e: any) {
      setError(e?.message ?? "Die Verbindung konnte nicht hergestellt werden. Bitte versuchen Sie es erneut.");
    } finally {
      setLoadingConfig(false);
    }
  }, [appId, conversation]);


  const stopSession = useCallback(async () => {
    if (!connected && !connecting) return;
    try {
      await conversation.endSession();
    } catch (e) {
      console.warn("[voice] endSession failed:", e);
    }
  }, [conversation, connected, connecting]);

  const company = branding?.firmenname || config?.companyName || "uns";
  const primary = branding?.primary_color || "#2563eb";
  const mm = Math.floor(remainingSec / 60).toString().padStart(2, "0");
  const ss = (remainingSec % 60).toString().padStart(2, "0");

  // Consent-Gate
  if (!consent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
        <div className="max-w-lg w-full bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-sm">
          {branding?.logo_url && <img src={branding.logo_url} alt={company} className="h-10 object-contain" />}
          <h1 className="text-xl font-semibold">Telefonisches Bewerbungsgespräch mit {company}</h1>
          <div className="text-sm text-muted-foreground space-y-2">
            <p><strong>Das Gespräch wird als Sprachgespräch geführt</strong> und automatisiert ausgewertet.</p>
            <p>Sie sprechen direkt mit unserem digitalen Personalreferenten. Das Gespräch dauert <strong>maximal 10 Minuten</strong>.</p>
            <p>Für die Auswertung wird ein Text-Transkript Ihrer Antworten gespeichert (max. 6 Monate). Bitte sorgen Sie für eine ruhige Umgebung und erlauben Sie den Zugriff auf Ihr Mikrofon.</p>
          </div>
          <Button size="lg" className="w-full" style={{ background: primary }} onClick={() => setConsent(true)}>
            Verstanden, Gespräch starten
          </Button>
        </div>
      </div>
    );
  }

  // Ende-Screen — drei Varianten je nach KI-Empfehlung
  if (ended) {
    const rec = endResult?.recommendation;
    const firstName = config?.applicantFirstName?.trim();
    const greeting = firstName ? `Hallo ${firstName},` : "Hallo,";
    const companyName = branding?.firmenname || config?.companyName || "uns";
    const primaryColor = branding?.primary_color || "#2563eb";

    if (rec === "invite") {
      const registerUrl = `/register?application=${encodeURIComponent(appId)}`;
      return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 to-slate-100 p-4">
          <div className="max-w-xl w-full bg-white rounded-2xl border border-emerald-200 p-8 shadow-sm">
            <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mb-4">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <h1 className="text-2xl font-semibold mb-2">Willkommen im Team!</h1>
            <p className="text-sm text-muted-foreground leading-relaxed mb-4">
              {greeting} wir freuen uns, dass Sie dabei sind. Ihr Profil hat uns überzeugt — lassen Sie uns direkt starten!
            </p>
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 mb-5">
              <p className="text-sm font-medium text-slate-800 mb-2">Wie geht es weiter?</p>
              <ol className="text-sm text-slate-700 space-y-1.5 list-decimal list-inside">
                <li>Registrieren Sie sich im Mitarbeiter-Portal von {companyName}</li>
                <li>Führen Sie anschließend Ihr Onboarding durch (Arbeitsvertrag &amp; Personalausweis)</li>
              </ol>
            </div>
            <Button asChild size="lg" className="w-full" style={{ background: primaryColor }}>
              <a href={registerUrl}>Jetzt registrieren</a>
            </Button>
            <p className="text-xs text-muted-foreground text-center mt-4">
              Wir wünschen Ihnen einen erfolgreichen Start!
            </p>
          </div>
        </div>
      );
    }

    if (rec === "reject") {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
          <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 p-8 shadow-sm">
            <h1 className="text-xl font-semibold mb-3">Vielen Dank für Ihr Gespräch</h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {greeting} vielen Dank, dass Sie sich die Zeit für unser Gespräch genommen haben. Nach interner Prüfung haben wir uns entschieden, Ihre Bewerbung an dieser Stelle <strong>nicht weiterzuverfolgen</strong>.
            </p>
            <p className="text-sm text-muted-foreground leading-relaxed mt-3">
              Wir wünschen Ihnen für Ihren weiteren Weg alles Gute.
            </p>
            <p className="text-xs text-muted-foreground mt-5">— Personalabteilung {companyName}</p>
          </div>
        </div>
      );
    }

    // unsure / empty / Fehler
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
        <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 p-8 text-center shadow-sm">
          <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-3">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-semibold mb-2">Vielen Dank!</h1>
          <p className="text-sm text-muted-foreground">
            Ihr Gespräch wurde aufgezeichnet und wird jetzt von unserem HR-Team final geprüft. Sie erhalten in Kürze eine E-Mail mit der Rückmeldung.
          </p>
        </div>
      </div>
    );
  }

  const recruiterName = config?.recruiterName ?? "Sabine Schneider";
  const recruiterAvatarUrl = config?.recruiterAvatarUrl ?? null;
  const recruiterInitials = recruiterName
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const Avatar = ({ size }: { size: "sm" | "md" | "lg" }) => {
    const px = size === "lg" ? "w-20 h-20 text-2xl" : size === "md" ? "w-10 h-10 text-sm" : "w-8 h-8 text-xs";
    if (recruiterAvatarUrl) {
      return <img src={recruiterAvatarUrl} alt={recruiterName} className={`${px} rounded-full object-cover shrink-0 border border-slate-200`} />;
    }
    return (
      <div
        className={`${px} rounded-full flex items-center justify-center text-white font-semibold shrink-0`}
        style={{ background: `linear-gradient(135deg, ${primary}, ${primary}cc)` }}
      >
        {recruiterInitials}
      </div>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-50 to-slate-100">
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Avatar size="md" />
            <div>
              <h1 className="text-sm font-semibold leading-tight">{recruiterName}</h1>
              <p className="text-xs text-muted-foreground leading-tight">
                Personalabteilung · {company}
                {connected && (
                  <span className="inline-flex items-center gap-1 ml-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-emerald-600">{isSpeaking ? "spricht …" : "hört zu …"}</span>
                  </span>
                )}
              </p>
            </div>
          </div>
          {connected && (
            <div className={`text-sm font-mono tabular-nums ${remainingSec < 60 ? "text-destructive" : "text-muted-foreground"}`}>
              {mm}:{ss}
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-6 flex flex-col gap-4">
        {error && (
          <div className="w-full p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive flex gap-2 items-start">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Chat-Verlauf */}
        <div className="flex-1 flex flex-col gap-3 min-h-[40vh]">
          {transcript.length === 0 && !connected && !connecting && (
            <div className="flex-1 flex flex-col items-center justify-center text-center text-sm text-muted-foreground py-12">
              <div className="mb-4"><Avatar size="lg" /></div>
              <p className="font-medium text-foreground mb-1">{recruiterName} freut sich auf Sie</p>
              <p>Sobald Sie auf „Gespräch beginnen" tippen, ruft Sie {recruiterName.split(" ")[0]} direkt im Browser an.</p>
            </div>
          )}

          {connecting && transcript.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              {recruiterName.split(" ")[0]} verbindet sich …
            </div>
          )}

          {transcript.map((m, i) => {
            const isRecruiter = m.role === "assistant";
            return (
              <div key={i} className={`flex gap-2 ${isRecruiter ? "justify-start" : "justify-end"}`}>
                {isRecruiter && <Avatar size="sm" />}
                <div
                  className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                    isRecruiter
                      ? "bg-white border border-slate-200 rounded-tl-sm text-slate-800"
                      : "text-white rounded-tr-sm"
                  }`}
                  style={!isRecruiter ? { background: primary } : undefined}
                >
                  {m.text}
                </div>
              </div>
            );
          })}

          {connected && isSpeaking && (
            <div className="flex gap-2 justify-start">
              <Avatar size="sm" />
              <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-sm px-4 py-3 flex gap-1">
                <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          )}
        </div>

        {/* Sprach-Indikator unten + Steuerung */}
        <div className="sticky bottom-0 bg-gradient-to-t from-slate-100 via-slate-100/95 to-transparent pt-6 pb-4 -mx-4 px-4">
          <div className="flex flex-col items-center gap-3">
            {connected && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {isSpeaking ? (
                  <><Mic className="w-3.5 h-3.5" /> {recruiterName.split(" ")[0]} spricht</>
                ) : (
                  <><MicOff className="w-3.5 h-3.5" /> Sie sind dran – bitte sprechen Sie</>
                )}
              </div>
            )}

            {!connected && !connecting && !finalizing && (
              <Button size="lg" className="px-10 h-12 w-full max-w-xs" style={{ background: primary }} onClick={startSession} disabled={loadingConfig}>
                {loadingConfig ? <Loader2 className="w-4 h-4 animate-spin" /> : "Gespräch beginnen"}
              </Button>
            )}

            {(connected || connecting) && (
              <Button size="lg" variant="destructive" className="px-8 h-12 w-full max-w-xs" onClick={stopSession} disabled={finalizing}>
                <PhoneOff className="w-4 h-4 mr-2" /> Gespräch beenden
              </Button>
            )}

            {finalizing && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" /> Gespräch wird ausgewertet …
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

