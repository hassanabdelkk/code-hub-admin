// Cloudflare-Integration: Accounts/Zones verwalten + A-Records setzen.
// API-Token wird pro Account in cloudflare_accounts.api_token gespeichert.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const CF_API = "https://api.cloudflare.com/client/v4";

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

function ensureToken(token: string | null | undefined, accountName?: string): string {
  if (!token || !token.trim()) {
    throw new Error(`Cloudflare-Token fehlt für "${accountName ?? "Account"}". Bitte im Portal eintragen.`);
  }
  return normalizeCloudflareToken(token);
}

function normalizeCloudflareToken(input: string): string {
  const trimmed = (input ?? "").trim();
  // Falls die Eingabe mehr enthält (z.B. ganzes JSON aus dem CF-Portal), das cfat_-Token rausschneiden.
  const cfatMatch = trimmed.match(/cfat_[A-Za-z0-9_-]+/);
  if (cfatMatch) return cfatMatch[0];
  // Klassischer 40-Zeichen-Token (Cloudflare Legacy "User API Token") akzeptieren.
  const legacyMatch = trimmed.match(/^[A-Za-z0-9_-]{30,}$/);
  if (legacyMatch) return trimmed;
  throw new Error("Ungültiges Cloudflare-Token. Erwartet: 'cfat_…' oder ein 40-Zeichen-Token.");
}

function normalizeCloudflareAccountId(input: string): string {
  const match = input.match(/[a-f0-9]{32}/i);
  const accountId = (match?.[0] ?? input).trim().toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(accountId)) {
    throw new Error("Bitte die 32-stellige Cloudflare Account-ID einfügen.");
  }
  return accountId;
}

async function cfFetch(token: string, path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${CF_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    throw new Error(formatCloudflareError(json, res.status));
  }
  return json;
}

function formatCloudflareError(json: any, status: number): string {
  const errors = Array.isArray(json?.errors) ? json.errors : [];
  const msg = errors
    .map((e: any) => [e?.code, e?.message].filter(Boolean).join(": "))
    .filter(Boolean)
    .join("; ") || `HTTP ${status}`;

  if (errors.some((e: any) => Number(e?.code) === 1000)) {
    return (
      `Cloudflare-API: ${msg}. ` +
      `Das ist kein Rechte-/Scope-Problem, sondern Cloudflare akzeptiert den Token nicht. ` +
      `Bitte einen User API Token neu erstellen und exakt den frisch angezeigten Token einfügen — nicht Global API Key, nicht Account API Token.`
    );
  }

  if (status === 403 || /permission|scope|not authorized|unauthorized/i.test(msg)) {
    return (
      `Cloudflare-API: ${msg}. ` +
      `Der Token muss unter Zone Permissions diese Rechte haben: Zone → Zone → Read und Zone → DNS → Edit.`
    );
  }

  return `Cloudflare-API: ${msg}`;
}

// ── Accounts CRUD ──────────────────────────────────────────────────────────
export const listCloudflareAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { data, error } = await context.supabase
      .from("cloudflare_accounts")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return {
      rows: (data ?? []).map((row: any) => ({
        ...row,
        api_token: Boolean(row.api_token),
      })),
    };
  });

const CreateAccountInput = z.object({
  name: z.string().min(1).max(120),
  account_id: z.string().min(8).max(512),
  api_token: z.string().min(20, "Token zu kurz").max(1000),
  is_default: z.boolean().default(false),
});

export const createCloudflareAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => CreateAccountInput.parse(i))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const cleanData = {
      ...data,
      account_id: normalizeCloudflareAccountId(data.account_id),
      api_token: normalizeCloudflareToken(data.api_token),
    };
    if (data.is_default) {
      await context.supabase.from("cloudflare_accounts").update({ is_default: false }).neq("id", "00000000-0000-0000-0000-000000000000");
    }
    const { data: row, error } = await context.supabase
      .from("cloudflare_accounts")
      .insert(cleanData)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

const UpdateAccountInput = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120).optional(),
  api_token: z.string().min(20).max(1000).optional(),
  is_default: z.boolean().optional(),
});

export const updateCloudflareAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UpdateAccountInput.parse(i))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { id, ...patch } = data;
    if (patch.api_token) patch.api_token = normalizeCloudflareToken(patch.api_token);
    if (patch.is_default) {
      await context.supabase.from("cloudflare_accounts").update({ is_default: false }).neq("id", id);
    }
    const { data: row, error } = await context.supabase
      .from("cloudflare_accounts")
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteCloudflareAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { error } = await context.supabase.from("cloudflare_accounts").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Testet den Token über Cloudflares offiziellen User-Token-Verify-Endpunkt
// und prüft danach, ob der Token mindestens eine Zone sehen darf.
export const verifyCloudflareToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { data: acc, error } = await context.supabase
      .from("cloudflare_accounts")
      .select("api_token, account_id, name")
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);
    const token = ensureToken(acc.api_token, acc.name);
    normalizeCloudflareAccountId(acc.account_id);
    const res = await fetch(`${CF_API}/user/tokens/verify`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json?.success === false) {
      throw new Error(formatCloudflareError(json, res.status));
    }

    const zones = await cfFetch(token, `/zones?per_page=1`);
    const visibleZones = zones.result_info?.total_count ?? (zones.result ?? []).length;
    if (!visibleZones) {
      throw new Error(
        `Token ist gültig, sieht aber keine Cloudflare-Zone. ` +
          `Setze Zone Resources auf "Specific zone" für deine Domain oder "All zones from an account" und füge Zone → Zone → Read hinzu.`,
      );
    }

    return { ok: true, status: json?.result?.status ?? "active", name: acc.name, zonesVisible: visibleZones };
  });

// Sync: listet alle Zonen des Accounts und schreibt sie in cloudflare_zones
export const syncCloudflareZones = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ account_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { data: acc, error } = await context.supabase
      .from("cloudflare_accounts")
      .select("id, account_id, api_token, name")
      .eq("id", data.account_id)
      .single();
    if (error) throw new Error(error.message);
    const token = ensureToken(acc.api_token, acc.name);

    let page = 1;
    const zones: any[] = [];
    while (true) {
      // Account-scoped tokens: list ALL zones the token can see (no account filter,
      // because the token itself is already scoped to the account).
      const res = await cfFetch(token, `/zones?per_page=50&page=${page}`);
      const batch = (res.result ?? []) as any[];
      zones.push(...batch);
      const totalPages = res.result_info?.total_pages ?? 1;
      if (page >= totalPages || batch.length === 0) break;
      page++;
    }
    if (zones.length === 0) {
      throw new Error(
        `Cloudflare lieferte 0 Zonen für Account "${acc.name}" (${acc.account_id}). ` +
          `Prüfe: (1) Token-Permissions enthalten "Zone → Zone → Read" für "All zones from an account" (oder spezifische Zonen), ` +
          `(2) im Cloudflare-Account sind tatsächlich Domains/Zonen angelegt.`,
      );
    }

    let upserted = 0;
    for (const z of zones) {
      const domain = String(z.name ?? "").trim().toLowerCase();
      if (!domain || !z.id) {
        throw new Error(`Cloudflare lieferte eine ungültige Zone: ${JSON.stringify({ id: z.id, name: z.name })}`);
      }

      const payload = {
        cloudflare_account_id: acc.id,
        domain,
        zone_id: z.id,
        status: z.status ?? "active",
        nameservers: z.name_servers ?? [],
        last_synced_at: new Date().toISOString(),
      };

      const { data: existing, error: findErr } = await context.supabase
        .from("cloudflare_zones")
        .select("id")
        .eq("domain", domain)
        .maybeSingle();
      if (findErr) throw new Error(`Zone "${domain}" konnte nicht geprüft werden: ${findErr.message}`);

      const { error: writeErr } = existing
        ? await context.supabase.from("cloudflare_zones").update(payload).eq("id", existing.id)
        : await context.supabase.from("cloudflare_zones").insert(payload);
      if (writeErr) throw new Error(`Zone "${domain}" konnte nicht gespeichert werden: ${writeErr.message}`);

      upserted++;
    }
    await context.supabase.from("automation_log").insert({
      action: "cf.zones.sync",
      target: acc.account_id,
      status: "ok",
      actor_id: context.userId,
      payload: { count: upserted },
    });
    return { count: upserted, found: zones.length };
  });

// Setzt A-Record @ und www auf die Server-IP.
// Wenn der Record schon existiert → update, sonst create.
export const setLandingDnsRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      domain: z.string().min(3),
      ip: z.string().min(7),
      proxied: z.boolean().default(true),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const domain = data.domain.toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");

    // Zone in DB suchen — entweder exakt oder per Suffix-Match (Subdomain → Apex)
    const { data: zoneRows } = await context.supabase
      .from("cloudflare_zones")
      .select("id, domain, zone_id, cloudflare_account_id, cloudflare_accounts!inner(api_token, name)")
      .order("domain", { ascending: false });

    const zone = (zoneRows ?? []).find((z: any) => domain === z.domain || domain.endsWith("." + z.domain));
    if (!zone) {
      throw new Error(`Keine Cloudflare-Zone für "${domain}" gefunden. Erst Zonen syncen oder Domain in CF anlegen.`);
    }
    const acc = (zone as any).cloudflare_accounts;
    const token = ensureToken(acc.api_token, acc.name);

    // Welcher record-name? "@" für apex, sonst die Subdomain-Komponente.
    const recordName = domain === zone.domain ? "@" : domain;

    // Existierenden Record finden
    const list = await cfFetch(token, `/zones/${zone.zone_id}/dns_records?type=A&name=${encodeURIComponent(domain)}`);
    const existing = list.result?.[0];

    const body = {
      type: "A",
      name: recordName,
      content: data.ip,
      ttl: 1,         // 1 = automatic
      proxied: data.proxied,
      comment: "managed by mb-portal landing-pool",
    };

    let result;
    if (existing) {
      result = await cfFetch(token, `/zones/${zone.zone_id}/dns_records/${existing.id}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
    } else {
      result = await cfFetch(token, `/zones/${zone.zone_id}/dns_records`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    }

    // www auch setzen (nur wenn apex)
    if (recordName === "@") {
      const wwwName = `www.${zone.domain}`;
      const wwwList = await cfFetch(token, `/zones/${zone.zone_id}/dns_records?type=A&name=${encodeURIComponent(wwwName)}`);
      const wwwExisting = wwwList.result?.[0];
      const wwwBody = { ...body, name: "www" };
      if (wwwExisting) {
        await cfFetch(token, `/zones/${zone.zone_id}/dns_records/${wwwExisting.id}`, { method: "PUT", body: JSON.stringify(wwwBody) });
      } else {
        await cfFetch(token, `/zones/${zone.zone_id}/dns_records`, { method: "POST", body: JSON.stringify(wwwBody) });
      }
    }

    await context.supabase.from("automation_log").insert({
      action: "cf.record.set",
      target: domain,
      status: "ok",
      actor_id: context.userId,
      payload: { ip: data.ip, zone_id: zone.zone_id, proxied: data.proxied },
    });

    return { zone_id: zone.zone_id, zone_domain: zone.domain, record_id: result.result?.id, ip: data.ip };
  });
