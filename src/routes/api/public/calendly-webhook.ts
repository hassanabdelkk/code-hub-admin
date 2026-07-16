// Public webhook endpoint für Calendly.
// Calendly-Doku: https://developer.calendly.com/api-docs/ZG9jOjE0ODcyMDMx-webhook-signatures
//
// Header "Calendly-Webhook-Signature": "t=<timestamp>,v1=<hex-sig>"
// Signature = HMAC-SHA256(signing_key, `${t}.${raw_body}`).
//
// Wir akzeptieren jede Signatur, die mit IRGENDEINEM der hinterlegten
// webhook_signing_keys aus calendly_accounts matched (mehrere CF/Calendly
// Accounts pro Workspace sind möglich).

import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

function parseSignatureHeader(h: string | null): { t: string; v1: string } | null {
  if (!h) return null;
  const parts = Object.fromEntries(
    h.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  if (!parts.t || !parts.v1) return null;
  return { t: parts.t, v1: parts.v1 };
}

function verify(rawBody: string, t: string, sig: string, key: string): boolean {
  const expected = createHmac("sha256", key).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  try { return timingSafeEqual(a, b); } catch { return false; }
}

export const Route = createFileRoute("/api/public/calendly-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text();
        const sigHeader = parseSignatureHeader(request.headers.get("calendly-webhook-signature"));
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: accounts } = await supabaseAdmin
          .from("calendly_accounts")
          .select("id, tenant_id, webhook_signing_key");

        let matched = false;
        if (sigHeader) {
          for (const acc of accounts ?? []) {
            if (verify(rawBody, sigHeader.t, sigHeader.v1, (acc as any).webhook_signing_key)) {
              matched = true;
              break;
            }
          }
        }
        if (!matched) {
          await supabaseAdmin.from("automation_log").insert({
            action: "calendly.webhook.invalid_signature",
            status: "warn",
            target: null,
            error: "Signature did not match any account",
          });
          return new Response("Invalid signature", { status: 401 });
        }

        let payload: any;
        try { payload = JSON.parse(rawBody); } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const event = payload?.event as string | undefined;
        const inv = payload?.payload ?? {};
        const eventUri = inv?.uri ?? inv?.event ?? null;
        const inviteeUri = inv?.uri ?? null;
        const email = String(inv?.email ?? "").toLowerCase();
        const fullName = String(inv?.name ?? "").trim();
        const startTime = inv?.scheduled_event?.start_time ?? null;
        // utm_content from prefill carries our application_id (legacy flow).
        // utm_source carries the broker landing slug/id.
        const tracking = inv?.tracking ?? {};
        const appIdFromUtm = tracking?.utm_content || tracking?.salesforce_uuid || null;
        const brokerSourceSlug = String(tracking?.utm_source ?? "").trim() || null;

        // Resolve target Fast-Track landing (where /bewerbung lives) from the
        // broker landing's linked_fasttrack_landing_id, or directly via slug/id.
        let targetLanding: { id: string; tenant_id: string | null; domain: string | null } | null = null;
        if (brokerSourceSlug) {
          // Try as broker landing slug first → linked fast-track landing.
          const { data: brokerLp } = await supabaseAdmin
            .from("landing_pages")
            .select("id, linked_fasttrack_landing_id")
            .or(`source_slug.eq.${brokerSourceSlug},slug.eq.${brokerSourceSlug},id.eq.${brokerSourceSlug}`)
            .maybeSingle();
          const targetId = (brokerLp as any)?.linked_fasttrack_landing_id ?? (brokerLp as any)?.id ?? null;
          if (targetId) {
            const { data: lp } = await supabaseAdmin
              .from("landing_pages")
              .select("id, tenant_id, domain")
              .eq("id", targetId)
              .maybeSingle();
            if (lp) targetLanding = lp as any;
          }
        }

        // Find matching application. Falls mehrere Datensätze zur gleichen Mail
        // existieren (Formular + späterer Calendly-Webhook), bevorzugen wir eine
        // noch offene/pending Bewerbung statt einen neuen Datensatz anzulegen.
        let appRow: any = null;
        if (appIdFromUtm) {
          const { data } = await supabaseAdmin
            .from("applications")
            .select("id, tenant_id, email, booking_status, magic_token")
            .eq("id", appIdFromUtm).maybeSingle();
          if (data) appRow = data;
        }
        if (!appRow && email) {
          // Lücke A: 'cancelled' und 'no_show' mit einbeziehen, damit bei einer
          // Neubuchung derselbe Application-Datensatz recycled wird
          // (inkl. bestehendem magic_token → derselbe Link zeigt neuen Termin).
          const { data } = await supabaseAdmin
            .from("applications")
            .select("id, tenant_id, email, booking_status, magic_token, created_at")
            .ilike("email", email)
            .in("booking_status", ["pending", "none", "scheduled", "cancelled", "no_show"])
            .order("created_at", { ascending: false })
            .limit(10);
          const rows = (data ?? []) as any[];
          appRow =
            rows.find((r) => r.booking_status === "pending") ??
            rows.find((r) => r.booking_status === "cancelled" || r.booking_status === "no_show") ??
            rows[0] ??
            null;
        }

        // Auto-create application if booking arrived without an existing one
        // (new flow: Vermittlung → Calendly → Webhook → application + magic link).
        if (!appRow && email && event === "invitee.created") {
          const newId = crypto.randomUUID();
          const tenantId = targetLanding?.tenant_id ?? null;
          const { error: insErr } = await supabaseAdmin.from("applications").insert({
            id: newId,
            full_name: fullName || email,
            email,
            tenant_id: tenantId,
            // Nicht automatisch akzeptieren: erst das KI-Bewerbungsgespräch
            // entscheidet später über status='akzeptiert' oder 'abgelehnt'.
            status: "neu",
            flow_type: "fast",
            source_slug: brokerSourceSlug,
            target_landing_id: targetLanding?.id ?? null,
            booking_status: "scheduled",
          } as any);
          if (insErr) {
            console.error("[calendly-webhook] auto-create application failed:", insErr);
          } else {
            appRow = { id: newId, tenant_id: tenantId, email };
          }
        }

        if (!appRow) {
          await supabaseAdmin.from("automation_log").insert({
            action: `calendly.${event ?? "unknown"}.no_match`,
            status: "warn",
            target: email || null,
            payload: { eventUri, email },
          });
          return Response.json({ ok: true, matched: false });
        }

        let newStatus: string | null = null;
        if (event === "invitee.created") newStatus = "scheduled";
        else if (event === "invitee.canceled") newStatus = "cancelled";
        else if (event === "invitee_no_show.created") newStatus = "no_show";

        // Generate (or reuse) magic token for invitee.created
        let magicToken: string | null = appRow.magic_token ?? null;
        if (event === "invitee.created" && !magicToken) {
          magicToken = crypto.randomUUID() + "-" + crypto.randomUUID().slice(0, 8);
        }
        const expiresAt = event === "invitee.created"
          ? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
          : null;

        if (newStatus) {
          const upd: any = {
            booking_status: newStatus,
            scheduled_at: startTime ?? null,
            calendly_event_uri: eventUri ?? null,
            calendly_invitee_uri: inviteeUri ?? null,
          };
          if (targetLanding?.id) upd.target_landing_id = targetLanding.id;
          if (!appRow.tenant_id && targetLanding?.tenant_id) upd.tenant_id = targetLanding.tenant_id;
          if (brokerSourceSlug) upd.source_slug = brokerSourceSlug;
          if (event === "invitee.created" && magicToken) {
            upd.magic_token = magicToken;
            upd.magic_token_expires_at = expiresAt;
          }
          await supabaseAdmin.from("applications").update(upd).eq("id", appRow.id);

          // Re-Booking: alte Rebook-Reminder-Log-Einträge löschen, damit bei
          // erneuter Absage die Reminder wieder feuern können.
          if (event === "invitee.created" &&
              (appRow.booking_status === "cancelled" || appRow.booking_status === "no_show")) {
            await supabaseAdmin
              .from("application_reminder_log")
              .delete()
              .eq("application_id", appRow.id)
              .in("reminder_kind", ["rebook_after_cancel_24h", "rebook_after_cancel_72h", "no_show_24h"]);
          }

          // Stage-Lifecycle mitziehen (Migration 20260706000000).
          const targetStage =
            newStatus === "scheduled" ? "vermittlung_termin_gebucht"
            : newStatus === "no_show" ? "vermittlung_no_show"
            : newStatus === "cancelled" ? "vermittlung_absage"
            : null;
          if (targetStage) {
            await supabaseAdmin.rpc("advance_application_stage", {
              _application_id: appRow.id,
              _to_stage: targetStage,
              _actor_id: null,
              _reason: `calendly:${event}`,
              _force: false,
            } as any).then(() => {}, (e) => console.warn("[calendly-webhook] stage rpc:", e));
          }
        }

        // Interview-Einladung wird NICHT mehr sofort verschickt.
        // Sie geht ~30 Min vor dem Termin über Edge-Function
        // "send-appointment-reminders" raus (Template bewerbung_magic_link_*).


        await supabaseAdmin.from("automation_log").insert({
          action: `calendly.${event ?? "unknown"}`,
          status: "ok",
          target: appRow.email ?? email,
          payload: { application_id: appRow.id, scheduled_at: startTime, status: newStatus, magic_link_sent: !!(event === "invitee.created" && magicToken && targetLanding?.domain) },
        });

        return Response.json({ ok: true, application_id: appRow.id, status: newStatus });
      },
    },
  },
});
