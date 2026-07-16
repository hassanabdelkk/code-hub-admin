// Öffentliche API für das KI-Telefon-Bewerbungsgespräch (ElevenLabs).
// Drei Aktionen:
//   action="token"  → Bewerbung laden, Branding + System-Prompt + Voice-ID auflösen,
//                     ElevenLabs Conversation Token erzeugen, application markieren als running.
//   action="save"   → einzelne Transkript-Nachricht anhängen (role + text).
//   action="end"    → Verlauf zusammenfassen, Status + Einladung wie beim Chat.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  finalizeInterview,
  loadInterviewContext,
  type ApplicationRow,
  type Msg,
} from "@/lib/interview-engine.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const Input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("token"), applicationId: z.string().uuid() }),
  z.object({
    action: z.literal("save"),
    applicationId: z.string().uuid(),
    role: z.enum(["user", "assistant"]),
    text: z.string().max(8000),
  }),
  z.object({ action: z.literal("end"), applicationId: z.string().uuid() }),
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

async function loadElevenLabsCreds() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("system_settings")
    .select("elevenlabs_api_key, elevenlabs_agent_id")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new Error(`system_settings: ${error.message}`);
  const apiKey = (data as any)?.elevenlabs_api_key?.trim?.();
  const agentId = (data as any)?.elevenlabs_agent_id?.trim?.();
  if (!apiKey) throw new Error("ElevenLabs API Key fehlt (Admin → AI Settings).");
  if (!agentId) throw new Error("ElevenLabs Agent ID fehlt (Admin → AI Settings).");
  return { apiKey, agentId };
}

async function createElevenLabsConversationToken(agentId: string, apiKey: string) {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${encodeURIComponent(agentId)}`,
    { headers: { "xi-api-key": apiKey } },
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`ElevenLabs ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = (await res.json()) as any;
  if (!data?.token) throw new Error("ElevenLabs: kein Token in Antwort");
  return String(data.token);
}

export const Route = createFileRoute("/api/public/interview-voice")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        try {
          let payload: unknown;
          try { payload = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
          const parsed = Input.safeParse(payload);
          if (!parsed.success) return json({ error: "Validation failed", details: parsed.error.flatten() }, 400);

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const { data: appRaw, error: appErr } = await supabaseAdmin
            .from("applications")
            .select("id, full_name, first_name, last_name, email, tenant_id, status, source_slug, source_landing_id, target_landing_id, interview_messages, interview_status, interview_mode, interview_started_at")
            .eq("id", parsed.data.applicationId)
            .maybeSingle();
          if (appErr || !appRaw) return json({ error: "Bewerbung nicht gefunden" }, 404);
          const app = appRaw as ApplicationRow;

          if (parsed.data.action === "token") {
            if (app.interview_status === "done" || app.interview_status === "taken_over") {
              return json({ error: "Interview bereits abgeschlossen", status: app.interview_status }, 409);
            }
            const { apiKey, agentId } = await loadElevenLabsCreds();
            const ctx = await loadInterviewContext(app);
            const token = await createElevenLabsConversationToken(agentId, apiKey);

            const updates: any = { interview_mode: "voice" };
            if (!app.interview_started_at) {
              updates.interview_started_at = new Date().toISOString();
              updates.interview_status = "running";
            }
            await supabaseAdmin.from("applications").update(updates).eq("id", app.id);

            const firstName = ctx.brandingFirstName;
            const firstMessage = `Guten Tag${firstName ? ` ${firstName}` : ""}, mein Name ist ${ctx.recruiterName}, ich bin im Personalbereich bei ${ctx.companyName}. Schön, dass Sie sich Zeit für unser kurzes Erstgespräch nehmen. Erzählen Sie mir doch zum Einstieg kurz etwas zu Ihrer aktuellen beruflichen Situation.`;

            return json({
              ok: true,
              token,
              agentId,
              voiceId: ctx.voiceId,
              systemPrompt: ctx.systemPrompt,
              firstMessage,
              companyName: ctx.companyName,
              recruiterName: ctx.recruiterName,
              recruiterAvatarUrl: ctx.recruiterAvatarUrl,
              applicantFirstName: firstName,
            });
          }

          if (parsed.data.action === "save") {
            const history: Msg[] = Array.isArray(app.interview_messages) ? (app.interview_messages as any) : [];
            const text = parsed.data.text.trim();
            if (!text) return json({ ok: true, skipped: true });
            history.push({ role: parsed.data.role, text, ts: new Date().toISOString() });
            const updates: any = { interview_messages: history, interview_mode: "voice" };
            if (!app.interview_started_at) {
              updates.interview_started_at = new Date().toISOString();
              updates.interview_status = "running";
            }
            const { error: updErr } = await supabaseAdmin.from("applications").update(updates).eq("id", app.id);
            if (updErr) return json({ error: updErr.message }, 500);
            return json({ ok: true, count: history.length });
          }

          if (parsed.data.action === "end") {
            const history: Msg[] = Array.isArray(app.interview_messages) ? (app.interview_messages as any) : [];
            if (history.length === 0) {
              await supabaseAdmin
                .from("applications")
                .update({ interview_status: "done", interview_completed_at: new Date().toISOString() } as any)
                .eq("id", app.id);
              return json({ ok: true, ended: true, empty: true });
            }
            const result = await finalizeInterview(app, history, request);
            return json({ ok: true, ended: true, ...result });
          }

          return json({ error: "Unknown action" }, 400);
        } catch (e: any) {
          console.error("[interview-voice] fatal:", e?.stack || e);
          return json({ error: e?.message ? `Serverfehler: ${e.message}` : "Unbekannter Serverfehler" }, 500);
        }
      },
    },
  },
});
