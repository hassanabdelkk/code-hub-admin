import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Schema = z.object({
  user_id: z.string().uuid(),
});

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase
    .from("user_roles").select("role")
    .eq("user_id", ctx.userId).eq("role", "admin").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Nicht autorisiert");
}

/**
 * Setzt den Vertragsstatus eines Mitarbeiters zurück, sodass er beim nächsten
 * Login die aktuelle Vertragsvorlage des Tenants neu unterschreiben muss.
 * Bestehende Vertragsdatensätze bleiben (Audit-Trail), nur das Signaturdatum
 * im Profil wird genullt.
 */
export const requestContractResign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Schema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;

    const { data: profile, error: pErr } = await sb
      .from("profiles")
      .select("user_id, full_name, contract_signed_at")
      .eq("user_id", data.user_id)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!profile) throw new Error("Mitarbeiter nicht gefunden");

    const { error: uErr } = await sb
      .from("profiles")
      .update({ contract_signed_at: null })
      .eq("user_id", data.user_id);
    if (uErr) throw new Error(uErr.message);

    try {
      await sb.from("activity_log").insert({
        action: "vertrag_neu_anfordern",
        entity_type: "profile",
        entity_id: data.user_id,
        actor_id: context.userId,
        comment: `Neuer Arbeitsvertrag zur Unterschrift angefordert (${profile.full_name}).`,
        old_status: profile.contract_signed_at ? "unterschrieben" : "offen",
        new_status: "offen",
      });
    } catch {}

    return { ok: true };
  });