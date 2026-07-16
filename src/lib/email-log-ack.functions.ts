import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase
    .from("user_roles").select("role")
    .eq("user_id", ctx.userId).eq("role", "admin").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Nicht autorisiert");
}

/**
 * Markiert alle nicht-acknowledgten failed/dlq/bounced Einträge der letzten 24h
 * als bearbeitet. Treibt den "Aktion erforderlich"-Banner.
 */
export const acknowledgeFailedEmails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;
    const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { error, count } = await sb
      .from("email_send_log")
      .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: context.userId }, { count: "exact" })
      .is("acknowledged_at", null)
      .in("status", ["failed", "dlq", "bounced"])
      .gte("created_at", cutoff);
    if (error) throw new Error(error.message);
    return { acknowledged: count ?? 0 };
  });
