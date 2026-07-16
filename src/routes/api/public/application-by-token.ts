// Public endpoint: Magic-Token → Application-Lookup.
// Wird von /bewerbung?token=... aufgerufen, um nach einer Calendly-Buchung
// den Bewerber direkt ins KI-Interview zu leiten.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

const Schema = z.object({ token: z.string().trim().min(8).max(128) });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

export const Route = createFileRoute("/api/public/application-by-token")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        let payload: unknown;
        try { payload = await request.json(); } catch {
          return json({ ok: false, error: "Invalid JSON" }, 400);
        }
        const parsed = Schema.safeParse(payload);
        if (!parsed.success) return json({ ok: false, error: "Invalid token" }, 400);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("applications")
          .select("id, tenant_id, status, full_name, email, source_slug, source_landing_id, target_landing_id")
          .eq("magic_token", parsed.data.token)
          .limit(1)
          .maybeSingle();
        if (error) {
          console.error("[application-by-token] lookup error:", error);
          return json({ ok: false, error: "Server error" }, 500);
        }
        const row = data as any;
        if (!row) return json({ ok: false, error: "not_found" }, 404);

        let landingSlug: string | null = null;
        let interviewMode: "chat" | "voice" | "both" = "chat";
        const landingSelect = "id, slug, source_slug, linked_fasttrack_landing_id, interview_mode";
        const loadLandingById = async (id?: string | null) => {
          if (!id) return null;
          const { data } = await supabaseAdmin.from("landing_pages").select(landingSelect).eq("id", id).maybeSingle();
          return data as any | null;
        };
        const loadLandingBySlug = async (slug?: string | null) => {
          const s = String(slug || "").trim();
          if (!s) return null;
          const { data: bySource } = await supabaseAdmin.from("landing_pages").select(landingSelect).eq("source_slug", s).maybeSingle();
          if (bySource) return bySource as any;
          const { data: bySlug } = await supabaseAdmin.from("landing_pages").select(landingSelect).eq("slug", s).maybeSingle();
          return bySlug as any | null;
        };
        const primaryLanding =
          (await loadLandingById(row.target_landing_id)) ||
          (await loadLandingById(row.source_landing_id)) ||
          (await loadLandingBySlug(row.source_slug));
        const finalLanding = primaryLanding?.linked_fasttrack_landing_id
          ? ((await loadLandingById(primaryLanding.linked_fasttrack_landing_id)) || primaryLanding)
          : primaryLanding;
        landingSlug = finalLanding?.slug || finalLanding?.source_slug || row.source_slug || null;
        const rawMode = String(finalLanding?.interview_mode || "").toLowerCase();
        if (rawMode === "voice" || rawMode === "both" || rawMode === "chat") interviewMode = rawMode;

        return json({
          ok: true,
          application_id: row.id,
          tenant_id: row.tenant_id,
          status: row.status,
          full_name: row.full_name,
          landing_slug: landingSlug,
          interview_mode: interviewMode,
        });
      },
    },
  },
});
