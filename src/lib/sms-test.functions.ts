import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const TestSchema = z.object({
  api_key: z.string().min(4).max(200),
});

/**
 * Testet einen Anosim API-Key, indem der SMS-Endpoint aufgerufen wird.
 * 200 + JSON-Array → Key gültig. Sonst Fehlerstatus + Body.
 */
export const testAnosimConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => TestSchema.parse(input))
  .handler(async ({ data, context }) => {
    // Admin-Gate
    const { data: roleRow, error: roleErr } = await (context.supabase as any)
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (roleErr) throw new Error(roleErr.message);
    if (!roleRow) throw new Error("Nicht autorisiert");

    try {
      const res = await fetch(
        `https://anosim.net/api/v1/Sms?apikey=${encodeURIComponent(data.api_key)}`,
        { method: "GET", headers: { Accept: "application/json" } },
      );
      const text = await res.text().catch(() => "");
      if (!res.ok) {
        return {
          ok: false as const,
          status: res.status,
          message: text?.slice(0, 200) || `HTTP ${res.status}`,
        };
      }
      let count = 0;
      try {
        const j = JSON.parse(text);
        if (Array.isArray(j)) count = j.length;
      } catch {
        return { ok: false as const, status: res.status, message: "Antwort ist kein gültiges JSON" };
      }
      return { ok: true as const, status: 200, message: `Verbindung OK · ${count} SMS verfügbar` };
    } catch (e: any) {
      return { ok: false as const, status: 0, message: String(e?.message ?? e) };
    }
  });
