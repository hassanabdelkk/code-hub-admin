import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function isMissingLastSeenColumnError(error: { message?: string } | null | undefined) {
  const message = error?.message?.toLowerCase() ?? "";
  return message.includes("last_seen_at") && (
    message.includes("schema cache") ||
    message.includes("could not find") ||
    message.includes("column")
  );
}

const Schema = z.object({
  user_ids: z.array(z.string().uuid()).min(1).max(500),
});

export type UserActivity = {
  last_sign_in_at: string | null;
  last_seen_at: string | null;
};

export const getLastSignIns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Schema.parse(input))
  .handler(async ({ data, context }) => {
    // Admin-Gate: nur Admins dürfen Login-Zeitstempel fremder User abfragen.
    const { data: roleRow, error: roleErr } = await (context.supabase as any)
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (roleErr) throw new Error(roleErr.message);
    if (!roleRow) throw new Error("Nicht autorisiert");

    const sb = context.supabase as any;

    const [rpcRes, profRes] = await Promise.all([
      sb.rpc("get_last_sign_ins", { _user_ids: data.user_ids }),
      sb.from("profiles").select("user_id, last_seen_at").in("user_id", data.user_ids),
    ]);

    if (rpcRes.error) throw new Error(rpcRes.error.message);
    if (profRes.error && !isMissingLastSeenColumnError(profRes.error)) {
      throw new Error(profRes.error.message);
    }

    const map: Record<string, UserActivity> = {};
    for (const id of data.user_ids) {
      map[id] = { last_sign_in_at: null, last_seen_at: null };
    }
    for (const r of (rpcRes.data ?? []) as Array<{ user_id: string; last_sign_in_at: string | null }>) {
      if (map[r.user_id]) map[r.user_id].last_sign_in_at = r.last_sign_in_at;
    }
    for (const r of ((profRes.error ? [] : profRes.data) ?? []) as Array<{ user_id: string; last_seen_at: string | null }>) {
      if (map[r.user_id]) map[r.user_id].last_seen_at = r.last_seen_at;
    }
    return map;
  });
