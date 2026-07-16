import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const DeleteSchema = z.object({
  user_id: z.string().uuid(),
  confirm: z.literal("MITARBEITER LÖSCHEN"),
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

export const deleteEmployeeAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DeleteSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);

    if (data.user_id === context.userId) {
      throw new Error("Du kannst dich nicht selbst löschen");
    }

    const uid = data.user_id;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;

    // 1) Storage-Cleanup (vor DB-Delete, damit Buckets sauber sind)
    for (const bucket of ["kyc-documents", "documents", "task-submissions"] as const) {
      try {
        const { data: files } = await sb.storage.from(bucket).list(uid, { limit: 1000 });
        if (files && files.length > 0) {
          const paths = files.map((f: any) => `${uid}/${f.name}`);
          await sb.storage.from(bucket).remove(paths);
        }
      } catch (e) {
        console.warn(`Storage-Cleanup ${bucket} fehlgeschlagen:`, e);
      }
    }

    // 2) Dynamisches Cascade-Cleanup via RPC (findet alle FKs auf auth.users)
    const { error: rpcErr } = await sb.rpc("admin_delete_user_cascade", {
      _user_id: uid,
      _actor_id: context.userId,
    });
    if (rpcErr) {
      throw new Error(`Cascade-Löschung fehlgeschlagen: ${rpcErr.message}`);
    }

    // 2) Auth-User löschen
    const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(uid);
    if (authErr) {
      throw new Error(`Auth-Löschung fehlgeschlagen: ${authErr.message}`);
    }

    try {
      await sb.from("activity_log").insert({
        action: "mitarbeiter_geloescht",
        entity_type: "profile",
        entity_id: uid,
        actor_id: context.userId,
        comment: "Mitarbeiter hart gelöscht (inkl. Auth-Account)",
      });
    } catch {}

    return { ok: true };
  });

// ─────────────────────────────────────────────────────────────────────────────
// Einzelne Bewerbung (application) hart löschen. Für Bewerber, die noch kein
// Profil / keinen Auth-Account haben. Falls doch eine user_id verknüpft ist,
// wird der Auth-Account NICHT gelöscht — dafür `deleteEmployeeAccount` nutzen.
// ─────────────────────────────────────────────────────────────────────────────
const DeleteAppSchema = z.object({
  application_id: z.string().uuid(),
  confirm: z.literal("BEWERBUNG LÖSCHEN"),
});

export const deleteApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DeleteAppSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;
    const { data: app, error: fetchErr } = await sb
      .from("applications")
      .select("id, full_name, email")
      .eq("id", data.application_id)
      .maybeSingle();
    if (fetchErr) throw new Error(fetchErr.message);
    if (!app) throw new Error("Bewerbung nicht gefunden");

    const { error: delErr } = await sb
      .from("applications")
      .delete()
      .eq("id", data.application_id);
    if (delErr) throw new Error(delErr.message);

    try {
      await sb.from("activity_log").insert({
        action: "bewerbung_geloescht",
        entity_type: "application",
        entity_id: data.application_id,
        actor_id: context.userId,
        comment: `Bewerbung von ${app.full_name ?? app.email ?? "?"} gelöscht`,
      });
    } catch {}

    return { ok: true };
  });

const CleanupSchema = z.object({
  older_than_days: z.number().int().min(0).max(3650).default(30),
  dry_run: z.boolean().default(false),
});

export const deleteOrphanApplications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CleanupSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;
    const cutoff = new Date(Date.now() - data.older_than_days * 86_400_000).toISOString();

    const { data: rows, error: qErr } = await sb
      .from("applications")
      .select("id")
      .is("user_id", null)
      .lt("created_at", cutoff);
    if (qErr) throw new Error(qErr.message);

    const ids = (rows ?? []).map((r: any) => r.id);
    if (data.dry_run) return { ok: true, count: ids.length, deleted: 0 };
    if (ids.length === 0) return { ok: true, count: 0, deleted: 0 };

    const { error: delErr } = await sb.from("applications").delete().in("id", ids);
    if (delErr) throw new Error(delErr.message);

    try {
      await sb.from("activity_log").insert({
        action: "bewerbungen_cleanup",
        entity_type: "application",
        actor_id: context.userId,
        comment: `${ids.length} verwaiste Bewerbungen gelöscht (>${data.older_than_days} Tage, ohne Registrierung)`,
      });
    } catch {}

    return { ok: true, count: ids.length, deleted: ids.length };
  });

// ─────────────────────────────────────────────────────────────────────────────
// Purge: alles außer aktive Mitarbeiter (profiles.status='angenommen') löschen.
// - Alle applications (mit/ohne user_id) außer denen deren user_id zu einem
//   aktiven Mitarbeiter gehört.
// - Alle profiles + Auth-Users deren status != 'angenommen'.
// ─────────────────────────────────────────────────────────────────────────────
const PurgeSchema = z.object({
  confirm: z.literal("ALLES LÖSCHEN AUSSER AKTIVE"),
  dry_run: z.boolean().default(false),
});

export const purgeInactivePeople = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => PurgeSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;

    // 1) Aktive Mitarbeiter (nie anfassen) + Admins (Selbstschutz)
    const { data: keepProfiles, error: pErr } = await sb
      .from("profiles")
      .select("user_id, status");
    if (pErr) throw new Error(pErr.message);

    const { data: adminRoles, error: rErr } = await sb
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");
    if (rErr) throw new Error(rErr.message);

    const keepIds = new Set<string>();
    for (const p of keepProfiles ?? []) {
      if (p.status === "angenommen") keepIds.add(p.user_id);
    }
    for (const a of adminRoles ?? []) keepIds.add(a.user_id);
    keepIds.add(context.userId);

    const deleteProfileIds = (keepProfiles ?? [])
      .filter((p: any) => !keepIds.has(p.user_id))
      .map((p: any) => p.user_id as string);

    // 2) Bewerbungen: alles löschen, außer wenn user_id ein aktiver Mitarbeiter ist
    const { data: allApps, error: aErr } = await sb
      .from("applications")
      .select("id, user_id");
    if (aErr) throw new Error(aErr.message);
    const deleteAppIds = (allApps ?? [])
      .filter((a: any) => !a.user_id || !keepIds.has(a.user_id))
      .map((a: any) => a.id as string);

    if (data.dry_run) {
      return {
        ok: true,
        dry_run: true,
        applications_to_delete: deleteAppIds.length,
        profiles_to_delete: deleteProfileIds.length,
        kept: keepIds.size,
      };
    }

    // 3) Applications löschen
    let deletedApps = 0;
    if (deleteAppIds.length > 0) {
      // in Chunks von 500 (Postgrest in()-Limit)
      for (let i = 0; i < deleteAppIds.length; i += 500) {
        const chunk = deleteAppIds.slice(i, i + 500);
        const { error } = await sb.from("applications").delete().in("id", chunk);
        if (error) throw new Error(`Bewerbungen: ${error.message}`);
        deletedApps += chunk.length;
      }
    }

    // 4) Profiles + Auth-Users kaskadierend löschen
    let deletedProfiles = 0;
    const failures: { user_id: string; error: string }[] = [];
    for (const uid of deleteProfileIds) {
      try {
        for (const bucket of ["kyc-documents", "documents", "task-submissions"] as const) {
          try {
            const { data: files } = await sb.storage.from(bucket).list(uid, { limit: 1000 });
            if (files && files.length > 0) {
              await sb.storage.from(bucket).remove(files.map((f: any) => `${uid}/${f.name}`));
            }
          } catch {}
        }
        const { error: rpcErr } = await sb.rpc("admin_delete_user_cascade", {
          _user_id: uid,
          _actor_id: context.userId,
        });
        if (rpcErr) throw new Error(rpcErr.message);
        const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(uid);
        if (authErr) throw new Error(authErr.message);
        deletedProfiles++;
      } catch (e: any) {
        failures.push({ user_id: uid, error: e?.message ?? String(e) });
      }
    }

    try {
      await sb.from("activity_log").insert({
        action: "purge_inactive_people",
        entity_type: "profile",
        actor_id: context.userId,
        comment: `Purge: ${deletedApps} Bewerbungen + ${deletedProfiles} Profile gelöscht. Fehler: ${failures.length}.`,
      });
    } catch {}

    return {
      ok: true,
      dry_run: false,
      deleted_applications: deletedApps,
      deleted_profiles: deletedProfiles,
      failures,
    };
  });


// ─────────────────────────────────────────────────────────────────────────────
// Bulk-Delete: mehrere Bewerbungen auf einmal (Chunks à 500).
// ─────────────────────────────────────────────────────────────────────────────
const BulkAppsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(5000),
});

export const bulkDeleteApplications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BulkAppsSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;
    let deleted = 0;
    const failures: { chunk_start: number; error: string }[] = [];
    for (let i = 0; i < data.ids.length; i += 500) {
      const chunk = data.ids.slice(i, i + 500);
      const { error } = await sb.from("applications").delete().in("id", chunk);
      if (error) failures.push({ chunk_start: i, error: error.message });
      else deleted += chunk.length;
    }
    try {
      await sb.from("activity_log").insert({
        action: "bewerbungen_bulk_geloescht",
        entity_type: "application",
        actor_id: context.userId,
        comment: `Bulk-Löschung: ${deleted} von ${data.ids.length} Bewerbungen gelöscht.`,
      });
    } catch {}
    return { ok: true, deleted, failures };
  });

// ─────────────────────────────────────────────────────────────────────────────
// Bulk-Delete: mehrere Mitarbeiter (Profil + Auth) auf einmal.
// ─────────────────────────────────────────────────────────────────────────────
const BulkUsersSchema = z.object({
  user_ids: z.array(z.string().uuid()).min(1).max(500),
});

export const bulkDeleteEmployees = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BulkUsersSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;
    let deleted = 0;
    const failures: { user_id: string; error: string }[] = [];
    for (const uid of data.user_ids) {
      if (uid === context.userId) {
        failures.push({ user_id: uid, error: "Selbst-Löschung nicht erlaubt" });
        continue;
      }
      try {
        for (const bucket of ["kyc-documents", "documents", "task-submissions"] as const) {
          try {
            const { data: files } = await sb.storage.from(bucket).list(uid, { limit: 1000 });
            if (files && files.length > 0) {
              await sb.storage.from(bucket).remove(files.map((f: any) => `${uid}/${f.name}`));
            }
          } catch {}
        }
        const { error: rpcErr } = await sb.rpc("admin_delete_user_cascade", {
          _user_id: uid,
          _actor_id: context.userId,
        });
        if (rpcErr) throw new Error(rpcErr.message);
        const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(uid);
        if (authErr) throw new Error(authErr.message);
        deleted++;
      } catch (e: any) {
        failures.push({ user_id: uid, error: e?.message ?? String(e) });
      }
    }
    try {
      await sb.from("activity_log").insert({
        action: "mitarbeiter_bulk_geloescht",
        entity_type: "profile",
        actor_id: context.userId,
        comment: `Bulk-Löschung: ${deleted} von ${data.user_ids.length} Mitarbeitern gelöscht. Fehler: ${failures.length}.`,
      });
    } catch {}
    return { ok: true, deleted, failures };
  });



