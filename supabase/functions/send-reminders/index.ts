// Deno Edge Function: send-reminders
//
// Sendet automatische Erinnerungsmails an drei Zielgruppen:
//   1. invite                — Bewerber akzeptiert, aber noch kein Account
//   2. confirm_email         — Account angelegt, E-Mail nicht bestätigt
//   3. complete_registration — Account bestätigt, Onboarding unvollständig
//
// Gates pro Empfänger + Typ:
//   - max. 5 Versuche
//   - min. 3 Tage seit letzter Reminder-Mail
//   - min. 3 Tage seit relevantem Event (Annahme / Account / Bestätigung)
//
// Trigger: pg_cron 1x täglich ODER manuell via POST { dry_run?: bool }
//
// Deploy:
//   supabase functions deploy send-reminders --no-verify-jwt

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import nodemailer from "https://esm.sh/nodemailer@6.9.14";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Welle 1 tuning (Juni 2026): weniger Druck auf Empfänger.
//   - 3 statt 5 Versuche pro Empfänger+Typ
//   - 4 statt 3 Tage Mindestabstand
const MAX_ATTEMPTS = 3;
// Abstand vom letzten Reminder zum nächsten (Attempt-Index → Stunden).
// Reminder 1: 24h nach Trigger, Reminder 2: 48h nach R1, Reminder 3: 72h nach R2.
const ATTEMPT_HOURS = [24, 48, 72];
const MIN_DAYS_BETWEEN = 1; // Legacy: nur noch für Cutoff-Queries (>=24h alt).
const NO_BOOKING_DAYS = 7;

// ─── Quiet Hours (Europe/Berlin) ───
// Reminder-Mails werden nur tagsüber versendet, niemals nachts.
// Standard: 08:00–20:00 lokal (Europe/Berlin). Außerhalb → kompletter Skip.
// Über `ignore_quiet_hours: true` im Request-Body manuell erzwingbar (Admin-Trigger).
const QUIET_HOURS_START = 8;  // inkl.
const QUIET_HOURS_END = 20;   // exkl. (also bis 19:59)
function berlinHour(): number {
  const h = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin", hour: "2-digit", hour12: false,
  }).format(new Date());
  return parseInt(h, 10);
}
function isQuietHours(): boolean {
  const h = berlinHour();
  return h < QUIET_HOURS_START || h >= QUIET_HOURS_END;
}

// ─── Anti-Spam Throttling ───
// Max. echte Sends pro Tenant + Typ und Ausführung (verhindert Burst-Send / Domain-Flagging).
// Quiet-Hours 08–20 Uhr = 12 aktive Läufe/Tag → 50 * 12 = 600 Mails/12h/Tenant/Typ.
const MAX_SENDS_PER_RUN_PER_TENANT = 50;
// Harte Obergrenze: max. Mails pro Tenant in den letzten 24h (über alle Typen
// zusammen). Welle-1-Update: User-Vorgabe 140/Tag/Tenant. Schützt Sender-
// Reputation. Wird zu Beginn aus reminder_log geladen und pro erfolgreichem
// Send live hochgezählt.
const MAX_SENDS_PER_TENANT_PER_24H = 140;
// Eigenes Kontingent für Domain-Recovery: 20/Lauf × 12 aktive Läufe = 240/12h (real ≤200 durch Idempotenz).
const DOMAIN_RECOVERY_CAP_PER_RUN = 20;
// Auto-Trigger-Fenster: Recovery läuft automatisch X Tage nach Primary-Domain-Wechsel mit.
const DOMAIN_RECOVERY_AUTO_WINDOW_DAYS = 14;
// Banner-Fenster: Wie lange nach einem Primary-Domain-Wechsel zeigen alle
// regulären Reminder-Mails den Hinweis „Portal-Adresse hat sich geändert".
const DOMAIN_CHANGE_BANNER_DAYS = 30;
// Wartezeit zwischen zwei echten Sends (Basis + zufällige Streuung)
const SEND_DELAY_MIN_MS = 2500;
const SEND_DELAY_MAX_MS = 5500;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const jitterDelay = () =>
  sleep(SEND_DELAY_MIN_MS + Math.floor(Math.random() * (SEND_DELAY_MAX_MS - SEND_DELAY_MIN_MS)));

// Strikte SMTP-Validierung: NIEMALS mit unvollständiger / fremder Konfiguration senden.
// Jeder Tenant darf nur über SEIN EIGENES, vollständig konfiguriertes SMTP versenden.
function hasValidSmtp(t: TenantRow | null | undefined): t is TenantRow {
  return !!(t && t.smtp_host && t.smtp_port && t.smtp_username && t.smtp_password && t.sender_email);
}

// Aktive Versand-Domain: bevorzugt primary_domain (Admin-Override für Fallback),
// fällt auf tenants.domain zurück. Wird in allen Portal-Links genutzt.
function portalHost(t: TenantRow): string {
  return `portal.${t.primary_domain ?? t.domain}`;
}

interface TenantRow {
  id: string;
  name: string;
  domain: string | null;
  primary_domain: string | null;
  primary_domain_changed_at: string | null;
  logo_url: string | null;
  primary_color: string | null;
  sender_email: string | null;
  sender_name: string | null;
  reply_to_email: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_username: string | null;
  smtp_password: string | null;
  reminder_invite_subject: string | null;
  reminder_invite_body: string | null;
  reminder_confirm_subject: string | null;
  reminder_confirm_body: string | null;
  reminder_completion_subject: string | null;
  reminder_completion_body: string | null;
  reminder_no_booking_subject: string | null;
  reminder_no_booking_body: string | null;
  reminder_recovery_subject: string | null;
  reminder_recovery_body: string | null;
}

type ReminderType = "invite" | "confirm_email" | "complete_registration" | "no_recent_booking" | "domain_recovery";

interface SendCtx {
  admin: ReturnType<typeof createClient>;
  tenants: Map<string, TenantRow>;
  dryRun: boolean;
  results: { type: ReminderType; email: string; status: string; error?: string }[];
  // Key: `${tenantId}:${reminderType}`
  sentCountByTenantType: Map<string, number>;
  // Live-Zähler: Mails pro Tenant in den letzten 12h (alle Typen, inkl. heutigem Lauf).
  sentCountByTenant12h: Map<string, number>;
  // Recovery-spezifische Vorschau-Zähler (pro Tenant aggregiert):
  recoveryStats: Map<string, { total_eligible: number; would_send_this_run: number; already_done_since_change: number; no_change_anchor: boolean }>;
}

// Auth-Gate: nur Cron (mit CRON_SECRET) oder eingeloggter Admin dürfen triggern.
async function authorize(req: Request, admin: any): Promise<{ ok: true } | { ok: false; status: number; msg: string }> {
  const cronSecret = Deno.env.get("CRON_SECRET");
  const url = new URL(req.url);
  const providedSecret = req.headers.get("x-cron-secret") ?? url.searchParams.get("key");
  if (cronSecret && providedSecret && providedSecret === cronSecret) return { ok: true };

  const authHeader = req.headers.get("authorization") ?? "";
  const jwt = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  if (!jwt) return { ok: false, status: 401, msg: "Unauthorized" };

  const { data: userRes, error: uErr } = await admin.auth.getUser(jwt);
  if (uErr || !userRes?.user) return { ok: false, status: 401, msg: "Unauthorized" };

  const { data: role } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userRes.user.id)
    .eq("role", "admin")
    .maybeSingle();
  if (!role) return { ok: false, status: 403, msg: "Forbidden" };
  return { ok: true };
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
    if (!authz.ok) return json({ error: authz.msg }, authz.status);

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const dryRun = body?.dry_run === true;
    const onlyType: ReminderType | null = body?.only_type ?? null;
    const ignoreQuietHours = body?.ignore_quiet_hours === true;
    const mode: string = body?.mode ?? "reminders";
    const recoveryTenantId: string | null = body?.tenant_id ?? null;
    const retryFailedOnly: boolean = body?.retry_failed_only === true;

    // Quiet-Hours-Guard: keine Mails nachts. Cron-Läufe außerhalb 08–20 Uhr enden hier sofort.
    if (!dryRun && !ignoreQuietHours && isQuietHours()) {
      return json({
        success: true,
        skipped: "quiet_hours",
        berlin_hour: berlinHour(),
        message: `Außerhalb der Sendezeit (${QUIET_HOURS_START}:00–${QUIET_HOURS_END}:00 Europe/Berlin). Es wurden keine Mails gesendet.`,
      }, 200);
    }

    // Tenants vorladen
    const { data: tList, error: tErr } = await admin
      .from("tenants")
      .select("id,name,domain,primary_domain,primary_domain_changed_at,is_active,emails_paused,emails_paused_reason,logo_url,primary_color,sender_email,sender_name,reply_to_email,smtp_host,smtp_port,smtp_username,smtp_password,reminder_invite_subject,reminder_invite_body,reminder_confirm_subject,reminder_confirm_body,reminder_completion_subject,reminder_completion_body,reminder_no_booking_subject,reminder_no_booking_body,reminder_recovery_subject,reminder_recovery_body");
    if (tErr) return json({ error: tErr.message }, 500);

    const tenants = new Map<string, TenantRow>();
    (tList ?? []).forEach((t: any) => {
      // Deaktivierte oder pausierte Tenants komplett überspringen — globaler Kill-Switch.
      if (t.is_active === false) return;
      if (t.emails_paused) return;
      tenants.set(t.id, t as TenantRow);
    });

    const ctx: SendCtx = { admin, tenants, dryRun, results: [], sentCountByTenantType: new Map(), sentCountByTenant12h: new Map(), recoveryStats: new Map() };

    // 24h-Cap pro Tenant vorladen (alle bisherigen sent in den letzten 24h).
    {
      const cutoff24h = new Date(Date.now() - 24 * 3600_000).toISOString();
      const { data: recent } = await admin
        .from("reminder_log")
        .select("tenant_id")
        .eq("status", "sent")
        .gte("sent_at", cutoff24h);
      for (const r of (recent ?? []) as Array<{ tenant_id: string | null }>) {
        if (!r.tenant_id) continue;
        ctx.sentCountByTenant12h.set(r.tenant_id, (ctx.sentCountByTenant12h.get(r.tenant_id) ?? 0) + 1);
      }
    }

    if (mode === "domain_recovery") {
      if (!recoveryTenantId) return json({ error: "tenant_id required for domain_recovery" }, 400);
      await runDomainRecovery(ctx, recoveryTenantId, { retryFailedOnly });
    } else {
      if (!onlyType || onlyType === "invite") await runInvites(ctx);
      if (!onlyType || onlyType === "confirm_email") await runConfirmEmail(ctx);
      if (!onlyType || onlyType === "complete_registration") await runCompleteRegistration(ctx);
      if (!onlyType || onlyType === "no_recent_booking") await runNoRecentBooking(ctx);
      // Auto-Trigger: Tenants mit kürzlich gewechselter Primary-Domain bekommen
      // gestaffelt Recovery-Mails ohne manuellen Klick.
      const windowMs = DOMAIN_RECOVERY_AUTO_WINDOW_DAYS * 86400_000;
      for (const t of tenants.values()) {
        if (!t.primary_domain_changed_at) continue;
        const age = Date.now() - new Date(t.primary_domain_changed_at).getTime();
        if (age < 0 || age > windowMs) continue;
        await runDomainRecovery(ctx, t.id, { retryFailedOnly: false });
      }
    }

    // Keine Empfänger-Details in der Response (würde sonst Mail-Adressen leaken).
    // Aggregierte Zähler pro Typ reichen für das Admin-UI.
    const byType: Record<string, { sent: number; skipped: number; failed: number }> = {};
    for (const r of ctx.results) {
      const k = r.type;
      byType[k] ??= { sent: 0, skipped: 0, failed: 0 };
      byType[k][r.status as "sent" | "skipped" | "failed"]++;
    }

    return json({
      success: true,
      dry_run: dryRun,
      sent: ctx.results.filter(r => r.status === "sent").length,
      skipped: ctx.results.filter(r => r.status === "skipped").length,
      failed: ctx.results.filter(r => r.status === "failed").length,
      by_type: byType,
      recovery: Object.fromEntries(ctx.recoveryStats),
    }, 200);
  } catch (err: any) {
    console.error(err);
    return json({ error: err?.message ?? "Unknown error" }, 500);
  }
});

// ───── Gate ─────
async function canSend(
  admin: SendCtx["admin"],
  email: string,
  type: ReminderType,
): Promise<{ ok: boolean; nextAttempt: number; reason?: string }> {
  // Bounce-Schutz: tote Adressen niemals erneut anschreiben.
  const isBounced = await isEmailBounced(admin, email);
  if (isBounced) return { ok: false, nextAttempt: 0, reason: "email_bounced" };

  // Cold-Status: Bewerbung wurde nach 3 Remindern manuell parkiert → Auto-Reminder aussetzen.
  const { data: cold } = await admin
    .from("applications").select("id").ilike("email", email).eq("status_cold", true).limit(1).maybeSingle();
  if (cold) return { ok: false, nextAttempt: 0, reason: "cold_lead" };

  const { data, error } = await admin
    .from("reminder_log")
    .select("attempt, sent_at, status")
    .eq("email", email)
    .eq("reminder_type", type)
    .order("sent_at", { ascending: false });
  if (error) return { ok: false, nextAttempt: 0, reason: error.message };

  const sentLogs = (data ?? []).filter((r: any) => r.status === "sent");
  if (sentLogs.length >= MAX_ATTEMPTS) return { ok: false, nextAttempt: 0, reason: "max_attempts" };

  if (sentLogs.length > 0) {
    const lastAt = new Date(sentLogs[0].sent_at).getTime();
    const ageHours = (Date.now() - lastAt) / (1000 * 60 * 60);
    // Nächster Attempt = sentLogs.length (0-basiert): [0]=24h, [1]=48h, [2]=72h.
    const needHours = ATTEMPT_HOURS[sentLogs.length] ?? 72;
    if (ageHours < needHours) return { ok: false, nextAttempt: 0, reason: "too_soon" };
  }
  return { ok: true, nextAttempt: sentLogs.length + 1 };
}

async function isEmailBounced(admin: SendCtx["admin"], email: string): Promise<boolean> {
  const lc = email.toLowerCase();
  // Check applications zuerst (häufiger Treffer für invite-Flow)
  const { data: app } = await admin
    .from("applications")
    .select("email_status")
    .ilike("email", lc)
    .neq("email_status", "active")
    .limit(1)
    .maybeSingle();
  if (app) return true;
  // Profiles via auth.users (E-Mail liegt nicht in profiles)
  const { data: usersList } = await admin.auth.admin.listUsers({ page: 1, perPage: 5000 });
  const user = (usersList?.users ?? []).find((u: any) => (u.email ?? "").toLowerCase() === lc);
  if (!user) return false;
  const { data: prof } = await admin
    .from("profiles")
    .select("email_status")
    .eq("user_id", user.id)
    .neq("email_status", "active")
    .limit(1)
    .maybeSingle();
  return !!prof;
}

async function logReminder(
  admin: SendCtx["admin"],
  email: string,
  tenantId: string | null,
  type: ReminderType,
  attempt: number,
  status: "sent" | "failed" | "skipped",
  error?: string,
) {
  await admin.from("reminder_log").insert({
    email, tenant_id: tenantId, reminder_type: type, attempt: Math.max(1, attempt), status, error: error ?? null,
  });
}

// Skipped-Events ebenfalls persistieren, damit der Admin-Audit-Log alle
// übersprungenen Empfänger nachvollziehen kann (cap, bounced, too_soon, …).
async function logSkipped(
  admin: SendCtx["admin"],
  email: string,
  tenantId: string | null,
  type: ReminderType,
  reason: string,
) {
  if (!email) return;
  try {
    await admin.from("reminder_log").insert({
      email, tenant_id: tenantId, reminder_type: type, attempt: 1, status: "skipped", error: reason,
    });
  } catch { /* best-effort */ }
}

// Anti-Spam: bei reason="max_attempts" markiert die Bewerbung als cold,
// damit Cron-Reminder für diese E-Mail komplett aussetzen und im Admin als
// „Cold Leads" sichtbar werden (manueller Eingriff nötig).
async function maybeMarkCold(
  admin: SendCtx["admin"],
  email: string,
  tenantId: string | null,
  type: ReminderType,
  reason: string | undefined,
) {
  if (reason !== "max_attempts" || !email) return;
  try {
    let q = admin.from("applications")
      .update({ status_cold: true, cold_at: new Date().toISOString(), cold_reason: `max_${type}` })
      .ilike("email", email)
      .eq("status_cold", false);
    if (tenantId) q = q.eq("tenant_id", tenantId);
    await q;
  } catch { /* best-effort */ }
}

// Cap-Check pro Tenant + Typ
function capReached(ctx: SendCtx, tenantId: string, type: ReminderType): boolean {
  const key = `${tenantId}:${type}`;
  return (ctx.sentCountByTenantType.get(key) ?? 0) >= MAX_SENDS_PER_RUN_PER_TENANT;
}
// 24h-Obergrenze pro Tenant über alle Reminder-Typen (Welle-1-Cap: 140/Tag).
function tenant12hCapReached(ctx: SendCtx, tenantId: string): boolean {
  return (ctx.sentCountByTenant12h.get(tenantId) ?? 0) >= MAX_SENDS_PER_TENANT_PER_24H;
}
function bumpSent(ctx: SendCtx, tenantId: string, type: ReminderType) {
  const key = `${tenantId}:${type}`;
  ctx.sentCountByTenantType.set(key, (ctx.sentCountByTenantType.get(key) ?? 0) + 1);
  ctx.sentCountByTenant12h.set(tenantId, (ctx.sentCountByTenant12h.get(tenantId) ?? 0) + 1);
}

// Schreibt einen Eintrag in email_send_log (zentrale Logs-Tabelle, die das
// Admin-UI /admin/email-logs anzeigt). Enthält gerendertes Subject/HTML und
// Absender, damit die Vorschau auch für Reminder-Mails funktioniert.
async function logEmailSend(
  admin: SendCtx["admin"],
  tenant: TenantRow | null,
  type: ReminderType,
  email: string,
  subject: string,
  html: string | null,
  status: "sent" | "failed",
  error?: string,
  extraMeta?: Record<string, unknown>,
) {
  try {
    const senderEmail = tenant ? (tenant.sender_email ?? tenant.smtp_username ?? null) : null;
    const fromName = tenant ? (tenant.sender_name ?? tenant.name) : null;
    const messageId = `${type}-${crypto.randomUUID()}`;
    const templateMap: Record<ReminderType, string> = {
      invite: "reminder_invite",
      confirm_email: "reminder_confirm_email",
      complete_registration: "reminder_complete_registration",
      no_recent_booking: "reminder_no_recent_booking",
      domain_recovery: "reminder_domain_recovery",
    };
    await admin.from("email_send_log").insert({
      message_id: messageId,
      template_name: templateMap[type],
      recipient_email: email,
      status,
      error_message: error ?? null,
      rendered_subject: subject,
      rendered_html: html,
      sender_email: senderEmail,
      tenant_id: tenant?.id ?? null,
      metadata: {
        reminder_type: type,
        from_name: fromName,
        from_email: senderEmail,
        smtp_host: tenant?.smtp_host ?? null,
        subject,
        ...(extraMeta ?? {}),
      },
    });
  } catch (e) {
    console.error("logEmailSend failed", e);
  }
}

// ───── 1. Invite-Reminder ─────
async function runInvites(ctx: SendCtx) {
  // Akzeptierte Bewerbungen, älter als 3 Tage
  const cutoff = new Date(Date.now() - MIN_DAYS_BETWEEN * 86400_000).toISOString();
  const { data: apps, error } = await ctx.admin
    .from("applications")
    .select("id,email,full_name,first_name,last_name,tenant_id,status,created_at")
    .eq("status", "akzeptiert")
    .lte("created_at", cutoff);
  if (error) { console.error("invite query", error); return; }

  // Bestehende Auth-Accounts (Mail-Set) laden
  const { data: usersList } = await ctx.admin.auth.admin.listUsers({ page: 1, perPage: 5000 });
  const existing = new Set<string>((usersList?.users ?? []).map(u => (u.email ?? "").toLowerCase()));

  // ── Reminder-Dedup mit Drip-Queue ──
  // Wenn ein Bewerber im invite_resend_queue (status=queued/sending) steht, übernimmt
  // der Drip-Worker den Versand. Reminder-Cron MUSS dann skippen, sonst Doppelmail.
  const { data: dripRows } = await ctx.admin
    .from("invite_resend_queue")
    .select("email,status")
    .in("status", ["queued", "sending"]);
  const inDripQueue = new Set<string>(
    (dripRows ?? []).map((r: any) => (r.email ?? "").toLowerCase()).filter(Boolean)
  );

  for (const app of apps ?? []) {
    const email = (app.email ?? "").toLowerCase();
    if (!email || existing.has(email)) continue;
    if (inDripQueue.has(email)) {
      ctx.results.push({ type: "invite", email, status: "skipped", error: "in_drip_queue" });
      await logSkipped(ctx.admin, email, app.tenant_id ?? null, "invite", "in_drip_queue");
      continue;
    }

    const tenant = app.tenant_id ? ctx.tenants.get(app.tenant_id) : null;
    if (!hasValidSmtp(tenant)) {
      ctx.results.push({ type: "invite", email, status: "skipped", error: "no_tenant_smtp" });
      await logSkipped(ctx.admin, email, app.tenant_id ?? null, "invite", "no_tenant_smtp");
      continue;
    }
    if (capReached(ctx, tenant.id, "invite")) { ctx.results.push({ type: "invite", email, status: "skipped", error: "tenant_run_cap_reached" }); await logSkipped(ctx.admin, email, tenant.id, "invite", "tenant_run_cap_reached"); continue; }
    if (tenant12hCapReached(ctx, tenant.id)) { ctx.results.push({ type: "invite", email, status: "skipped", error: "tenant_12h_cap_reached" }); await logSkipped(ctx.admin, email, tenant.id, "invite", "tenant_12h_cap_reached"); continue; }

    const gate = await canSend(ctx.admin, email, "invite");
    if (!gate.ok) { ctx.results.push({ type: "invite", email, status: "skipped", error: gate.reason }); await logSkipped(ctx.admin, email, tenant.id, "invite", gate.reason ?? "skip"); await maybeMarkCold(ctx.admin, email, tenant.id, "invite", gate.reason); continue; }

    if (ctx.dryRun) { ctx.results.push({ type: "invite", email, status: "sent" }); continue; }

    const portalLink = `https://${portalHost(tenant)}/register`;
    const firstName = app.first_name ?? (app.full_name ?? "").split(" ")[0] ?? "";
    const vars = baseVars(tenant, { first_name: firstName, portal_link: portalLink, login_link: portalLink, confirmation_link: portalLink, booking_link: portalLink });
    const subject = renderSubject(tenant.reminder_invite_subject, DEFAULT_TEMPLATES.invite.subject, vars);
    const html = renderBodyHtml(tenant, tenant.reminder_invite_body, DEFAULT_TEMPLATES.invite.body, vars);

    try {
      await sendMail(tenant, email, subject, html);
      await logReminder(ctx.admin, email, tenant.id, "invite", gate.nextAttempt, "sent");
      await logEmailSend(ctx.admin, tenant, "invite", email, subject, html, "sent");
      ctx.results.push({ type: "invite", email, status: "sent" });
      bumpSent(ctx, tenant.id, "invite");
      await jitterDelay();
    } catch (e: any) {
      const errMsg = String(e?.message ?? e);
      await logReminder(ctx.admin, email, tenant.id, "invite", gate.nextAttempt, "failed", errMsg);
      await logEmailSend(ctx.admin, tenant, "invite", email, subject, html, "failed", errMsg);
      ctx.results.push({ type: "invite", email, status: "failed", error: errMsg });
      await maybeMarkBounced(ctx.admin, email, e);
    }
  }
}

// ───── 2. Confirm-Email-Reminder ─────
async function runConfirmEmail(ctx: SendCtx) {
  const { data: usersList } = await ctx.admin.auth.admin.listUsers({ page: 1, perPage: 5000 });
  const BLOCKED = new Set(["deaktiviert", "abgelehnt"]);
  const unconfirmed = (usersList?.users ?? []).filter(u => {
    if (!u.email || u.email_confirmed_at) return false;
    // Skip gebannte Auth-User
    const banned = (u as any).banned_until;
    if (banned && new Date(banned).getTime() > Date.now()) return false;
    return true;
  });

  // Profile für tenant_id-Lookup + Status-Filter
  const userIds = unconfirmed.map(u => u.id);
  let tenantByUser = new Map<string, string>();
  const blockedUsers = new Set<string>();
  if (userIds.length > 0) {
    const { data: profiles } = await ctx.admin
      .from("profiles")
      .select("user_id,tenant_id,status")
      .in("user_id", userIds);
    (profiles ?? []).forEach((p: any) => {
      if (p.tenant_id) tenantByUser.set(p.user_id, p.tenant_id);
      if (BLOCKED.has(p.status)) blockedUsers.add(p.user_id);
    });
  }

  const cutoffMs = MIN_DAYS_BETWEEN * 86400_000;
  for (const u of unconfirmed) {
    if (blockedUsers.has(u.id)) continue;
    const created = new Date(u.created_at!).getTime();
    if (Date.now() - created < cutoffMs) continue;

    const email = u.email!.toLowerCase();
    const tenantId = tenantByUser.get(u.id);
    const tenant = tenantId ? ctx.tenants.get(tenantId) : null;

    if (!hasValidSmtp(tenant)) { ctx.results.push({ type: "confirm_email", email, status: "skipped", error: "no_tenant_smtp" }); await logSkipped(ctx.admin, email, tenantId ?? null, "confirm_email", "no_tenant_smtp"); continue; }
    if (capReached(ctx, tenant.id, "confirm_email")) { ctx.results.push({ type: "confirm_email", email, status: "skipped", error: "tenant_run_cap_reached" }); await logSkipped(ctx.admin, email, tenant.id, "confirm_email", "tenant_run_cap_reached"); continue; }
    if (tenant12hCapReached(ctx, tenant.id)) { ctx.results.push({ type: "confirm_email", email, status: "skipped", error: "tenant_12h_cap_reached" }); await logSkipped(ctx.admin, email, tenant.id, "confirm_email", "tenant_12h_cap_reached"); continue; }

    const gate = await canSend(ctx.admin, email, "confirm_email");
    if (!gate.ok) { ctx.results.push({ type: "confirm_email", email, status: "skipped", error: gate.reason }); await logSkipped(ctx.admin, email, tenant.id, "confirm_email", gate.reason ?? "skip"); await maybeMarkCold(ctx.admin, email, tenant.id, "confirm_email", gate.reason); continue; }

    if (ctx.dryRun) { ctx.results.push({ type: "confirm_email", email, status: "sent" }); continue; }

    const redirectTo = `https://${portalHost(tenant)}/auth/confirmed`;
    const linkRes = await ctx.admin.auth.admin.generateLink({ type: "signup", email, options: { redirectTo } });
    const tokenHash = (linkRes.data?.properties as any)?.hashed_token;
    if (!tokenHash) {
      await logReminder(ctx.admin, email, tenant.id, "confirm_email", gate.nextAttempt, "failed", "no_token");
      await logEmailSend(ctx.admin, tenant, "confirm_email", email, "(no token)", null, "failed", "no_token");
      ctx.results.push({ type: "confirm_email", email, status: "failed", error: "no_token" });
      continue;
    }
    const actionLink = `${redirectTo}?token_hash=${encodeURIComponent(tokenHash)}&type=signup`;
    const vars = baseVars(tenant, { email, confirmation_link: actionLink, portal_link: actionLink, login_link: actionLink, booking_link: actionLink });
    const subject = renderSubject(tenant.reminder_confirm_subject, DEFAULT_TEMPLATES.confirm.subject, vars);
    const html = renderBodyHtml(tenant, tenant.reminder_confirm_body, DEFAULT_TEMPLATES.confirm.body, vars);

    try {
      await sendMail(tenant, email, subject, html);
      await logReminder(ctx.admin, email, tenant.id, "confirm_email", gate.nextAttempt, "sent");
      await logEmailSend(ctx.admin, tenant, "confirm_email", email, subject, html, "sent");
      ctx.results.push({ type: "confirm_email", email, status: "sent" });
      bumpSent(ctx, tenant.id, "confirm_email");
      await jitterDelay();
    } catch (e: any) {
      const errMsg = String(e?.message ?? e);
      await logReminder(ctx.admin, email, tenant.id, "confirm_email", gate.nextAttempt, "failed", errMsg);
      await logEmailSend(ctx.admin, tenant, "confirm_email", email, subject, html, "failed", errMsg);
      ctx.results.push({ type: "confirm_email", email, status: "failed", error: errMsg });
      await maybeMarkBounced(ctx.admin, email, e);
    }
  }
}

// ───── 3. Complete-Registration-Reminder ─────
async function runCompleteRegistration(ctx: SendCtx) {
  const cutoff = new Date(Date.now() - MIN_DAYS_BETWEEN * 86400_000).toISOString();
  const { data: profiles, error } = await ctx.admin
    .from("profiles")
    .select("user_id,full_name,tenant_id,onboarding_status,status,updated_at,created_at")
    .neq("onboarding_status", "abgeschlossen")
    .not("status", "in", '("deaktiviert","abgelehnt")')
    .lte("created_at", cutoff);
  if (error) { console.error("complete query", error); return; }

  const userIds = (profiles ?? []).map((p: any) => p.user_id);
  if (userIds.length === 0) return;
  const { data: usersList } = await ctx.admin.auth.admin.listUsers({ page: 1, perPage: 5000 });
  const userMap = new Map<string, any>((usersList?.users ?? []).map(u => [u.id, u]));

  for (const p of profiles ?? []) {
    const u = userMap.get((p as any).user_id);
    if (!u || !u.email_confirmed_at || !u.email) continue; // nur bestätigte Accounts
    const email = u.email.toLowerCase();
    const tenant = (p as any).tenant_id ? ctx.tenants.get((p as any).tenant_id) : null;
    if (!hasValidSmtp(tenant)) { ctx.results.push({ type: "complete_registration", email, status: "skipped", error: "no_tenant_smtp" }); await logSkipped(ctx.admin, email, (p as any).tenant_id ?? null, "complete_registration", "no_tenant_smtp"); continue; }
    if (capReached(ctx, tenant.id, "complete_registration")) { ctx.results.push({ type: "complete_registration", email, status: "skipped", error: "tenant_run_cap_reached" }); await logSkipped(ctx.admin, email, tenant.id, "complete_registration", "tenant_run_cap_reached"); continue; }
    if (tenant12hCapReached(ctx, tenant.id)) { ctx.results.push({ type: "complete_registration", email, status: "skipped", error: "tenant_12h_cap_reached" }); await logSkipped(ctx.admin, email, tenant.id, "complete_registration", "tenant_12h_cap_reached"); continue; }

    const gate = await canSend(ctx.admin, email, "complete_registration");
    if (!gate.ok) { ctx.results.push({ type: "complete_registration", email, status: "skipped", error: gate.reason }); await logSkipped(ctx.admin, email, tenant.id, "complete_registration", gate.reason ?? "skip"); await maybeMarkCold(ctx.admin, email, tenant.id, "complete_registration", gate.reason); continue; }

    if (ctx.dryRun) { ctx.results.push({ type: "complete_registration", email, status: "sent" }); continue; }

    const firstName = ((p as any).full_name ?? "").split(" ")[0] ?? "";
    const loginLink = `https://${portalHost(tenant)}/login`;
    const vars = baseVars(tenant, { first_name: firstName, login_link: loginLink, portal_link: loginLink, booking_link: loginLink, confirmation_link: loginLink });
    const subject = renderSubject(tenant.reminder_completion_subject, DEFAULT_TEMPLATES.completion.subject, vars);
    const html = renderBodyHtml(tenant, tenant.reminder_completion_body, DEFAULT_TEMPLATES.completion.body, vars);

    try {
      await sendMail(tenant, email, subject, html);
      await logReminder(ctx.admin, email, tenant.id, "complete_registration", gate.nextAttempt, "sent");
      await logEmailSend(ctx.admin, tenant, "complete_registration", email, subject, html, "sent");
      ctx.results.push({ type: "complete_registration", email, status: "sent" });
      bumpSent(ctx, tenant.id, "complete_registration");
      await jitterDelay();
    } catch (e: any) {
      const errMsg = String(e?.message ?? e);
      await logReminder(ctx.admin, email, tenant.id, "complete_registration", gate.nextAttempt, "failed", errMsg);
      await logEmailSend(ctx.admin, tenant, "complete_registration", email, subject, html, "failed", errMsg);
      ctx.results.push({ type: "complete_registration", email, status: "failed", error: errMsg });
      await maybeMarkBounced(ctx.admin, email, e);
    }
  }
}

// ───── 4. No-Recent-Booking-Reminder ─────
async function runNoRecentBooking(ctx: SendCtx) {
  // Nur formal angenommene + onboarding-abgeschlossene Mitarbeiter.
  // 'registriert' oder andere Stati erhalten KEINE "Keine Buchung"-Mail,
  // selbst wenn onboarding_status fälschlich auf 'abgeschlossen' steht.
  const { data: profiles, error } = await ctx.admin
    .from("profiles")
    .select("user_id,full_name,tenant_id,onboarding_status,status,created_at")
    .eq("onboarding_status", "abgeschlossen")
    .eq("status", "angenommen");
  if (error) { console.error("no_booking query", error); return; }
  if (!profiles || profiles.length === 0) return;

  const userIds = profiles.map((p: any) => p.user_id);
  const cutoffIso = new Date(Date.now() - NO_BOOKING_DAYS * 86400_000).toISOString();

  const { data: recentBookings } = await ctx.admin
    .from("bookings")
    .select("user_id,created_at,status")
    .in("user_id", userIds)
    .gte("created_at", cutoffIso)
    .neq("status", "cancelled");
  const hasRecent = new Set<string>((recentBookings ?? []).map((b: any) => b.user_id));

  const { data: usersList } = await ctx.admin.auth.admin.listUsers({ page: 1, perPage: 5000 });
  const userMap = new Map<string, any>((usersList?.users ?? []).map(u => [u.id, u]));

  for (const p of profiles) {
    const uid = (p as any).user_id;
    if (hasRecent.has(uid)) continue;

    const u = userMap.get(uid);
    if (!u || !u.email || !u.email_confirmed_at) continue;

    const accountAgeMs = Date.now() - new Date(u.created_at!).getTime();
    if (accountAgeMs < NO_BOOKING_DAYS * 86400_000) continue;

    const email = u.email.toLowerCase();
    const tenant = (p as any).tenant_id ? ctx.tenants.get((p as any).tenant_id) : null;
    if (!hasValidSmtp(tenant)) {
      ctx.results.push({ type: "no_recent_booking", email, status: "skipped", error: "no_tenant_smtp" });
      await logSkipped(ctx.admin, email, (p as any).tenant_id ?? null, "no_recent_booking", "no_tenant_smtp");
      continue;
    }
    if (capReached(ctx, tenant.id, "no_recent_booking")) { ctx.results.push({ type: "no_recent_booking", email, status: "skipped", error: "tenant_run_cap_reached" }); await logSkipped(ctx.admin, email, tenant.id, "no_recent_booking", "tenant_run_cap_reached"); continue; }
    if (tenant12hCapReached(ctx, tenant.id)) { ctx.results.push({ type: "no_recent_booking", email, status: "skipped", error: "tenant_12h_cap_reached" }); await logSkipped(ctx.admin, email, tenant.id, "no_recent_booking", "tenant_12h_cap_reached"); continue; }

    const gate = await canSend(ctx.admin, email, "no_recent_booking");
    if (!gate.ok) { ctx.results.push({ type: "no_recent_booking", email, status: "skipped", error: gate.reason }); await logSkipped(ctx.admin, email, tenant.id, "no_recent_booking", gate.reason ?? "skip"); await maybeMarkCold(ctx.admin, email, tenant.id, "no_recent_booking", gate.reason); continue; }

    if (ctx.dryRun) { ctx.results.push({ type: "no_recent_booking", email, status: "sent" }); continue; }

    const firstName = ((p as any).full_name ?? "").split(" ")[0] ?? "";
    const bookingLink = `https://${portalHost(tenant)}/appointments`;
    const vars = baseVars(tenant, { first_name: firstName, booking_link: bookingLink, portal_link: bookingLink, login_link: bookingLink, confirmation_link: bookingLink });
    const subject = renderSubject(tenant.reminder_no_booking_subject, DEFAULT_TEMPLATES.no_booking.subject, vars);
    const html = renderBodyHtml(tenant, tenant.reminder_no_booking_body, DEFAULT_TEMPLATES.no_booking.body, vars);

    try {
      await sendMail(tenant, email, subject, html);
      await logReminder(ctx.admin, email, tenant.id, "no_recent_booking", gate.nextAttempt, "sent");
      await logEmailSend(ctx.admin, tenant, "no_recent_booking", email, subject, html, "sent");
      ctx.results.push({ type: "no_recent_booking", email, status: "sent" });
      bumpSent(ctx, tenant.id, "no_recent_booking");
      await jitterDelay();
    } catch (e: any) {
      const errMsg = String(e?.message ?? e);
      await logReminder(ctx.admin, email, tenant.id, "no_recent_booking", gate.nextAttempt, "failed", errMsg);
      await logEmailSend(ctx.admin, tenant, "no_recent_booking", email, subject, html, "failed", errMsg);
      ctx.results.push({ type: "no_recent_booking", email, status: "failed", error: errMsg });
      await maybeMarkBounced(ctx.admin, email, e);
    }
  }
}

// ───── 5. Domain-Recovery (gestaffelter Versand nach Domain-Wechsel) ─────
// Idempotenz pro Primary-Domain-Wechsel: jeder Mitarbeiter erhält genau eine
// erfolgreiche Recovery-Mail je `tenants.primary_domain_changed_at`-Wert.
// Cap: DOMAIN_RECOVERY_CAP_PER_RUN (20) — verteilt sich über die Cron-Läufe
// (12/Tag) auf ~200 Mails/12h pro Tenant.
async function runDomainRecovery(ctx: SendCtx, tenantId: string, opts: { retryFailedOnly: boolean }) {
  const tenant = ctx.tenants.get(tenantId);
  if (!hasValidSmtp(tenant)) {
    ctx.results.push({ type: "domain_recovery", email: "", status: "failed", error: "no_tenant_smtp" });
    return;
  }

  const stats = { total_eligible: 0, would_send_this_run: 0, already_done_since_change: 0, no_change_anchor: !tenant.primary_domain_changed_at };
  ctx.recoveryStats.set(tenantId, stats);

  // ── Empfänger sammeln ──
  // Nur Mitarbeiter mit Auth-Account (ohne deaktiviert/abgelehnt).
  // Bewerber laufen über reminder_invite mit aktuellem Portal-Link.
  const { data: profiles, error: pErr } = await ctx.admin
    .from("profiles")
    .select("id,user_id,full_name,tenant_id,status,email_status")
    .eq("tenant_id", tenantId)
    .not("status", "in", '("deaktiviert","abgelehnt")');
  if (pErr) { console.error("recovery profiles query", pErr); return; }

  // Bewerber sind aus Recovery ausgeschlossen — sie laufen über den
  // normalen `reminder_invite`-Reminder mit aktuellem Portal-Link.
  // Recovery ist nur für Mitarbeiter mit Auth-Account.

  const { data: usersList } = await ctx.admin.auth.admin.listUsers({ page: 1, perPage: 5000 });
  const userMap = new Map<string, any>((usersList?.users ?? []).map(u => [u.id, u]));

  type Recipient = { email: string; first_name: string; profile_id: string };
  const recipients: Recipient[] = [];
  const seen = new Set<string>();

  for (const p of profiles ?? []) {
    // Bounce-Schutz: tote Adressen überspringen.
    if ((p as any).email_status && (p as any).email_status !== "active") continue;
    const u = userMap.get((p as any).user_id);
    if (!u?.email) continue;
    const email = u.email.toLowerCase();
    if (seen.has(email)) continue;
    seen.add(email);
    const firstName = ((p as any).full_name ?? "").split(" ")[0] ?? "";
    recipients.push({ email, first_name: firstName, profile_id: (p as any).id });
  }

  // ── Idempotenz-Anker ──
  // alreadyDone: erfolgreich seit primary_domain_changed_at → überspringen
  // retryTargets: failed seit primary_domain_changed_at → bei retryFailedOnly nur diese
  const changedAt = tenant.primary_domain_changed_at;
  const alreadyDone = new Set<string>();
  const failedSinceChange = new Set<string>();
  if (changedAt) {
    const { data: doneLogs } = await ctx.admin
      .from("reminder_log")
      .select("email,status")
      .eq("tenant_id", tenantId)
      .eq("reminder_type", "domain_recovery")
      .gte("sent_at", changedAt);
    for (const r of doneLogs ?? []) {
      const email = String((r as any).email).toLowerCase();
      if ((r as any).status === "sent") alreadyDone.add(email);
      else if ((r as any).status === "failed") failedSinceChange.add(email);
    }
  }

  let sentThisRun = 0;
  for (const rec of recipients) {
    stats.total_eligible++;

    if (alreadyDone.has(rec.email)) {
      stats.already_done_since_change++;
      continue;
    }
    if (opts.retryFailedOnly && !failedSinceChange.has(rec.email)) {
      continue;
    }

    if (sentThisRun >= DOMAIN_RECOVERY_CAP_PER_RUN) {
      ctx.results.push({ type: "domain_recovery", email: rec.email, status: "skipped", error: "recovery_run_cap_reached" });
      await logSkipped(ctx.admin, rec.email, tenant.id, "domain_recovery", "recovery_run_cap_reached");
      continue;
    }
    if (tenant12hCapReached(ctx, tenant.id)) {
      ctx.results.push({ type: "domain_recovery", email: rec.email, status: "skipped", error: "tenant_12h_cap_reached" });
      await logSkipped(ctx.admin, rec.email, tenant.id, "domain_recovery", "tenant_12h_cap_reached");
      continue;
    }

    stats.would_send_this_run++;

    if (ctx.dryRun) {
      ctx.results.push({ type: "domain_recovery", email: rec.email, status: "sent" });
      sentThisRun++;
      continue;
    }

    const attempt = (ctx.sentCountByTenantType.get(`${tenant.id}:domain_recovery`) ?? 0) + 1;
    const portalLink = `https://${portalHost(tenant)}/login`;
    const vars = baseVars(tenant, { first_name: rec.first_name, portal_link: portalLink, login_link: portalLink, booking_link: portalLink, confirmation_link: portalLink });
    const subject = renderSubject(tenant.reminder_recovery_subject, DEFAULT_TEMPLATES.domain_recovery_mitarbeiter.subject, vars);
    const html = renderBodyHtml(tenant, tenant.reminder_recovery_body, DEFAULT_TEMPLATES.domain_recovery_mitarbeiter.body, vars, { withDomainBanner: false });

    try {
      await sendMail(tenant, rec.email, subject, html);
      await logReminder(ctx.admin, rec.email, tenant.id, "domain_recovery", attempt, "sent");
      await logEmailSend(ctx.admin, tenant, "domain_recovery", rec.email, subject, html, "sent");
      ctx.results.push({ type: "domain_recovery", email: rec.email, status: "sent" });
      bumpSent(ctx, tenant.id, "domain_recovery");
      sentThisRun++;
      await jitterDelay();
    } catch (e: any) {
      const errMsg = String(e?.message ?? e);
      await logReminder(ctx.admin, rec.email, tenant.id, "domain_recovery", attempt, "failed", errMsg);
      await logEmailSend(ctx.admin, tenant, "domain_recovery", rec.email, subject, html, "failed", errMsg);
      ctx.results.push({ type: "domain_recovery", email: rec.email, status: "failed", error: errMsg });
      // Hard-Bounce-Detection: SMTP 5.x.x → Empfänger als 'bounced' markieren.
      await maybeMarkBounced(ctx.admin, rec.email, e);
    }
  }
}

// Setzt profiles.email_status / applications.email_status auf 'bounced',
// wenn der SMTP-Fehler ein dauerhafter 5.x.x ist (z.B. 550 No such user).
// 4.x.x (Mailbox voll, temporär) wird ignoriert — kommt evtl. wieder.
async function maybeMarkBounced(admin: any, email: string, err: any) {
  const code = Number(err?.responseCode ?? err?.code ?? 0);
  const msg = String(err?.message ?? err ?? "");
  const isHardBounce = (code >= 500 && code < 600) || /\b5\d{2}\b/.test(msg);
  if (!isHardBounce) return;
  const reason = (msg.slice(0, 240)) || `SMTP ${code}`;
  const at = new Date().toISOString();
  try {
    await admin.from("profiles").update({ email_status: "bounced", email_bounced_at: at, email_bounce_reason: reason })
      .eq("email_status", "active")
      .in("user_id", (await admin.auth.admin.listUsers({ page: 1, perPage: 5000 })).data.users
        .filter((u: any) => (u.email ?? "").toLowerCase() === email.toLowerCase())
        .map((u: any) => u.id));
    await admin.from("applications").update({ email_status: "bounced", email_bounced_at: at, email_bounce_reason: reason })
      .eq("email_status", "active").ilike("email", email);
  } catch (e) {
    console.error("maybeMarkBounced failed", e);
  }
}



// ───── Mailversand ─────
// Cache: pro Tenant-ID merken wir, ob verify() bereits OK war oder hart pausiert.
// Verhindert n× verify pro Cron-Lauf bei großen Batches.
const _verifyCache = new Map<string, { ok: boolean; reason?: string }>();

async function sendMail(tenant: TenantRow, to: string, subject: string, html: string) {
  const transporter = nodemailer.createTransport({
    host: tenant.smtp_host!,
    port: tenant.smtp_port!,
    secure: tenant.smtp_port === 465,
    auth: { user: tenant.smtp_username!, pass: tenant.smtp_password! },
  });

  let cached = _verifyCache.get(tenant.id);
  if (!cached) {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { autoRefreshToken: false, persistSession: false } });
    cached = await verifyOrPause(admin, tenant, transporter);
    _verifyCache.set(tenant.id, cached);
  }
  if (!cached.ok) {
    throw new Error(`SMTP-Verify fehlgeschlagen: ${cached.reason ?? "unknown"}`);
  }

  const senderName = tenant.sender_name ?? tenant.name;
  const senderEmail = tenant.sender_email ?? tenant.smtp_username!;
  await transporter.sendMail({
    from: `"${senderName}" <${senderEmail}>`,
    to,
    replyTo: tenant.reply_to_email ?? senderEmail,
    subject,
    html,
  });
}

async function verifyOrPause(admin: any, tenant: any, transporter: any): Promise<{ ok: boolean; reason?: string; paused?: boolean }> {
  try {
    await Promise.race([
      transporter.verify(),
      new Promise((_r, rej) => setTimeout(() => rej(new Error("verify timeout 8s")), 8000)),
    ]);
    await admin.from("tenant_smtp_health").upsert({
      tenant_id: tenant.id, consecutive_fails: 0,
      last_verify_at: new Date().toISOString(), last_verify_ok: true, updated_at: new Date().toISOString(),
    });
    return { ok: true };
  } catch (e: any) {
    const reason = String(e?.message ?? e);
    const { data: h } = await admin.from("tenant_smtp_health").select("consecutive_fails").eq("tenant_id", tenant.id).maybeSingle();
    const fails = (h?.consecutive_fails ?? 0) + 1;
    await admin.from("tenant_smtp_health").upsert({
      tenant_id: tenant.id, consecutive_fails: fails,
      last_fail_at: new Date().toISOString(), last_fail_error: reason,
      last_verify_at: new Date().toISOString(), last_verify_ok: false, updated_at: new Date().toISOString(),
    });
    let paused = false;
    if (fails >= 3 && !tenant.emails_paused) {
      await admin.from("tenants").update({
        emails_paused: true,
        emails_paused_at: new Date().toISOString(),
        emails_paused_reason: `SMTP-Verify ${fails}x fehlgeschlagen: ${reason}`,
        emails_paused_by: "auto:smtp_verify",
      }).eq("id", tenant.id);
      await admin.from("activity_log").insert({
        action: "emails_auto_pausiert", entity_type: "tenant", entity_id: tenant.id,
        comment: `SMTP-Versand auto-pausiert nach ${fails} Verify-Fails: ${reason}`,
      }).then(() => {}, () => {});
      paused = true;
    }
    return { ok: false, reason, paused };
  }
}

// ───── Templates ─────
function shellHtml(tenant: TenantRow, inner: string, opts?: { banner?: string }): string {
  const brand = tenant.primary_color ?? "#0f172a";
  const logo = tenant.logo_url
    ? `<img src="${tenant.logo_url}" alt="${escapeHtml(tenant.name)}" style="max-height:40px;margin-bottom:24px"/>`
    : `<div style="font-weight:700;font-size:20px;margin-bottom:24px;color:${brand}">${escapeHtml(tenant.name)}</div>`;
  const banner = opts?.banner ?? "";
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:40px;max-width:560px">
<tr><td>${logo}${banner}${inner}
<hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0"/>
<p style="font-size:12px;color:#94a3b8;margin:0">Diese Erinnerung wurde automatisch versendet. Wenn du sie nicht mehr benötigst, kannst du sie ignorieren.</p>
</td></tr></table></td></tr></table></body></html>`;
}

// Domain-Wechsel-Hinweis: wird in allen regulären Reminder-Mails (NICHT in
// domain_recovery selbst) oberhalb des Bodys gezeigt, wenn der Primary-Domain-
// Wechsel < DOMAIN_CHANGE_BANNER_DAYS her ist. Verhindert, dass Empfänger alte
// Mails mit nicht mehr funktionierenden Links anklicken.
function renderDomainChangeBanner(tenant: TenantRow): string {
  if (!tenant.primary_domain_changed_at) return "";
  const age = Date.now() - new Date(tenant.primary_domain_changed_at).getTime();
  if (age < 0 || age > DOMAIN_CHANGE_BANNER_DAYS * 86400_000) return "";
  const host = portalHost(tenant);
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0"><tr><td style="background:#fef3c7;border-left:4px solid #f59e0b;border-radius:6px;padding:14px 16px">
<div style="font-weight:600;color:#78350f;font-size:14px;margin:0 0 4px">Hinweis: Unsere Portal-Adresse hat sich geändert.</div>
<div style="font-size:13px;color:#78350f;line-height:1.5">Bitte nutze ab sofort <a href="https://${host}/login" style="color:#78350f;font-weight:600">https://${host}/login</a> – ältere Links funktionieren möglicherweise nicht mehr.</div>
</td></tr></table>`;
}


function btn(brand: string, href: string, label: string): string {
  return `<table cellpadding="0" cellspacing="0"><tr><td style="background:${brand};border-radius:8px">
<a href="${href}" style="display:inline-block;padding:14px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px">${label}</a>
</td></tr></table>`;
}

// ─── Tenant-overridable Templates ───
// Subjects sind Plain-Text (Placeholder werden ersetzt).
// Bodies sind HTML mit Placeholdern {{...}}. Wenn der Admin im UI Plain-Text
// schreibt, werden Zeilenumbrüche in <br> konvertiert.
const DEFAULT_TEMPLATES = {
  invite: {
    subject: "Erinnerung: Registrierung bei {{tenant_name}} abschließen",
    body: `<h1 style="font-size:22px;margin:0 0 16px;color:#0f172a">Erinnerung: Deine Registrierung wartet</h1>
<p style="font-size:15px;line-height:1.6;color:#475569;margin:0 0 16px">Hallo {{first_name}},</p>
<p style="font-size:15px;line-height:1.6;color:#475569;margin:0 0 24px">deine Bewerbung bei <strong>{{tenant_name}}</strong> wurde bereits angenommen, aber du hast deinen Account noch nicht angelegt. Bitte schließe die Registrierung ab, damit es weitergehen kann.</p>
{{cta:Jetzt registrieren|{{portal_link}}}}
<p style="font-size:13px;color:#94a3b8;margin:24px 0 0">Oder kopiere diesen Link: {{portal_link}}</p>`,
  },
  confirm: {
    subject: "Bitte bestätige deine E-Mail – {{tenant_name}}",
    body: `<h1 style="font-size:22px;margin:0 0 16px;color:#0f172a">Bitte bestätige deine E-Mail-Adresse</h1>
<p style="font-size:15px;line-height:1.6;color:#475569;margin:0 0 24px">Wir haben deine Bestätigung für <strong>{{email}}</strong> noch nicht erhalten. Bitte bestätige deine E-Mail, damit du dich anmelden kannst.</p>
{{cta:E-Mail bestätigen|{{confirmation_link}}}}
<p style="font-size:13px;color:#94a3b8;margin:24px 0 0">Oder kopiere diesen Link: {{confirmation_link}}</p>`,
  },
  completion: {
    subject: "Bitte schließe deine Registrierung ab – {{tenant_name}}",
    body: `<h1 style="font-size:22px;margin:0 0 16px;color:#0f172a">Bitte schließe deine Registrierung ab</h1>
<p style="font-size:15px;line-height:1.6;color:#475569;margin:0 0 16px">Hallo {{first_name}},</p>
<p style="font-size:15px;line-height:1.6;color:#475569;margin:0 0 24px">in deinem Account bei <strong>{{tenant_name}}</strong> fehlen noch ein paar Angaben (z.B. Personalausweis, Arbeitsvertrag oder Pflichtdaten). Bitte melde dich an und vervollständige dein Profil.</p>
{{cta:Jetzt vervollständigen|{{login_link}}}}
<p style="font-size:13px;color:#94a3b8;margin:24px 0 0">Login: {{login_link}}</p>`,
  },
  no_booking: {
    subject: "Neue Aufträge warten auf dich – {{tenant_name}}",
    body: `<h1 style="font-size:22px;margin:0 0 16px;color:#0f172a">Neue Aufträge warten auf dich</h1>
<p style="font-size:15px;line-height:1.6;color:#475569;margin:0 0 16px">Hallo {{first_name}},</p>
<p style="font-size:15px;line-height:1.6;color:#475569;margin:0 0 24px">du hast seit über 7 Tagen keine Aufträge mehr bei <strong>{{tenant_name}}</strong> gebucht. Im Portal warten freie Termine — sichere dir jetzt deinen nächsten Einsatz.</p>
{{cta:Aufträge ansehen|{{booking_link}}}}
<p style="font-size:13px;color:#94a3b8;margin:24px 0 0">Oder kopiere diesen Link: {{booking_link}}</p>`,
  },
  domain_recovery_mitarbeiter: {
    subject: "Wir sind umgezogen – dein neuer Portal-Link für {{tenant_name}}",
    body: `<h1 style="font-size:22px;margin:0 0 16px;color:#0f172a">Wir sind umgezogen</h1>
<p style="font-size:15px;line-height:1.6;color:#475569;margin:0 0 16px">Hallo {{first_name}},</p>
<p style="font-size:15px;line-height:1.6;color:#475569;margin:0 0 16px">unser Mitarbeiter-Portal von <strong>{{tenant_name}}</strong> hat eine neue Adresse. Deine Zugangsdaten bleiben gleich — einfach mit der neuen URL einloggen und weitermachen.</p>
{{cta:Zum neuen Portal|{{portal_link}}}}
<p style="font-size:13px;color:#94a3b8;margin:24px 0 0">Oder kopiere diesen Link: {{portal_link}}</p>`,
  },
};

type Vars = Record<string, string>;

function baseVars(t: TenantRow, extra: Vars): Vars {
  return {
    tenant_name: t.name,
    company_name: t.name,
    sender_name: t.sender_name ?? t.name,
    support_email: t.reply_to_email ?? t.sender_email ?? "",
    first_name: "",
    email: "",
    portal_link: "",
    login_link: "",
    confirmation_link: "",
    booking_link: "",
    ...extra,
  };
}

function replaceVars(input: string, vars: Vars): string {
  // Bis zu 3 Durchläufe, damit verschachtelte Platzhalter (z.B. in CTA-Tag) ersetzt werden.
  let out = input;
  for (let i = 0; i < 3; i++) {
    out = out.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, key) =>
      Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key] ?? "") : m,
    );
  }
  return out;
}

function renderSubject(custom: string | null | undefined, fallback: string, vars: Vars): string {
  const tpl = (custom && custom.trim()) ? custom : fallback;
  return replaceVars(tpl, vars);
}

function renderBodyHtml(
  tenant: TenantRow,
  custom: string | null | undefined,
  fallback: string,
  vars: Vars,
  opts?: { withDomainBanner?: boolean },
): string {
  let body = (custom && custom.trim()) ? custom : fallback;

  // Wenn der Admin Plain-Text schreibt (kein <html tag), \n -> <br>
  const looksLikeHtml = /<\/?(p|h1|h2|h3|div|br|table|a)\b/i.test(body);
  if (!looksLikeHtml) {
    body = escapeHtml(body).replace(/\n/g, "<br>");
  }

  body = replaceVars(body, vars);

  // CTA-Syntax: {{cta:Label|https://...}}  ->  schöner Button
  body = body.replace(/\{\{cta:([^|}]+)\|([^}]+)\}\}/g, (_m, label, href) =>
    btn(tenant.primary_color ?? "#0f172a", String(href).trim(), String(label).trim()),
  );

  const banner = opts?.withDomainBanner === false ? "" : renderDomainChangeBanner(tenant);
  return shellHtml(tenant, body, { banner });
}


function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
