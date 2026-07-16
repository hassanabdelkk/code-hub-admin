import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

const Schema = z.object({
  full_name: z.string().trim().min(1).max(120),
  first_name: z.string().trim().max(80).optional().nullable(),
  last_name: z.string().trim().max(80).optional().nullable(),
  email: z.string().trim().email().max(255),
  phone: z.string().trim().max(40).optional().nullable(),
  postal_code: z.string().trim().max(20).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  message: z.string().trim().max(2000).optional().nullable(),
  tenant_id: z.string().uuid().optional().nullable(),
  flow_type: z.enum(["classic", "fast", "broker"]).optional().default("classic"),
  portal_url: z.string().url().max(500).optional().nullable(),
  source_slug: z.string().trim().max(120).optional().nullable(),
  source_landing_id: z.string().uuid().optional().nullable(),
  target_landing_id: z.string().uuid().optional().nullable(),
  is_test: z.coerce.boolean().optional().default(false),
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

export const Route = createFileRoute("/api/public/applications")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const requestId = crypto.randomUUID().slice(0, 8);
        const origin = request.headers.get("origin") || null;
        const referer = request.headers.get("referer") || null;
        console.log("[applications] request_received", { requestId, origin, referer });

        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          console.warn("[applications] invalid_json", { requestId, origin, referer });
          return json({ error: "Invalid JSON" }, 400);
        }
        const parsed = Schema.safeParse(payload);
        if (!parsed.success) {
          console.warn("[applications] validation_failed", { requestId, details: parsed.error.flatten() });
          return json({ error: "Validation failed", details: parsed.error.flatten() }, 400);
        }
        const d = parsed.data;
        console.log("[applications] payload_valid", {
          requestId,
          email: d.email,
          flow_type: d.flow_type,
          source_slug: d.source_slug ?? null,
          tenant_id: d.tenant_id ?? null,
          is_test: d.is_test,
        });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const isFast = d.flow_type === "fast";
        const displayName = d.is_test ? `[TEST] ${d.full_name}` : d.full_name;

        // Tenant-Fallback: Wenn kein tenant_id mitgeschickt wurde, versuche
        // ihn über Origin/Referer-Header zu ermitteln (Landingpage-Domain).
        let resolvedTenantId: string | null = d.tenant_id ?? null;
        if (!resolvedTenantId) {
          const originHeader = request.headers.get("origin") || request.headers.get("referer") || "";
          try {
            const host = new URL(originHeader).hostname.toLowerCase().replace(/^portal\./, "").replace(/^www\./, "");
            if (host && host !== "localhost") {
              const { data: tByPrimary } = await supabaseAdmin
                .from("tenants").select("id").eq("primary_domain", host).maybeSingle();
              if (tByPrimary?.id) {
                resolvedTenantId = tByPrimary.id;
              } else {
                const { data: tByDomain } = await supabaseAdmin
                  .from("tenants").select("id").eq("domain", host).maybeSingle();
                if (tByDomain?.id) resolvedTenantId = tByDomain.id;
              }
            }
          } catch { /* ignore parse errors */ }
        }

        // Broker-Flow: Partner/Fasttrack wird erst nach erfolgreichem Speichern
        // als Response zurückgegeben; die Landing zeigt den Calendly-Block dadurch
        // ausschließlich nach dem Formular-Submit.
        let calendlyOnLanding: string | null = null;
        let partner: any = null;
        let landingPage: any = null;
        let interviewMode: string | null = null;
        if (d.source_slug) {
          const source = d.source_slug.trim();
          let lp: any = null;
          const { data: bySource } = await supabaseAdmin
            .from("landing_pages")
            .select("id, slug, source_slug, tenant_id, calendly_url, partner_company_id, interview_mode, linked_fasttrack_landing_id, intermediate_company_name, logo_url, branding, booking_mode")
            .eq("source_slug", d.source_slug)
            .eq("is_published", true)
            .maybeSingle();
          lp = bySource ?? null;
          if (!lp) {
            const { data: bySlug } = await supabaseAdmin
              .from("landing_pages")
              .select("id, slug, source_slug, tenant_id, calendly_url, partner_company_id, interview_mode, linked_fasttrack_landing_id, intermediate_company_name, logo_url, branding, booking_mode")
              .eq("slug", source)
              .eq("is_published", true)
              .maybeSingle();
            lp = bySlug ?? null;
          }

          landingPage = lp;
          calendlyOnLanding = typeof lp?.calendly_url === "string" && lp.calendly_url.trim()
            ? lp.calendly_url.trim()
            : null;
          interviewMode = lp?.interview_mode ?? null;
          const partnerId = lp?.partner_company_id ?? null;
          if (partnerId) {
            const { data: pc } = await supabaseAdmin
              .from("partner_companies")
              .select("name, logo_url, calendly_url, portal_register_url, intro_headline, intro_subline, button_label")
              .eq("id", partnerId)
              .maybeSingle();
            partner = pc
              ? { ...pc, calendly_url: calendlyOnLanding || pc.calendly_url }
              : null;
          }
          if (!partner && d.flow_type === "broker" && lp?.linked_fasttrack_landing_id) {
            const { data: linked } = await supabaseAdmin
              .from("landing_pages")
              .select("domain, calendly_url, intermediate_company_name, logo_url, branding")
              .eq("id", lp.linked_fasttrack_landing_id)
              .eq("is_published", true)
              .maybeSingle();
            const linkedBranding = (linked as any)?.branding ?? {};
            const ownBranding = lp?.branding ?? {};
            if (linked) {
              partner = {
                name: (linked as any).intermediate_company_name || linkedBranding.firmenname || lp.intermediate_company_name || ownBranding.firmenname || "unserem Partner",
                logo_url: (linked as any).logo_url || linkedBranding.logo_image || null,
                calendly_url: calendlyOnLanding || (linked as any).calendly_url || linkedBranding.calendly_url || null,
                portal_register_url: null,
                intro_headline: null,
                intro_subline: null,
                button_label: "Jetzt Termin buchen",
              };
            }
          }
          if (!partner && d.flow_type === "broker" && calendlyOnLanding) {
            const ownBranding = landingPage?.branding ?? {};
            partner = {
              name: landingPage?.intermediate_company_name || ownBranding.firmenname || "unserem Partner",
              logo_url: landingPage?.logo_url || ownBranding.logo_image || null,
              calendly_url: calendlyOnLanding,
              portal_register_url: null,
              intro_headline: null,
              intro_subline: null,
              button_label: "Jetzt Termin buchen",
            };
          }
        }
        // Booking-Mode pro Landing Page steuert Calendly vs. eigenes System.
        // 'calendly' → Calendly-Flow; 'internal' → eigenes Buchungssystem.
        const bookingMode: "calendly" | "internal" =
          (landingPage?.booking_mode as any) ?? "calendly";
        const isBrokerFlow = d.flow_type === "broker" && !!partner && !d.is_test;
        const isBroker = isBrokerFlow && bookingMode === "calendly";
        const useCalendly = !isBroker && !!calendlyOnLanding && !d.is_test && bookingMode === "calendly";

        // Tenant-Fallback #3: Landing-Page hat i.d.R. tenant_id → nutzen wenn
        // Origin/Referer nichts gebracht hat.
        if (!resolvedTenantId && landingPage?.tenant_id) {
          resolvedTenantId = landingPage.tenant_id as string;
        }
        console.log("[applications] tenant_resolved", {
          requestId,
          tenant_id: resolvedTenantId,
          landing_id: landingPage?.id ?? null,
          source_slug: d.source_slug ?? null,
          booking_mode: landingPage?.booking_mode ?? null,
          interview_mode: interviewMode,
        });

        // Tenant-Guard: Neue Bewerbung OHNE Tenant ist immer ein Bug
        // (Origin unbekannt + kein source_slug + kein tenant_id im Payload).
        // Statt null zu speichern → sauber abweisen, sonst rutschen Bewerber
        // in den "Kadermarketing/Digital-DGI"-Backfill-Zustand.
        if (!resolvedTenantId && !d.is_test) {
          console.warn("[applications] tenant_missing", {
            origin: request.headers.get("origin"),
            referer: request.headers.get("referer"),
            source_slug: d.source_slug ?? null,
            email: d.email,
          });
          return json({ error: "tenant_missing", message: "Bewerbung konnte keinem Mandanten zugeordnet werden." }, 400);
        }


        // Dedup: identische E-Mail im selben Tenant innerhalb 60 Tagen →
        // vorhandene Bewerbung wiederverwenden statt neuen Datensatz anzulegen.
        // Verhindert Doppel-/Dreifach-Einträge, wenn ein Bewerber das Formular
        // mehrfach abschickt (Marc Jung, Shirin Alaqrabawi, …).
        let appId: string | null = null;
        if (resolvedTenantId && !d.is_test) {
          const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60_000).toISOString();
          const { data: existing } = await supabaseAdmin
            .from("applications")
            .select("id")
            .eq("tenant_id", resolvedTenantId)
            .ilike("email", d.email)
            .gte("created_at", sixtyDaysAgo)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if ((existing as any)?.id) appId = (existing as any).id as string;
        }

        const wasNewlyCreated = !appId;
        if (!wasNewlyCreated) {
          console.log("[applications] duplicate_reused", { requestId, application_id: appId, tenant_id: resolvedTenantId, email: d.email });
        }
        if (!appId) {
          appId = crypto.randomUUID();
          // Vor-/Nachname aus explizitem Feld, sonst aus full_name gesplittet
          const nameParts = d.full_name.trim().split(/\s+/);
          const derivedFirst = nameParts[0] ?? "";
          const derivedLast = nameParts.slice(1).join(" ");
          const firstNameForDb = (d.first_name ?? "").trim() || derivedFirst;
          const lastNameForDb = (d.last_name ?? "").trim() || derivedLast;
          const { error } = await supabaseAdmin.from("applications").insert({
            id: appId,
            full_name: displayName,
            first_name: firstNameForDb || null,
            last_name: lastNameForDb || null,
            email: d.email,
            phone: d.phone ?? null,
            postal_code: d.postal_code ?? null,
            city: d.city ?? null,
            message: d.message ?? null,
            tenant_id: resolvedTenantId,
            status: isFast ? "akzeptiert" : "neu",
            flow_type: d.flow_type ?? "classic",
            source_slug: d.source_slug ?? null,
            source_landing_id: d.source_landing_id ?? landingPage?.id ?? null,
            target_landing_id: d.target_landing_id ?? landingPage?.linked_fasttrack_landing_id ?? null,
            is_test: !!d.is_test,
            booking_status: (isBroker || useCalendly) ? "pending" : "none",
          } as any);
          if (error) {
            console.error("[applications] insert error:", error);
            return json({ error: "Could not save application" }, 500);
          }
          console.log("[applications] inserted", { requestId, application_id: appId, tenant_id: resolvedTenantId, flow_type: d.flow_type });
        }

        // Eigenes Buchungssystem: falls für Source- oder Ziel-Landing ein aktiver
        // Kalender existiert, wird Calendly ignoriert und der Bewerber landet auf
        // /termin/buchen/:magic_token. Ziel-/Fasttrack-Landing hat Vorrang,
        // Source-Landing ist Fallback für Vermittlungsseiten ohne Ziel-Kalender.
        // K3: bei Dedup-Reuse die ORIGINAL source/target IDs nehmen, damit
        // Buchungs-Redirect + Statistik konsistent bleiben.
        let ownBookingUrl: string | null = null;
        const scheduleCandidateIds: string[] = [];
        const pushScheduleCandidate = (id?: string | null) => {
          if (id && !scheduleCandidateIds.includes(id)) scheduleCandidateIds.push(id);
        };
        pushScheduleCandidate(d.target_landing_id ?? null);
        pushScheduleCandidate(landingPage?.linked_fasttrack_landing_id ?? null);
        pushScheduleCandidate(d.source_landing_id ?? null);
        pushScheduleCandidate(landingPage?.id ?? null);
        {
          const { data: existingApp } = await supabaseAdmin
            .from("applications")
            .select("source_landing_id, target_landing_id")
            .eq("id", appId).maybeSingle();
          pushScheduleCandidate((existingApp as any)?.target_landing_id ?? null);
          pushScheduleCandidate((existingApp as any)?.source_landing_id ?? null);
        }
        if (!d.is_test && !isFast && scheduleCandidateIds.length > 0 && d.portal_url) {
          // Nur Landings mit booking_mode='internal' zählen als Kandidaten.
          const { data: schedules } = await supabaseAdmin
            .from("availability_schedules")
            .select("id, landing_page_id, landing_pages!inner(booking_mode)")
            .in("landing_page_id", scheduleCandidateIds)
            .eq("active", true)
            .eq("landing_pages.booking_mode", "internal");
          const sched = scheduleCandidateIds
            .map((id) => (schedules as any[] | null)?.find((s) => s.landing_page_id === id))
            .find(Boolean);
          if ((sched as any)?.id) {
            let token: string | null = null;
            const { data: existingApp } = await supabaseAdmin
              .from("applications")
              .select("magic_token, magic_token_expires_at")
              .eq("id", appId).maybeSingle();
            const stillValid = (existingApp as any)?.magic_token &&
              (!((existingApp as any).magic_token_expires_at) ||
                new Date((existingApp as any).magic_token_expires_at) > new Date());
            if (stillValid) {
              token = (existingApp as any).magic_token as string;
            } else {
              token = crypto.randomUUID().replace(/-/g, "");
              await supabaseAdmin.from("applications").update({
                magic_token: token,
                magic_token_expires_at: new Date(Date.now() + 14 * 24 * 60 * 60_000).toISOString(),
                booking_status: "pending",
              } as any).eq("id", appId);
            }
            const base = d.portal_url.replace(/\/+$/, "");
            ownBookingUrl = `${base}/termin/buchen/${token}`;
          }
        }

        let redirect_url: string | null = null;
        let broker_block: any = null;
        let email_status: {
          attempted: boolean;
          status: "not_attempted" | "sent" | "failed" | "skipped";
          template?: string;
          reason?: string;
        } = { attempted: false, status: "not_attempted" };
        const mailErrorMessage = (err: any, data?: any) =>
          String(data?.error ?? err?.message ?? err?.context?.msg ?? err ?? "Unbekannter Mailfehler");

        // KI-Bewerbungsgespräch hat Vorrang vor Calendly. Bei interview_mode
        // chat/voice/both → Bewerber landet zuerst im Interview, von dort
        // wird nach Abschluss zur Terminbuchung weitergeleitet.
        const useInterview = !d.is_test && !isBroker && !isFast && !!interviewMode
          && (interviewMode === "chat" || interviewMode === "voice" || interviewMode === "both")
          && !!d.portal_url && !!d.source_slug;


        if (useInterview) {
          const base = d.portal_url!.replace(/\/+$/, "");
          const qs = new URLSearchParams({
            landing: d.source_slug!,
            portal: base,
          }).toString();
          redirect_url = `${base}/interview/${appId}?${qs}`;
        } else if (ownBookingUrl) {
          redirect_url = ownBookingUrl;
        } else if (isBroker) {
          const parts = d.full_name.trim().split(/\s+/);
          const firstName = parts[0] ?? "";
          const lastName = parts.slice(1).join(" ");
          const base = String(partner.calendly_url || "").trim();
          const sep = base.includes("?") ? "&" : "?";
          const qs = new URLSearchParams({
            name: d.full_name, email: d.email,
            first_name: firstName, last_name: lastName,
            utm_content: appId, utm_source: d.source_slug ?? "",
          }).toString();
          broker_block = {
            partner_name: partner.name,
            partner_logo: partner.logo_url ?? null,
            calendly_url: base ? `${base}${sep}${qs}` : "",
            button_label: partner.button_label || "Jetzt Termin buchen",
            intro_headline: partner.intro_headline ?? null,
            intro_subline: partner.intro_subline ?? null,
            portal_register_url: partner.portal_register_url ?? null,
          };
        } else if (isFast && d.portal_url) {
          // Fasttrack: direkt zur Portal-Startseite. Verbindung / Login
          // erfolgt dort separat — keine PII in der URL.
          const base = d.portal_url.replace(/\/+$/, "");
          redirect_url = `${base}/`;
        } else if (useCalendly && d.portal_url && d.source_slug) {
          const base = d.portal_url.replace(/\/+$/, "");
          const parts = d.full_name.trim().split(/\s+/);
          const firstName = parts[0] ?? "";
          const lastName = parts.slice(1).join(" ");
          const qs = new URLSearchParams({
            app: appId, landing: d.source_slug,
            first_name: firstName, last_name: lastName,
            email: d.email, phone: d.phone ?? "",
          }).toString();
          redirect_url = `${base}/bewerbung/verbinden?${qs}`;
        }

        if (isFast && resolvedTenantId && redirect_url && !d.is_test) {
          try {
            await supabaseAdmin.from("invite_resend_queue")
              .update({ status: "skipped", last_error: "fast_track_accept" } as any)
              .eq("tenant_id", resolvedTenantId)
              .eq("email", d.email.toLowerCase())
              .in("status", ["queued", "sending"]);
          } catch (e) { console.warn("[applications fast] skip drip queue:", e); }
          try {
            const parts = d.full_name.trim().split(/\s+/);
            const firstName = parts[0] ?? "";
            const lastName = parts.slice(1).join(" ");
            email_status = { attempted: true, status: "failed", template: "invitation" };
            const { data: mailData, error: mailErr } = await supabaseAdmin.functions.invoke("send-invitation-email", {
              body: { to: d.email, fullName: d.full_name, firstName, lastName, registrationLink: redirect_url, tenantId: resolvedTenantId },
            });
            if (mailErr || mailData?.error) {
              email_status = { attempted: true, status: "failed", template: "invitation", reason: mailErrorMessage(mailErr, mailData) };
              console.warn("[applications fast] invitation mail:", mailErr ?? mailData?.error);
            } else {
              email_status = { attempted: true, status: "sent", template: "invitation" };
            }
          } catch (e) {
            email_status = { attempted: true, status: "failed", template: "invitation", reason: mailErrorMessage(e) };
            console.warn("[applications fast] invitation mail error:", e);
          }
        }

        // Eingangsbestätigung an Bewerber – für ALLE Flows außer Fasttrack
        // (Fasttrack schickt bereits die Einladungsmail oben). Nur beim ersten
        // Einreichen (wasNewlyCreated), damit wiederholte Submits keine
        // Doppel-Mails erzeugen. Termin-Link (Calendly/eigenes System/Broker)
        // wird als Button eingebettet, falls vorhanden – sonst reine Bestätigung.
        const brokerBookingLink = broker_block?.calendly_url || ownBookingUrl;
        const confirmationBookingLink =
          brokerBookingLink
          || (useCalendly ? calendlyOnLanding : null)
          || ownBookingUrl
          || null;
        const shouldSendConfirmation =
          !isFast && wasNewlyCreated && resolvedTenantId && !d.is_test;

        console.log("[applications] confirmation_decision", {
          requestId,
          application_id: appId,
          shouldSendConfirmation,
          isFast,
          wasNewlyCreated,
          tenant_id: resolvedTenantId,
          is_test: d.is_test,
          has_booking_link: !!confirmationBookingLink,
        });

        if (shouldSendConfirmation) {
          try {
            const parts = d.full_name.trim().split(/\s+/);
            const firstName = parts[0] ?? "";
            const lastName = parts.slice(1).join(" ");
            email_status = { attempted: true, status: "failed", template: "application_received" };
            const { data: mailData, error: mailErr } = await supabaseAdmin.functions.invoke("send-invitation-email", {
              body: {
                to: d.email,
                fullName: d.full_name,
                firstName,
                lastName,
                registrationLink: confirmationBookingLink ?? "",
                tenantId: resolvedTenantId,
                templateName: "application_received",
                placeholders: {
                  partner_name: partner?.name ?? broker_block?.partner_name ?? "",
                  calendly_link: confirmationBookingLink ?? "",
                  booking_link: confirmationBookingLink ?? "",
                },
              },
            });
            if (mailErr || mailData?.error) {
              email_status = { attempted: true, status: "failed", template: "application_received", reason: mailErrorMessage(mailErr, mailData) };
              console.warn("[applications] application_received mail:", mailErr ?? mailData?.error);
            } else {
              email_status = { attempted: true, status: "sent", template: "application_received" };
              console.log("[applications] application_received sent", { to: d.email, tenant: resolvedTenantId, hasLink: !!confirmationBookingLink });
            }
          } catch (e) {
            email_status = { attempted: true, status: "failed", template: "application_received", reason: mailErrorMessage(e) };
            console.warn("[applications] application_received mail error:", e);
          }
        } else if (!isFast && !wasNewlyCreated && !d.is_test) {
          email_status = { attempted: false, status: "skipped", template: "application_received", reason: "duplicate_application" };
        }




        console.log("[applications] response", {
          requestId,
          application_id: appId,
          flow_type: d.flow_type ?? "classic",
          has_redirect: !!redirect_url,
          has_broker: !!broker_block,
          email_status,
        });
        return json({ success: true, flow_type: d.flow_type ?? "classic", redirect_url, broker: broker_block, email_status });


      },
    },
  },
});
