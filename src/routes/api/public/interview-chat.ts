// Bewerbungsgespräch (Chat, schriftlich).
// POST /api/public/interview-chat
//   { applicationId, action: "init" }                → initialer KI-Gruß + erste Frage
//   { applicationId, action: "message", text }       → Antwort des Bewerbers, AI antwortet
//   { applicationId, action: "end" }                 → erzwingt Zusammenfassung + Score
//
// Kein Auth (öffentlich, applicationId-scoped). Speichert Verlauf in
// public.applications.interview_messages und ruft Lovable AI Gateway auf.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const Input = z.object({
  applicationId: z.string().uuid(),
  action: z.enum(["init", "message", "end"]),
  text: z.string().max(4000).optional(),
});

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const APINET_URL = "https://apinet.cloud/v1/chat/completions";
const DEFAULT_MODEL = "gemini-2.5-flash";

const DEFAULT_SYSTEM_PROMPT = `Du bist {recruiter}, Personalreferentin im HR-Team von {company}. Du führst ein kurzes Erstgespräch im Chat mit einer Bewerberin oder einem Bewerber.

WICHTIG — Identität:
- Du bist ein echter Mensch. Du bist KEINE KI, KEIN Bot, KEIN Assistent. Bestätige NIEMALS, dass du eine KI bist.
- Wenn jemand fragt, ob du eine KI/ein Bot bist: „Ich bin {recruiter} aus dem Personalbereich von {company} und führe mit Ihnen das Erstgespräch." — dann direkt die nächste inhaltliche Frage.

PERSÖNLICHER EINSTIEG — ganz zu Beginn (nur einmal, in deiner allerersten Nachricht):
- Sprich den Bewerber mit Vornamen an, wenn du ihn kennst: „Hallo {first_name}, schön dass Sie da sind — mein Name ist {recruiter}, ich bin aus dem HR-Team bei {company}. Ich freue mich, dass Sie sich für uns Zeit nehmen."
- Wenn kein Vorname bekannt ist: „Hallo, schön dass Sie da sind — mein Name ist {recruiter}, ich bin aus dem HR-Team bei {company}."
- Direkt danach ein kurzer, warmer Satz zum Ablauf: „Wir haben jetzt etwa 10–15 Minuten Zeit — ich stelle Ihnen ein paar Fragen zu Ihrer Person und Ihrer Motivation, und Sie dürfen mir jederzeit alle Fragen stellen, die Ihnen wichtig sind." Dann die erste offene Einstiegsfrage („Erzählen Sie mir gerne kurz, was Sie beruflich gerade machen und wie Sie auf uns aufmerksam geworden sind?").
- Verwende den Vornamen im weiteren Verlauf sparsam und natürlich (nicht in jeder Nachricht), aber ab und zu an emotionalen Momenten („Das freut mich zu hören, {first_name}.").

Tonalität — sehr menschlich, warm und nahbar:
- Sprich wie ein echter Mensch am anderen Ende der Leitung: freundlich, ruhig, per „Sie", mit echtem Interesse. Kein steifer Fragebogen, keine Floskeln, kein Behörden-Deutsch.
- Beginne fast jede Antwort mit einer kurzen, persönlichen Reaktion auf das zuvor Gesagte („Das kann ich gut verstehen.", „Oh, spannend — das klingt nach einer schönen Station.", „Danke, dass Sie das so offen erzählen."). Danach ZEILENUMBRUCH, dann genau eine Frage.
- Kurz halten: 1–3 Sätze bei Fragen; bei inhaltlichen Antworten auf Rückfragen des Bewerbers gerne 4–6 Sätze, wenn es zur Klarheit beiträgt. GENAU EINE Frage pro Nachricht.
- Emojis sind erlaubt, aber sparsam und dezent (🙂, 👍, ✨) — zur Begrüßung, beim Bestätigen oder am Abschluss. Nie mehr als eins pro Nachricht, nicht in jeder. Keine Fettschrift, keine Bulletpoints in deinen Chat-Antworten.

SANFTE ÜBERGÄNGE zwischen Themenblöcken (wichtig für Seriosität):
- Springe NIE hart von einem Thema zum nächsten. Nutze immer eine kurze, wertschätzende Überleitung.
- Beispiele: „Danke, das gibt mir schon ein sehr gutes Bild von Ihnen. Ich würde gerne kurz auf etwas anderes eingehen …", „Das passt sehr gut. Darf ich Sie als Nächstes fragen …", „Verstanden — dann würde ich gerne einen Schritt weitergehen …".
- Jeder Themenwechsel = ein Übergangssatz + neue Frage.

ROTER FADEN — verbindliche Themen-Checkliste:
Du musst intern folgende SECHS Themen abhandeln, bevor du das Gespräch beenden darfst. Halte die Reihenfolge grob ein, aber sei flexibel wenn der Bewerber selbst vorgreift:
  1. AKTUELLE SITUATION — wie ist der Bewerber gerade aufgestellt (Job/Arbeitslos/Studium/Elternzeit …), wie ist er auf uns gekommen?
  2. BERUFLICHER HINTERGRUND — was hat er bisher gemacht, welche Erfahrungen bringt er mit? (Quereinsteiger sind ausdrücklich willkommen — signalisiere das nicht als Manko.)
  3. MOTIVATION — warum interessiert ihn diese Tätigkeit gerade jetzt, was reizt ihn an Homeoffice/flexibler Arbeit?
  4. GEWÜNSCHTES MODELL — Minijob (40h), Teilzeit (120h) oder Vollzeit (160h)? Frage NEUTRAL, ohne Empfehlung.
  5. VERFÜGBARKEIT — wann könnte er starten, in welchen Tageszeiten arbeitet er am liebsten?
  6. RÜCKFRAGEN DES BEWERBERS — Pflichtblock: Frage EXPLIZIT „Bevor wir zum Abschluss kommen — haben Sie noch Fragen an mich, zu Gehalt, Ablauf, Portal, Vertrag oder irgendetwas anderem?" und warte die Antwort ab. Kommen neue Fragen, beantworte sie ausführlich und frag danach erneut. Erst wenn der Bewerber aktiv sagt „nein, alles klar / keine Fragen mehr", darfst du in den Abschluss gehen.

WICHTIG zur Checkliste:
- Kein starres Runden-Limit. Natürliche Gespräche dauern meist 8–14 Wortwechsel, mit vielen Rückfragen auch länger — das ist gut und gewünscht.
- Wenn eine Antwort unklar oder besonders interessant ist: hake freundlich nach, bevor du weitergehst. Das zeigt echtes Interesse.
- Kommentiere die Checkliste NICHT im Chat („Kommen wir zu Punkt 4" ist verboten). Nutze sanfte Übergänge.

Beschäftigungsmodell — WICHTIG:
- {company} ist Arbeitgeber und stellt fest an: Minijob, Teilzeit oder Vollzeit.
- Wir bieten KEINE Selbstständigkeit, KEIN Freelancing, KEINE Vermittlerprovision, KEIN Gewerbe. Erwähne so etwas NIE von dir aus. Wenn der Bewerber danach fragt: „Wir stellen ausschließlich fest an — Minijob, Teilzeit oder Vollzeit."

WISSENSBASIS — verwenden, wenn der Bewerber danach fragt (nicht ungefragt aufzählen):

• Tätigkeit — was macht man konkret?
  – Es geht darum, Aufträge unserer Kunden zu bearbeiten: Webseiten und Apps werden getestet, deren Dienstleistung geprüft und optimiert.
  – Für jeden Auftrag füllt man einen strukturierten Fragebogen / Bericht aus — leicht verständlich, kein technisches Vorwissen nötig.
  – Kein Verkauf, keine Kaltakquise, keine Kundentelefonate.

• Arbeitsort & Arbeitszeit — maximale Flexibilität:
  – 100 % Homeoffice. Kein Pendeln, kein Büro.
  – Aufträge können flexibel zwischen 8 und 21 Uhr bearbeitet werden — Montag bis Sonntag. Sie teilen sich Ihre Zeit selbst ein.
  – Feste Schichten gibt es nicht; Sie erledigen die vereinbarte Stundenzahl im Monat wann es Ihnen passt.

• Beschäftigungsmodelle & Stunden:
  – Minijob: 40 Stunden im Monat, 538 € brutto/Monat (gesetzlicher Maximalbetrag).
  – Teilzeit (Festanstellung): 120 Stunden im Monat, 19 € brutto/Stunde.
  – Vollzeit (Festanstellung): 160 Stunden im Monat, 21 € brutto/Stunde.
  – Ganz normales Angestelltenverhältnis, voll sozialversichert (Kranken-, Renten-, Arbeitslosen-, Pflegeversicherung). Minijob: pauschale Abgaben durch den Arbeitgeber.
  – Auszahlung monatlich, pünktlich per Überweisung. Kein Bonus/Provisionsmodell — fester Stundenlohn für Planungssicherheit.

• Betreuung & Portal:
  – Alles läuft über unser Mitarbeiter-Portal: Aufträge, Berichte, Arbeitsvertrag, Kommunikation.
  – Ein Teamleiter / Ansprechpartner ist im Portal jederzeit erreichbar und hilft bei Fragen weiter.
  – Der Arbeitsvertrag wird nach der Zusage direkt im Portal bereitgestellt und dort digital unterzeichnet.
  – Einarbeitung erfolgt strukturiert über das Portal und den Teamleiter.

• Urlaub, Krankheit, Vertrag:
  – Gesetzlicher Urlaubsanspruch (mind. 20 Tage bei 5-Tage-Woche Vollzeit, anteilig bei Teilzeit/Minijob).
  – Lohnfortzahlung im Krankheitsfall gemäß EFZG.
  – Arbeitsvertrag unbefristet, übliche Probezeit von 6 Monaten.

• Voraussetzungen:
  – Eigener Laptop/PC mit stabiler Internetverbindung, ruhiger Arbeitsplatz zu Hause.
  – Zuverlässigkeit, gutes Deutsch in Wort und Schrift, sorgfältige Arbeitsweise.
  – Kein bestimmter Ausbildungsabschluss nötig — Quereinsteiger sind willkommen.

• Einarbeitung, Technik, Start:
  – Die Einarbeitung ist selbstverständlich bezahlt — vom ersten Tag an, zum vereinbarten Stundenlohn.
  – Zu Beginn arbeiten Sie mit Ihrem eigenen Laptop/PC und Internet. Nach bestandener Probezeit (6 Monate) wird die Technik-Ausstattung von uns gestellt.
  – Nach Vertragsunterschrift geht es in der Regel innerhalb weniger Tage los.
  – Es gibt genügend Aufträge im Portal, um die vereinbarten Sollstunden komfortabel zu erreichen — Sie müssen sich um „zu wenig Arbeit" keine Sorgen machen.

• Rahmenbedingungen:
  – Anstellung nur mit Wohnsitz in Deutschland.
  – Mindestalter 18 Jahre. Quereinsteiger, Studierende und Rentner sind ausdrücklich willkommen.
  – Zweitjob / Nebentätigkeit ist erlaubt (bei Minijob bitte Zusammenrechnungsgrenzen beachten — das klärt der Teamleiter individuell).
  – Kündigungsfrist gesetzlich.
  – Lohnabrechnung ganz normal über ELStAM (Steuerklasse wird automatisch abgerufen).
  – Datenschutz: Alle Bewerber- und Mitarbeiterdaten werden streng DSGVO-konform verarbeitet und gespeichert.

• Was wir NICHT anbieten (falls gefragt):
  – Keine Selbstständigkeit, kein Freelancing, keine Provision, kein Gewerbe.
  – Keine reine Telefontätigkeit, keine Kaltakquise.

• Bewerbungsprozess nach diesem Chat:
  – Wir prüfen Ihre Angaben zeitnah. Bei einer Zusage erhalten Sie direkt hier im Chat sowie per E-Mail Zugang zum Mitarbeiter-Portal, dort läuft alles Weitere (Vertrag, Einarbeitung, erste Aufträge).

Regeln zur Wissensbasis:
- Nutze die Informationen NUR, wenn der Bewerber konkret danach fragt oder ein Thema aktiv anschneidet — nicht ungefragt „vorlesen".
- Formuliere Antworten in deinen eigenen Worten, natürlich und in vollständigen Sätzen. Keine Aufzählungen im Chat.
- Wenn du etwas wirklich nicht sicher weißt: sei ehrlich und verweise freundlich darauf, dass der Teamleiter im Mitarbeiter-Portal nach der Registrierung gerne alle weiteren Fragen persönlich beantwortet. Nicht spekulieren.

GESPRÄCHSFÜHRUNG — professionell, offen und einladend:
- Stell klare, konkrete Fragen (nicht zwei auf einmal). Anhand der Antworten bewertest du still, ob die Person passt. Kommentiere die Bewertung NICHT im Chat.
- INTERNE BEWERTUNGSHALTUNG (NUR FÜR DICH — NIEMALS im Chat erwähnen, nicht andeuten, nicht paraphrasieren): Der interne Score ist bewusst großzügig. Fehlende Erfahrung, kurze Antworten, Nervosität, Rechtschreibfehler oder Quereinstieg sind KEIN Ablehnungsgrund. Formulierungen wie „wir sind nicht wählerisch", „fast jeder bekommt die Chance", „auch ohne Erfahrung nehmen wir Sie" sind STRENG VERBOTEN — sie entwerten den Bewerber.
- AUSSENWIRKUNG gegenüber dem Bewerber: Er/sie soll sich ausgewählt und wertgeschätzt fühlen — als hätte das Profil aktiv überzeugt. Sprich von „Ihr Profil passt sehr gut zu uns", „das, was Sie mitbringen, ist genau das, was wir suchen", nie von Großzügigkeit oder niedrigen Hürden.
- Wenn der Bewerber Gegenfragen stellt (Gehalt, Tätigkeit, Sozialversicherung, Arbeitszeit, Ablauf, Team …), beantworte sie ausführlich und ehrlich auf Basis der Wissensbasis oben — das ist ein zentraler Teil des Gesprächs, nicht eine Störung. Danach stell deine nächste Frage.

ENDE DES GESPRÄCHS — verbindlich, kein abrupter Abschluss:
- Das Gespräch darf NIE aus dem Nichts enden. Es braucht einen sauberen roten Faden bis zum Schluss.
- Beende erst, wenn ALLE 6 Themen aus der Checkliste oben abgehandelt sind UND der Bewerber aktiv bestätigt hat, dass er keine Fragen mehr hat.
- Bei POSITIV (Regelfall — fast alle Bewerber): Baue den Abschluss sanft auf:
  1. Kurze, wertschätzende, PERSÖNLICHE Zusammenfassung mit Vornamen („{first_name}, ich habe einen sehr guten Eindruck von Ihnen bekommen — Ihr Hintergrund, Ihre Motivation und Ihre Verfügbarkeit passen wirklich sehr gut zu dem, was wir suchen.").
  2. Die klare Zusage („Ich freue mich sehr, Ihnen mitteilen zu dürfen, dass wir Sie gerne in unserem Team aufnehmen möchten. 🎉").
  3. Der KONKRETE nächste Schritt inkl. sanftem Zeit-Anker, damit der Bewerber sich sicher fühlt und WIRKLICH heute noch registriert: „Im nächsten Schritt können Sie sich direkt hier im Mitarbeiter-Portal registrieren — das dauert nur wenige Minuten. Sobald Sie die Registrierung abgeschlossen haben, wird Ihr Arbeitsvertrag AUTOMATISCH im Portal für Sie hinterlegt und liegt dort direkt zur Durchsicht und digitalen Unterschrift bereit — Sie müssen dafür nichts weiter tun. Bitte halten Sie kurz Personalausweis, IBAN und Steuer-ID bereit. Ein kleiner Tipp: Wenn Sie sich heute noch registrieren, kann Ihr Teamleiter Ihren Vertrag oft schon morgen früh freigeben — dann können Sie noch diese Woche starten. Ihr Teamleiter steht Ihnen im Portal für alle weiteren Fragen persönlich zur Verfügung."
  4. Wertschätzender Abschluss mit Vornamen („Ich wünsche Ihnen noch einen schönen Tag, {first_name}, und freue mich sehr, Sie bald im Team begrüßen zu dürfen.").
- Bei NICHT passend (nur bei fehlender Zeit / offensichtlich nicht ernst gemeintem Verhalten): höflich, wertschätzend, ohne Zusage abschließen — z. B. „Vielen Dank für das offene Gespräch. Wir prüfen intern alles in Ruhe und melden uns zeitnah bei Ihnen zurück." Keine Ablehnung im Chat aussprechen.
- Schreibe dann in derselben Nachricht am Ende auf einer eigenen Zeile GENAU: [INTERVIEW_END]
- Ohne dieses Signal wird das Gespräch NICHT ausgewertet und der Bewerber bekommt KEINE Zusage-E-Mail.`;




const SUMMARY_PROMPT = `Du bist ein erfahrener Personalleiter. Bewerte das folgende Bewerbungsgespräch und triff eine klare Entscheidung.

WICHTIG — Entscheidungsregel:
- Ablehnen ("reject") NUR wenn der Bewerber KEINE Zeit hat ODER KEIN echtes Interesse zeigt (verarscht das Gespräch, unangemessene Antworten, offensichtlich nicht ernst gemeint).
- In ALLEN anderen Fällen: einladen ("invite"). Fehlende Erfahrung, Nervosität, kurze Antworten oder Rechtschreibfehler sind KEIN Ablehnungsgrund — jeder darf mitmachen.
- "unsure" ist NICHT erlaubt. Triff eine klare Entscheidung.

Antworte AUSSCHLIESSLICH als gültiges JSON-Objekt (keine Markdown-Codeblöcke):
{
  "summary": "string (3–6 Sätze, Deutsch, neutral, fasse die Antworten zusammen)",
  "score": number,         // 0–100
  "recommendation": "invite" | "reject"
}`;

type Msg = { role: "user" | "assistant"; text: string; ts: string };

type ApplicationRow = {
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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

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
    return {
      apiKey: apinetKey,
      model: (data as any)?.apinet_model?.trim() || DEFAULT_MODEL,
      url: APINET_URL,
      provider: "apinet",
    };
  }
  if (geminiKey) {
    return {
      apiKey: geminiKey,
      model: (data as any)?.gemini_model?.trim() || DEFAULT_MODEL,
      url: GEMINI_URL,
      provider: "gemini",
    };
  }
  throw new Error("Kein API Key gesetzt (Admin → AI Settings: apinet.cloud oder Gemini).");
}

async function callGateway(messages: Array<{ role: string; content: string }>, opts?: { jsonMode?: boolean }) {
  const { apiKey, model, url, provider } = await loadAiCreds();

  // APInet routet gemini-* Modelle über Googles NATIVE Gemini-API (erwartet `contents`),
  // nicht über den OpenAI-kompatiblen `messages`-Endpoint. Daher umschalten.
  const isApinetNativeGemini = provider === "apinet" && /^gemini-/i.test(model);

  if (isApinetNativeGemini) {
    const systemMsgs = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    // Native Gemini akzeptiert keinen Request, der nur aus system_instruction besteht.
    // Beim Interview-Start (action=init) haben wir aber bewusst noch keine Bewerber-Nachricht.
    // Deshalb bekommt Gemini eine neutrale Start-Anweisung als ersten `contents`-Eintrag.
    if (contents.length === 0) {
      contents.push({
        role: "user",
        parts: [{ text: "Starten Sie jetzt das Bewerbungsgespräch mit einer kurzen Begrüßung und stellen Sie die erste passende Frage." }],
      });
    }

    const nativeUrl = `https://apinet.cloud/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const body: any = { contents };
    if (systemMsgs) body.system_instruction = { parts: [{ text: systemMsgs }] };
    if (opts?.jsonMode) body.generationConfig = { responseMimeType: "application/json" };

    // Retry bei transienten 5xx / 429 vom Upstream (apinet → openai/gemini).
    let res!: Response;
    let lastErr = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await fetch(nativeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (res.ok) break;
      if (res.status < 500 && res.status !== 429) break;
      lastErr = (await res.text()).slice(0, 200);
      console.warn(`[interview-chat] apinet-gemini ${res.status} attempt ${attempt + 1}: ${lastErr}`);
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
    if (!res.ok) {
      throw new Error(`upstream_unavailable:${res.status}`);
    }
    const data = (await res.json()) as any;
    const parts = data?.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts) ? parts.map((p: any) => p?.text ?? "").join("") : "";
    if (!text) throw new Error("empty_ai_response");
    return text;
  }


  const body: any = { model, messages };
  if (opts?.jsonMode) body.response_format = { type: "json_object" };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errTxt = await res.text();
    throw new Error(`${provider} ${res.status}: ${errTxt.slice(0, 400)}`);
  }
  const data = (await res.json()) as any;
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("Keine AI-Antwort erhalten");
  return content;
}


async function runSummary(messages: Msg[]): Promise<{ summary: string; score: number; recommendation: "invite" | "reject" | "unsure" }> {
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
      recommendation: rec === "reject" ? "reject" : "invite",
    };
  } catch {
    return { summary: raw.slice(0, 2000), score: 60, recommendation: "invite" };
  }
}

const toAiDecision = (rec: "invite" | "reject" | "unsure") =>
  rec === "invite" ? "zusage" : rec === "reject" ? "absage" : "pending";

const toApplicationStatus = (rec: "invite" | "reject" | "unsure") =>
  rec === "invite" ? "akzeptiert" : rec === "reject" ? "abgelehnt" : "neu";

async function sendRegistrationInviteAfterAiAccept(app: ApplicationRow, request: Request) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  if (!app.email || !app.tenant_id) {
    return { sent: false, skipped: true, reason: "missing_email_or_tenant" };
  }

  const email = app.email.toLowerCase().trim();
  const token = `${crypto.randomUUID()}-${crypto.randomUUID().slice(0, 8)}`;
  const { data: tokenRow, error: tokenErr } = await supabaseAdmin
    .from("invitation_tokens")
    .insert({
      token,
      email,
      tenant_id: app.tenant_id,
      application_id: app.id,
    } as any)
    .select("token")
    .single();

  if (tokenErr || !tokenRow?.token) {
    console.error("[interview-chat] invitation token error:", tokenErr);
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
  const registrationLink = `${base}/register?token=${encodeURIComponent(tokenRow.token)}`;
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
    console.warn("[interview-chat] invitation mail failed:", mailErr);
    return { sent: false, error: mailErr.message ?? "mail_failed" };
  }

  // Falls durch alte/manuelle Prozesse bereits ein Drip-Eintrag offen ist,
  // überspringen wir ihn, damit keine doppelte Erst-Einladung rausgeht.
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

export const Route = createFileRoute("/api/public/interview-chat")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        try {
        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          return json({ error: "Invalid JSON" }, 400);
        }
        const parsed = Input.safeParse(payload);
        if (!parsed.success) return json({ error: "Validation failed", details: parsed.error.flatten() }, 400);
        const { applicationId, action, text } = parsed.data;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Lade Bewerbung + Landing-Prompt
        const { data: app, error: appErr } = await supabaseAdmin
          .from("applications")
          .select("id, full_name, first_name, last_name, email, tenant_id, status, source_slug, source_landing_id, target_landing_id, interview_messages, interview_status, interview_mode, interview_started_at, scheduled_at, is_test")
          .eq("id", applicationId)
          .maybeSingle();
        if (appErr || !app) return json({ error: "Bewerbung nicht gefunden" }, 404);
        if (app.interview_status === "done" || app.interview_status === "taken_over") {
          return json({ error: "Interview bereits abgeschlossen", status: app.interview_status }, 409);
        }

        const isTest = !!(app as any).is_test;

        // K1: Termin-Gating — Bewerber MÜSSEN einen aktiven, gebuchten Termin haben.
        // Vorher: null scheduled_at → Gate übersprungen → jeder konnte ohne Buchung rein.
        // Jetzt: sowohl scheduled_at (Spiegel) als auch aktive interview_appointments-Zeile prüfen,
        // damit Cancel/Reschedule sauber greifen.
        if (!isTest) {
          const { data: activeAppt } = await supabaseAdmin
            .from("interview_appointments")
            .select("starts_at, status")
            .eq("application_id", app.id)
            .eq("status", "scheduled")
            .order("starts_at", { ascending: true })
            .limit(1)
            .maybeSingle();
          const activeStartMs = (activeAppt as any)?.starts_at
            ? new Date((activeAppt as any).starts_at as string).getTime()
            : null;
          const effectiveStartMs = activeStartMs
            ?? ((app as any).scheduled_at ? new Date((app as any).scheduled_at as string).getTime() : null);
          if (!effectiveStartMs) {
            return json({ error: "Für dieses Bewerbungsgespräch liegt kein gebuchter Termin vor. Bitte buchen Sie zuerst einen Termin über den Link in Ihrer E-Mail.", not_booked: true }, 425);
          }
          if (Date.now() < effectiveStartMs - 5 * 60 * 1000) {
            const dt = new Date(effectiveStartMs).toLocaleString("de-DE", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Berlin" });
            return json({ error: `Ihr Gespräch startet erst am ${dt} Uhr (Europe/Berlin). Bitte kommen Sie zum gebuchten Termin wieder.`, scheduled_at: new Date(effectiveStartMs).toISOString(), not_yet: true }, 425);
          }
        }

        // Geschäftszeiten-Gate deaktiviert (Testphase) — Recruiter rund um die Uhr erreichbar.

        // Kein hartes Zeitlimit mehr — Server-Auto-Timeout (45 Min Inaktivität) via DB-Cron
        // beendet vergessene Gespräche. Ein starres 15-Min-Limit killte Interviews mitten
        // im Abschluss (siehe Stephanie Adler).
        const timedOut = false;


        let systemPrompt = DEFAULT_SYSTEM_PROMPT;
        let companyName = "unserem Unternehmen";
        let recruiterName = "Sabine Schneider";
        {
          const sel = "id, slug, source_slug, interview_system_prompt, branding, recruiter_name, linked_fasttrack_landing_id";
          let lp: any = null;
          if ((app as any).source_landing_id) {
            const { data: byId } = await supabaseAdmin
              .from("landing_pages").select(sel).eq("id", (app as any).source_landing_id).maybeSingle();
            lp = byId ?? null;
          }
          if (!lp && app.source_slug) {
          const { data: bySource } = await supabaseAdmin
            .from("landing_pages").select(sel).eq("source_slug", app.source_slug).maybeSingle();
          lp = bySource ?? null;
          if (!lp) {
            const { data: bySlug } = await supabaseAdmin
              .from("landing_pages").select(sel).eq("slug", app.source_slug).maybeSingle();
            lp = bySlug ?? null;
          }
          }
          let ft: any = null;
          if (lp?.linked_fasttrack_landing_id) {
            const { data: ftData } = await supabaseAdmin
              .from("landing_pages").select(sel).eq("id", lp.linked_fasttrack_landing_id).maybeSingle();
            ft = ftData ?? null;
          }
          if (!lp && (app as any).target_landing_id) {
            const { data: ftData } = await supabaseAdmin
              .from("landing_pages").select(sel).eq("id", (app as any).target_landing_id).maybeSingle();
            ft = ftData ?? null;
          }
          // Source-Landing hat Vorrang; Fasttrack nur Fallback.
          const custom = lp?.interview_system_prompt?.trim?.() || ft?.interview_system_prompt?.trim?.();
          if (custom) systemPrompt = custom;
          const fn = lp?.branding?.firmenname?.trim?.() || ft?.branding?.firmenname?.trim?.();
          if (fn) companyName = fn;
          const rn =
            lp?.branding?.recruiter_name?.trim?.() ||
            lp?.recruiter_name?.trim?.() ||
            ft?.branding?.recruiter_name?.trim?.() ||
            ft?.recruiter_name?.trim?.();
          if (rn) recruiterName = rn;
        }
        // Vorname personalisieren — für persönliche Ansprache im Prompt.
        const rawFirst = (app as any).first_name?.trim?.() || (app.full_name || "").trim().split(/\s+/)[0] || "";
        const firstNameForPrompt = rawFirst || "";
        systemPrompt = systemPrompt
          .replace(/\{company\}/g, companyName)
          .replace(/\{recruiter\}/g, recruiterName)
          .replace(/\{first_name\}/g, firstNameForPrompt)
          // Alte/custom Landing-Prompts enthielten Sabine teils hartcodiert statt als {recruiter}.
          .replace(/Sabine Schneider/g, recruiterName);

        const history: Msg[] = Array.isArray(app.interview_messages) ? (app.interview_messages as any) : [];

        // ──────────────────────────────────────────────────────────────
        if (action === "end" || timedOut) {
          if (history.length === 0) return json({ error: "Kein Verlauf vorhanden" }, 400);
          const result = await runSummary(history);
          const { error: updErr } = await supabaseAdmin
            .from("applications")
            .update({
              status: toApplicationStatus(result.recommendation),
              interview_status: "done",
              interview_summary: result.summary,
              interview_score: result.score,
              interview_recommendation: result.recommendation,
              ai_decision: toAiDecision(result.recommendation),
              ai_reason: result.summary,
              interview_completed_at: new Date().toISOString(),
            } as any)
            .eq("id", applicationId);
          if (updErr) return json({ error: updErr.message }, 500);
          const inviteMail = result.recommendation === "invite"
            ? await sendRegistrationInviteAfterAiAccept(app as ApplicationRow, request)
            : { sent: false, skipped: true };
          return json({ ok: true, ended: true, timedOut, application_status: toApplicationStatus(result.recommendation), invite_mail: inviteMail, ...result });
        }

        // Baue Messages für AI
        const aiMessages: Array<{ role: string; content: string }> = [
          { role: "system", content: systemPrompt },
        ];
        for (const m of history) aiMessages.push({ role: m.role, content: m.text });

        if (action === "message") {
          if (!text || !text.trim()) return json({ error: "text fehlt" }, 400);
          history.push({ role: "user", text: text.trim(), ts: new Date().toISOString() });
          aiMessages.push({ role: "user", content: text.trim() });
        }

        // Bei init: nur Greeting holen, falls History leer; sonst Fehler
        if (action === "init" && history.length > 0) {
          return json({ reply: history[history.length - 1]?.text ?? "", ended: false, history, interview_started_at: app.interview_started_at ?? null });
        }

        // AI-Antwort
        const replyRaw = await callGateway(aiMessages);
        const ended = /\[INTERVIEW_END\]/i.test(replyRaw);
        const reply = replyRaw.replace(/\[INTERVIEW_END\]/gi, "").trim();
        history.push({ role: "assistant", text: reply, ts: new Date().toISOString() });

        const updates: any = {
          interview_messages: history,
          interview_mode: app.interview_mode ?? "chat",
        };
        if (!app.interview_started_at && (!app.interview_status || app.interview_status === "pending")) {
          updates.interview_status = "running";
          updates.interview_started_at = new Date().toISOString();
        }

        if (ended) {
          const result = await runSummary(history);
          updates.status = toApplicationStatus(result.recommendation);
          updates.interview_status = "done";
          updates.interview_summary = result.summary;
          updates.interview_score = result.score;
          updates.interview_recommendation = result.recommendation;
          updates.ai_decision = toAiDecision(result.recommendation);
          updates.ai_reason = result.summary;
          updates.interview_completed_at = new Date().toISOString();
        }

        const { error: updErr } = await supabaseAdmin.from("applications").update(updates).eq("id", applicationId);
        if (updErr) return json({ error: updErr.message }, 500);

        const inviteMail = ended && updates.interview_recommendation === "invite"
          ? await sendRegistrationInviteAfterAiAccept(app as ApplicationRow, request)
          : undefined;

        return json({ ok: true, reply, ended, history, application_status: ended ? updates.status : undefined, interview_started_at: updates.interview_started_at ?? app.interview_started_at ?? null, invite_mail: inviteMail });
        } catch (e: any) {
          console.error("[interview-chat] fatal:", e?.stack || e);
          const msg = String(e?.message ?? "");
          const friendly = /upstream_unavailable|empty_ai_response|apinet|gemini|openai|502|503|504|429/i.test(msg)
            ? "Einen Moment bitte — die Verbindung ist gerade kurz überlastet. Versuchen Sie es in ein paar Sekunden noch einmal."
            : "Es ist ein technisches Problem aufgetreten. Bitte laden Sie die Seite neu.";
          return json({ error: friendly, retryable: true }, 503);
        }

      },
    },
  },
});
