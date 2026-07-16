import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function isMissingLastSeenColumnError(error: { message?: string } | null | undefined) {
  const message = error?.message?.toLowerCase() ?? "";
  return message.includes("last_seen_at") && (
    message.includes("schema cache") ||
    message.includes("could not find") ||
    message.includes("column")
  );
}

/**
 * Heartbeat: setzt profiles.last_seen_at = now() für den eingeloggten User.
 * Wird vom Browser alle ~60s aufgerufen, solange ein Tab offen ist.
 */
export const updateLastSeen = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await (context.supabase as any)
      .from("profiles")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("user_id", context.userId);

    if (error) {
      if (isMissingLastSeenColumnError(error)) {
        console.warn("profiles.last_seen_at ist noch nicht verfügbar; Presence-Heartbeat wird übersprungen.");
        return { ok: false, skipped: true as const };
      }
      throw new Error(error.message);
    }

    return { ok: true, skipped: false as const };
  });
