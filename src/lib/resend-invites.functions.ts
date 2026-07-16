import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase
    .from("user_roles").select("role")
    .eq("user_id", ctx.userId).eq("role", "admin").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Nicht autorisiert");
}

/**
 * Drip-Resend: Plant Einladungs-Mails an alle akzeptierten Bewerber OHNE Auth-Account.
 * Statt sofort zu senden, werden Rows in invite_resend_queue eingestellt mit
 * scheduled_at gleichmäßig über `windowHours` (Default 24) verteilt — pro Tenant
 * separat, damit jeder Tenant sein eigenes SMTP gleichmäßig auslastet.
 *
 * Worker: Edge Function process-invite-resend-queue (per pg_cron alle 15 min).
 */
export const resendInvitesToUnregistered = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { windowHours?: number; dryRun?: boolean } | undefined) => input ?? {})
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const windowHours = Math.min(Math.max(data.windowHours ?? 24, 1), 168); // 1h..7d
    const dryRun = !!data.dryRun;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;
    const pageSize = 1000;

    // 1) Auth-User-E-Mails einsammeln
    const existing = new Set<string>();
    for (let page = 1; page < 50; page++) {
      const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw new Error(error.message);
      const users = data?.users ?? [];
      for (const u of users) if (u.email) existing.add(u.email.toLowerCase());
      if (users.length < 1000) break;
    }

    // 2) Akzeptierte Bewerbungen ohne Auth-Account (per E-Mail dedupliziert)
    const apps: any[] = [];
    for (let from = 0; ; from += pageSize) {
      const { data: chunk, error } = await sb
        .from("applications")
        .select("id, email, full_name, first_name, last_name, phone, tenant_id, status, created_at")
        .eq("status", "akzeptiert")
        .order("created_at", { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) throw new Error(error.message);
      apps.push(...(chunk ?? []));
      if (!chunk || chunk.length < pageSize) break;
    }

    const acceptedTotal = (apps ?? []).length;
    let missingEmailOrTenant = 0;
    let alreadyRegistered = 0;
    let duplicateEmail = 0;
    const seenEmails = new Set<string>();

    const targets = (apps ?? []).filter((a: any) => {
      const e = (a.email ?? "").toLowerCase().trim();
      if (!e || !a.tenant_id) { missingEmailOrTenant++; return false; }
      if (existing.has(e)) { alreadyRegistered++; return false; }
      if (seenEmails.has(e)) { duplicateEmail++; return false; }
      seenEmails.add(e);
      return true;
    });
    const stats = { acceptedTotal, missingEmailOrTenant, alreadyRegistered, duplicateEmail };

    if (targets.length === 0) {
      return { eligible: 0, queued: 0, windowHours, batchId: null as string | null, dryRun, items: [] as any[], perTenant: {} as Record<string, number>, alreadyQueued: 0, wouldQueue: 0, stats };
    }

    // 3) Schon offen in der Queue? Skip, um Doppel-Einträge zu vermeiden.
    const openRows: Array<{ application_id: string }> = [];
    for (let from = 0; ; from += pageSize) {
      const { data: chunk, error } = await sb
        .from("invite_resend_queue")
        .select("application_id")
        .eq("status", "queued")
        .range(from, from + pageSize - 1);
      if (error) throw new Error(error.message);
      openRows.push(...((chunk ?? []) as Array<{ application_id: string }>));
      if (!chunk || chunk.length < pageSize) break;
    }
    const openSet = new Set<string>(openRows.map((r) => r.application_id));
    const fresh = targets.filter((a: any) => !openSet.has(a.id));
    const alreadyQueued = targets.length - fresh.length;

    // Per-Tenant-Aufschlüsselung (für Preview)
    const perTenant: Record<string, number> = {};
    for (const t of fresh) perTenant[t.tenant_id] = (perTenant[t.tenant_id] ?? 0) + 1;

    // Vollständige Liste (für Preview-Tabelle)
    const items = fresh.map((a: any) => ({
      id: a.id, email: a.email, full_name: a.full_name,
      first_name: a.first_name, last_name: a.last_name,
      phone: a.phone, tenant_id: a.tenant_id, status: a.status, created_at: a.created_at,
    }));

    if (fresh.length === 0) {
      return { eligible: targets.length, queued: 0, windowHours, batchId: null, dryRun, items, perTenant, alreadyQueued, wouldQueue: 0, stats };
    }

    if (dryRun) {
      return { eligible: targets.length, queued: 0, windowHours, batchId: null, dryRun, items, perTenant, alreadyQueued, wouldQueue: fresh.length, stats };
    }


    // 4) Per Tenant gruppieren und scheduled_at gleichmäßig über windowHours verteilen
    const batchId = crypto.randomUUID();
    const now = Date.now();
    const windowMs = windowHours * 60 * 60 * 1000;

    const byTenant = new Map<string, any[]>();
    for (const t of fresh) {
      if (!byTenant.has(t.tenant_id)) byTenant.set(t.tenant_id, []);
      byTenant.get(t.tenant_id)!.push(t);
    }

    const rows: any[] = [];
    for (const [tenantId, list] of byTenant) {
      const n = list.length;
      const step = n > 1 ? windowMs / n : 0;
      list.forEach((a: any, i: number) => {
        const jitter = Math.floor((Math.random() - 0.5) * 4 * 60 * 1000);
        rows.push({
          application_id: a.id,
          tenant_id: tenantId,
          email: a.email,
          full_name: a.full_name,
          first_name: a.first_name,
          last_name: a.last_name,
          scheduled_at: new Date(now + i * step + jitter).toISOString(),
          batch_id: batchId,
        });
      });
    }

    let queued = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error: insErr, count } = await sb
        .from("invite_resend_queue")
        .insert(chunk, { count: "exact" });
      if (insErr) throw new Error(insErr.message);
      queued += count ?? chunk.length;
    }

    return { eligible: targets.length, queued, windowHours, batchId, dryRun, items, perTenant, alreadyQueued, wouldQueue: fresh.length, stats };
  });

/**
 * Live-Status der Drip-Queue (für UI-Anzeige).
 */
export const getInviteResendQueueStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;

    const counts = { queued: 0, sent: 0, failed: 0, skipped: 0 };
    for (const status of Object.keys(counts) as Array<keyof typeof counts>) {
      const { count } = await sb
        .from("invite_resend_queue")
        .select("id", { head: true, count: "exact" })
        .eq("status", status);
      counts[status] = count ?? 0;
    }

    const { data: nextRow } = await sb
      .from("invite_resend_queue")
      .select("scheduled_at")
      .eq("status", "queued")
      .order("scheduled_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    const { data: lastRow } = await sb
      .from("invite_resend_queue")
      .select("scheduled_at")
      .eq("status", "queued")
      .order("scheduled_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return {
      counts,
      nextScheduledAt: nextRow?.scheduled_at ?? null,
      lastScheduledAt: lastRow?.scheduled_at ?? null,
    };
  });

/**
 * Detail-Liste der Drip-Queue (gefiltert nach Status). Limit 500.
 */
export const listInviteResendQueueItems = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { status?: "queued" | "sent" | "failed" | "skipped" | "all" } | undefined) => input ?? {})
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;
    const status = data.status ?? "all";
    let q = sb
      .from("invite_resend_queue")
      .select("id, application_id, tenant_id, email, full_name, status, scheduled_at, sent_at, attempts, last_error, created_at")
      .order("scheduled_at", { ascending: true })
      .limit(500);
    if (status !== "all") q = q.eq("status", status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { items: (rows ?? []) as Array<{
      id: string; application_id: string; tenant_id: string; email: string;
      full_name: string | null; status: string; scheduled_at: string;
      sent_at: string | null; attempts: number; last_error: string | null; created_at: string;
    }> };
  });

/**
 * Markiert offene Queue-Einträge (status='queued') für gegebene application_ids
 * oder E-Mail-Adressen als 'skipped'. Wird beim manuellen "Einladung erneut senden"
 * aufgerufen, damit der Bewerber nicht zusätzlich noch eine Drip-Mail bekommt.
 */
export const skipQueuedInvitesFor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      application_ids: z.array(z.string().uuid()).optional(),
      emails: z.array(z.string().email()).optional(),
      reason: z.string().max(200).optional(),
    }).parse(input ?? {})
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const ids = data.application_ids ?? [];
    const emails = (data.emails ?? []).map((e) => e.toLowerCase());
    if (ids.length === 0 && emails.length === 0) return { skipped: 0 };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;
    const reason = data.reason ?? "manual_resend";

    let total = 0;
    if (ids.length > 0) {
      const { count } = await sb
        .from("invite_resend_queue")
        .update({ status: "skipped", last_error: reason }, { count: "exact" })
        .eq("status", "queued")
        .in("application_id", ids);
      total += count ?? 0;
    }
    if (emails.length > 0) {
      const { count } = await sb
        .from("invite_resend_queue")
        .update({ status: "skipped", last_error: reason }, { count: "exact" })
        .eq("status", "queued")
        .in("email", emails);
      total += count ?? 0;
    }
    return { skipped: total };
  });

/**
 * Stoppt die komplette Drip-Queue: alle offenen (status='queued') Einträge
 * werden auf 'skipped' gesetzt. "Notbremse" für das Admin-UI.
 */
export const stopInviteResendQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { reason?: string } | undefined) => input ?? {})
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;
    const reason = data.reason ?? "admin_stop_all";
    const { count, error } = await sb
      .from("invite_resend_queue")
      .update({ status: "skipped", last_error: reason }, { count: "exact" })
      .eq("status", "queued");
    if (error) throw new Error(error.message);
    return { stopped: count ?? 0 };
  });



