// Öffentlicher Support-Chat („KI Chat" im FloatingChat) — non-streaming.
// POST /api/public/ai-chat  { messages: [{role, content}] }
// Antwort: { content: string }
//
// Nutzt dieselben AI-Credentials wie das Interview (apinet.cloud → Gemini
// oder direkt Google Gemini). Non-streaming, um Cloudflare-524-Timeouts
// zu vermeiden.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const Input = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        content: z.string().max(6000),
      }),
    )
    .min(1)
    .max(40),
});

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const APINET_URL = "https://apinet.cloud/v1/chat/completions";
const DEFAULT_MODEL = "gemini-2.5-flash";

const SYSTEM_PROMPT = `Du bist der freundliche Support-Assistent im Mitarbeiter-Portal.
- Antworte kurz, klar, auf Deutsch, per „Du".
- Wenn du eine Frage nicht sicher beantworten kannst oder es um Verträge, Bezahlung, Krankmeldung, Kündigung oder persönliche Anliegen geht, beende deine Antwort mit dem Marker [ESCALATE] und weise darauf hin, dass der Teamleiter sich meldet.
- Keine langen Aufzählungen, maximal 4 Sätze.`;

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

async function loadCreds() {
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
      provider: "apinet" as const,
    };
  }
  if (geminiKey) {
    return {
      apiKey: geminiKey,
      model: (data as any)?.gemini_model?.trim() || DEFAULT_MODEL,
      url: GEMINI_URL,
      provider: "gemini" as const,
    };
  }
  throw new Error("Kein AI-API-Key gesetzt (Admin → KI-Assistent).");
}

async function callAi(messages: Array<{ role: string; content: string }>) {
  const { apiKey, model, url, provider } = await loadCreds();
  const isApinetNativeGemini = provider === "apinet" && /^gemini-/i.test(model);

  if (isApinetNativeGemini) {
    const systemMsgs = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));
    if (contents.length === 0) contents.push({ role: "user", parts: [{ text: "Hallo" }] });
    const nativeUrl = `https://apinet.cloud/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const body: any = { contents };
    if (systemMsgs) body.system_instruction = { parts: [{ text: systemMsgs }] };
    const res = await fetch(nativeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`apinet-gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as any;
    const parts = data?.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts) ? parts.map((p: any) => p?.text ?? "").join("") : "";
    if (!text) throw new Error("Leere AI-Antwort");
    return text;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages }),
  });
  if (!res.ok) throw new Error(`${provider} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as any;
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content) throw new Error("Leere AI-Antwort");
  return content;
}

export const Route = createFileRoute("/api/public/ai-chat")({
  server: {
    handlers: {
      OPTIONS: () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        try {
          const parsed = Input.safeParse(await request.json().catch(() => ({})));
          if (!parsed.success) return jsonRes({ error: "invalid_body" }, 400);
          const msgs = [
            { role: "system", content: SYSTEM_PROMPT },
            ...parsed.data.messages,
          ];
          const content = await callAi(msgs);
          return jsonRes({ content });
        } catch (e: any) {
          return jsonRes({ error: e?.message ?? "internal_error" }, 500);
        }
      },
    },
  },
});
