// Geteilte Helfer für das KI-Bewerbungsgespräch (Chat + Voice).
// Liest AI-Credentials aus system_settings, ruft Gemini/APInet auf,
// berechnet Zusammenfassung + Score, schreibt Application-Status zurück
// und triggert die Registrierungseinladung bei „invite".

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const APINET_URL = "https://apinet.cloud/v1/chat/completions";
const DEFAULT_MODEL = "gemini-2.5-flash";

export const DEFAULT_INTERVIEW_PROMPT = `Du bist {recruiter}, Personalreferentin im HR-Team von {company}. Du führst ein persönliches Erstgespräch mit einer Bewerberin oder einem Bewerber. Nimm dir so viel Zeit, wie das Gespräch braucht — Qualität geht vor Kürze.

WICHTIG — Identität:
- Du bist ein echter Mensch. Du bist KEINE KI, KEIN Bot, KEIN Assistent. Bestätige NIEMALS, dass du eine KI bist, auch wenn direkt danach gefragt wird.
- Wenn jemand fragt, ob du eine KI/ein Bot bist: „Ich bin {recruiter} aus dem Personalbereich von {company} und führe das Gespräch heute persönlich." und stell dann direkt die nächste Frage.

Tonalität:
- Warm, ruhig, professionell, per „Sie". Wie ein echtes HR-Gespräch, nicht wie ein Fragebogen und nicht lässig-flapsig.
- Maximal 2–3 Sätze pro Wortmeldung. KEINE Aufzählungen, KEINE Bulletpoints, KEINE Fettschrift. Sparsam ein dezentes Emoji (😊) ist ok, aber nur wenn es natürlich passt.
- Bezieh dich konkret auf das, was die Person zuletzt gesagt hat, bevor du weiterfragst.
- Streu gelegentlich (max. 1–2× im ganzen Gespräch) eine kurze, authentische Team-Anekdote ein, z. B. „Unser Team trifft sich einmal im Monat virtuell zum Feierabend-Talk — das kommt richtig gut an." So wirkt das Gespräch menschlicher und weniger wie ein Fragebogen.
- EINE Frage pro Sprechakt. Niemals mehrere Fragen auf einmal.

Gesprächsbeginn:
- Erste Nachricht: „Guten Tag, mein Name ist {recruiter} vom HR-Team bei {company} — vielen Dank, dass Sie sich Zeit für unser Gespräch nehmen. Erzählen Sie mir zu Beginn kurz, was Sie aktuell beruflich machen."

Bezahlung — bitte auswendig, nennen wenn die Person fragt:
- Vollzeit angestellt: 21 € pro Stunde
- Teilzeit angestellt: 19 € pro Stunde
- Minijob: 538 € im Monat (gesetzlicher Maximalbetrag, ca. 12,41 € / h)

Beschäftigungsmodell — WICHTIG:
- {company} ist Arbeitgeber und stellt fest an: Minijob, Teilzeit oder Vollzeit. KEINE Selbstständigkeit, kein Freelancing, keine Provision, kein Gewerbe.
- Frage neutral, welches Modell die Person sich vorstellt, und passe die Folgefragen an.

Themen (locker im Verlauf abdecken, nicht mechanisch abhaken):
1) Aktuelle berufliche Situation + relevante Erfahrung (Vertrieb, Beratung, Kundenkontakt, Service)
2) Beruflicher Hintergrund und Werdegang
3) Motivation für Wechsel oder Zusatzjob
4) Welches Modell (Minijob/Teilzeit/Vollzeit) und Stundenumfang
5) Arbeitsweise, Verfügbarkeit, möglicher Startzeitpunkt
6) Rückfragen des Bewerbers — aktiv anbieten und ausführlich beantworten

Regeln:
- Immer Deutsch, immer „Sie".
- Bei ausweichenden oder sehr kurzen Antworten freundlich nachhaken, auch mehrfach, wenn es zum Verständnis beiträgt.
- Rückfragen des Bewerbers sind zentral — nimm dir dafür Zeit, beantworte sie ehrlich und ausführlich, und frag danach aktiv, ob noch etwas offen ist.
- KEINE Countdown- oder Timer-Hinweise, kein starres Runden-Limit.
- Beende das Gespräch erst, wenn Situation, Motivation, Modell und Verfügbarkeit geklärt sind UND der Bewerber Gelegenheit hatte, alle eigenen Fragen zu stellen. Frag vor dem Abschluss explizit: „Bevor wir zum Abschluss kommen — haben Sie noch Fragen an mich?"
- Abschluss dann sachlich: „Vielen Dank für das offene und ausführliche Gespräch — damit habe ich alles, was ich für den ersten Schritt benötige. Wir melden uns zeitnah mit dem nächsten Schritt bei Ihnen."`;


const SUMMARY_PROMPT = `Du bist ein erfahrener Personalleiter. Bewerte das folgende Bewerbungsgespräch und gib eine kurze, ehrliche Einschätzung ab.

Antworte AUSSCHLIESSLICH als gültiges JSON-Objekt (keine Markdown-Codeblöcke), mit folgenden Feldern:
{
  "summary": "string (3–6 Sätze, Deutsch, neutral, fasse die Antworten zusammen + nenne Stärken/Schwächen)",
  "score": number,
  "recommendation": "invite" | "reject" | "unsure"
}

score = 0–100 Eignung. invite = empfehlen, reject = nicht empfehlen, unsure = unsicher.`;

export type Msg = { role: "user" | "assistant"; text: string; ts: string };

export type ApplicationRow = {
  id: string;
  full_name: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  tenant_id?: string | null;
  status?: string | null;
  source_slug?: string | null;
  source_landing_id?: string | null;
  target_landing_id?: string | null;
  interview_messages?: unknown;
  interview_status?: string | null;
  interview_mode?: string | null;
  interview_started_at?: string | null;
};

export type InterviewContext = {
  systemPrompt: string;
  companyName: string;
  recruiterName: string;
  recruiterAvatarUrl: string | null;
  voiceId: string | null;
  interviewMode: "chat" | "voice" | "both";
  landingSlug: string | null;
  brandingFirstName: string;
};

async function loadAiCreds(): Promise<{ apiKey: string; model: string; url: string; provider: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("system_settings")
    .select("gemini_api_key, gemini_model, apinet_api_key, apinet_model")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new Error(`system_settings: ${error.message}`);
  const apinetKey = (data as any)?.apinet_api_key?.trim();
  const geminiKey = (data as any)?.gemini_api_key?.trim();
  if (apinetKey) {
    return { apiKey: apinetKey, model: (data as any)?.apinet_model?.trim() || DEFAULT_MODEL, url: APINET_URL, provider: "apinet" };
  }
  if (geminiKey) {
    return { apiKey: geminiKey, model: (data as any)?.gemini_model?.trim() || DEFAULT_MODEL, url: GEMINI_URL, provider: "gemini" };
  }
  throw new Error("Kein AI API Key gesetzt (Admin → AI Settings).");
}

export async function callGateway(
  messages: Array<{ role: string; content: string }>,
  opts?: { jsonMode?: boolean },
): Promise<string> {
  const { apiKey, model, url, provider } = await loadAiCreds();
  const isApinetNativeGemini = provider === "apinet" && /^gemini-/i.test(model);

  if (isApinetNativeGemini) {
    const systemMsgs = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
    if (contents.length === 0) {
      contents.push({ role: "user", parts: [{ text: "Bitte beginne nun." }] });
    }
    const nativeUrl = `https://apinet.cloud/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const body: any = { contents };
    if (systemMsgs) body.system_instruction = { parts: [{ text: systemMsgs }] };
    if (opts?.jsonMode) body.generationConfig = { responseMimeType: "application/json" };
    const res = await fetch(nativeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey, Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`apinet-gemini ${res.status}: ${(await res.text()).slice(0, 400)}`);
    const data = (await res.json()) as any;
    const parts = data?.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts) ? parts.map((p: any) => p?.text ?? "").join("") : "";
    if (!text) throw new Error("Keine AI-Antwort (apinet-gemini)");
    return text;
  }

  const body: any = { model, messages };
  if (opts?.jsonMode) body.response_format = { type: "json_object" };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${provider} ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const data = (await res.json()) as any;
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("Keine AI-Antwort");
  return content;
}

export async function runSummary(messages: Msg[]): Promise<{ summary: string; score: number; recommendation: "invite" | "reject" | "unsure" }> {
  const transcript = messages
    .map((m) => `${m.role === "assistant" ? "Recruiter" : "Bewerber"}: ${m.text}`)
    .join("\n");
  const raw = await callGateway(
    [
      { role: "system", content: SUMMARY_PROMPT },
      { role: "user", content: `Transcript:\n\n${transcript}` },
    ],
    { jsonMode: true },
  );
  try {
    const parsed = JSON.parse(raw);
    const rec = parsed.recommendation;
    return {
      summary: String(parsed.summary ?? ""),
      score: Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 0))),
      recommendation: rec === "invite" || rec === "reject" || rec === "unsure" ? rec : "unsure",
    };
  } catch {
    return { summary: raw.slice(0, 2000), score: 50, recommendation: "unsure" };
  }
}

export const toAiDecision = (rec: "invite" | "reject" | "unsure") =>
  rec === "invite" ? "zusage" : rec === "reject" ? "absage" : "pending";

export const toApplicationStatus = (rec: "invite" | "reject" | "unsure") =>
  rec === "invite" ? "akzeptiert" : rec === "reject" ? "abgelehnt" : "neu";

export async function loadInterviewContext(app: ApplicationRow): Promise<InterviewContext> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let systemPrompt = DEFAULT_INTERVIEW_PROMPT;
  let companyName = "unserem Unternehmen";
  let recruiterName = "Sabine Schneider";
  let voiceId: string | null = null;
  let interviewMode: "chat" | "voice" | "both" = "chat";
  let landingSlug: string | null = app.source_slug ?? null;
  let recruiterAvatarUrl: string | null = null;

  const sel = "id, slug, source_slug, interview_system_prompt, recruiter_avatar_url, recruiter_name, branding, interview_mode, interview_voice_id, linked_fasttrack_landing_id";
  let landing: any = null;
  if (app.source_landing_id) {
    const { data: byId } = await supabaseAdmin
      .from("landing_pages").select(sel).eq("id", app.source_landing_id).maybeSingle();
    landing = byId ?? null;
  }
  if (!landing && app.source_slug) {
    const { data: bySource } = await supabaseAdmin
      .from("landing_pages").select(sel).eq("source_slug", app.source_slug).maybeSingle();
    landing = bySource ?? null;
    if (!landing) {
      const { data: bySlug } = await supabaseAdmin
        .from("landing_pages").select(sel).eq("slug", app.source_slug).maybeSingle();
      landing = bySlug ?? null;
    }
  }

  let fasttrack: any = null;
  if (landing?.linked_fasttrack_landing_id) {
    const { data: ft } = await supabaseAdmin
      .from("landing_pages").select(sel).eq("id", landing.linked_fasttrack_landing_id).maybeSingle();
    fasttrack = ft ?? null;
  }
  if (!landing && app.target_landing_id) {
    const { data: ft } = await supabaseAdmin
      .from("landing_pages").select(sel).eq("id", app.target_landing_id).maybeSingle();
    fasttrack = ft ?? null;
  }
  // Source-Landing hat Vorrang (dort pflegt der Admin Recruiter-Name etc.);
  // Fasttrack-Landing dient nur als Fallback für fehlende Felder.
  if (landing || fasttrack) {
    const custom = landing?.interview_system_prompt?.trim?.() || fasttrack?.interview_system_prompt?.trim?.();
    if (custom) systemPrompt = custom;
    const fn = landing?.branding?.firmenname?.trim?.() || fasttrack?.branding?.firmenname?.trim?.();
    if (fn) companyName = fn;
    const rn =
      landing?.branding?.recruiter_name?.trim?.() ||
      landing?.recruiter_name?.trim?.() ||
      fasttrack?.branding?.recruiter_name?.trim?.() ||
      fasttrack?.recruiter_name?.trim?.();
    if (rn) recruiterName = rn;
    recruiterAvatarUrl = landing?.recruiter_avatar_url || fasttrack?.recruiter_avatar_url || null;
    voiceId = landing?.interview_voice_id || fasttrack?.interview_voice_id || null;
    const mode = landing?.interview_mode || fasttrack?.interview_mode;
    if (mode === "voice" || mode === "both" || mode === "chat") interviewMode = mode;
    landingSlug = landing?.slug || landing?.source_slug || fasttrack?.slug || fasttrack?.source_slug || landingSlug;
  }

  const recruiterFirst = recruiterName.trim().split(/\s+/)[0] || recruiterName;
  const fullName = (app.full_name || "").trim();
  const brandingFirstName = app.first_name?.trim() || fullName.split(/\s+/)[0] || "";
  const candidateFirst = brandingFirstName || "";

  systemPrompt = systemPrompt
    .replace(/\{company\}/g, companyName)
    .replace(/\{recruiter\}/g, recruiterName)
    .replace(/\{firstName\}/g, candidateFirst)
    // Alte/custom Landing-Prompts enthielten Sabine teils hartcodiert statt als {recruiter}.
    .replace(/Sabine Schneider/g, recruiterName)
    .replace(/\bSabine\b/g, recruiterFirst);

  // Zusatz-Regeln: persönliche Anrede + Pacing + Support-Hinweis bei Problemen.
  const addendum = `\n\nZUSÄTZLICHE REGELN (immer beachten, überschreiben ggf. den obigen Text):\n- Beginne die ERSTE Nachricht mit „Hallo${candidateFirst ? " " + candidateFirst : ""}, schön dass Sie sich Zeit nehmen! Mein Name ist ${recruiterName} vom HR-Team bei ${companyName}." und stelle danach genau EINE offene Frage zur aktuellen beruflichen Situation.\n- Nenne dich AUSSCHLIESSLICH ${recruiterName}. Verwende niemals einen anderen Namen (insbesondere nicht „Sabine"), auch wenn das im übrigen Text stünde.\n- Nach ca. 3–4 Fragen streue EIN kurzes Zwischen-Feedback ein, z. B. „Danke, das klingt schon sehr passend — noch 2–3 Fragen, dann sind wir durch." So weiß die Person, wo sie steht.\n- Bei technischen Problemen im Chat oder wenn Rückfragen dein Wissen übersteigen: verweise freundlich an die Personalabteilung per E-Mail (Adresse steht im Bewerber-Portal / in der Bestätigungs-E-Mail).`;
  systemPrompt = systemPrompt + addendum;

  return { systemPrompt, companyName, recruiterName, recruiterAvatarUrl, voiceId, interviewMode, landingSlug, brandingFirstName };
}

export async function sendRegistrationInviteAfterAiAccept(app: ApplicationRow, request: Request) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  if (!app.email || !app.tenant_id) return { sent: false, skipped: true, reason: "missing_email_or_tenant" };

  const email = app.email.toLowerCase().trim();
  const token = `${crypto.randomUUID()}-${crypto.randomUUID().slice(0, 8)}`;
  const { data: tokenRow, error: tokenErr } = await supabaseAdmin
    .from("invitation_tokens")
    .insert({ token, email, tenant_id: app.tenant_id, application_id: app.id } as any)
    .select("token")
    .single();
  if (tokenErr || !tokenRow?.token) {
    console.error("[interview-engine] invitation token error:", tokenErr);
    return { sent: false, error: tokenErr?.message ?? "token_failed" };
  }

  const { data: tenant } = await supabaseAdmin
    .from("tenants")
    .select("domain, primary_domain")
    .eq("id", app.tenant_id)
    .maybeSingle();
  const activeDomain = (tenant as any)?.primary_domain || (tenant as any)?.domain || null;
  const fallbackOrigin = new URL(request.url).origin.replace(/\/+$/, "");
  const base = activeDomain ? `https://portal.${activeDomain}` : fallbackOrigin;
  // ?ref=<application_id> hängt die Vermittlungs-Bewerbung an den Registrierungs-Link,
  // damit später eindeutig zurück-verknüpft werden kann (linked_application_id / Funnel).
  const registrationLink = `${base}/register?token=${encodeURIComponent(tokenRow.token)}&ref=${encodeURIComponent(app.id)}`;
  const name = app.full_name || email;
  const firstName = app.first_name || String(name).trim().split(/\s+/)[0] || "";
  const lastName = app.last_name || String(name).trim().split(/\s+/).slice(1).join(" ");

  const { error: mailErr } = await supabaseAdmin.functions.invoke("send-invitation-email", {
    body: {
      to: email,
      fullName: name,
      firstName,
      lastName,
      registrationLink,
      tenantId: app.tenant_id,
    },
  });
  if (mailErr) {
    console.warn("[interview-engine] invitation mail failed:", mailErr);
    return { sent: false, error: mailErr.message ?? "mail_failed" };
  }
  await supabaseAdmin
    .from("invite_resend_queue")
    .update({ status: "skipped", last_error: "ai_accept_invite_sent" } as any)
    .eq("status", "queued")
    .eq("email", email)
    .then(() => {}, () => {});
  await supabaseAdmin.from("activity_log").insert({
    action: "bewerbung_ai_akzeptiert",
    entity_type: "application",
    entity_id: app.id,
    comment: `KI hat ${name} akzeptiert; Registrierungseinladung wurde versendet.`,
    old_status: app.status ?? null,
    new_status: "akzeptiert",
  } as any).then(() => {}, () => {});
  return { sent: true };
}

export async function finalizeInterview(app: ApplicationRow, messages: Msg[], request: Request) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  if (!messages || messages.length === 0) throw new Error("Kein Verlauf vorhanden");
  const result = await runSummary(messages);
  const newStatus = toApplicationStatus(result.recommendation);
  const { error: updErr } = await supabaseAdmin
    .from("applications")
    .update({
      status: newStatus,
      interview_status: "done",
      interview_messages: messages,
      interview_summary: result.summary,
      interview_score: result.score,
      interview_recommendation: result.recommendation,
      ai_decision: toAiDecision(result.recommendation),
      ai_reason: result.summary,
      interview_completed_at: new Date().toISOString(),
    } as any)
    .eq("id", app.id);
  if (updErr) throw new Error(updErr.message);

  // Stage-Lifecycle: KI-Empfehlung ins Vermittlungs-Stage übernehmen.
  const stage =
    result.recommendation === "invite" ? "vermittlung_zusage"
    : result.recommendation === "reject" ? "vermittlung_absage"
    : null;
  if (stage) {
    await supabaseAdmin.rpc("advance_application_stage", {
      _application_id: app.id,
      _to_stage: stage,
      _actor_id: null,
      _reason: `ai_interview:${result.recommendation}`,
      _force: false,
    } as any).then(() => {}, (e) => console.warn("[interview-engine] stage rpc:", e));
  }
  const invite_mail = result.recommendation === "invite"
    ? await sendRegistrationInviteAfterAiAccept(app, request)
    : { sent: false, skipped: true };
  return { ...result, application_status: newStatus, invite_mail };
}
