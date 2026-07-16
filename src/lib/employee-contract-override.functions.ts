import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Pro-Mitarbeiter / Bewerber Override des Arbeitsvertrags.
// Zielzeile wird identifiziert über entweder:
//   - user_id (existierendes Konto / Profil)
//   - email + optional application_id (Bewerber ohne Konto)
// Sobald sich der Bewerber registriert, übernimmt ein DB-Trigger den
// Override automatisch (setzt user_id, leert email).

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", ctx.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Nicht autorisiert");
}

// Target = entweder user_id ODER email (+ optional application_id).
const TargetSchema = z
  .object({
    user_id: z.string().uuid().nullable().optional(),
    email: z.string().email().nullable().optional(),
    application_id: z.string().uuid().nullable().optional(),
  })
  .refine((t) => !!t.user_id || !!t.email, {
    message: "user_id oder email erforderlich",
  });

type Target = z.infer<typeof TargetSchema>;

function targetFilter(sb: any, t: Target) {
  let q = sb.from("employee_contract_overrides").select("*");
  if (t.user_id) return q.eq("user_id", t.user_id);
  return q.is("user_id", null).ilike("email", t.email!);
}

async function findExisting(sb: any, t: Target) {
  const { data, error } = await targetFilter(sb, t).maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

async function upsertOverride(
  sb: any,
  t: Target,
  patch: Record<string, any>,
  actorId: string,
) {
  const existing = await findExisting(sb, t);
  if (existing) {
    const { error } = await sb
      .from("employee_contract_overrides")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
    return existing.id;
  }
  // Tenant_id ableiten, falls möglich.
  let tenant_id: string | null = null;
  if (t.user_id) {
    const { data: prof } = await sb
      .from("profiles")
      .select("tenant_id")
      .eq("user_id", t.user_id)
      .maybeSingle();
    tenant_id = prof?.tenant_id ?? null;
  } else if (t.application_id) {
    const { data: app } = await sb
      .from("applications")
      .select("tenant_id")
      .eq("id", t.application_id)
      .maybeSingle();
    tenant_id = app?.tenant_id ?? null;
  }
  const row: any = {
    user_id: t.user_id ?? null,
    email: t.user_id ? null : t.email,
    application_id: t.application_id ?? null,
    tenant_id,
    created_by: actorId,
    ...patch,
  };
  const { data, error } = await sb
    .from("employee_contract_overrides")
    .insert(row)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

async function loadTargetProfile(sb: any, t: Target) {
  if (t.user_id) {
    const { data } = await sb
      .from("profiles")
      .select("tenant_id, contract_signed_at, full_name")
      .eq("user_id", t.user_id)
      .maybeSingle();
    return data ?? null;
  }
  if (t.application_id) {
    const { data } = await sb
      .from("applications")
      .select("tenant_id, full_name")
      .eq("id", t.application_id)
      .maybeSingle();
    return data ? { ...data, contract_signed_at: null } : null;
  }
  return null;
}

async function logOverride(sb: any, params: {
  action: string;
  target: Target;
  actorId: string;
  prof: any;
  comment: string;
}) {
  try {
    await sb.from("activity_log").insert({
      action: params.action,
      entity_type: params.target.user_id ? "profile" : "application",
      entity_id: params.target.user_id ?? params.target.application_id ?? null,
      actor_id: params.actorId,
      comment: params.comment,
      old_status: params.prof?.contract_signed_at ? "unterschrieben" : "offen",
      new_status: "offen",
    });
  } catch {}
}

export const getContractOverride = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => TargetSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const row = await findExisting(context.supabase, data);
    return { override: row };
  });

export const saveContractOverrideHtml = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    TargetSchema.and(
      z.object({ html_body: z.string().min(10).max(200_000) }),
    ).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;
    const t: Target = {
      user_id: data.user_id ?? null,
      email: data.email ?? null,
      application_id: data.application_id ?? null,
    };
    const prof = await loadTargetProfile(sb, t);
    await upsertOverride(sb, t, { html_body: data.html_body, pdf_url: null }, context.userId);
    if (t.user_id) {
      await sb.from("profiles").update({ contract_signed_at: null }).eq("user_id", t.user_id);
    }
    await logOverride(sb, {
      action: "vertrag_override_html",
      target: t,
      actorId: context.userId,
      prof,
      comment: `Individueller Arbeitsvertrag (Text) hinterlegt für ${prof?.full_name ?? t.email ?? "Person"}.`,
    });
    return { ok: true };
  });

export const saveContractOverridePdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    TargetSchema.and(
      z.object({ pdf_url: z.string().min(1).max(1000) }),
    ).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;
    const t: Target = {
      user_id: data.user_id ?? null,
      email: data.email ?? null,
      application_id: data.application_id ?? null,
    };
    const prof = await loadTargetProfile(sb, t);
    await upsertOverride(sb, t, { html_body: null, pdf_url: data.pdf_url }, context.userId);
    if (t.user_id) {
      await sb.from("profiles").update({ contract_signed_at: null }).eq("user_id", t.user_id);
    }
    await logOverride(sb, {
      action: "vertrag_override_pdf",
      target: t,
      actorId: context.userId,
      prof,
      comment: `Individueller Arbeitsvertrag (PDF) hochgeladen für ${prof?.full_name ?? t.email ?? "Person"}.`,
    });
    return { ok: true };
  });

export const saveContractOverrideSalary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    TargetSchema.and(
      z.object({
        monthly_salary_cents: z.number().int().min(0).max(100_000_00).nullable(),
        weekly_hours: z.number().min(0).max(80).nullable(),
        start_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable()
          .optional(),
      }),
    ).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;
    const t: Target = {
      user_id: data.user_id ?? null,
      email: data.email ?? null,
      application_id: data.application_id ?? null,
    };
    const prof = await loadTargetProfile(sb, t);
    const patch: Record<string, any> = {
      monthly_salary_cents: data.monthly_salary_cents,
      weekly_hours: data.weekly_hours,
    };
    if (data.start_date !== undefined) patch.start_date = data.start_date;
    await upsertOverride(sb, t, patch, context.userId);
    // Für existierende Mitarbeiter zusätzlich auf das Profil spiegeln,
    // damit alle bestehenden Render-/PDF-Pfade das neue Startdatum nutzen.
    if (t.user_id && data.start_date !== undefined) {
      await sb
        .from("profiles")
        .update({ employment_start_date: data.start_date })
        .eq("user_id", t.user_id);
    }
    await logOverride(sb, {
      action: "vertrag_override_salary",
      target: t,
      actorId: context.userId,
      prof,
      comment: `Individuelles Gehalt / Wochenstunden / Startdatum aktualisiert für ${prof?.full_name ?? t.email ?? "Person"}.`,
    });
    return { ok: true };
  });


export const deleteContractOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => TargetSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;
    const existing = await findExisting(sb, data);
    if (!existing) return { ok: true };
    const { error } = await sb
      .from("employee_contract_overrides")
      .delete()
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Mitarbeiter-Sicht: Override für den eigenen Account holen.
export const getMyContractOverride = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as any)
      .from("employee_contract_overrides")
      .select("html_body, pdf_url, monthly_salary_cents, weekly_hours, start_date, updated_at")
      .eq("user_id", context.userId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return { override: data ?? null };
  });
