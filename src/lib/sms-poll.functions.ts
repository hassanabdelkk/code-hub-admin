import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Ergebnis-Shape des Pollings.
export type PollResult = {
  pulled: number;
  inserted: number;
  channels_polled: number;
  errors: string[];
};

type AnosimSms = {
  simCardNumber: string;
  messageDate: string;
  messageSender: string | number;
  messageText: string;
};

// Stable Dedup-ID pro SMS. Anosim hat keine eigene Message-ID,
// also bauen wir einen deterministischen Schlüssel.
function buildProviderMessageId(sms: AnosimSms): string {
  return `anosim:${sms.simCardNumber}:${sms.messageDate}:${sms.messageSender}`;
}

// Telefonnummern können in unterschiedlichen Formaten kommen.
// Normalisierung: alle Nicht-Ziffern entfernen, dann führende Nullen
// und länderlose Varianten egal machen – wir matchen über das
// Ende der Nummer (letzte 10 Stellen sollten reichen).
function normalizePhone(p: string): string {
  return String(p ?? "").replace(/\D/g, "");
}
function phoneMatchKey(p: string): string {
  const n = normalizePhone(p);
  return n.slice(-10);
}

async function runPoll(): Promise<PollResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const sb = supabaseAdmin as any;

  const result: PollResult = {
    pulled: 0,
    inserted: 0,
    channels_polled: 0,
    errors: [],
  };

  // Alle Anosim-Channels mit hinterlegtem API-Key
  const { data: channels, error: chErr } = await sb
    .from("sms_channels")
    .select("id, phone_number, api_key, tenant_id, is_active")
    .eq("provider", "anosim")
    .eq("is_active", true)
    .not("api_key", "is", null);

  if (chErr) {
    result.errors.push(`channels: ${chErr.message}`);
    return result;
  }

  type Channel = {
    id: string;
    phone_number: string;
    api_key: string;
    tenant_id: string | null;
  };

  // Gruppieren nach api_key (ein Account kann mehrere Nummern haben → 1 Request)
  const byKey = new Map<string, Channel[]>();
  for (const c of (channels ?? []) as Channel[]) {
    if (!c.api_key) continue;
    const arr = byKey.get(c.api_key) ?? [];
    arr.push(c);
    byKey.set(c.api_key, arr);
  }

  for (const [apiKey, group] of byKey.entries()) {
    result.channels_polled += group.length;

    // Lookup: Telefon-Suffix → Channel
    const channelByPhone = new Map<string, Channel>();
    for (const c of group) channelByPhone.set(phoneMatchKey(c.phone_number), c);

    let smsList: AnosimSms[] = [];
    try {
      const res = await fetch(
        `https://anosim.net/api/v1/Sms?apikey=${encodeURIComponent(apiKey)}`,
        { method: "GET", headers: { Accept: "application/json" } },
      );
      if (!res.ok) {
        result.errors.push(`anosim ${res.status}: ${await res.text().catch(() => "")}`);
        continue;
      }
      smsList = (await res.json()) as AnosimSms[];
    } catch (e: any) {
      result.errors.push(`anosim fetch: ${String(e?.message ?? e)}`);
      continue;
    }

    if (!Array.isArray(smsList) || smsList.length === 0) continue;
    result.pulled += smsList.length;

    // Pro SMS: passenden Channel finden, aktive Zuweisung holen, einfügen.
    for (const sms of smsList) {
      const ch = channelByPhone.get(phoneMatchKey(sms.simCardNumber));
      if (!ch) continue; // Nummer gehört zu keinem unserer Channels

      // Aktiver Mitarbeiter, dem die Nummer zugewiesen ist (kann fehlen)
      let userId: string | null = null;
      try {
        const { data: asg } = await sb
          .from("sms_assignments")
          .select("user_id")
          .eq("sms_channel_id", ch.id)
          .eq("is_active", true)
          .order("assigned_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        userId = (asg?.user_id as string) ?? null;
      } catch {
        /* ignore – wir loggen die SMS auch ohne user_id */
      }

      const providerMessageId = buildProviderMessageId(sms);

      const { error: insErr } = await sb
        .from("sms_messages")
        .upsert(
          {
            channel_id: ch.id,
            tenant_id: ch.tenant_id,
            user_id: userId,
            direction: "inbound",
            from_number: String(sms.messageSender ?? ""),
            to_number: ch.phone_number,
            body: String(sms.messageText ?? ""),
            status: "received",
            provider_message_id: providerMessageId,
            created_at: sms.messageDate,
          },
          { onConflict: "channel_id,provider_message_id", ignoreDuplicates: true },
        );

      if (insErr) {
        result.errors.push(`insert: ${insErr.message}`);
        continue;
      }
      // upsert mit ignoreDuplicates liefert keine eindeutige "inserted"-Zahl;
      // wir zählen optimistisch.
      result.inserted += 1;
    }
  }

  return result;
}

// Öffentlich für Cron / interne Aufrufer
export async function pollAnosimSmsInternal(): Promise<PollResult> {
  return runPoll();
}

// ServerFn für UI-Refresh-Buttons (nur für eingeloggte Nutzer)
export const pollAnosimSms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    return runPoll();
  });
