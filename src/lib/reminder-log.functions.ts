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

async function getSupabaseAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

export type ReminderLogRow = {
  id: string;
  sent_at: string;
  email: string;
  tenant_id: string | null;
  reminder_type: string;
  status: string;
  attempt: number;
  error: string | null;
};

const ListInput = z.object({
  tenant_id: z.string().uuid().optional().nullable(),
  email_query: z.string().trim().optional().nullable(),
  type: z.enum(["invite", "confirm_email", "complete_registration", "no_recent_booking", "domain_recovery"]).optional().nullable(),
  status: z.enum(["sent", "failed", "skipped"]).optional().nullable(),
  range: z.enum(["today", "7d", "30d", "all"]).default("7d"),
  page: z.number().int().min(1).default(1),
  page_size: z.number().int().min(10).max(200).default(50),
});

export const listReminderLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ListInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const sb = await getSupabaseAdmin();

    let q = sb.from("reminder_log").select("id,sent_at,email,tenant_id,reminder_type,status,attempt,error", { count: "exact" });

    if (data.tenant_id) q = q.eq("tenant_id", data.tenant_id);
    if (data.type) q = q.eq("reminder_type", data.type);
    if (data.status) q = q.eq("status", data.status);
    if (data.email_query) q = q.ilike("email", `%${data.email_query.toLowerCase()}%`);

    if (data.range !== "all") {
      const days = data.range === "today" ? 1 : data.range === "7d" ? 7 : 30;
      const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
      q = q.gte("sent_at", cutoff);
    }

    const from = (data.page - 1) * data.page_size;
    const to = from + data.page_size - 1;
    q = q.order("sent_at", { ascending: false }).range(from, to);

    const { data: rows, count, error } = await q;
    if (error) throw new Error(error.message);
    return { rows: (rows ?? []) as ReminderLogRow[], total: count ?? 0, page: data.page, page_size: data.page_size };
  });

export const getReminderHealth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ tenant_id: z.string().uuid().optional().nullable() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const sb = await getSupabaseAdmin();

    // Letzter Log-Eintrag (irgendein Status)
    let lastQ = sb.from("reminder_log").select("sent_at").order("sent_at", { ascending: false }).limit(1);
    if (data.tenant_id) lastQ = lastQ.eq("tenant_id", data.tenant_id);
    const { data: lastRow } = await lastQ.maybeSingle();
    const last_run_at: string | null = lastRow?.sent_at ?? null;

    // Counts 24h
    const cutoff24 = new Date(Date.now() - 86400_000).toISOString();
    let countsQ = sb.from("reminder_log").select("status").gte("sent_at", cutoff24);
    if (data.tenant_id) countsQ = countsQ.eq("tenant_id", data.tenant_id);
    const { data: countRows } = await countsQ;
    const counts_24h = { sent: 0, failed: 0, skipped: 0 };
    for (const r of (countRows ?? []) as Array<{ status: string }>) {
      if (r.status in counts_24h) (counts_24h as any)[r.status]++;
    }

    // Bounced
    let bounced = 0;
    if (data.tenant_id) {
      const { count: pc } = await sb.from("profiles").select("id", { count: "exact", head: true })
        .eq("tenant_id", data.tenant_id).eq("email_status", "bounced");
      const { count: ac } = await sb.from("applications").select("id", { count: "exact", head: true })
        .eq("tenant_id", data.tenant_id).eq("email_status", "bounced");
      bounced = (pc ?? 0) + (ac ?? 0);
    } else {
      const { count: pc } = await sb.from("profiles").select("id", { count: "exact", head: true }).eq("email_status", "bounced");
      const { count: ac } = await sb.from("applications").select("id", { count: "exact", head: true }).eq("email_status", "bounced");
      bounced = (pc ?? 0) + (ac ?? 0);
    }

    const ageMs = last_run_at ? Date.now() - new Date(last_run_at).getTime() : null;
    const severity: "green" | "yellow" | "red" | "unknown" =
      ageMs === null ? "unknown"
        : ageMs < 15 * 60_000 ? "green"
        : ageMs < 60 * 60_000 ? "yellow"
        : "red";

    return { last_run_at, age_ms: ageMs, severity, counts_24h, bounced };
  });
