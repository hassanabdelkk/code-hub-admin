// Deno Edge Function: smtp-test
// Prüft die SMTP-Konfiguration eines Tenants mit Admin-Auth und liefert
// detaillierte Diagnose-Schritte für die Admin-Oberfläche.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import nodemailer from "https://esm.sh/nodemailer@6.9.14";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Stage = "AUTH" | "CONFIG" | "TENANT" | "VERIFY" | "DONE";

interface Payload {
  tenant_id?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const debug: Record<string, unknown> = {
    current_stage: "AUTH",
    last_successful_stage: null,
  };

  try {
    const { tenant_id } = (await req.json().catch(() => ({}))) as Payload;
    if (!tenant_id) {
      return json({ success: false, error: "tenant_id fehlt", errorCode: "VALIDATION_ERROR", debug }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("API_EXTERNAL_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      debug.current_stage = "CONFIG" satisfies Stage;
      return json({ success: false, error: "Server-Konfiguration fehlt", errorCode: "CONFIG_ERROR", debug }, 500);
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!bearer) {
      return json({ success: false, error: "Nicht autorisiert", errorCode: "AUTH_ERROR", debug }, 401);
    }

    const { data: userRes, error: userErr } = await admin.auth.getUser(bearer);
    if (userErr || !userRes?.user) {
      return json({ success: false, error: "Admin-Sitzung ungültig", errorCode: "AUTH_ERROR", details: userErr?.message, debug }, 401);
    }

    const { data: role, error: roleErr } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userRes.user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (roleErr) {
      return json({ success: false, error: "Admin-Rolle konnte nicht geprüft werden", errorCode: "AUTH_ERROR", details: roleErr.message, debug }, 500);
    }
    if (!role) {
      return json({ success: false, error: "Nicht autorisiert", errorCode: "AUTH_ERROR", debug }, 403);
    }

    debug.last_successful_stage = "AUTH";
    debug.current_stage = "TENANT" satisfies Stage;

    const { data: tenant, error: tenantErr } = await admin
      .from("tenants")
      .select("id,name,sender_email,smtp_host,smtp_port,smtp_username,smtp_password,is_active,emails_paused,emails_paused_reason")
      .eq("id", tenant_id)
      .maybeSingle();

    if (tenantErr) {
      return json({ success: false, error: "Tenant konnte nicht geladen werden", errorCode: "TENANT_ERROR", details: tenantErr.message, debug }, 500);
    }
    if (!tenant) {
      return json({ success: false, error: "Tenant nicht gefunden", errorCode: "TENANT_ERROR", debug }, 404);
    }
    if (tenant.is_active === false) {
      return json({ success: false, error: "Tenant ist deaktiviert", errorCode: "TENANT_INACTIVE", debug }, 400);
    }
    if (tenant.emails_paused) {
      return json({
        success: false,
        error: `E-Mail-Versand ist pausiert${tenant.emails_paused_reason ? `: ${tenant.emails_paused_reason}` : ""}`,
        errorCode: "TENANT_PAUSED",
        debug,
      }, 400);
    }
    if (!tenant.smtp_host || !tenant.smtp_port || !tenant.smtp_username || !tenant.smtp_password || !tenant.sender_email) {
      return json({ success: false, error: "SMTP ist nicht vollständig konfiguriert", errorCode: "SMTP_CONFIG_INCOMPLETE", debug }, 400);
    }

    debug.last_successful_stage = "TENANT";
    debug.current_stage = "VERIFY" satisfies Stage;
    debug.smtp_host = tenant.smtp_host;
    debug.smtp_port = tenant.smtp_port;
    debug.smtp_secure = tenant.smtp_port === 465;
    debug.smtp_username = tenant.smtp_username;
    debug.sender_email = tenant.sender_email;

    const transporter = nodemailer.createTransport({
      host: tenant.smtp_host,
      port: tenant.smtp_port,
      secure: tenant.smtp_port === 465,
      auth: { user: tenant.smtp_username, pass: tenant.smtp_password },
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 12000,
    });

    await Promise.race([
      transporter.verify(),
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error("verify timeout 8s")), 8000)),
    ]);

    debug.last_successful_stage = "VERIFY";
    debug.current_stage = "DONE" satisfies Stage;
    return json({ success: true, message: "SMTP-Verbindung und Login erfolgreich", debug }, 200);
  } catch (err: any) {
    const message = String(err?.message ?? err);
    return json({
      success: false,
      error: classifySmtpError(message),
      errorCode: smtpErrorCode(message),
      details: message,
      debug: { ...debug, rawError: message },
    }, 502);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function smtpErrorCode(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("535") || normalized.includes("auth") || normalized.includes("login")) return "AUTH_ERROR";
  if (normalized.includes("timeout") || normalized.includes("etimedout")) return "TIMEOUT";
  if (normalized.includes("econnrefused") || normalized.includes("connection refused")) return "CONNECTION_REFUSED";
  if (normalized.includes("enotfound") || normalized.includes("getaddrinfo")) return "DNS_ERROR";
  if (normalized.includes("certificate") || normalized.includes("tls") || normalized.includes("ssl")) return "TLS_ERROR";
  return "SMTP_ERROR";
}

function classifySmtpError(message: string) {
  switch (smtpErrorCode(message)) {
    case "AUTH_ERROR":
      return "SMTP-Login fehlgeschlagen: Benutzername oder Passwort/App-Passwort stimmt nicht.";
    case "TIMEOUT":
      return "SMTP-Server antwortet nicht rechtzeitig.";
    case "CONNECTION_REFUSED":
      return "SMTP-Verbindung wurde abgelehnt: Host oder Port prüfen.";
    case "DNS_ERROR":
      return "SMTP-Host konnte nicht aufgelöst werden.";
    case "TLS_ERROR":
      return "TLS/SSL-Verbindung zum SMTP-Server fehlgeschlagen.";
    default:
      return `SMTP-Test fehlgeschlagen: ${message}`;
  }
}