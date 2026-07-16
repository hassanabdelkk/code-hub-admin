// CRUD + Pool-Auswahl für public.landing_servers.
// Public-Endpoints (Bootstrap/Heartbeat) liegen in src/routes/api/public/.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function requireAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", ctx.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Nicht autorisiert");
}

function generateToken(): string {
  // 32 Byte URL-safe Token
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export const listLandingServers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { data, error } = await context.supabase
      .from("landing_servers")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return { rows: data ?? [] };
  });

const CreateInput = z.object({
  name: z.string().min(1).max(120),
  hostname: z.string().min(1).max(255),
  ip: z.string().min(7).max(45),
  capacity: z.number().int().min(1).max(10_000).default(100),
  notes: z.string().max(1000).default(""),
});

export const createLandingServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => CreateInput.parse(i))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const token = generateToken();
    const { data: row, error } = await context.supabase
      .from("landing_servers")
      .insert({
        name: data.name,
        hostname: data.hostname,
        ip: data.ip,
        capacity: data.capacity,
        notes: data.notes,
        bootstrap_token: token,
        status: "pending",
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    await context.supabase.from("automation_log").insert({
      action: "server.created",
      target: data.name,
      status: "ok",
      actor_id: context.userId,
      payload: { hostname: data.hostname, ip: data.ip },
    });
    return row;
  });

export const updateLandingServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        name: z.string().min(1).max(120).optional(),
        capacity: z.number().int().min(1).max(10_000).optional(),
        status: z.enum(["pending", "online", "offline", "paused"]).optional(),
        notes: z.string().max(1000).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { id, ...patch } = data;
    const { data: row, error } = await context.supabase
      .from("landing_servers")
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteLandingServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    // Sicherheit: nur löschen, wenn keine Landings drauf liegen
    const { data: row } = await context.supabase
      .from("landing_servers")
      .select("landing_count, name")
      .eq("id", data.id)
      .maybeSingle();
    if (row && row.landing_count > 0) {
      throw new Error(`Server "${row.name}" hostet noch ${row.landing_count} Landings. Erst migrieren oder löschen.`);
    }
    const { error } = await context.supabase.from("landing_servers").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await context.supabase.from("automation_log").insert({
      action: "server.deleted",
      target: row?.name ?? data.id,
      status: "ok",
      actor_id: context.userId,
      payload: {},
    });
    return { ok: true };
  });

export const rotateBootstrapToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const token = generateToken();
    const { data: row, error } = await context.supabase
      .from("landing_servers")
      .update({ bootstrap_token: token })
      .eq("id", data.id)
      .select("id, bootstrap_token")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const requestThemeResync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { data: row, error } = await context.supabase
      .from("landing_servers")
      .update({ themes_resync_requested_at: new Date().toISOString() })
      .eq("id", data.id)
      .select("id, name, themes_resync_requested_at")
      .single();
    if (error) throw new Error(error.message);
    await context.supabase.from("automation_log").insert({
      action: "server.themes_resync_requested",
      target: row.name,
      status: "ok",
      actor_id: context.userId,
      payload: {},
    });
    return row;
  });

/**
 * Wählt den passendsten Server für eine neue Landing.
 * Strategie: Least-Full unter online + nicht-pausierten Servern mit freier Kapazität.
 */
export const pickLandingServer = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { data, error } = await context.supabase
      .from("landing_servers")
      .select("id, name, ip, hostname, landing_count, capacity, status")
      .in("status", ["online", "pending"])
      .order("landing_count", { ascending: true });
    if (error) throw new Error(error.message);
    const free = (data ?? []).find((s: any) => s.landing_count < s.capacity);
    return { server: free ?? null, all: data ?? [] };
  });
