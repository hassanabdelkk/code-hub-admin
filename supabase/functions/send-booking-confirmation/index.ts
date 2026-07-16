// Deno Edge Function: send-booking-confirmation
// Scannt frisch gebuchte interview_appointments (created_at > now()-15min) und
// sendet Bewerber-Bestätigungsmail (professioneller Wrapper: Logo, Preheader,
// Spam-Hinweis, Recruiter-Karte, ICS-Anhang + Plain-Text-Alternative).
// Idempotent via application_reminder_log kind='booking_confirmation'.
//
// Trigger: pg_cron alle 2 Min (siehe Migration 20260717000000_...).
// Auth: x-cron-secret Header/?key=<CRON_SECRET> oder Service-Role via Authorization/apikey.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import nodemailer from "https://esm.sh/nodemailer@6.9.14";
import { renderEmail } from "../_shared/email-wrapper.ts";

const FUNCTION_VERSION = "2026-07-18-booking-confirmation-v3-lookback72h";
const REMINDER_KIND = "booking_confirmation";
const LOOKBACK_MIN = 4320; // 72h – überbrückt längere Cron-Ausfälle; Idempotenz via reminder_log

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_SUBJECT = "✅ Termin bestätigt: {{appointment_date}}, {{appointment_time}} Uhr";
const DEFAULT_PREHEADER = "Ihr Bewerbungsgespräch am {{appointment_date}} um {{appointment_time}} Uhr – alle Infos + Kalendereintrag im Anhang.";
const DEFAULT_BODY = `Hallo {{first_name}},

vielen Dank – Ihr Termin für das Bewerbungsgespräch bei {{tenant_name}} ist fest reserviert:

📅  {{appointment_date}}
🕐  {{appointment_time}} Uhr
⏱️  Dauer: ca. {{duration_minutes}} Minuten

Sie finden den Termin als Kalendereintrag (.ics) im Anhang – einfach öffnen und in Outlook, Google oder Apple-Kalender speichern.

30 Minuten vor Beginn schicken wir Ihnen zusätzlich den direkten Link zum Gespräch, damit Sie ihn nicht extra suchen müssen.

Sollten Sie den Termin verschieben oder absagen müssen, tun Sie das jederzeit hier:

{{cta:Termin verwalten|{{cancel_url}}}}

Wir freuen uns auf das Gespräch!

Herzliche Grüße
{{recruiter_name}}`;

interface TenantRow {
  id: string; name: string; domain: string | null; primary_domain: string | null;
  logo_url: string | null; primary_color: string | null;
  sender_email: string | null; sender_name: string | null; reply_to_email: string | null;
  smtp_host: string | null; smtp_port: number | null; smtp_username: string | null; smtp_password: string | null;
  email_signature: string | null; emails_paused: boolean | null;
  booking_confirmation_subject: string | null; booking_confirmation_body: string | null;
}

function hasValidSmtp(t: any): boolean {
  return !!(t?.smtp_host && t?.smtp_port && t?.smtp_username && t?.smtp_password && t?.sender_email);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...corsHeaders } });
}

async function authorize(req: Request) {
  const secret = Deno.env.get("CRON_SECRET");
  const url = new URL(req.url);
  const provided = (req.headers.get("x-cron-secret") ?? url.searchParams.get("key") ?? "").trim();
  if (secret?.trim() && provided && provided === secret.trim()) return true;

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  const authHeader = req.headers.get("authorization") ?? "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  const apiKey = (req.headers.get("apikey") ?? req.headers.get("x-api-key") ?? "").trim();

  return !!(serviceRoleKey && (bearer === serviceRoleKey || apiKey === serviceRoleKey));
}

function pad(n: number) { return n.toString().padStart(2, "0"); }
function icsDate(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}
function icsEscape(s: string): string {
  return s.replace(/\\/g,"\\\\").replace(/\r?\n/g,"\\n").replace(/,/g,"\\,").replace(/;/g,"\\;");
}
function buildIcs(opts: { uid: string; title: string; description: string; start: Date; end: Date; url: string; organizerName: string; organizerEmail: string; attendeeEmail: string; }): string {
  const lines = [
    "BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//MB Portal//Bewerbung//DE","CALSCALE:GREGORIAN","METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${opts.uid}`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(opts.start)}`,
    `DTEND:${icsDate(opts.end)}`,
    `SUMMARY:${icsEscape(opts.title)}`,
    `DESCRIPTION:${icsEscape(opts.description)}`,
    `URL:${opts.url}`,
    `ORGANIZER;CN=${icsEscape(opts.organizerName)}:mailto:${opts.organizerEmail}`,
    `ATTENDEE;RSVP=TRUE:mailto:${opts.attendeeEmail}`,
    "STATUS:CONFIRMED","TRANSP:OPAQUE",
    "END:VEVENT","END:VCALENDAR",
  ];
  return lines.join("\r\n");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!(await authorize(req))) return json({ error: "Unauthorized", version: FUNCTION_VERSION }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } });

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const dryRun = body?.dry_run === true;

    const since = new Date(Date.now() - LOOKBACK_MIN * 60_000).toISOString();

    const { data: appts, error: aErr } = await admin.from("interview_appointments")
      .select("id, application_id, tenant_id, starts_at, ends_at, cancel_token, status, created_at")
      .eq("status", "scheduled")
      .gte("created_at", since)
      .limit(200);
    if (aErr) return json({ error: aErr.message, version: FUNCTION_VERSION }, 500);
    if (!appts || appts.length === 0) return json({ success: true, version: FUNCTION_VERSION, candidates: 0, sent: 0 });

    const appIds = Array.from(new Set(appts.map((a: any) => a.application_id)));
    const { data: logs } = await admin.from("application_reminder_log")
      .select("application_id").eq("reminder_kind", REMINDER_KIND).in("application_id", appIds);
    const done = new Set((logs ?? []).map((r: any) => r.application_id));
    const todo = appts.filter((a: any) => !done.has(a.application_id));
    if (todo.length === 0) return json({ success: true, version: FUNCTION_VERSION, candidates: appts.length, sent: 0, skipped_already_sent: appts.length });

    const { data: apps } = await admin.from("applications")
      .select("id, email, first_name, last_name, full_name, tenant_id, target_landing_id, source_landing_id")
      .in("id", todo.map((t: any) => t.application_id));
    const appMap = new Map<string, any>((apps ?? []).map((a: any) => [a.id, a]));

    const tenantIds = Array.from(new Set(todo.map((a: any) => a.tenant_id).filter(Boolean)));
    const { data: tList } = await admin.from("tenants")
      .select("id,name,domain,primary_domain,logo_url,primary_color,sender_email,sender_name,reply_to_email,smtp_host,smtp_port,smtp_username,smtp_password,email_signature,emails_paused,booking_confirmation_subject,booking_confirmation_body")
      .in("id", tenantIds);
    const tenantMap = new Map<string, TenantRow>((tList ?? []).map((t: any) => [t.id, t]));

    const lps = Array.from(new Set([
      ...todo.map((a: any) => appMap.get(a.application_id)?.target_landing_id).filter(Boolean),
      ...todo.map((a: any) => appMap.get(a.application_id)?.source_landing_id).filter(Boolean),
    ]));
    const { data: lpList } = lps.length
      ? await admin.from("landing_pages").select("id, domain, recruiter_name, recruiter_avatar_url").in("id", lps)
      : { data: [] as any[] };
    const lpMap = new Map<string, any>((lpList ?? []).map((l: any) => [l.id, l]));

    let sent = 0, skipped = 0, failed = 0;
    const results: any[] = [];

    for (const appt of todo as any[]) {
      const app = appMap.get(appt.application_id);
      if (!app?.email) { skipped++; results.push({ id: appt.id, reason: "no_email" }); continue; }
      const tenant = tenantMap.get(appt.tenant_id);
      if (!tenant) { skipped++; results.push({ id: appt.id, reason: "no_tenant" }); continue; }
      if (tenant.emails_paused) { skipped++; results.push({ id: appt.id, reason: "tenant_paused" }); continue; }
      if (!hasValidSmtp(tenant)) { skipped++; results.push({ id: appt.id, reason: "no_smtp" }); continue; }

      const landing = lpMap.get(app.target_landing_id) || lpMap.get(app.source_landing_id);
      const domain = landing?.domain || tenant.primary_domain || tenant.domain;
      const recruiterName = landing?.recruiter_name || tenant.name;
      const recruiterAvatar = landing?.recruiter_avatar_url || null;
      const cancelUrl = domain ? `https://${domain}/termin/${appt.cancel_token}` : `/termin/${appt.cancel_token}`;

      const starts = new Date(appt.starts_at);
      const ends = new Date(appt.ends_at);
      const firstName = app.first_name || (app.full_name?.split(" ")[0] ?? "");
      const duration = Math.round((ends.getTime() - starts.getTime()) / 60_000);

      const vars: Record<string, string> = {
        first_name: firstName,
        last_name: app.last_name || "",
        full_name: app.full_name || `${firstName} ${app.last_name || ""}`.trim(),
        tenant_name: tenant.name,
        recruiter_name: recruiterName,
        appointment_date: starts.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
        appointment_time: starts.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }),
        duration_minutes: String(duration),
        cancel_url: cancelUrl,
      };

      const { html, text, subject } = renderEmail({
        subject: tenant.booking_confirmation_subject || DEFAULT_SUBJECT,
        body: tenant.booking_confirmation_body || DEFAULT_BODY,
        preheader: DEFAULT_PREHEADER,
        spamHint: true,
        tenant,
        recruiter: { name: recruiterName, avatar_url: recruiterAvatar, role_label: "Personalabteilung" },
        vars,
      });

      const ics = buildIcs({
        uid: `${appt.id}@${domain || "mb-portal"}`,
        title: `Bewerbungsgespräch – ${tenant.name}`,
        description: `Bewerbungsgespräch mit ${recruiterName}. Termin verwalten: ${cancelUrl}`,
        start: starts, end: ends, url: cancelUrl,
        organizerName: recruiterName, organizerEmail: tenant.sender_email || tenant.smtp_username!,
        attendeeEmail: app.email,
      });

      if (dryRun) { sent++; results.push({ id: appt.id, status: "would_send", to: app.email }); continue; }

      try {
        const transporter = nodemailer.createTransport({
          host: tenant.smtp_host!, port: tenant.smtp_port!, secure: tenant.smtp_port === 465,
          auth: { user: tenant.smtp_username!, pass: tenant.smtp_password! },
        });
        await transporter.sendMail({
          from: `"${tenant.sender_name || tenant.name}" <${tenant.sender_email || tenant.smtp_username!}>`,
          to: app.email,
          replyTo: tenant.reply_to_email ?? tenant.sender_email ?? undefined,
          subject, html, text,
          icalEvent: { filename: "termin.ics", method: "REQUEST", content: ics },
          attachments: [{ filename: "termin.ics", content: ics, contentType: "text/calendar; charset=utf-8; method=REQUEST" }],
        });
        await admin.from("application_reminder_log").upsert({
          application_id: app.id, tenant_id: tenant.id, reminder_kind: REMINDER_KIND,
          recipient_email: app.email, status: "sent",
        }, { onConflict: "application_id,reminder_kind" });
        sent++; results.push({ id: appt.id, status: "sent" });
        await new Promise((r) => setTimeout(r, 3000));
      } catch (e: any) {
        failed++;
        const err = String(e?.message ?? e).slice(0, 500);
        await admin.from("application_reminder_log").upsert({
          application_id: app.id, tenant_id: tenant.id, reminder_kind: REMINDER_KIND,
          recipient_email: app.email, status: "failed", error: err,
        }, { onConflict: "application_id,reminder_kind" });
        results.push({ id: appt.id, status: "failed", error: err });
      }
    }

    return json({ success: true, version: FUNCTION_VERSION, dry_run: dryRun, candidates: appts.length, todo: todo.length, sent, skipped, failed, results: dryRun ? results : undefined });
  } catch (err: any) {
    console.error(err);
    return json({ error: err?.message ?? "Unknown error", version: FUNCTION_VERSION }, 500);
  }
});
