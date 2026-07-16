// CRUD für public.partner_companies (Vermittlungs-Profile).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function requireAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase
    .from("user_roles").select("role")
    .eq("user_id", ctx.userId).eq("role", "admin").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Nicht autorisiert");
}

export const listPartnerCompanies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { data, error } = await context.supabase
      .from("partner_companies")
      .select("id, tenant_id, name, logo_url, calendly_url, calendly_account_id, portal_register_url, intro_headline, intro_subline, button_label, redirect_delay_ms, created_at")
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return { rows: data ?? [] };
  });

const SaveInput = z.object({
  id: z.string().uuid().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(160),
  logo_url: z.string().max(500).optional().default(""),
  calendly_url: z.string().url().max(500),
  calendly_account_id: z.string().uuid().nullable().optional(),
  portal_register_url: z.string().max(500).optional().default(""),
  intro_headline: z.string().max(200).optional().default(""),
  intro_subline: z.string().max(500).optional().default(""),
  button_label: z.string().max(80).optional().default("Jetzt Termin buchen"),
  redirect_delay_ms: z.number().int().min(0).max(60000).optional().default(2500),
});

export const savePartnerCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => SaveInput.parse(i))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const payload = {
      tenant_id: data.tenant_id || null,
      name: data.name,
      logo_url: data.logo_url || null,
      calendly_url: data.calendly_url,
      calendly_account_id: data.calendly_account_id || null,
      portal_register_url: data.portal_register_url || null,
      intro_headline: data.intro_headline || null,
      intro_subline: data.intro_subline || null,
      button_label: data.button_label || "Jetzt Termin buchen",
      redirect_delay_ms: data.redirect_delay_ms ?? 2500,
    };
    if (data.id) {
      const { error } = await context.supabase
        .from("partner_companies").update(payload).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { ok: true, id: data.id };
    }
    const { data: row, error } = await context.supabase
      .from("partner_companies").insert(payload).select("id").single();
    if (error) throw new Error(error.message);
    return { ok: true, id: row.id };
  });

export const deletePartnerCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { error } = await context.supabase
      .from("partner_companies").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
