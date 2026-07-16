// Public lookup: Bewerber gibt seine E-Mail ein → wir prüfen, ob es eine
// Bewerbung gibt. Wenn ja, erzeugen/erneuern wir einen Magic-Link und leiten
// direkt ins Bewerbungsgespräch. Calendly wurde bereits im Vermittlungsflow
// gebucht und wird hier bewusst NICHT mehr geöffnet.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

const Schema = z.object({
  email: z.string().trim().email().max(255),
  portal_url: z.string().url().max(500).optional().nullable(),
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

export const Route = createFileRoute("/api/public/application-lookup")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        let payload: unknown;
        try { payload = await request.json(); } catch { return json({ error: "Ungültige Anfrage (JSON konnte nicht gelesen werden)." }, 400); }
        const parsed = Schema.safeParse(payload);
        if (!parsed.success) {
          const first = parsed.error.issues[0];
          return json({ error: `Ungültige E-Mail-Adresse: ${first?.message ?? "bitte prüfen"}` }, 400);
        }

        const email = parsed.data.email.toLowerCase();
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Bewerbungen zu dieser E-Mail laden. Wichtig: Es kann Duplikate geben
        // (z.B. Formular-Submit + Calendly-Webhook). Deshalb nicht blind die
        // neueste Zeile nehmen, sondern bevorzugt eine Zeile mit gebuchtem Termin.
        const { data: apps, error } = await supabaseAdmin
          .from("applications")
          .select("id, full_name, email, phone, source_slug, source_landing_id, target_landing_id, booking_status, scheduled_at, calendly_event_uri, calendly_invitee_uri, tenant_id, created_at, magic_token, magic_token_expires_at")
          .ilike("email", email)
          .order("created_at", { ascending: false })
          .limit(10);

        if (error) {
          console.error("[application-lookup]", error);
          return json({ error: `Datenbank-Abfrage fehlgeschlagen: ${error.message || "unbekannter Fehler"}` }, 500);
        }
        const bookedStatuses = new Set(["scheduled", "completed", "booked", "gebucht", "bestätigt", "bestaetigt", "abgeschlossen"]);
        const isBooked = (row: any) => {
          const status = String(row?.booking_status || "").toLowerCase().trim();
          return bookedStatuses.has(status) || !!row?.scheduled_at || !!row?.calendly_invitee_uri || !!row?.calendly_event_uri;
        };

        const rows = (apps ?? []) as any[];
        const app = rows.find(isBooked) ?? rows[0];
        if (!app) {
          return json({
            found: false,
            reason: "no_application",
            message: `Zu der E-Mail-Adresse "${email}" liegt uns keine Bewerbung vor. Bitte prüfe die Schreibweise – verwende die exakte Adresse, mit der du dich beworben hast. Falls du dich noch nicht beworben hast, mach das zuerst über die Landing-Page.`,
          });
        }

        const landingSelect = "id, calendly_url, slug, source_slug, flow_type, domain, linked_fasttrack_landing_id";
        const loadLandingById = async (id?: string | null) => {
          if (!id) return null;
          const { data } = await supabaseAdmin
            .from("landing_pages")
            .select(landingSelect)
            .eq("id", id)
            .maybeSingle();
          return data as any | null;
        };
        const loadLandingBySlug = async (slug?: string | null) => {
          const s = String(slug || "").trim();
          if (!s) return null;
          const { data: bySource } = await supabaseAdmin
            .from("landing_pages")
            .select(landingSelect)
            .eq("source_slug", s)
            .eq("is_published", true)
            .maybeSingle();
          if (bySource) return bySource as any;
          const { data: bySlug } = await supabaseAdmin
            .from("landing_pages")
            .select(landingSelect)
            .eq("slug", s)
            .eq("is_published", true)
            .maybeSingle();
          return bySlug as any | null;
        };
        const followFasttrack = async (lp: any | null) => {
          if (!lp) return null;
          const linkedId = lp.linked_fasttrack_landing_id ?? null;
          if (linkedId) {
            const linked = await loadLandingById(linkedId);
            if (linked) return linked;
          }
          return lp;
        };

        // Landing-Info robust auflösen: alte Datensätze haben oft nur source_slug,
        // neue Vermittlungen zusätzlich source_landing_id/target_landing_id.
        const targetLanding = await followFasttrack(
          (await loadLandingById(app.target_landing_id))
          || (await loadLandingById(app.source_landing_id))
          || (await loadLandingBySlug(app.source_slug))
        );
        const landingSlug: string | null = targetLanding?.slug ?? app.source_slug ?? null;

        const booked = isBooked(app);
        let magicToken: string | null = app.magic_token ?? null;
        const expiresAt = app.magic_token_expires_at ? new Date(app.magic_token_expires_at).getTime() : 0;
        if (!magicToken || !expiresAt || expiresAt <= Date.now()) {
          magicToken = `${crypto.randomUUID()}-${crypto.randomUUID().slice(0, 8)}`;
          const { error: tokenError } = await supabaseAdmin
            .from("applications")
            .update({
              magic_token: magicToken,
              magic_token_expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
              target_landing_id: targetLanding?.id ?? app.target_landing_id ?? null,
            } as any)
            .eq("id", app.id);
          if (tokenError) {
            console.error("[application-lookup] token update failed", tokenError);
            return json({ error: "Bewerbungslink konnte nicht erstellt werden." }, 500);
          }
        }
        const base = (parsed.data.portal_url || new URL(request.url).origin).replace(/\/+$/, "");
        return json({
          found: true,
          booked,
          interview_ready: true,
          landing_slug: landingSlug,
          redirect_url: `${base}/bewerbung?token=${encodeURIComponent(magicToken)}`,
          message: booked
            ? "Dein Termin ist bestätigt. Du wirst jetzt zum Bewerbungsgespräch weitergeleitet."
            : "Deine Bewerbung wurde gefunden. Du wirst jetzt zum Bewerbungsgespräch weitergeleitet.",
        });
      },
    },
  },
});
