// Server functions rund um den Application-Lifecycle (Stage + History).
// Migration 20260706000000_application_stage_lifecycle.sql liefert die Datenbasis.
// Solange die Migration nicht durchgelaufen ist, fallen die Reads auf leere
// Antworten zurück, damit die UI nicht crasht.
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const STAGES = [
  "vermittlung_neu",
  "vermittlung_termin_gebucht",
  "vermittlung_no_show",
  "vermittlung_absage",
  "vermittlung_zusage",
  "fasttrack_weitergeleitet",
  "fasttrack_registriert",
  "fasttrack_onboarding",
  "fasttrack_abgeschlossen",
  "fasttrack_angenommen",
  "abgelehnt",
  "cold",
] as const;

async function assertAdmin(ctx: any) {
  const { data, error } = await ctx.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", ctx.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Nicht autorisiert");
}

export const getApplicationStageInfo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ applicationId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    // Aktueller stage-Wert (Spalte kann noch fehlen → graceful fallback).
    let stage: string | null = null;
    let stageChangedAt: string | null = null;
    try {
      const { data: row } = await context.supabase
        .from("applications")
        .select("stage, stage_changed_at")
        .eq("id", data.applicationId)
        .maybeSingle();
      stage = (row as any)?.stage ?? null;
      stageChangedAt = (row as any)?.stage_changed_at ?? null;
    } catch { /* pre-migration */ }

    let history: Array<{ from_stage: string | null; to_stage: string; reason: string | null; created_at: string }> = [];
    try {
      const { data: rows } = await context.supabase
        .from("application_stage_history")
        .select("from_stage, to_stage, reason, created_at")
        .eq("application_id", data.applicationId)
        .order("created_at", { ascending: false })
        .limit(50);
      history = (rows as any) ?? [];
    } catch { /* pre-migration */ }

    return { stage, stageChangedAt, history };
  });

export const advanceApplicationStage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      applicationId: z.string().uuid(),
      toStage: z.enum(STAGES),
      reason: z.string().max(500).optional().nullable(),
      force: z.boolean().optional().default(false),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: result, error } = await context.supabase.rpc(
      "advance_application_stage",
      {
        _application_id: data.applicationId,
        _to_stage: data.toStage,
        _actor_id: context.userId,
        _reason: data.reason ?? "admin ui",
        _force: !!data.force,
      } as any,
    );
    if (error) throw new Error(error.message);

    // Trigger "Herzlichen Glückwunsch" invitation email when admin marks
    // an application as accepted (Vermittlung-Zusage or Fasttrack-Angenommen).
    // Idempotent: skip if an invitation_token already exists for this application.
    let invite_mail: { sent: boolean; skipped?: boolean; reason?: string; error?: string } | null = null;
    if (data.toStage === "vermittlung_zusage" || data.toStage === "fasttrack_angenommen") {
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: existing } = await supabaseAdmin
          .from("invitation_tokens")
          .select("token")
          .eq("application_id", data.applicationId)
          .limit(1)
          .maybeSingle();
        if (existing?.token) {
          invite_mail = { sent: false, skipped: true, reason: "already_invited" };
        } else {
          const { data: appRow, error: appErr } = await supabaseAdmin
            .from("applications")
            .select("id, full_name, first_name, last_name, email, tenant_id, status, source_slug, source_landing_id, target_landing_id")
            .eq("id", data.applicationId)
            .maybeSingle();
          if (appErr || !appRow) {
            invite_mail = { sent: false, error: appErr?.message ?? "application_not_found" };
          } else {
            const { sendRegistrationInviteAfterAiAccept } = await import("@/lib/interview-engine.server");
            const req = getRequest();
            invite_mail = await sendRegistrationInviteAfterAiAccept(appRow as any, req);
          }
        }
      } catch (e: any) {
        console.warn("[application-stage] invite mail failed:", e);
        invite_mail = { sent: false, error: e?.message ?? "invite_failed" };
      }
    }

    return { stage: result as string, invite_mail };
  });
