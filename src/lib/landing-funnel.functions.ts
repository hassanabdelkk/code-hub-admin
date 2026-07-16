// Funnel-Tracking pro Landing-Page (source_slug) ODER global pro Tenant + flow_type.
//
// Liefert: bewerbungen → registriert → onboarding abgeschlossen.
// "Registriert" = Bewerber-E-Mail + Tenant matched in profiles.
// "Onboarding abgeschlossen" = profile.onboarding_status = 'abgeschlossen'.
//
// Bewerbungen mit is_test=true werden grundsätzlich ignoriert.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

type FunnelStats = {
  bewerbungen: number;
  registriert: number;
  abgeschlossen: number;
  conv_reg: number;       // % bewerbungen → registriert
  conv_done: number;      // % bewerbungen → abgeschlossen
};

type FunnelRow = FunnelStats & { key: string; label: string };

const Input = z.object({
  scope: z.enum(["per_slug", "global_flow", "single_slug"]),
  slug: z.string().max(120).optional(),
  tenant_id: z.string().uuid().optional(),
  days: z.number().int().min(1).max(365).default(90),
});

export const getLandingFunnel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const sinceIso = new Date(Date.now() - data.days * 86400_000).toISOString();

    let q = supabase
      .from("applications")
      .select("id, email, tenant_id, source_slug, flow_type, created_at, is_test")
      .eq("is_test", false)
      .gte("created_at", sinceIso);
    if (data.tenant_id) q = q.eq("tenant_id", data.tenant_id);
    if (data.scope === "single_slug" && data.slug) q = q.eq("source_slug", data.slug);

    const { data: apps, error } = await q;
    if (error) return { error: error.message, rows: [] as FunnelRow[] };
    const all = apps ?? [];

    // Gruppieren je nach scope
    const buckets = new Map<string, { label: string; emails: Array<{ email: string; tenant_id: string | null }> }>();
    const keyFor = (a: any): { k: string; label: string } => {
      if (data.scope === "global_flow") {
        const k = a.flow_type === "fast" ? "fast" : "classic";
        return { k, label: k === "fast" ? "Fast-Track (alle Landings)" : "Klassisch (alle Landings)" };
      }
      const k = (a.source_slug || "__no_slug__") as string;
      return { k, label: a.source_slug || "Ohne Slug / manuell" };
    };
    for (const a of all) {
      if (!a.email) continue;
      const { k, label } = keyFor(a);
      if (!buckets.has(k)) buckets.set(k, { label, emails: [] });
      buckets.get(k)!.emails.push({ email: String(a.email).toLowerCase(), tenant_id: a.tenant_id ?? null });
    }

    // Alle relevanten Emails (deduped) in einem Roundtrip nachschlagen
    const allEmails = Array.from(new Set(all.map((a: any) => String(a.email ?? "").toLowerCase()).filter(Boolean)));
    let profilesByEmail = new Map<string, { tenant_id: string | null; onboarding_status: string | null }>();
    if (allEmails.length > 0) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("email, tenant_id, onboarding_status")
        .in("email", allEmails);
      for (const p of (profs ?? []) as any[]) {
        if (p.email) profilesByEmail.set(p.email.toLowerCase(), { tenant_id: p.tenant_id, onboarding_status: p.onboarding_status });
      }
    }

    const rows: FunnelRow[] = [];
    for (const [k, bucket] of buckets) {
      const bewerbungen = bucket.emails.length;
      let registriert = 0;
      let abgeschlossen = 0;
      const seen = new Set<string>();
      for (const e of bucket.emails) {
        const dedupKey = `${e.email}|${e.tenant_id ?? ""}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);
        const p = profilesByEmail.get(e.email);
        if (!p) continue;
        // Tenant-Match (oder kein Tenant auf Bewerbung gesetzt)
        if (e.tenant_id && p.tenant_id && e.tenant_id !== p.tenant_id) continue;
        registriert++;
        if (p.onboarding_status === "abgeschlossen") abgeschlossen++;
      }
      const conv_reg = bewerbungen ? Math.round((registriert / bewerbungen) * 1000) / 10 : 0;
      const conv_done = bewerbungen ? Math.round((abgeschlossen / bewerbungen) * 1000) / 10 : 0;
      rows.push({ key: k, label: bucket.label, bewerbungen, registriert, abgeschlossen, conv_reg, conv_done });
    }
    rows.sort((a, b) => b.bewerbungen - a.bewerbungen);
    return { rows, error: null as string | null };
  });
