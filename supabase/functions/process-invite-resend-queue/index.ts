// Deno Edge Function: process-invite-resend-queue
//
// Worker für die Drip-Queue invite_resend_queue.
// Zieht fällige Rows (scheduled_at <= now, status=queued), sendet via
// vorhandene Edge Function send-invitation-email (nutzt Tenant-SMTP, Pause,
// SMTP-Health). Pro Run hartes Cap, Quiet-Hours respektiert.
//
// Trigger: pg_cron alle 15 Minuten ODER manuell POST {}
//
// Deploy:
//   supabase functions deploy process-invite-resend-queue --no-verify-jwt

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Ziel: gleichmäßig verteilte Sends statt Burst → Spam-Schutz.
// 40 Mails/Stunde × 18 aktive Stunden (05–23 Berlin) = 720/Tag Kapazität.
// 4 Runs/h × 10 = 40/h. Sobald Queue leer ist, läuft der Cron leer durch.
const MAX_PER_RUN = 10;
// Quiet-Hours (Europe/Berlin): aktiv 05:00–23:00
const QUIET_START = 5;
const QUIET_END = 23;

function berlinHour(): number {
  const h = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin", hour: "2-digit", hour12: false,
  }).format(new Date());
  return parseInt(h, 10);
}
function isQuietHours(): boolean {
  const h = berlinHour();
  return h < QUIET_START || h >= QUIET_END;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const ignoreQuiet = body?.ignore_quiet_hours === true;

  if (isQuietHours() && !ignoreQuiet) {
    return json({ skipped: "quiet_hours", hour: berlinHour() }, 200);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // 1) Fällige Rows ziehen
  const { data: due, error: dueErr } = await admin
    .from("invite_resend_queue")
    .select("id, application_id, tenant_id, email, full_name, first_name, last_name, attempts")
    .eq("status", "queued")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(MAX_PER_RUN);
  if (dueErr) return json({ error: dueErr.message }, 500);
  if (!due || due.length === 0) return json({ processed: 0, sent: 0, failed: 0 }, 200);

  // 2a) Auto-Skip: nur prüfen, ob die KONKRETEN fälligen E-Mails bereits
  //     einen Auth-Account haben. Kein listUsers-Scan über ALLE User
  //     (war die Hauptursache für CPU/Wall-Clock-Timeouts).
  //     Wir nutzen eine billige profiles-Query (1 Roundtrip).
  const dueEmails = Array.from(new Set(
    due.map((r: any) => String(r.email ?? "").toLowerCase()).filter(Boolean),
  ));
  const registeredEmails = new Set<string>();
  if (dueEmails.length > 0) {
    const { data: profs } = await admin
      .from("profiles")
      .select("email")
      .in("email", dueEmails);
    for (const p of (profs ?? []) as Array<{ email: string | null }>) {
      if (p.email) registeredEmails.add(p.email.toLowerCase());
    }
  }

  const dueFiltered: any[] = [];
  let autoSkipped = 0;
  for (const row of due) {
    if (row.email && registeredEmails.has(String(row.email).toLowerCase())) {
      await admin.from("invite_resend_queue").update({
        status: "skipped",
        last_error: "auto_skip_registered",
      }).eq("id", row.id);
      autoSkipped++;
    } else {
      dueFiltered.push(row);
    }
  }
  if (dueFiltered.length === 0) {
    return json({ processed: due.length, sent: 0, failed: 0, skipped: autoSkipped }, 200);
  }

  // 2b) Tenants vorladen (für portal-link)
  const tenantIds = Array.from(new Set(dueFiltered.map((r: any) => r.tenant_id)));
  const { data: tenants } = await admin
    .from("tenants")
    .select("id, domain, primary_domain, emails_paused, is_active")
    .in("id", tenantIds);
  const tMap = new Map<string, any>();
  (tenants ?? []).forEach((t: any) => tMap.set(t.id, t));

  // Welle-1: 140 Mails/Tag/Tenant (über reminder_log + email_send_log gemessen).
  // Pre-fetch der letzten 24h, damit Drip nicht das Cap reißt.
  const TENANT_DAILY_CAP = 140;
  const cutoff24h = new Date(Date.now() - 24 * 3600_000).toISOString();
  const tenantCount24h = new Map<string, number>();
  for (const tid of tenantIds) {
    const [{ count: cReminder }, { count: cSend }] = await Promise.all([
      admin.from("reminder_log").select("id", { count: "exact", head: true }).eq("tenant_id", tid).eq("status", "sent").gte("sent_at", cutoff24h),
      admin.from("email_send_log").select("id", { count: "exact", head: true }).eq("tenant_id", tid).eq("status", "sent").gte("created_at", cutoff24h),
    ]);
    tenantCount24h.set(tid, (cReminder ?? 0) + (cSend ?? 0));
  }

  let sent = 0, failed = 0, skipped = autoSkipped;

  for (const row of dueFiltered) {
    const t = tMap.get(row.tenant_id);
    if (!t || t.is_active === false || t.emails_paused) {
      await admin.from("invite_resend_queue").update({
        status: "skipped",
        last_error: !t ? "tenant not found" : t.is_active === false ? "tenant inactive" : "tenant emails paused",
      }).eq("id", row.id);
      skipped++;
      continue;
    }

    // 140/Tag/Tenant Cap (Welle 1). Bei Erreichen: zurück in queued, später nochmal.
    const current = tenantCount24h.get(row.tenant_id) ?? 0;
    if (current >= TENANT_DAILY_CAP) {
      await admin.from("invite_resend_queue").update({
        status: "queued",
        last_error: "tenant_daily_cap_reached",
        scheduled_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }).eq("id", row.id);
      skipped++;
      continue;
    }
    const activeDomain = t.primary_domain ?? t.domain;
    const registrationLink = activeDomain ? `https://portal.${activeDomain}/register` : "";

    try {
      const { data, error } = await admin.functions.invoke("send-invitation-email", {
        body: {
          to: row.email,
          fullName: row.full_name,
          firstName: row.first_name,
          lastName: row.last_name,
          registrationLink,
          tenantId: row.tenant_id,
        },
      });
      if (error) throw new Error(error.message || "invoke failed");
      if ((data as any)?.error) throw new Error((data as any).error);

      await admin.from("invite_resend_queue").update({
        status: "sent",
        sent_at: new Date().toISOString(),
        attempts: (row.attempts ?? 0) + 1,
      }).eq("id", row.id);
      tenantCount24h.set(row.tenant_id, (tenantCount24h.get(row.tenant_id) ?? 0) + 1);
      sent++;
    } catch (e: any) {
      const attempts = (row.attempts ?? 0) + 1;
      const isCold = attempts >= 3;
      await admin.from("invite_resend_queue").update({
        status: isCold ? "failed" : "queued",
        attempts,
        last_error: String(e?.message ?? e).slice(0, 500),
        scheduled_at: isCold ? undefined : new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      }).eq("id", row.id);
      // Anti-Spam-Hard-Cap: nach 3 Versuchen → Bewerbung cold (manueller Eingriff im Admin).
      if (isCold && row.application_id) {
        await admin.from("applications").update({
          status_cold: true,
          cold_at: new Date().toISOString(),
          cold_reason: "invite_resend_max",
        }).eq("id", row.application_id).eq("status_cold", false);
      }
      failed++;
    }


    // kleine Streuung zwischen Sends (kurz halten — Edge-Runtime-Wall-Limit)
    await new Promise(r => setTimeout(r, 200 + Math.floor(Math.random() * 300)));
  }

  return json({ processed: due.length, sent, failed, skipped }, 200);
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
