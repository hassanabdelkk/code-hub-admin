// Public endpoint: Heartbeat von Landing-Servern.
// Server pingt alle 60s mit { token, landing_count, agent_version, renderer_healthy }.
// Antwort: { ok: true, server_id }. Falls Token unbekannt → 401.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Body = z.object({
  token: z.string().min(20).max(200),
  landing_count: z.number().int().min(0).max(100_000).optional(),
  agent_version: z.string().max(40).optional(),
  renderer_healthy: z.boolean().optional(),
  resync_done: z.boolean().optional(),
});


export const Route = createFileRoute("/api/public/landing-server-heartbeat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const raw = await request.text();
          const body = Body.parse(JSON.parse(raw));
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const { data: server, error } = await supabaseAdmin
            .from("landing_servers")
            .select("id, status, themes_resync_requested_at, themes_resync_done_at")
            .eq("bootstrap_token", body.token)
            .maybeSingle();
          if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
          if (!server) return Response.json({ ok: false, error: "unknown token" }, { status: 401 });

          const patch: any = {
            last_heartbeat_at: new Date().toISOString(),
            status: server.status === "paused" ? "paused" : body.renderer_healthy === false ? "offline" : "online",
          };
          if (body.agent_version) patch.agent_version = body.agent_version;
          // landing_count autoritativ aus der DB zählen (Agent kennt die DB-Landings nicht)
          const { count: liveCount } = await supabaseAdmin
            .from("landing_pages")
            .select("id", { count: "exact", head: true })
            .eq("server_id", server.id);
          patch.landing_count = liveCount ?? 0;

          // Resync-Kommando: angefragt UND noch nicht erledigt?
          const reqAt = server.themes_resync_requested_at ? new Date(server.themes_resync_requested_at).getTime() : 0;
          const doneAt = server.themes_resync_done_at ? new Date(server.themes_resync_done_at).getTime() : 0;
          const resyncNeeded = body.resync_done === true ? false : reqAt > 0 && reqAt > doneAt;

          // Wenn der Agent meldet, dass er den Resync abgeschlossen hat, Zeitstempel setzen
          if ((body as any).resync_done === true) {
            patch.themes_resync_done_at = new Date().toISOString();
          }

          await supabaseAdmin.from("landing_servers").update(patch).eq("id", server.id);
          return Response.json({ ok: true, server_id: server.id, resync_needed: resyncNeeded });

        } catch (e: any) {
          return Response.json({ ok: false, error: e.message }, { status: 400 });
        }
      },
    },
  },
});
