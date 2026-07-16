import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase
    .from("user_roles").select("role")
    .eq("user_id", ctx.userId).eq("role", "admin").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Nicht autorisiert");
}

async function getSupabaseAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

export type CronStatus = {
  key: string;
  label: string;
  description: string;
  schedule: string;
  expected_max_age_min: number;
  last_activity_at: string | null;
  age_min: number | null;
  severity: "green" | "yellow" | "red" | "unknown";
  hint: string | null;
};

/**
 * Indirekte Cron-Health: misst NICHT pg_cron.job_run_details (kein Zugriff aus
 * PostgREST), sondern die *Auswirkung* jedes Crons in den fachlichen Tabellen.
 * Kein Eintrag im erwarteten Fenster → Cron läuft vermutlich nicht.
 */
export const getCronHealth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const sb = await getSupabaseAdmin();

    const latest = async (table: string, col: string): Promise<string | null> => {
      const { data } = await sb.from(table).select(col).order(col, { ascending: false }).limit(1).maybeSingle();
      return (data as any)?.[col] ?? null;
    };

    const remLast = await latest("reminder_log", "sent_at");
    const dripLast = await latest("invite_resend_queue", "updated_at");

    // Booking-Confirmation: letzter Eintrag in application_reminder_log mit kind=booking_confirmation.
    const { data: bcLog } = await sb.from("application_reminder_log")
      .select("sent_at").eq("reminder_kind", "booking_confirmation")
      .order("sent_at", { ascending: false }).limit(1).maybeSingle();
    const bcLast = (bcLog as any)?.sent_at ?? null;

    // Auto-Complete: SQL-Function, kein Log — wir prüfen ob überhaupt neuere
    // interview_appointments existieren, deren Status noch 'scheduled' ist,
    // obwohl sie längst gelaufen sein müssten. Wenn ja → Cron läuft nicht.
    const { data: staleAppt } = await sb.from("interview_appointments")
      .select("id, ends_at").eq("status", "scheduled")
      .lt("ends_at", new Date(Date.now() - 2 * 60 * 60_000).toISOString())
      .order("ends_at", { ascending: false }).limit(1).maybeSingle();
    const acStale = !!(staleAppt as any)?.id;

    const now = Date.now();
    const ageMin = (iso: string | null) => iso ? Math.floor((now - new Date(iso).getTime()) / 60_000) : null;
    const sev = (age: number | null, expected: number): CronStatus["severity"] => {
      if (age === null) return "unknown";
      if (age <= expected) return "green";
      if (age <= expected * 4) return "yellow";
      return "red";
    };

    const items: CronStatus[] = [
      {
        key: "send-reminders-hourly",
        label: "Reminder-Cron",
        description: "Stündlich (Minute 15). Sendet Invite-, Confirm- und Onboarding-Reminder.",
        schedule: "15 * * * *",
        expected_max_age_min: 90,
        last_activity_at: remLast,
        age_min: ageMin(remLast),
        severity: sev(ageMin(remLast), 90),
        hint: "Aktivität gemessen am letzten reminder_log-Eintrag.",
      },
      {
        key: "process-invite-resend-queue",
        label: "Drip-Queue (Bewerber-Einladungen)",
        description: "Alle 15 Min. Sendet eingereihte Bewerber-Einladungen mit Quiet-Hours 23–05.",
        schedule: "*/15 * * * *",
        expected_max_age_min: 30,
        last_activity_at: dripLast,
        age_min: ageMin(dripLast),
        severity: sev(ageMin(dripLast), 30),
        hint: "Aktivität gemessen am letzten invite_resend_queue.updated_at. Nachts erwartet kein Update.",
      },
      {
        key: "send-booking-confirmation",
        label: "Booking-Bestätigungsmail",
        description: "Alle 2 Min. Sendet Bestätigungsmail + ICS-Anhang nach Termin-Buchung.",
        schedule: "*/2 * * * *",
        expected_max_age_min: 60,
        last_activity_at: bcLast,
        age_min: ageMin(bcLast),
        severity: bcLast ? sev(ageMin(bcLast), 60) : "unknown",
        hint: "Letzter versendeter Bestätigungs-Log-Eintrag. 'unknown' bedeutet: seit App-Start noch keine Buchung — oder Cron/Vault-Secret fehlt.",
      },
      {
        key: "auto-complete-appointments",
        label: "Auto-Complete Termine",
        description: "Alle 15 Min. Markiert vergangene Termine als 'completed' oder 'no_show'.",
        schedule: "*/15 * * * *",
        expected_max_age_min: 30,
        last_activity_at: null,
        age_min: null,
        severity: acStale ? "red" : "green",
        hint: acStale
          ? "Es existieren Termine im Status 'scheduled', die > 2 h vorbei sind. Cron auto_complete_appointments läuft vermutlich nicht."
          : "Keine hängengebliebenen Termine gefunden.",
      },
    ];

    return { items, generated_at: new Date().toISOString() };
  });
