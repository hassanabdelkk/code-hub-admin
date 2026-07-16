// Deno Edge Function: send-appointment-reminders
// FUNCTION_VERSION: 2026-07-09-interview-invite-30min-v1
//
// Sendet ~30 Minuten VOR dem gebuchten Interview-Termin (applications.scheduled_at)
// die "Interview-Einladung" (Template bewerbung_magic_link_*) mit Magic-Link
// zum AI-Bewerbungsgespräch.
//
// Trigger: pg_cron alle 10 Min, POST { dry_run?: bool }
//   - Auth: x-cron-secret Header ODER ?key=<CRON_SECRET> ODER Service-Role Bearer/apikey ODER Admin JWT
//
// Toleranzfenster: now+25min .. now+40min
// Idempotenz: application_reminder_log (application_id, reminder_kind='interview_invite_30min')
// Tenant-Isolation: SMTP strikt aus applications.tenant_id → tenants.
// Pausierte Tenants (emails_paused = true) werden übersprungen.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import nodemailer from "https://esm.sh/nodemailer@6.9.14";

const FUNCTION_VERSION = "2026-07-09-interview-invite-30min-v1";
const REMINDER_KIND = "interview_invite_30min";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const WINDOW_LOW_MIN = 25;
const WINDOW_HIGH_MIN = 40;

const DEFAULT_SUBJECT = "⏰ In 30 Minuten startet Ihr Bewerbungsgespräch";
const DEFAULT_BODY = `Hallo {{first_name}},

kurze Erinnerung: In etwa 30 Minuten ({{appointment_time}} Uhr) startet Ihr Bewerbungsgespräch.

So läuft es ab:

1️⃣  Kurzes Gespräch (ca. 10–15 Min)
2️⃣  Bei positiver Bewertung erhalten Sie direkt eine Zusage per E-Mail
3️⃣  Anschließend Registrierung im Mitarbeiter-Portal – Vertrag digital unterschreiben und loslegen

Bitte starten Sie das Gespräch über Ihren persönlichen Link:

{{cta:{{button_label}}|{{magic_link}}}}

Tipp: Ruhige Umgebung, stabile Internet-Verbindung. Bei Problemen einfach auf diese E-Mail antworten.

Viel Erfolg und bis gleich!
{{tenant_name}}`;
const DEFAULT_BUTTON = "Bewerbungsgespräch starten";

interface TenantRow {
  id: string;
  name: string;
  domain: string | null;
  primary_domain: string | null;
  logo_url: string | null;
  primary_color: string | null;
  sender_email: string | null;
  sender_name: string | null;
  reply_to_email: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_username: string | null;
  smtp_password: string | null;
  email_signature: string | null;
  emails_paused: boolean | null;
  bewerbung_magic_link_subject: string | null;
  bewerbung_magic_link_body: string | null;
  bewerbung_magic_link_button: string | null;
}

function hasValidSmtp(t: TenantRow | null | undefined): t is TenantRow {
  return !!(t && t.smtp_host && t.smtp_port && t.smtp_username && t.smtp_password && t.sender_email);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

async function authorize(req: Request, admin: any) {
  const cronSecret = Deno.env.get("CRON_SECRET")?.trim();
  const url = new URL(req.url);
  const provided = (req.headers.get("x-cron-secret") ?? url.searchParams.get("key") ?? "").trim();
  if (cronSecret && provided && provided === cronSecret) return { ok: true as const };

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  const authHeader = req.headers.get("authorization") ?? "";
  const bearer = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  const apiKey = (req.headers.get("apikey") ?? "").trim();
  if (serviceRoleKey && (bearer === serviceRoleKey || apiKey === serviceRoleKey)) return { ok: true as const };

  if (!bearer) return { ok: false as const, status: 401, msg: "Unauthorized" };
  const { data: userRes, error: uErr } = await admin.auth.getUser(bearer);
  if (uErr || !userRes?.user) return { ok: false as const, status: 401, msg: "Unauthorized" };
  const { data: role } = await admin.from("user_roles").select("role")
    .eq("user_id", userRes.user.id).eq("role", "admin").maybeSingle();
  if (!role) return { ok: false as const, status: 403, msg: "Forbidden" };
  return { ok: true as const };
}

function renderTemplate(text: string, vars: Record<string, string>): string {
  let out = text;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v ?? "");
  }
  return out;
}

function buildHtml(subject: string, body: string, signature: string, tenant: TenantRow, vars: Record<string, string>): string {
  const color = tenant.primary_color || "#0f172a";
  const resolvedBody = renderTemplate(body, vars)
    .replace(/\{\{cta:([^|}]+)\|([^}]+)\}\}/g, (_m, label, href) =>
      `<table cellpadding="0" cellspacing="0" style="margin:16px 0"><tr><td style="background:${color};border-radius:8px"><a href="${String(href).trim()}" style="display:inline-block;padding:14px 28px;color:#fff;text-decoration:none;font-weight:600;font-size:15px">${String(label).trim()}</a></td></tr></table>`
    );
  const bodyHtml = resolvedBody.replace(/\n/g, "<br>")
    .replace(/(https?:\/\/[^\s<]+)/g, `<a href="$1" style="color:${color};text-decoration:underline;">$1</a>`);
  const logoHtml = tenant.logo_url
    ? `<div style="text-align:center;margin-bottom:24px;"><img src="${tenant.logo_url}" alt="${tenant.name}" style="max-height:48px;max-width:200px;" /></div>` : "";
  const sigText = signature ? renderTemplate(signature, vars).replace(/\n/g, "<br>") : "";
  const sigHtml = sigText
    ? `<div style="border-top:1px solid #e5e7eb;margin-top:24px;padding-top:16px;color:#9ca3af;font-size:13px;line-height:20px;">${sigText}</div>` : "";
  const subj = renderTemplate(subject, vars);
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
    from: `"${senderName}" <${senderEmail}>`,
    to, replyTo: tenant.reply_to_email ?? senderEmail, subject, html,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const authz = await authorize(req, admin);
    if (!authz.ok) return json({ error: authz.msg, version: FUNCTION_VERSION }, authz.status);

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const dryRun = body?.dry_run === true;

    const now = new Date();
    const low = new Date(now.getTime() + WINDOW_LOW_MIN * 60_000);
    const high = new Date(now.getTime() + WINDOW_HIGH_MIN * 60_000);

    // Tenants
    const { data: tList, error: tErr } = await admin.from("tenants")
      .select("id,name,domain,primary_domain,logo_url,primary_color,sender_email,sender_name,reply_to_email,smtp_host,smtp_port,smtp_username,smtp_password,email_signature,is_active,emails_paused,bewerbung_magic_link_subject,bewerbung_magic_link_body,bewerbung_magic_link_button")
      .eq("is_active", true);
    if (tErr) return json({ error: tErr.message, version: FUNCTION_VERSION }, 500);
    const tenants = new Map<string, TenantRow>();
    (tList ?? []).forEach((t: any) => tenants.set(t.id, t as TenantRow));

    // Applications im Fenster (scheduled_at zwischen +25 und +40 Min)
    const { data: apps, error: aErr } = await admin.from("applications")
      .select("id,email,first_name,last_name,full_name,tenant_id,scheduled_at,magic_token,magic_token_expires_at,target_landing_id,booking_status")
      .eq("booking_status", "scheduled")
      .gte("scheduled_at", low.toISOString())
      .lt("scheduled_at", high.toISOString());
    if (aErr) return json({ error: aErr.message, version: FUNCTION_VERSION }, 500);

    if (!apps || apps.length === 0) {
      return json({ success: true, version: FUNCTION_VERSION, dry_run: dryRun,
        window: { from: low.toISOString(), to: high.toISOString() }, candidates: 0, sent: 0, skipped: 0, failed: 0 });
    }

    // Idempotenz: nur solche, die noch nicht als 'sent' geloggt sind
    const appIds = apps.map((a: any) => a.id);
    const { data: logged } = await admin.from("application_reminder_log")
      .select("application_id,status").eq("reminder_kind", REMINDER_KIND).in("application_id", appIds);
    const sentSet = new Set((logged ?? []).filter((r: any) => r.status === "sent").map((r: any) => r.application_id));
    const todo = apps.filter((a: any) => !sentSet.has(a.id));

    // Landing-Pages (für Domain → Magic-Link)
    const landingIds = Array.from(new Set(todo.map((a: any) => a.target_landing_id).filter(Boolean)));
    const landingMap = new Map<string, { domain: string | null }>();
    if (landingIds.length) {
      const { data: lp } = await admin.from("landing_pages").select("id,domain").in("id", landingIds);
      (lp ?? []).forEach((l: any) => landingMap.set(l.id, { domain: l.domain }));
    }

    let sent = 0, skipped = 0, failed = 0;
    const results: any[] = [];

    for (const a of todo as any[]) {
      if (!a.email || !a.tenant_id) { skipped++; results.push({ application_id: a.id, status: "skipped", reason: "no_email_or_tenant" }); continue; }
      if (!a.magic_token) { skipped++; results.push({ application_id: a.id, status: "skipped", reason: "no_magic_token" }); continue; }
      const tenant = tenants.get(a.tenant_id);
      if (!tenant) { skipped++; results.push({ application_id: a.id, status: "skipped", reason: "tenant_missing" }); continue; }
      if (tenant.emails_paused) { skipped++; results.push({ application_id: a.id, status: "skipped", reason: "tenant_paused" }); continue; }
      if (!hasValidSmtp(tenant)) { skipped++; results.push({ application_id: a.id, status: "skipped", reason: "smtp_incomplete" }); continue; }

      const landing = a.target_landing_id ? landingMap.get(a.target_landing_id) : null;
      const domain = landing?.domain || tenant.primary_domain || tenant.domain;
      if (!domain) { skipped++; results.push({ application_id: a.id, status: "skipped", reason: "no_domain" }); continue; }

      const magicLink = `https://${domain}/bewerbung?token=${a.magic_token}`;
      const startsAt = new Date(a.scheduled_at);
      const firstName = a.first_name || (a.full_name?.split(" ")[0] ?? "");

      const subject = tenant.bewerbung_magic_link_subject || DEFAULT_SUBJECT;
      const bodyT = tenant.bewerbung_magic_link_body || DEFAULT_BODY;
      const buttonLabel = tenant.bewerbung_magic_link_button || DEFAULT_BUTTON;

      const vars: Record<string, string> = {
        first_name: firstName,
        last_name: a.last_name || "",
        full_name: a.full_name || `${firstName} ${a.last_name || ""}`.trim(),
        email: a.email,
        tenant_name: tenant.name,
        appointment_date: startsAt.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" }),
        appointment_time: startsAt.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }),
        magic_link: magicLink,
        button_label: buttonLabel,
      };

      if (dryRun) { sent++; results.push({ application_id: a.id, status: "would_send", to: a.email, magic_link: magicLink }); continue; }

      const renderedSubject = renderTemplate(subject, vars);
      const html = buildHtml(subject, bodyT, tenant.email_signature ?? "", tenant, vars);
      try {
        await sendMail(tenant, a.email, renderedSubject, html);
        await admin.from("application_reminder_log").upsert({
          application_id: a.id, tenant_id: tenant.id, reminder_kind: REMINDER_KIND,
          recipient_email: a.email, status: "sent",
        }, { onConflict: "application_id,reminder_kind" });
        sent++; results.push({ application_id: a.id, status: "sent" });
        // SMTP-Throttle gegen Rate-Limit
        await new Promise((r) => setTimeout(r, 4000));
      } catch (e: any) {
        failed++;
        const errMsg = String(e?.message ?? e).slice(0, 500);
        await admin.from("application_reminder_log").upsert({
          application_id: a.id, tenant_id: tenant.id, reminder_kind: REMINDER_KIND,
          recipient_email: a.email, status: "failed", error: errMsg,
        }, { onConflict: "application_id,reminder_kind" });
        results.push({ application_id: a.id, status: "failed", reason: errMsg });
      }
    }

    return json({
      success: true, version: FUNCTION_VERSION, dry_run: dryRun,
      window: { from: low.toISOString(), to: high.toISOString() },
      candidates: apps.length, already_sent: apps.length - todo.length,
      sent, skipped, failed,
      results: dryRun ? results : undefined,
    });
  } catch (err: any) {
    console.error(err);
    return json({ error: err?.message ?? "Unknown error", version: FUNCTION_VERSION }, 500);
  }
});
