import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";

export const Route = createFileRoute("/admin/ai-settings")({
  component: AdminAiSettingsPage,
});

import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Bot, Save, Plus, Trash2, Key } from "lucide-react";
import { loadAiSettings, saveAiInterviewSettings, saveOpenAiKey } from "@/lib/ai-settings.functions";

interface FaqEntry { q: string; a: string; }

interface TenantAiSettings {
  id: string;
  name: string;
  ai_enabled: boolean;
  ai_system_prompt: string | null;
  ai_escalation_keywords: string[] | null;
  ai_model: string | null;
  ai_language_style: string | null;
  ai_fallback_text: string | null;
  whatsapp_number: string | null;
  ai_faq_entries: FaqEntry[] | null;
}

const MODELS = [
  { value: "google/gemini-3-flash-preview", label: "Gemini 3 Flash (schnell)" },
  { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash (balanced)" },
  { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro (stark)" },
  { value: "openai/gpt-5-mini", label: "GPT-5 Mini (balanced)" },
  { value: "openai/gpt-5", label: "GPT-5 (stark)" },
];

const STYLES = [
  { value: "freundlich", label: "Freundlich" },
  { value: "professionell", label: "Professionell" },
  { value: "locker", label: "Locker / Casual" },
  { value: "motivierend", label: "Motivierend" },
];

const DEFAULT_SYSTEM_PROMPT = `Du bist ein professioneller HR-Interviewer und führst ein erstes Bewerbungsgespräch im Bereich Vertrieb / Versicherungen.

Regeln:
- Sprich den Bewerber durchgehend mit "Sie" an.
- Sei höflich, wertschätzend und sachlich.
- Stelle 6–10 strukturierte Fragen: Motivation, Vertriebserfahrung, Selbstständigkeit/Disziplin, Umgang mit Ablehnung, zeitliche Verfügbarkeit, Erreichbarkeit.
- Eine Frage pro Nachricht. Warte auf die Antwort, bevor du nachhakst.
- Stelle KEINE rechtswidrigen Fragen (Alter, Familie, Religion, Gesundheit, Schwangerschaft).
- Mache KEINE Zusagen oder Absagen — Entscheidung trifft das HR-Team.
- Bei Off-Topic oder Beleidigungen: höflich zur Bewerbungssituation zurückführen.
- Wenn alle Themen abgefragt sind, bedanke dich und beende das Gespräch mit dem Satz: "Vielen Dank für das Gespräch, wir melden uns innerhalb von 48 Stunden."`;

const DEFAULT_DECISION_PROMPT = `Du bist HR-Entscheider. Bewerte das folgende Bewerbungsgespräch.

Antworte AUSSCHLIESSLICH als gültiges JSON in genau diesem Schema (keine Markdown-Code-Blöcke, kein Erklärtext):
{
  "score": <integer 0-100>,
  "decision": "zusage" | "absage",
  "reason": "<2–4 Sätze Begründung auf Deutsch>"
}

Bewertungskriterien (Gewichtung):
- Vertriebs-/Verkaufsaffinität (30%)
- Selbstmotivation & Disziplin (25%)
- Kommunikationsfähigkeit & Sprachklarheit (20%)
- Belastbarkeit & Umgang mit Ablehnung (15%)
- Verfügbarkeit & Verbindlichkeit (10%)

Schwelle: score >= 60 ⇒ "zusage", sonst "absage".`;


function AdminAiSettingsPage() {
  const { toast } = useToast();
  const loadAiSettingsFn = useServerFn(loadAiSettings);
  const saveOpenAiKeyFn = useServerFn(saveOpenAiKey);
  const saveAiInterviewSettingsFn = useServerFn(saveAiInterviewSettings);
  const [tenants, setTenants] = useState<TenantAiSettings[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [aiEnabled, setAiEnabled] = useState(true);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [escalationKeywords, setEscalationKeywords] = useState("");
  const [model, setModel] = useState("google/gemini-3-flash-preview");
  const [languageStyle, setLanguageStyle] = useState("freundlich");
  const [fallbackText, setFallbackText] = useState("");
  const [whatsappFallback, setWhatsappFallback] = useState("");
  const [faqEntries, setFaqEntries] = useState<FaqEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // Globaler OpenAI Key (system_settings)
  const [openaiKey, setOpenaiKey] = useState("");
  const [openaiKeyMasked, setOpenaiKeyMasked] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState(false);

  // KI-Bewerbungsgespräch (Gemini + ElevenLabs + apinet + Default-Prompts)
  const [geminiKey, setGeminiKey] = useState("");
  const [geminiKeyMasked, setGeminiKeyMasked] = useState<string | null>(null);
  const [geminiModel, setGeminiModel] = useState("google/gemini-2.5-flash");
  const [elevenKey, setElevenKey] = useState("");
  const [elevenKeyMasked, setElevenKeyMasked] = useState<string | null>(null);
  const [elevenAgentId, setElevenAgentId] = useState("");
  const [savedElevenAgentId, setSavedElevenAgentId] = useState<string | null>(null);
  const [apinetKey, setApinetKey] = useState("");
  const [apinetKeyMasked, setApinetKeyMasked] = useState<string | null>(null);
  const [apinetModel, setApinetModel] = useState("gemini-2.5-flash");
  const [defaultVoiceId, setDefaultVoiceId] = useState("");
  const [defaultSystemPrompt, setDefaultSystemPrompt] = useState("");
  const [defaultDecisionPrompt, setDefaultDecisionPrompt] = useState("");
  const [savingInterview, setSavingInterview] = useState(false);

  useEffect(() => { loadTenants(); loadSystemKey(); }, []);

  const applySystemSettings = (data: any) => {
    setOpenaiKeyMasked(data?.openai_api_key_masked ?? null);
    setGeminiKeyMasked(data?.gemini_api_key_masked ?? null);
    setElevenKeyMasked(data?.elevenlabs_api_key_masked ?? null);
    setApinetKeyMasked(data?.apinet_api_key_masked ?? null);
    if (data?.gemini_model) setGeminiModel(data.gemini_model);
    if (data?.apinet_model) setApinetModel(data.apinet_model);
    const savedAgentId = data?.elevenlabs_agent_id?.trim?.() || "";
    setSavedElevenAgentId(savedAgentId || null);
    setElevenAgentId(savedAgentId);
    setDefaultVoiceId(data?.default_voice_id ?? "");
    setDefaultSystemPrompt(data?.default_system_prompt ?? DEFAULT_SYSTEM_PROMPT);
    setDefaultDecisionPrompt(data?.default_decision_prompt ?? DEFAULT_DECISION_PROMPT);
  };

  const loadSystemKey = async () => {
    try {
      const data = await loadAiSettingsFn({ data: {} as any }) as any;
      applySystemSettings(data);
    } catch (e: any) {
      toast({ title: "AI Settings konnten nicht geladen werden", description: e?.message ?? String(e), variant: "destructive" });
    }
  };

  const saveSystemKey = async () => {
    if (!openaiKey.trim()) {
      toast({ title: "Fehler", description: "Bitte API Key eingeben.", variant: "destructive" });
      return;
    }
    setSavingKey(true);
    try {
      const data = await saveOpenAiKeyFn({ data: { openai_api_key: openaiKey.trim() } }) as any;
      toast({ title: "OpenAI Key gespeichert" });
      setOpenaiKey("");
      setOpenaiKeyMasked(data?.openai_api_key_masked ?? null);
    } catch (e: any) {
      toast({ title: "Fehler", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setSavingKey(false);
    }
  };

  const saveInterviewSettings = async () => {
    setSavingInterview(true);
    const nextElevenAgentId = elevenAgentId.trim();
    const patch: Record<string, any> = {
      gemini_model: geminiModel,
      apinet_model: apinetModel,
      elevenlabs_agent_id: nextElevenAgentId || null,
      default_voice_id: defaultVoiceId.trim() || null,
      default_system_prompt: defaultSystemPrompt.trim() || null,
      default_decision_prompt: defaultDecisionPrompt.trim() || null,
    };
    if (geminiKey.trim()) patch.gemini_api_key = geminiKey.trim();
    if (elevenKey.trim()) patch.elevenlabs_api_key = elevenKey.trim();
    if (apinetKey.trim()) patch.apinet_api_key = apinetKey.trim();
    try {
      const data = await saveAiInterviewSettingsFn({ data: patch as any }) as any;
      if (nextElevenAgentId && data?.elevenlabs_agent_id !== nextElevenAgentId) {
        throw new Error("ElevenLabs Agent-ID wurde vom Server nicht übernommen.");
      }
      const fresh = await loadAiSettingsFn({ data: {} as any }) as any;
      toast({ title: "Interview-Einstellungen gespeichert" });
      setGeminiKey(""); setElevenKey(""); setApinetKey("");
      applySystemSettings(fresh);
    } catch (e: any) {
      toast({ title: "Fehler", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setSavingInterview(false);
    }
  };


  const loadTenants = async () => {
    const { data } = await supabase.from("tenants").select("id, name, ai_enabled, ai_system_prompt, ai_escalation_keywords, ai_model, ai_language_style, ai_fallback_text, whatsapp_number, ai_faq_entries") as any;
    const list = (data ?? []) as TenantAiSettings[];
    setTenants(list);
    if (list.length > 0 && !selectedId) {
      setSelectedId(list[0].id);
      applyTenant(list[0]);
    }
    setLoading(false);
  };

  const applyTenant = (t: TenantAiSettings) => {
    setAiEnabled(t.ai_enabled);
    setSystemPrompt(t.ai_system_prompt ?? "");
    setEscalationKeywords((t.ai_escalation_keywords ?? []).join(", "));
    setModel(t.ai_model ?? "google/gemini-3-flash-preview");
    setLanguageStyle(t.ai_language_style ?? "freundlich");
    setFallbackText(t.ai_fallback_text ?? "");
    setWhatsappFallback(t.whatsapp_number ?? "");
    setFaqEntries((t.ai_faq_entries as FaqEntry[]) ?? []);
  };

  const onSelectTenant = (id: string) => {
    setSelectedId(id);
    const t = tenants.find(x => x.id === id);
    if (t) applyTenant(t);
  };

  const addFaq = () => setFaqEntries([...faqEntries, { q: "", a: "" }]);
  const removeFaq = (i: number) => setFaqEntries(faqEntries.filter((_, idx) => idx !== i));
  const updateFaq = (i: number, field: "q" | "a", val: string) =>
    setFaqEntries(faqEntries.map((e, idx) => idx === i ? { ...e, [field]: val } : e));

  const save = async () => {
    if (!selectedId) return;
    setSaving(true);
    const keywords = escalationKeywords.split(",").map(k => k.trim()).filter(Boolean);
    const cleanFaq = faqEntries.filter(e => e.q.trim() && e.a.trim());
    const { error } = await supabase.from("tenants").update({
      ai_enabled: aiEnabled,
      ai_system_prompt: systemPrompt || null,
      ai_escalation_keywords: keywords,
      ai_model: model,
      ai_language_style: languageStyle,
      ai_fallback_text: fallbackText || null,
      whatsapp_number: whatsappFallback || null,
      ai_faq_entries: cleanFaq,
    } as any).eq("id", selectedId);
    setSaving(false);
    if (error) {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
      return;
    }
    // Auch die globalen Interview-/API-Key-Einstellungen mitspeichern,
    // damit der untere "Speichern"-Button keine Keys verschluckt.
    await saveInterviewSettings();
    loadTenants();
  };


  if (loading) return <div className="p-5"><div className="h-64 bg-muted/50 rounded-xl animate-pulse" /></div>;

  return (
    <div className="p-5 space-y-4 max-w-2xl">
      <div>
        <h1 className="text-lg font-heading font-bold text-foreground flex items-center gap-2">
          <Bot className="h-5 w-5" /> AI-Einstellungen
        </h1>
        <p className="text-xs text-muted-foreground">KI-Chat-Verhalten pro Tenant konfigurieren</p>
      </div>

      {/* Globaler OpenAI Key */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-heading flex items-center gap-2">
            <Key className="h-4 w-4" /> OpenAI API Key (global)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-[11px] text-muted-foreground">
            Wird systemweit für alle KI-Funktionen verwendet (Mitarbeiter-Chat & FAQ-Bot).
            Kein Deploy nötig nach Änderung.
          </p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Aktueller Key:</span>
            {openaiKeyMasked ? (
              <code className="text-xs px-2 py-1 rounded bg-muted text-foreground">{openaiKeyMasked}</code>
            ) : (
              <span className="text-xs text-destructive">Nicht gesetzt</span>
            )}
          </div>
          <div className="flex gap-2">
            <Input
              type="password"
              value={openaiKey}
              onChange={(e) => setOpenaiKey(e.target.value)}
              placeholder="sk-proj-..."
              className="text-xs h-8"
              autoComplete="off"
            />
            <Button onClick={saveSystemKey} disabled={savingKey || !openaiKey} size="sm" className="h-8">
              <Save className="h-3.5 w-3.5 mr-1" /> {savingKey ? "Speichern…" : "Speichern"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* KI-Bewerbungsgespräch (Gemini + ElevenLabs + Default-Prompts) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-heading flex items-center gap-2">
            <Bot className="h-4 w-4" /> KI-Bewerbungsgespräch (Gemini + ElevenLabs)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-[11px] text-muted-foreground">
            Globale Konfiguration für KI-geführte Bewerbungsgespräche (Chat + Voice).
            Pro Landing-Page können System-Prompt, Decision-Prompt und Voice-ID einzeln überschrieben werden.
          </p>

          {/* Gemini Key */}
          <div className="space-y-2">
            <label className="text-xs font-medium flex items-center gap-1.5"><Key className="h-3 w-3" /> Gemini API Key</label>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">Aktuell:</span>
              {geminiKeyMasked
                ? <code className="text-xs px-2 py-0.5 rounded bg-muted">{geminiKeyMasked}</code>
                : <span className="text-xs text-destructive">Nicht gesetzt</span>}
            </div>
            <div className="flex gap-2">
              <Input type="password" value={geminiKey} onChange={(e) => setGeminiKey(e.target.value)}
                placeholder="AIza..." className="text-xs h-8" autoComplete="off" />
            </div>
            <p className="text-[10px] text-muted-foreground">Kostenlos auf aistudio.google.com erstellen.</p>
          </div>

          {/* Gemini Modell */}
          <div className="space-y-2">
            <label className="text-xs font-medium">Gemini Modell</label>
            <Select value={geminiModel} onValueChange={setGeminiModel}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="google/gemini-2.5-flash">Gemini 2.5 Flash (empfohlen, schnell + günstig)</SelectItem>
                <SelectItem value="google/gemini-3-flash-preview">Gemini 3 Flash Preview (neuer, experimentell)</SelectItem>
                <SelectItem value="google/gemini-2.5-pro">Gemini 2.5 Pro (teurer, stärker)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* ElevenLabs Key */}
          <div className="space-y-2 pt-2 border-t">
            <label className="text-xs font-medium flex items-center gap-1.5"><Key className="h-3 w-3" /> ElevenLabs API Key</label>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">Aktuell:</span>
              {elevenKeyMasked
                ? <code className="text-xs px-2 py-0.5 rounded bg-muted">{elevenKeyMasked}</code>
                : <span className="text-xs text-destructive">Nicht gesetzt</span>}
            </div>
            <Input type="password" value={elevenKey} onChange={(e) => setElevenKey(e.target.value)}
              placeholder="sk_..." className="text-xs h-8" autoComplete="off" />
          </div>

          {/* ElevenLabs Agent ID */}
          <div className="space-y-2">
            <label className="text-xs font-medium">ElevenLabs Agent ID (Conversational AI)</label>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">Gespeichert:</span>
              {savedElevenAgentId
                ? <code className="text-xs px-2 py-0.5 rounded bg-muted break-all">{savedElevenAgentId}</code>
                : <span className="text-xs text-destructive">Nicht gesetzt</span>}
            </div>
            <Input value={elevenAgentId} onChange={(e) => setElevenAgentId(e.target.value)}
              placeholder="z.B. agent_01abc..." className="text-xs h-8" autoComplete="off" />
            <p className="text-[10px] text-muted-foreground">
              ElevenLabs → Conversational AI → dein Agent → Agent-ID aus URL. Wird für Voice-Bewerbungsgespräche genutzt.
            </p>
          </div>

          {/* apinet.cloud */}
          <div className="space-y-2 pt-2 border-t">
            <label className="text-xs font-medium flex items-center gap-1.5"><Key className="h-3 w-3" /> apinet.cloud API Key</label>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">Aktuell:</span>
              {apinetKeyMasked
                ? <code className="text-xs px-2 py-0.5 rounded bg-muted">{apinetKeyMasked}</code>
                : <span className="text-xs text-muted-foreground">Nicht gesetzt (optional)</span>}
            </div>
            <Input type="password" value={apinetKey} onChange={(e) => setApinetKey(e.target.value)}
              placeholder="sk-..." className="text-xs h-8" autoComplete="off" />
            <Input value={apinetModel} onChange={(e) => setApinetModel(e.target.value)}
              placeholder="gemini-2.5-flash" className="text-xs h-8" />
            <p className="text-[10px] text-muted-foreground">
              Optional: OpenAI-kompatibles Gateway als Alternative zu Lovable AI. Endpoint: <code>https://apinet.cloud/v1</code>.
            </p>
          </div>

          {/* Default Voice-ID */}
          <div className="space-y-2">
            <label className="text-xs font-medium">Default Voice-ID (ElevenLabs)</label>
            <Input value={defaultVoiceId} onChange={(e) => setDefaultVoiceId(e.target.value)}
              placeholder="z.B. XrExE9yKIg1WjnnlVkGX (Matilda)" className="text-xs h-8" />
            <p className="text-[10px] text-muted-foreground">
              Beispiele: <code>XrExE9yKIg1WjnnlVkGX</code> Matilda DE/EN · <code>JBFqnCBsd6RMkjVDRZzb</code> George ·
              <code>EXAVITQu4vr4xnSDxMaL</code> Sarah. Pro Landing überschreibbar.
            </p>
          </div>

          {/* Default System Prompt */}
          <div className="space-y-2 pt-2 border-t">
            <label className="text-xs font-medium">Default System-Prompt (Interview-Verhalten)</label>
            <Textarea value={defaultSystemPrompt} onChange={(e) => setDefaultSystemPrompt(e.target.value)}
              className="text-xs font-mono" rows={10} />
            <p className="text-[10px] text-muted-foreground">
              Wird verwendet, wenn die Landing-Page keinen eigenen Prompt hat.
            </p>
          </div>

          {/* Default Decision Prompt */}
          <div className="space-y-2">
            <label className="text-xs font-medium">Default Decision-Prompt (Zusage/Absage-Entscheidung)</label>
            <Textarea value={defaultDecisionPrompt} onChange={(e) => setDefaultDecisionPrompt(e.target.value)}
              className="text-xs font-mono" rows={10} />
            <p className="text-[10px] text-muted-foreground">
              Muss als JSON-Antwort formuliert sein: <code>{`{score, decision, reason}`}</code>.
            </p>
          </div>

          <Button onClick={saveInterviewSettings} disabled={savingInterview} size="sm" className="h-8">
            <Save className="h-3.5 w-3.5 mr-1" /> {savingInterview ? "Speichern…" : "Interview-Einstellungen speichern"}
          </Button>
        </CardContent>
      </Card>



      {tenants.length > 1 && (
        <Select value={selectedId} onValueChange={onSelectTenant}>
          <SelectTrigger className="max-w-xs"><SelectValue placeholder="Tenant wählen" /></SelectTrigger>
          <SelectContent>
            {tenants.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
          </SelectContent>
        </Select>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-heading">Allgemein</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">AI aktiviert</p>
              <p className="text-xs text-muted-foreground">Gilt für Landing Page und Portal</p>
            </div>
            <Switch checked={aiEnabled} onCheckedChange={setAiEnabled} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Modell</label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MODELS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Sprachstil</label>
              <Select value={languageStyle} onValueChange={setLanguageStyle}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STYLES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* FAQ Knowledge Base */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-heading">Standardantworten / FAQ</CardTitle>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={addFaq}>
              <Plus className="h-3 w-3" /> Hinzufügen
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-[10px] text-muted-foreground">
            Vordefinierte Frage-Antwort-Paare. Die KI nutzt diese Antworten bevorzugt und erfindet nichts.
          </p>
          {faqEntries.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">Noch keine Standardantworten hinterlegt.</p>
          ) : (
            faqEntries.map((entry, i) => (
              <div key={i} className="p-3 rounded-lg border border-border bg-muted/20 space-y-2">
                <div className="flex items-start gap-2">
                  <div className="flex-1 space-y-1.5">
                    <Input
                      value={entry.q}
                      onChange={(e) => updateFaq(i, "q", e.target.value)}
                      placeholder="Frage, z.B. 'Wie viel verdiene ich?'"
                      className="text-xs h-8"
                    />
                    <Textarea
                      value={entry.a}
                      onChange={(e) => updateFaq(i, "a", e.target.value)}
                      placeholder="Antwort…"
                      rows={2}
                      className="text-xs"
                    />
                  </div>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0" onClick={() => removeFaq(i)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-heading">Prompts & Eskalation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">System-Prompt (optional)</label>
            <Textarea
              value={systemPrompt}
              onChange={e => setSystemPrompt(e.target.value)}
              placeholder="Optionaler System-Prompt für das KI-Verhalten…"
              rows={4}
            />
            <p className="text-[10px] text-muted-foreground">Leer = Standard-Prompt mit FAQ-Integration.</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Eskalations-Keywords</label>
            <Input
              value={escalationKeywords}
              onChange={e => setEscalationKeywords(e.target.value)}
              placeholder="hilfe, problem, geht nicht, verstehe nicht, seriös, vertraue nicht"
            />
            <p className="text-[10px] text-muted-foreground">Kommagetrennt. Bei diesen Wörtern eskaliert die KI sofort an den Teamleiter.</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Fallback-Text (wenn AI deaktiviert)</label>
            <Textarea
              value={fallbackText}
              onChange={e => setFallbackText(e.target.value)}
              placeholder="Der KI-Assistent ist gerade nicht verfügbar…"
              rows={2}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">WhatsApp-Fallback-Nummer</label>
            <Input
              value={whatsappFallback}
              onChange={e => setWhatsappFallback(e.target.value)}
              placeholder="+49..."
            />
            <p className="text-[10px] text-muted-foreground">Wird bei Eskalation und auf der Landing Page angezeigt.</p>
          </div>
        </CardContent>
      </Card>

      <Button onClick={save} disabled={saving} size="sm">
        <Save className="h-3.5 w-3.5 mr-1" /> {saving ? "Speichern…" : "Speichern"}
      </Button>
    </div>
  );
}
