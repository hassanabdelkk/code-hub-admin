import { createFileRoute } from "@tanstack/react-router";

// Wird vom pg_cron alle 5 Min angefragt. Pingt alle aktiven Tenant-Domains
// (primary + aliases), loggt Status, schreibt bei `down` einen Activity-Log-
// Eintrag (Admin sieht ihn auf /admin/activity).
//
// Auth: ?key=<CRON_SECRET> oder Service-Role via Authorization/apikey.

function normalizeDomain(d: string): string {
  return String(d).toLowerCase().trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^portal\./, "");
}

async function pingDomain(host: string, timeoutMs = 5000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const start = Date.now();
  try {
    const res = await fetch(`https://${host}/`, { method: "HEAD", signal: ctrl.signal, redirect: "manual" });
    clearTimeout(t);
    const latency = Date.now() - start;
    return { status: latency > 3000 ? "slow" : "ok", http_status: res.status, latency_ms: latency, error: null as string | null };
  } catch (e: any) {
    clearTimeout(t);
    return { status: "down", http_status: null, latency_ms: Date.now() - start, error: String(e?.message ?? e) };
  }
}

async function checkDomain(domain: string) {
  const rootHost = domain;
  const portalHost = `portal.${domain}`;
  const [root, portal] = await Promise.all([
    pingDomain(rootHost),
    pingDomain(portalHost),
  ]);
  const rootAlive = root.status !== "down";
  const portalAlive = portal.status !== "down";
  const preferred = portalAlive ? { host: portalHost, ...portal } : rootAlive ? { host: rootHost, ...root } : { host: rootHost, ...root };

  return {
    status: portalAlive || rootAlive ? preferred.status : "down",
    http_status: preferred.http_status,
    latency_ms: preferred.latency_ms,
    error: portalAlive || rootAlive
      ? null
      : `Root und Portal nicht erreichbar. Root: ${root.error ?? "keine Antwort"}; Portal: ${portal.error ?? "keine Antwort"}`,
    checked_url: `https://${preferred.host}/`,
    root_status: root.status,
    root_error: root.error,
    portal_status: portal.status,
    portal_error: portal.error,
  };
}

function isAuthorized(request: Request, url: URL) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const providedKey = (url.searchParams.get("key") ?? request.headers.get("x-cron-secret") ?? "").trim();
  const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const apikey = (request.headers.get("apikey") ?? "").trim();

  return Boolean(
    (cronSecret && providedKey === cronSecret) ||
    (serviceRole && (bearer === serviceRole || apikey === serviceRole))
  );
}

export const Route = createFileRoute("/api/public/domain-health-cron")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        if (!isAuthorized(request, url)) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const sb = supabaseAdmin as any;
        const { data: tenants, error } = await sb
          .from("tenants")
          .select("id,name,domain,domain_aliases,primary_domain,emails_paused")
          .eq("is_active", true);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const results: any[] = [];
        const autoPaused: string[] = [];
        for (const t of tenants ?? []) {
          const aliases: string[] = Array.isArray(t.domain_aliases) ? t.domain_aliases : [];
          const all = Array.from(new Set([t.domain, ...aliases].filter(Boolean).map(normalizeDomain)));
          const primary = t.primary_domain ? normalizeDomain(t.primary_domain) : (t.domain ? normalizeDomain(t.domain) : null);

          let downCount = 0;
          for (const d of all) {
            const r = await checkDomain(d);
            results.push({ tenant_id: t.id, tenant_name: t.name, domain: d, is_primary: d === primary, ...r });

            if (r.status === "down") {
              downCount++;
              try {
                await sb.from("activity_log").insert({
                  action: "domain_down_alert",
                  entity_type: "tenant",
                  entity_id: t.id,
                  comment: `Domain ${d} ist DOWN (${r.error ?? "no response"}). ${d === primary ? "AKTIVE Versand-Domain — sofortiger Wechsel auf Alias nötig!" : "Inaktive Alias-Domain."}`,
                });
              } catch {}
            }
          }

          // Auto-Pause: alle Domains down UND noch nicht pausiert → Mail-Versand stoppen.
          // Bewusst KEIN Auto-Resume — Admin muss manuell freigeben, sonst Mail-Flut nach Restore.
          if (all.length > 0 && downCount === all.length && !t.emails_paused) {
            try {
              await sb.from("tenants").update({
                emails_paused: true,
                emails_paused_at: new Date().toISOString(),
                emails_paused_reason: `Alle ${all.length} Domain(s) down — automatisch pausiert.`,
                emails_paused_by: "auto:domain_down",
              }).eq("id", t.id);
              await sb.from("activity_log").insert({
                action: "emails_auto_pausiert",
                entity_type: "tenant",
                entity_id: t.id,
                comment: `Mail-Versand automatisch gestoppt: alle ${all.length} Domain(s) nicht erreichbar. Admin muss manuell reaktivieren.`,
              });
              autoPaused.push(t.id);
            } catch {}
          }
        }

        return Response.json({ ok: true, checked_at: new Date().toISOString(), domains: results, auto_paused: autoPaused });
      },
    },
  },
});
