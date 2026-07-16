// Server-Functions für eigenes Buchungssystem (Calendly-Ersatz).
// Public: slot-lookup, buchen, absagen, umbuchen — alles per Magic-Token
// bzw. Cancel-Token. Kein Login nötig.
// Admin: Schedules verwalten.
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

// ---------------------------------------------------------------------------
// PUBLIC: Schedule-Info für Bewerber (per Magic-Token)
// ---------------------------------------------------------------------------
const TokenIn = z.object({ token: z.string().trim().min(8).max(128) });

export const getScheduleForApplicant = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => TokenIn.parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin.rpc("get_schedule_for_application", {
      _magic_token: data.token,
    });
    if (error) throw new Error(error.message);
    const row = (rows as any[])?.[0];
    if (!row) return { ok: false as const, error: "not_found" as const };
    if (!row.schedule_id) return { ok: false as const, error: "no_schedule" as const, tenant_name: row.tenant_name };
    return {
      ok: true as const,
      schedule_id: row.schedule_id as string,
      slot_duration_minutes: row.slot_duration_minutes as number,
      timezone: row.timezone as string,
      max_days_ahead: row.max_days_ahead as number,
      min_notice_hours: row.min_notice_hours as number,
      tenant_name: row.tenant_name as string | null,
      applicant_first_name: row.applicant_first_name as string | null,
      applicant_email: row.applicant_email as string | null,
      recruiter_name: row.recruiter_name as string | null,
      landing_page_id: row.landing_page_id as string | null,
      event_description: (row.event_description ?? null) as string | null,
      booking_window_days: (row.booking_window_days ?? 30) as number,
    };
  });

// ---------------------------------------------------------------------------
// PUBLIC: Freie Slots holen
// ---------------------------------------------------------------------------
const SlotsIn = z.object({
  schedule_id: z.string().uuid(),
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to_date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const getAvailableSlots = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => SlotsIn.parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin.rpc("get_free_appointment_slots", {
      _schedule_id: data.schedule_id,
      _from_date: data.from_date,
      _to_date: data.to_date,
    });
    if (error) throw new Error(error.message);
    return { slots: (rows as any[])?.map(r => ({ start: r.slot_start, end: r.slot_end })) ?? [] };
  });

// ---------------------------------------------------------------------------
// PUBLIC: Termin buchen
// ---------------------------------------------------------------------------
const BookIn = z.object({
  token: z.string().trim().min(8).max(128),
  starts_at: z.string().datetime(),
  applicant_timezone: z.string().max(80).optional(),
});

export const bookAppointment = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => BookIn.parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin.rpc("book_appointment_by_token", {
      _magic_token: data.token,
      _starts_at: data.starts_at,
      _applicant_timezone: data.applicant_timezone ?? null,
    });
    if (error) throw new Error(error.message);
    const row = (rows as any[])?.[0];
    if (!row) throw new Error("no_result");
    if (row.error) return { ok: false as const, error: row.error as string };
    return {
      ok: true as const,
      appointment_id: row.appointment_id as string,
      cancel_token: row.cancel_token as string,
      starts_at: row.starts_at as string,
      ends_at: row.ends_at as string,
    };
  });

// ---------------------------------------------------------------------------
// PUBLIC: Termin absagen
// ---------------------------------------------------------------------------
const CancelIn = z.object({
  cancel_token: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

export const cancelAppointment = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => CancelIn.parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin.rpc("cancel_appointment_by_token", {
      _cancel_token: data.cancel_token,
      _reason: data.reason ?? null,
    });
    if (error) throw new Error(error.message);
    const row = (rows as any[])?.[0];
    if (!row?.ok) return { ok: false as const, error: (row?.error as string) ?? "unknown", magic_token: row?.application_magic_token as string | null };
    return { ok: true as const, magic_token: row.application_magic_token as string | null };
  });

// ---------------------------------------------------------------------------
// PUBLIC: Termin-Detail per Cancel-Token
// ---------------------------------------------------------------------------
const CancelTokenIn = z.object({ cancel_token: z.string().uuid() });

export const getAppointmentByCancelToken = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => CancelTokenIn.parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin.rpc("get_appointment_by_cancel_token", {
      _cancel_token: data.cancel_token,
    });
    if (error) throw new Error(error.message);
    const row = (rows as any[])?.[0];
    if (!row) return { ok: false as const, error: "not_found" as const };
    return {
      ok: true as const,
      appointment_id: row.appointment_id as string,
      starts_at: row.starts_at as string,
      ends_at: row.ends_at as string,
      status: row.status as string,
      applicant_first_name: row.applicant_first_name as string | null,
      applicant_email: row.applicant_email as string | null,
      tenant_name: row.tenant_name as string | null,
      magic_token: row.application_magic_token as string | null,
    };
  });

// ===========================================================================
// ADMIN
// ===========================================================================

export const adminListSchedules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { data, error } = await context.supabase
      .from("availability_schedules")
      .select("id, tenant_id, landing_page_id, name, timezone, slot_duration_minutes, buffer_before_minutes, buffer_after_minutes, min_notice_hours, max_days_ahead, active, updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { rows: data ?? [] };
  });

const UpsertSchedule = z.object({
  id: z.string().uuid().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  landing_page_id: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(120),
  timezone: z.string().min(3).max(80),
  slot_duration_minutes: z.number().int().min(5).max(240),
  buffer_before_minutes: z.number().int().min(0).max(120),
  buffer_after_minutes: z.number().int().min(0).max(120),
  min_notice_hours: z.number().int().min(0).max(168),
  max_days_ahead: z.number().int().min(1).max(180),
  active: z.boolean(),
});

export const adminUpsertSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UpsertSchedule.parse(i))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const payload = { ...data, tenant_id: data.tenant_id || null, landing_page_id: data.landing_page_id || null };
    if (data.id) {
      const { error } = await context.supabase.from("availability_schedules").update(payload).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { ok: true, id: data.id };
    }
    const { data: ins, error } = await context.supabase
      .from("availability_schedules").insert(payload).select("id").single();
    if (error) throw new Error(error.message);
    return { ok: true, id: (ins as any).id };
  });

export const adminDeleteSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { error } = await context.supabase.from("availability_schedules").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Wochenregeln
export const adminListRules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ schedule_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { data: rows, error } = await context.supabase
      .from("availability_rules")
      .select("id, weekday, start_time, end_time")
      .eq("schedule_id", data.schedule_id)
      .order("weekday").order("start_time");
    if (error) throw new Error(error.message);
    return { rows: rows ?? [] };
  });

const RuleIn = z.object({
  schedule_id: z.string().uuid(),
  rules: z.array(z.object({
    weekday: z.number().int().min(0).max(6),
    start_time: z.string().regex(/^\d{2}:\d{2}$/),
    end_time: z.string().regex(/^\d{2}:\d{2}$/),
  })),
});

// Ersetzt komplett alle Regeln eines Schedules (einfachster UI-Flow).
export const adminReplaceRules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => RuleIn.parse(i))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const del = await context.supabase.from("availability_rules").delete().eq("schedule_id", data.schedule_id);
    if (del.error) throw new Error(del.error.message);
    if (data.rules.length === 0) return { ok: true, count: 0 };
    const payload = data.rules.map(r => ({
      schedule_id: data.schedule_id,
      weekday: r.weekday,
      start_time: r.start_time,
      end_time: r.end_time,
    }));
    const ins = await context.supabase.from("availability_rules").insert(payload);
    if (ins.error) throw new Error(ins.error.message);
    return { ok: true, count: payload.length };
  });

// Ausnahmen
export const adminListExceptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ schedule_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { data: rows, error } = await context.supabase
      .from("availability_exceptions")
      .select("id, exception_date, is_blocked, start_time, end_time, note")
      .eq("schedule_id", data.schedule_id)
      .order("exception_date");
    if (error) throw new Error(error.message);
    return { rows: rows ?? [] };
  });

const ExceptionIn = z.object({
  id: z.string().uuid().optional(),
  schedule_id: z.string().uuid(),
  exception_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  is_blocked: z.boolean(),
  start_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  end_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  note: z.string().max(500).optional(),
});

export const adminUpsertException = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ExceptionIn.parse(i))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const payload = {
      schedule_id: data.schedule_id,
      exception_date: data.exception_date,
      is_blocked: data.is_blocked,
      start_time: data.is_blocked ? null : (data.start_time ?? null),
      end_time: data.is_blocked ? null : (data.end_time ?? null),
      note: data.note ?? null,
    };
    if (data.id) {
      const { error } = await context.supabase.from("availability_exceptions").update(payload).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { ok: true, id: data.id };
    }
    const { data: ins, error } = await context.supabase
      .from("availability_exceptions").insert(payload).select("id").single();
    if (error) throw new Error(error.message);
    return { ok: true, id: (ins as any).id };
  });

export const adminDeleteException = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { error } = await context.supabase.from("availability_exceptions").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Buchungs-Übersicht (Admin)
export const adminListAppointments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({
    tenant_id: z.string().uuid().optional(),
    status: z.enum(["scheduled","cancelled","no_show","completed","all"]).default("scheduled"),
  }).parse(i))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    let q = context.supabase
      .from("interview_appointments")
      .select("id, tenant_id, application_id, schedule_id, starts_at, ends_at, status, applicant_timezone, cancelled_at, cancelled_by, created_at, applications:application_id(full_name, email)")
      .order("starts_at", { ascending: true })
      .limit(500);
    if (data.tenant_id) q = q.eq("tenant_id", data.tenant_id);
    if (data.status !== "all") q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [] };
  });

export const adminCancelAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({
    id: z.string().uuid(),
    reason: z.string().max(500).optional(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { data: appt, error: e1 } = await context.supabase
      .from("interview_appointments")
      .select("application_id, status")
      .eq("id", data.id).single();
    if (e1) throw new Error(e1.message);
    if ((appt as any).status !== "scheduled") return { ok: false, error: "not_scheduled" };

    const { error } = await context.supabase
      .from("interview_appointments")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancelled_by: "admin", cancel_reason: data.reason ?? null })
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    await context.supabase
      .from("applications")
      .update({ booking_status: "cancelled" })
      .eq("id", (appt as any).application_id);
    return { ok: true };
  });
