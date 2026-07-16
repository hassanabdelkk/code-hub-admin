import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const CreateSchema = z.object({
  email: z.string().email(),
  first_name: z.string().trim().min(1),
  last_name: z.string().trim().min(1),
  phone: z.string().trim().optional().default(""),
  employment_type: z.enum(["minijob", "teilzeit", "vollzeit"]).optional(),
});

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

export const createEmployeeAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;

    // Tenant des Admins ermitteln
    const { data: adminProfile } = await sb
      .from("profiles")
      .select("tenant_id")
      .eq("user_id", context.userId)
      .maybeSingle();
    const tenantId = adminProfile?.tenant_id ?? null;

    // 1) Auth-User anlegen (E-Mail direkt bestätigt)
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      email_confirm: true,
      user_metadata: {
        first_name: data.first_name,
        last_name: data.last_name,
        full_name: `${data.first_name} ${data.last_name}`,
      },
    });
    if (createErr) throw new Error(`Auth: ${createErr.message}`);
    const uid = created.user?.id;
    if (!uid) throw new Error("Auth: keine User-ID erhalten");

    const fullName = `${data.first_name} ${data.last_name}`.trim();

    // 2) Profil ergänzen (Trigger legt Zeile an; wir aktualisieren die Felder).
    //    Falls kein Trigger: upsert stellt sicher, dass die Zeile existiert.
    const profileRow: any = {
      user_id: uid,
      full_name: fullName,
      phone: data.phone || null,
      tenant_id: tenantId,
      status: "registriert",
      onboarding_status: "nicht_begonnen",
    };
    if (data.employment_type) profileRow.employment_type = data.employment_type;

    const { error: upsertErr } = await sb
      .from("profiles")
      .upsert(profileRow, { onConflict: "user_id" });
    if (upsertErr) {
      // Rollback: Auth-User wieder löschen, sonst Waise
      await supabaseAdmin.auth.admin.deleteUser(uid).catch(() => {});
      throw new Error(`Profil: ${upsertErr.message}`);
    }

    // 3) Passwort-Reset-Link generieren → E-Mail für Passwortvergabe
    let recoveryLink: string | null = null;
    try {
      const { data: link } = await (supabaseAdmin.auth.admin as any).generateLink({
        type: "recovery",
        email: data.email,
      });
      recoveryLink = link?.properties?.action_link ?? null;
    } catch {
      // nicht kritisch — Admin sieht den fehlenden Link in der Response
    }

    try {
      await sb.from("activity_log").insert({
        action: "mitarbeiter_angelegt",
        entity_type: "profile",
        entity_id: uid,
        actor_id: context.userId,
        comment: `Mitarbeiter ${fullName} (${data.email}) manuell angelegt`,
      });
    } catch {}

    return { ok: true, user_id: uid, recovery_link: recoveryLink };
  });

const UpdateEmpSchema = z.object({
  user_id: z.string().uuid(),
  employment_type: z.enum(["minijob", "teilzeit", "vollzeit"]).nullable(),
  employment_start_date: z.string().nullable(),
});

export const updateEmployeeEmployment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UpdateEmpSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;
    const { error } = await sb
      .from("profiles")
      .update({
        employment_type: data.employment_type,
        employment_start_date: data.employment_start_date,
      })
      .eq("user_id", data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
