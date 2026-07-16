// Deno Edge Function: send-application-reminders
//
// Zwei Bewerber-Reminder (Vermittlungs-/Broker-Flow):
//  1) no_booking_24h / no_booking_72h — Bewerbung eingegangen, aber kein Calendly-Termin gebucht.
//  2) no_show_24h                     — Termin gebucht, aber nicht wahrgenommen (24h nach scheduled_at).
//
// Trigger: pg_cron alle 30 Min. Auth via x-cron-secret Header ODER ?key=<CRON_SECRET>.
// Idempotenz: application_reminder_log UNIQUE(application_id, reminder_kind).

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import nodemailer from "https://esm.sh/nodemailer@6.9.14";

const FUNCTION_VERSION = "2026-07-15-rebook-after-cancel-v9-smtp-rate-limit-safe";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const NO_BOOKING_1_MIN = 24 * 60;         // 24h
const NO_BOOKING_2_MIN = 72 * 60;         // 72h
const NO_SHOW_MIN      = 24 * 60;         // 24h nach Termin
const REG_PENDING_1_MIN = 24 * 60;        // 24h nach Zusage/Invite
const REG_PENDING_2_MIN = 72 * 60;        // 72h nach Zusage/Invite (2. Nachfass)
const REBOOK_1_MIN      = 24 * 60;        // 24h nach Cancel
const REBOOK_2_MIN      = 72 * 60;        // 72h nach Cancel

const DEFAULTS = {
  no_booking: {
    subject: "Erinnerung: Dein Termin bei {{tenant_name}} steht noch aus",
    body:
`Hallo {{first_name}},

vielen Dank für deine Bewerbung bei {{tenant_name}}. Damit wir dich kennenlernen können, fehlt nur noch dein Wunschtermin für das kurze Erstgespräch.

{{cta:Jetzt Termin auswählen|{{calendly_link}}}}

Falls der Button nicht funktioniert, kopiere diesen Link:
{{calendly_link}}

Viele Grüße
{{recruiter_name}}
{{tenant_name}}`,
  },
  no_show: {
    subject: "Schade, dass es nicht geklappt hat – buche einen neuen Termin",
    body:
`Hallo {{first_name}},

leider konnten wir dich zu deinem Termin am {{appointment_date}} um {{appointment_time}} Uhr nicht erreichen. Kein Problem – wir hätten dich gern trotzdem kennengelernt.

Bitte wähle einen neuen Wunschtermin, der besser passt:

{{cta:Neuen Termin auswählen|{{calendly_link}}}}

Falls du Fragen hast oder Unterstützung brauchst, antworte einfach auf diese E-Mail.

Viele Grüße
{{recruiter_name}}
{{tenant_name}}`,
  },
  rebook: {
    subject: "Ihr Termin wurde abgesagt – bitte wählen Sie einen neuen",
    body:
`Hallo {{first_name}},

Ihr geplanter Termin bei {{tenant_name}} wurde abgesagt. Wir würden Sie trotzdem sehr gerne kennenlernen und laden Sie ein, einen neuen Wunschtermin zu wählen.

{{cta:Neuen Termin auswählen|{{calendly_link}}}}

Falls der Button nicht funktioniert, kopieren Sie diesen Link:
{{calendly_link}}

Bei Fragen antworten Sie einfach auf diese E-Mail – wir helfen gerne.

Herzliche Grüße
{{recruiter_name}}
{{tenant_name}}`,
  },
  registration: {
    subject: "🎉 Ihr Portal-Zugang wartet – nur noch ein Klick, {{first_name}}",
    body:
`Hallo {{first_name}},

herzlichen Glückwunsch nochmal zu Ihrer Zusage bei {{tenant_name}}! 🎊

Uns ist aufgefallen, dass Sie sich noch nicht im Mitarbeiter-Portal registriert haben. Erst mit der Registrierung können wir Ihren Arbeitsvertrag bereitstellen und Sie erhalten Zugriff auf Ihre ersten Aufträge.

Die Registrierung dauert nur 2 Minuten:

{{cta:Jetzt im Portal registrieren|{{portal_link}}}}

Falls der Button nicht funktioniert, kopieren Sie diesen Link:
{{portal_link}}

Bei Fragen antworten Sie einfach auf diese E-Mail – wir helfen gerne.

Herzliche Grüße
{{recruiter_name}}
{{tenant_name}}`,
  },
};

interface TenantRow {
  id: string; name: string; domain: string | null; primary_domain: string | null;
  logo_url: string | null; primary_color: string | null;
  sender_email: string | null; sender_name: string | null; reply_to_email: string | null;
  smtp_host: string | null; smtp_port: number | null; smtp_username: string | null; smtp_password: string | null;
  email_signature: string | null; emails_paused: boolean | null;
  reminder_app_no_booking_subject: string | null; reminder_app_no_booking_body: string | null;
  reminder_app_no_show_subject: string | null;    reminder_app_no_show_body: string | null;
  reminder_app_registration_subject: string | null; reminder_app_registration_body: string | null;
  reminder_app_rebook_subject: string | null; reminder_app_rebook_body: string | null;
}

type LandingRow = {
  id?: string | null;
  tenant_id?: string | null;
  slug?: string | null;
  source_slug?: string | null;
  calendly_url?: string | null;
  branding?: any;
  recruiter_name?: string | null;
  updated_at?: string | null;
};

function normalizeKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function calendlyFromLanding(landing: LandingRow | null | undefined): string {
  return String(landing?.calendly_url || landing?.branding?.calendly_url || "").trim();
}

function toLanding(row: any): LandingRow {
  return {
    id: row?.id ?? null,
    tenant_id: row?.tenant_id ?? null,
    slug: row?.slug ?? null,
    source_slug: row?.source_slug ?? null,
    calendly_url: row?.calendly_url ?? null,
    branding: row?.branding ?? null,
    recruiter_name: row?.recruiter_name ?? null,
    updated_at: row?.updated_at ?? null,
  };
}

function hasValidSmtp(t: TenantRow | null | undefined): t is TenantRow {
  return !!(t && t.smtp_host && t.smtp_port && t.smtp_username && t.smtp_password && t.sender_email);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...corsHeaders } });
}

async function authorize(req: Request, admin: any): Promise<{ ok: true } | { ok: false; status: number; msg: string }> {
  const cronSecret = Deno.env.get("CRON_SECRET");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY");
  const url = new URL(req.url);
  const provided = req.headers.get("x-cron-secret") ?? url.searchParams.get("key");
  if (cronSecret && provided && provided === cronSecret) return { ok: true };
  const authHeader = req.headers.get("authorization") ?? "";
  const jwt = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  const apiKey = req.headers.get("apikey")?.trim() ?? "";
  if (serviceRoleKey && (jwt === serviceRoleKey || apiKey === serviceRoleKey)) return { ok: true };
  if (jwt && await verifyServiceRoleJwt(jwt)) return { ok: true };
  if (apiKey && await verifyServiceRoleJwt(apiKey)) return { ok: true };
  if (!jwt) return { ok: false, status: 401, msg: "Unauthorized" };
  const { data: userRes, error } = await admin.auth.getUser(jwt);
  if (error || !userRes?.user) return { ok: false, status: 401, msg: "Unauthorized" };
  const { data: role } = await admin.from("user_roles").select("role").eq("user_id", userRes.user.id).eq("role", "admin").maybeSingle();
  if (!role) return { ok: false, status: 403, msg: "Forbidden" };
  return { ok: true };
}

function b64UrlToBytes(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function verifyServiceRoleJwt(token: string): Promise<boolean> {
  const jwtSecret = Deno.env.get("JWT_SECRET");
  if (!jwtSecret) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const [headerB64, payloadB64, signatureB64] = parts;
    const header = JSON.parse(new TextDecoder().decode(b64UrlToBytes(headerB64)));
    if (header?.alg !== "HS256") return false;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(jwtSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      b64UrlToBytes(signatureB64),
      new TextEncoder().encode(`${headerB64}.${payloadB64}`),
    );
    if (!valid) return false;
    const claims = JSON.parse(new TextDecoder().decode(b64UrlToBytes(payloadB64)));
    if (claims?.exp && Date.now() / 1000 >= Number(claims.exp)) return false;
    return claims?.role === "service_role";
  } catch {
    return false;
  }
}

function render(text: string, vars: Record<string, string>): string {
  let out = text;
  for (const [k, v] of Object.entries(vars)) out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v ?? "");
  return out;
}

function buildHtml(subject: string, body: string, signature: string, tenant: TenantRow, vars: Record<string, string>): string {
  const color = tenant.primary_color || "#0f172a";
  const resolvedBody = render(body, vars).replace(/\{\{cta:([^|}]+)\|([^}]+)\}\}/g, (_m, label, href) =>
    `<table cellpadding="0" cellspacing="0" style="margin:16px 0"><tr><td style="background:${color};border-radius:8px"><a href="${String(href).trim()}" style="display:inline-block;padding:14px 28px;color:#fff;text-decoration:none;font-weight:600;font-size:15px">${String(label).trim()}</a></td></tr></table>`);
  const bodyHtml = resolvedBody.replace(/\n/g, "<br>").replace(/(https?:\/\/[^\s<]+)/g, `<a href="$1" style="color:${color};text-decoration:underline;">$1</a>`);
  const logoHtml = tenant.logo_url ? `<div style="text-align:center;margin-bottom:24px;"><img src="${tenant.logo_url}" alt="${tenant.name}" style="max-height:48px;max-width:200px;" /></div>` : "";
  const sigText = signature ? render(signature, vars).replace(/\n/g, "<br>") : "";
  const sigHtml = sigText ? `<div style="border-top:1px solid #e5e7eb;margin-top:24px;padding-top:16px;color:#9ca3af;font-size:13px;line-height:20px;">${sigText}</div>` : "";
  const subj = render(subject, vars);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:32px 16px">
<div style="background:#fff;border-radius:12px;padding:32px 24px;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
${logoHtml}
<h1 style="color:#111827;font-size:22px;font-weight:700;margin:0 0 20px;line-height:1.3">${subj}</h1>
<div style="color:#374151;font-size:15px;line-height:26px">${bodyHtml}</div>
${sigHtml}
</div>
<div style="text-align:center;margin-top:16px;color:#9ca3af;font-size:11px">© ${new Date().getFullYear()} ${tenant.name}</div>
</div></body></html>`;
}

async function sendMail(tenant: TenantRow, to: string, subject: string, html: string) {
  const transporter = nodemailer.createTransport({
    host: tenant.smtp_host!, port: tenant.smtp_port!, secure: tenant.smtp_port === 465,
    auth: { user: tenant.smtp_username!, pass: tenant.smtp_password! },
  });
  const senderName = tenant.sender_name ?? tenant.name;
  const senderEmail = tenant.sender_email ?? tenant.smtp_username!;
  await transporter.sendMail({
    from: `"${senderName}" <${senderEmail}>`, to,
    replyTo: tenant.reply_to_email ?? senderEmail,
    subject, html,
  });
}

function firstName(full?: string | null): string {
  return (full ?? "").trim().split(/\s+/)[0] ?? "";
}

function appendUtm(url: string, appId: string): string {
  if (!url) return "";
  const sep = url.includes("?") ? "&" : "?";
  const has = /utm_content=/.test(url);
  return has ? url : `${url}${sep}utm_content=${encodeURIComponent(appId)}`;
}

function smtpErrorMessage(e: unknown): string {
  return String((e as any)?.message ?? e ?? "SMTP error").slice(0, 500);
}

function isSmtpHourlyRateLimit(errMsg: string): boolean {
  const normalized = errMsg.toLowerCase();
  return (
    normalized.includes("too many messages") ||
    normalized.includes("last 60 minutes") ||
    normalized.includes("rate limit") ||
    normalized.includes("rate-limit") ||
    normalized.includes("throttl") ||
    normalized.includes("quota exceeded") ||
    normalized.includes("try again later")
  );
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? Deno.env.get("API_EXTERNAL_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const authz = await authorize(req, admin);
    if (!authz.ok) return json({ error: authz.msg }, authz.status);

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const dryRun = body?.dry_run === true;

    // Tenants vorladen
    const { data: tList, error: tErr } = await admin
      .from("tenants")
      .select("id,name,domain,primary_domain,logo_url,primary_color,sender_email,sender_name,reply_to_email,smtp_host,smtp_port,smtp_username,smtp_password,email_signature,is_active,emails_paused,reminder_app_no_booking_subject,reminder_app_no_booking_body,reminder_app_no_show_subject,reminder_app_no_show_body,reminder_app_registration_subject,reminder_app_registration_body,reminder_app_rebook_subject,reminder_app_rebook_body")
      .eq("is_active", true);
    if (tErr) return json({ error: tErr.message }, 500);
    const tenants = new Map<string, TenantRow>((tList ?? []).map((t: any) => [t.id, t as TenantRow]));

    const now = Date.now();

    // ─── Kandidaten laden ───
    // Bewerbungen der letzten 10 Tage — Filterung im Code.
    const since = new Date(now - 10 * 86400_000).toISOString();
    const { data: apps, error: aErr } = await admin
      .from("applications")
      .select("id,tenant_id,source_slug,source_landing_id,target_landing_id,full_name,email,status,created_at,updated_at,booking_status,scheduled_at,interview_started_at,interview_completed_at,flow_type")
      .gte("created_at", since);
    if (aErr) return json({ error: aErr.message }, 500);

    if (!apps?.length) return json({ success: true, dry_run: dryRun, candidates: 0, sent: 0, skipped: 0, failed: 0 });

    // Landing-Pages mit Calendly-Link (direkte Zuordnung via source_landing_id / target_landing_id)
    const landingIds = Array.from(new Set(apps.flatMap((a: any) => [a.source_landing_id, a.target_landing_id]).filter(Boolean)));
    const landingMap = new Map<string, LandingRow>();
    const landingErrors: Record<string, string> = {};
    if (landingIds.length) {
      const { data: lps, error: lpErr } = await admin.from("landing_pages")
        .select("id,tenant_id,slug,source_slug,calendly_url,branding,updated_at")
        .in("id", landingIds);
      if (lpErr) landingErrors.direct = lpErr.message;
      for (const l of (lps ?? []) as any[]) landingMap.set(l.id, toLanding(l));
    }

    // Legacy-Fallback: ältere Bewerbungen haben oft source_landing_id = NULL,
    // aber source_slug ist noch gesetzt. Daher zusätzlich Landing per slug/source_slug laden.
    const sourceSlugs = Array.from(new Set(apps.map((a: any) => normalizeKey(a.source_slug)).filter(Boolean)));
    const slugLandingMap = new Map<string, LandingRow>();
    if (sourceSlugs.length) {
      const { data: bySlug, error: bsErr } = await admin.from("landing_pages")
        .select("id,tenant_id,slug,source_slug,calendly_url,branding,updated_at")
        .in("slug", sourceSlugs);
      const { data: bySourceSlug, error: bssErr } = await admin.from("landing_pages")
        .select("id,tenant_id,slug,source_slug,calendly_url,branding,updated_at")
        .in("source_slug", sourceSlugs);
      if (bsErr) landingErrors.by_slug = bsErr.message;
      if (bssErr) landingErrors.by_source_slug = bssErr.message;
      for (const l of ([...(bySlug ?? []), ...(bySourceSlug ?? [])] as any[])) {
        const landing = toLanding(l);
        const keys = [landing.slug, landing.source_slug].map(normalizeKey).filter(Boolean);
        for (const key of keys) {
          const current = slugLandingMap.get(key);
          if (!current || (!calendlyFromLanding(current) && calendlyFromLanding(landing))) slugLandingMap.set(key, landing);
        }
      }
    }

    // Fallback: pro Tenant erste Landing-Page mit Calendly-Link (für Apps ohne source_landing_id
    // oder wenn deren Landing keinen Calendly-Link hat — z.B. Legacy-/Direktbewerbungen).
    const tenantIdsForFallback = Array.from(new Set(apps.map((a: any) => a.tenant_id).filter(Boolean)));
    const tenantLandingFallback = new Map<string, LandingRow>();
    let tenantLandingRawCount = 0;
    if (tenantIdsForFallback.length) {
      const { data: tlps, error: tlpErr } = await admin.from("landing_pages")
        .select("id,tenant_id,slug,source_slug,calendly_url,branding,updated_at")
        .in("tenant_id", tenantIdsForFallback)
        .order("updated_at", { ascending: false });
      if (tlpErr) landingErrors.tenant = tlpErr.message;
      tenantLandingRawCount = (tlps ?? []).length;
      for (const l of (tlps ?? []) as any[]) {
        const landing = toLanding(l);
        if (!tenantLandingFallback.has(l.tenant_id) && calendlyFromLanding(landing)) {
          tenantLandingFallback.set(l.tenant_id, landing);
        }
      }
    }
    console.log("[reminders v4] landing queries", {
      landingIdsCount: landingIds.length,
      landingMapSize: landingMap.size,
      sourceSlugsCount: sourceSlugs.length,
      slugLandingMapSize: slugLandingMap.size,
      tenantIdsForFallbackCount: tenantIdsForFallback.length,
      tenantLandingRawCount,
      tenantLandingFallbackSize: tenantLandingFallback.size,
      landingErrors,
    });

    // Bereits versendete Reminder pro (application_id, kind)
    const appIds = apps.map((a: any) => a.id);
    // Nur 'sent' blockiert weitere Zustellversuche. 'skipped'/'failed' dürfen erneut
    // versucht werden (z.B. wenn inzwischen ein Calendly-Link hinterlegt wurde).
    const { data: existing } = await admin
      .from("application_reminder_log")
      .select("application_id,reminder_kind,status")
      .in("application_id", appIds)
      .eq("status", "sent");
    const already = new Set<string>((existing ?? []).map((r: any) => `${r.application_id}|${r.reminder_kind}`));

    type ReminderKind = "no_booking_24h" | "no_booking_72h" | "no_show_24h" | "registration_pending_24h" | "registration_pending_72h" | "rebook_after_cancel_24h" | "rebook_after_cancel_72h";
    type Todo = { app: any; kind: ReminderKind; inviteToken?: string };
    const todo: Todo[] = [];

    // ─── Invitation-Tokens laden (für registration_pending) ───
    // Bewerbungen mit Status "akzeptiert" + Invitation-Token → prüfen ob registriert.
    const acceptedApps = (apps as any[]).filter((a) =>
      a.email && a.tenant_id &&
      (a.status === "akzeptiert" || a.status === "vermittlung_zusage" || a.status === "fasttrack_angenommen")
    );
    const acceptedIds = acceptedApps.map((a) => a.id);
    const tokensByAppId = new Map<string, { token: string; created_at: string }>();
    const registeredEmails = new Set<string>();
    if (acceptedIds.length) {
      const { data: tokens } = await admin
        .from("invitation_tokens")
        .select("token, application_id, created_at")
        .in("application_id", acceptedIds);
      for (const t of (tokens ?? []) as any[]) {
        if (!tokensByAppId.has(t.application_id)) {
          tokensByAppId.set(t.application_id, { token: t.token, created_at: t.created_at });
        }
      }
      // Registrierte Bewerber = existiert Profil mit gleicher E-Mail im gleichen Tenant
      const emails = Array.from(new Set(acceptedApps.map((a) => a.email.toLowerCase().trim())));
      const tenantIds = Array.from(new Set(acceptedApps.map((a) => a.tenant_id)));
      if (emails.length && tenantIds.length) {
        const { data: profs } = await admin
          .from("profiles")
          .select("email, tenant_id")
          .in("email", emails)
          .in("tenant_id", tenantIds);
        for (const p of (profs ?? []) as any[]) {
          if (p.email && p.tenant_id) registeredEmails.add(`${p.tenant_id}|${String(p.email).toLowerCase().trim()}`);
        }
      }
    }

    for (const a of apps as any[]) {
      if (!a.email || !a.tenant_id) continue;
      const createdMs = new Date(a.created_at).getTime();
      const ageMin = (now - createdMs) / 60_000;

      // 1) No-Show 24h nach Termin — nur wenn Termin nachweislich NICHT wahrgenommen wurde.
      const noShowEligible =
        a.scheduled_at &&
        !a.interview_started_at &&
        !a.interview_completed_at &&
        a.booking_status !== "completed";
      if (noShowEligible) {
        const schedMs = new Date(a.scheduled_at).getTime();
        const sinceMin = (now - schedMs) / 60_000;
        if (sinceMin >= NO_SHOW_MIN && sinceMin < NO_SHOW_MIN + 24 * 60) {
          if (!already.has(`${a.id}|no_show_24h`)) todo.push({ app: a, kind: "no_show_24h" });
          continue;
        }
      }

      // 2) Registration Pending (Zusage erteilt, aber nicht registriert)
      const invite = tokensByAppId.get(a.id);
      if (invite) {
        const emailKey = `${a.tenant_id}|${String(a.email).toLowerCase().trim()}`;
        const isRegistered = registeredEmails.has(emailKey);
        if (!isRegistered) {
          const inviteAgeMin = (now - new Date(invite.created_at).getTime()) / 60_000;
          if (inviteAgeMin >= REG_PENDING_1_MIN && inviteAgeMin < REG_PENDING_2_MIN) {
            if (!already.has(`${a.id}|registration_pending_24h`)) {
              todo.push({ app: a, kind: "registration_pending_24h", inviteToken: invite.token });
              continue;
            }
          } else if (inviteAgeMin >= REG_PENDING_2_MIN && inviteAgeMin < REG_PENDING_2_MIN + 5 * 24 * 60) {
            if (!already.has(`${a.id}|registration_pending_72h`)) {
              todo.push({ app: a, kind: "registration_pending_72h", inviteToken: invite.token });
              continue;
            }
          }
        }
        // Bewerber mit Zusage bekommen KEINE No-Booking Mail mehr.
        continue;
      }

      // 3) Rebook nach Cancel (Termin wurde abgesagt, kein neuer gebucht)
      if (a.booking_status === "cancelled") {
        const changedMs = new Date(a.updated_at ?? a.created_at).getTime();
        const sinceChangeMin = (now - changedMs) / 60_000;
        if (sinceChangeMin >= REBOOK_1_MIN && sinceChangeMin < REBOOK_2_MIN) {
          if (!already.has(`${a.id}|rebook_after_cancel_24h`)) todo.push({ app: a, kind: "rebook_after_cancel_24h" });
        } else if (sinceChangeMin >= REBOOK_2_MIN && sinceChangeMin < REBOOK_2_MIN + 5 * 24 * 60) {
          if (!already.has(`${a.id}|rebook_after_cancel_72h`)) todo.push({ app: a, kind: "rebook_after_cancel_72h" });
        }
        continue;
      }

      // 4) No-Booking (nur wenn kein Termin gebucht)
      const hasBooking = a.booking_status === "scheduled" || !!a.scheduled_at;
      if (hasBooking) continue;

      if (ageMin >= NO_BOOKING_1_MIN && ageMin < NO_BOOKING_2_MIN) {
        if (!already.has(`${a.id}|no_booking_24h`)) todo.push({ app: a, kind: "no_booking_24h" });
      } else if (ageMin >= NO_BOOKING_2_MIN && ageMin < NO_BOOKING_2_MIN + 24 * 60) {
        if (!already.has(`${a.id}|no_booking_72h`)) todo.push({ app: a, kind: "no_booking_72h" });
      }
    }

    let sent = 0, skipped = 0, failed = 0;
    const results: any[] = [];

    // ─── Rate-Limits (SMTP-Reputationsschutz) ───
    // Pro Tenant/Sender bewusst konservativ: einige Mailserver blocken schon
    // nach wenigen Mails pro Stunde mit "too many messages from sender".
    const MAX_PER_RUN_PER_TENANT = 5;
    const MAX_PER_1H_PER_TENANT = 8;
    const MAX_PER_12H_PER_TENANT = 80;
    const JITTER_MIN_MS = 400;
    const JITTER_MAX_MS = 1200;
    const AUTO_PAUSE_AFTER_FAILS = 3;

    const runSentByTenant = new Map<string, number>();
    const failStreakByTenant = new Map<string, number>();
    const pausedInThisRun = new Set<string>();
    const rateLimitedInThisRun = new Set<string>();

    // 1h-/12h-Zählstand aus email_send_log (zentrale Tabelle im E-Mail-Center).
    const sent12hByTenant = new Map<string, number>();
    const sent1hByTenant = new Map<string, number>();
    try {
      const cutoff = new Date(Date.now() - 12 * 3600_000).toISOString();
      const cutoff1hMs = Date.now() - 3600_000;
      const tenantIds = Array.from(tenants.keys());
      if (tenantIds.length) {
        const { data: recent, error: recentErr } = await admin
          .from("email_send_log")
          .select("tenant_id,created_at")
          .in("tenant_id", tenantIds)
          .eq("status", "sent")
          .gte("created_at", cutoff);
        if (!recentErr) {
          for (const r of (recent ?? []) as any[]) {
            const c = sent12hByTenant.get(r.tenant_id) ?? 0;
            sent12hByTenant.set(r.tenant_id, c + 1);
            if (new Date(r.created_at).getTime() >= cutoff1hMs) {
              const h = sent1hByTenant.get(r.tenant_id) ?? 0;
              sent1hByTenant.set(r.tenant_id, h + 1);
            }
          }
        }
      }
    } catch { /* email_send_log optional */ }

    const jitter = () => new Promise(res => setTimeout(res, JITTER_MIN_MS + Math.random() * (JITTER_MAX_MS - JITTER_MIN_MS)));

    for (const { app, kind, inviteToken } of todo) {
      const tenant = tenants.get(app.tenant_id);
      if (!tenant) { skipped++; results.push({ app: app.id, kind, status: "skipped", reason: "tenant_missing" }); continue; }
      if (tenant.emails_paused || pausedInThisRun.has(tenant.id)) { skipped++; results.push({ app: app.id, kind, status: "skipped", reason: "tenant_paused" }); continue; }
      if (rateLimitedInThisRun.has(tenant.id)) { skipped++; results.push({ app: app.id, kind, status: "skipped", reason: "tenant_rate_limited_retry_later" }); continue; }
      if (!hasValidSmtp(tenant)) { skipped++; results.push({ app: app.id, kind, status: "skipped", reason: "smtp_incomplete" }); continue; }

      // Rate-Limits
      const runCount = runSentByTenant.get(tenant.id) ?? 0;
      if (runCount >= MAX_PER_RUN_PER_TENANT) { skipped++; results.push({ app: app.id, kind, status: "skipped", reason: "tenant_run_cap" }); continue; }
      const total1h = (sent1hByTenant.get(tenant.id) ?? 0) + runCount;
      if (total1h >= MAX_PER_1H_PER_TENANT) { skipped++; results.push({ app: app.id, kind, status: "skipped", reason: "tenant_1h_cap", limit: MAX_PER_1H_PER_TENANT }); continue; }
      const total12h = (sent12hByTenant.get(tenant.id) ?? 0) + runCount;
      if (total12h >= MAX_PER_12H_PER_TENANT) { skipped++; results.push({ app: app.id, kind, status: "skipped", reason: "tenant_12h_cap" }); continue; }

      const isRegistration = kind === "registration_pending_24h" || kind === "registration_pending_72h";
      const isNoShow = kind === "no_show_24h";
      const isRebook = kind === "rebook_after_cancel_24h" || kind === "rebook_after_cancel_72h";

      const landing = (app.source_landing_id ? landingMap.get(app.source_landing_id) : null)
        || (app.target_landing_id ? landingMap.get(app.target_landing_id) : null)
        || (app.source_slug ? slugLandingMap.get(normalizeKey(app.source_slug)) : null)
        || tenantLandingFallback.get(app.tenant_id)
        || null;
      const rawCalendly = calendlyFromLanding(landing);

      // Registration-Reminder braucht KEIN Calendly, sondern portal_link.
      let calendlyLink = "";
      let portalLink = "";
      if (isRegistration) {
        if (!inviteToken) {
          skipped++; results.push({ app: app.id, kind, status: "skipped", reason: "no_invite_token" });
          continue;
        }
        const activeDomain = tenant.primary_domain || tenant.domain;
        if (!activeDomain) {
          skipped++; results.push({ app: app.id, kind, status: "skipped", reason: "no_tenant_domain" });
          continue;
        }
        portalLink = `https://portal.${activeDomain}/register?token=${encodeURIComponent(inviteToken)}&ref=${encodeURIComponent(app.id)}`;
      } else {
        if (!rawCalendly) {
          skipped++; results.push({
            app: app.id, kind, status: "skipped", reason: "no_calendly_link",
            source_landing_id: app.source_landing_id ?? null,
            target_landing_id: app.target_landing_id ?? null,
            source_slug: app.source_slug ?? null,
            tenant_has_landing_fallback: tenantLandingFallback.has(app.tenant_id),
          });
          if (!dryRun) await admin.from("application_reminder_log").upsert({
            application_id: app.id, tenant_id: tenant.id, reminder_kind: kind,
            recipient_email: app.email, status: "skipped", error: "no_calendly_link",
            sent_at: new Date().toISOString(),
          }, { onConflict: "application_id,reminder_kind" });
          continue;
        }
        calendlyLink = appendUtm(rawCalendly, app.id);
      }

      const tmplSubject = isRegistration
        ? (tenant.reminder_app_registration_subject || DEFAULTS.registration.subject)
        : isRebook
          ? (tenant.reminder_app_rebook_subject || DEFAULTS.rebook.subject)
          : isNoShow
            ? (tenant.reminder_app_no_show_subject || DEFAULTS.no_show.subject)
            : (tenant.reminder_app_no_booking_subject || DEFAULTS.no_booking.subject);
      const tmplBody = isRegistration
        ? (tenant.reminder_app_registration_body || DEFAULTS.registration.body)
        : isRebook
          ? (tenant.reminder_app_rebook_body || DEFAULTS.rebook.body)
          : isNoShow
            ? (tenant.reminder_app_no_show_body || DEFAULTS.no_show.body)
            : (tenant.reminder_app_no_booking_body || DEFAULTS.no_booking.body);

      const recruiter = landing?.recruiter_name || landing?.branding?.recruiter_name || tenant.sender_name || tenant.name;

      const scheduledDate = app.scheduled_at ? new Date(app.scheduled_at) : null;
      const vars: Record<string, string> = {
        first_name: firstName(app.full_name),
        full_name: app.full_name ?? "",
        email: app.email,
        tenant_name: tenant.name,
        recruiter_name: recruiter,
        calendly_link: calendlyLink,
        portal_link: portalLink,
        appointment_date: scheduledDate ? scheduledDate.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" }) : "",
        appointment_time: scheduledDate ? scheduledDate.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "",
      };
      const subject = render(tmplSubject, vars);
      const html = buildHtml(tmplSubject, tmplBody, tenant.email_signature ?? "", tenant, vars);

      if (dryRun) { sent++; results.push({ app: app.id, kind, status: "would_send", to: app.email }); continue; }

      const templateName = `vermittlung_${kind}`; // vermittlung_no_booking_24h etc.
      const messageId = `${kind}-${app.id}-${Date.now()}@vermittlung`;

      try {
        await sendMail(tenant, app.email, subject, html);
        // Throttle: 4s Pause zwischen Sends, um SMTP-Rate-Limit (554) zu vermeiden
        await new Promise((r) => setTimeout(r, 4000));
        await admin.from("application_reminder_log").upsert({
          application_id: app.id, tenant_id: tenant.id, reminder_kind: kind,
          recipient_email: app.email, status: "sent", error: null,
          sent_at: new Date().toISOString(),
        }, { onConflict: "application_id,reminder_kind" });
        // Sichtbarkeit im E-Mail-Center
        try {
          await admin.from("email_send_log").insert({
            message_id: messageId, tenant_id: tenant.id,
            template_name: templateName, recipient_email: app.email,
            status: "sent", rendered_subject: subject, rendered_html: html,
            sender_email: tenant.sender_email ?? tenant.smtp_username,
            metadata: { application_id: app.id, kind, source: "send-application-reminders" },
          } as any);
        } catch { /* non-critical */ }
        sent++; results.push({ app: app.id, kind, status: "sent" });
        runSentByTenant.set(tenant.id, runCount + 1);
        failStreakByTenant.set(tenant.id, 0);
        await jitter();
      } catch (e: any) {
        const errMsg = smtpErrorMessage(e);
        if (isSmtpHourlyRateLimit(errMsg)) {
          rateLimitedInThisRun.add(tenant.id);
          await admin.from("application_reminder_log").upsert({
            application_id: app.id, tenant_id: tenant.id, reminder_kind: kind,
            recipient_email: app.email, status: "skipped", error: `smtp_rate_limited_retry_later: ${errMsg}`,
            sent_at: new Date().toISOString(),
          }, { onConflict: "application_id,reminder_kind" });
          try {
            await admin.from("email_send_log").insert({
              message_id: messageId, tenant_id: tenant.id,
              template_name: templateName, recipient_email: app.email,
              status: "pending", error_message: `SMTP-Stundenlimit erreicht, wird später erneut versucht: ${errMsg}`,
              rendered_subject: subject, rendered_html: html,
              sender_email: tenant.sender_email ?? tenant.smtp_username,
              metadata: { application_id: app.id, kind, source: "send-application-reminders", retry_reason: "smtp_hourly_rate_limit" },
            } as any);
          } catch { /* non-critical */ }
          skipped++; results.push({ app: app.id, kind, status: "skipped", reason: "smtp_rate_limited_retry_later", detail: errMsg });
          await jitter();
          continue;
        }
        await admin.from("application_reminder_log").upsert({
          application_id: app.id, tenant_id: tenant.id, reminder_kind: kind,
          recipient_email: app.email, status: "failed", error: errMsg,
          sent_at: new Date().toISOString(),
        }, { onConflict: "application_id,reminder_kind" });
        try {
          await admin.from("email_send_log").insert({
            message_id: messageId, tenant_id: tenant.id,
            template_name: templateName, recipient_email: app.email,
            status: "failed", error_message: errMsg,
            rendered_subject: subject, rendered_html: html,
            sender_email: tenant.sender_email ?? tenant.smtp_username,
            metadata: { application_id: app.id, kind, source: "send-application-reminders" },
          } as any);
        } catch { /* non-critical */ }
        failed++; results.push({ app: app.id, kind, status: "failed", reason: errMsg });
        const streak = (failStreakByTenant.get(tenant.id) ?? 0) + 1;
        failStreakByTenant.set(tenant.id, streak);
        // Auto-Pause deaktiviert: E-Mails werden nie automatisch pausiert.
        // Fehler werden geloggt und im Email-Center sichtbar; Admin entscheidet manuell.
        if (false && streak >= AUTO_PAUSE_AFTER_FAILS) {
          pausedInThisRun.add(tenant.id);
        }
      }
    }


    return json({
      success: true, version: FUNCTION_VERSION, dry_run: dryRun,
      candidates: todo.length, sent, skipped, failed,
      fallback_counts: {
        direct_landing_ids: landingMap.size,
        source_slugs: slugLandingMap.size,
        tenant_landing_fallbacks: tenantLandingFallback.size,
        tenant_landing_raw_rows: tenantLandingRawCount,
        landing_errors: landingErrors,
      },
      results: dryRun || todo.length < 100 ? results : undefined,
    });
  } catch (err: any) {
    console.error(err);
    return json({ error: err?.message ?? "Unknown error" }, 500);
  }
});
