// Deno Edge Function: send-invitation-email
//
// Wird beim Akzeptieren einer Bewerbung gerufen (admin.applications.$appId.tsx).
// Sendet eine Willkommens-/Einladungs-Mail mit Registrierungs-Link über die
// Tenant-SMTP. Respektiert tenants.emails_paused und nutzt verifyOrPause für
// Auto-Pause nach 3 SMTP-Verify-Fails (analog zu resend-signup-confirmation).
//
// Deploy:
//   supabase functions deploy send-invitation-email --no-verify-jwt

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import nodemailer from "https://esm.sh/nodemailer@6.9.14";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_WELCOME_TEMPLATE = `Hallo {{first_name}},

herzlichen Glückwunsch – Ihr Profil hat uns überzeugt! 🎉

Damit Sie direkt starten können, ist nur noch ein Schritt nötig: die Registrierung im Mitarbeiter-Portal.

Was Sie brauchen (bitte bereithalten):
• Personalausweis oder Reisepass
• IBAN (Bankverbindung für die Gehaltszahlung)
• Steuer-Identifikationsnummer (11-stellig, steht auf Ihrem Lohnsteuerbescheid)
• Sozialversicherungsnummer (falls vorhanden)

Wie geht es weiter?
1. Portal-Registrierung abschließen (ca. 5 Minuten)
2. Arbeitsvertrag digital unterschreiben
3. Sofort loslegen – Aufträge stehen bereit

{{cta:Jetzt registrieren|{{portal_link}}}}

Bei Fragen antworten Sie einfach auf diese E-Mail – wir helfen gerne.

Herzliche Grüße
{{sender_name}}`;

const LEGACY_WELCOME_MARKERS = [
  "dein Zugang für {{tenant_name}} ist bereit",
  "dein Zugang für",
  "Bitte registriere dich im Mitarbeiterportal und schließe anschließend dein Profil ab",
];

interface Payload {
  to: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  registrationLink: string;
  tenantId: string;
  /** Optional overrides for non-default flows (e.g. magic-link / interview link). */
  subject?: string;
  headline?: string;
  intro?: string;
  buttonLabel?: string;
  templateName?: string;
  /** Extra placeholder values (z.B. {{partner_name}}) für DB-Templates. */
  placeholders?: Record<string, string>;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = (await req.json()) as Payload;
    const { to, fullName, firstName, lastName, registrationLink, tenantId,
      subject: subjectOverride, headline: headlineOverride,
      intro: introOverride, buttonLabel: buttonLabelOverride,
      templateName: templateNameOverride, placeholders: extraPlaceholders } = body;

    if (!to || !registrationLink || !tenantId) {
      return json({ error: "Missing required fields: to, registrationLink, tenantId" }, 400);
    }

    const supabaseAdmin = createClient(
      (Deno.env.get("SUPABASE_URL") ?? Deno.env.get("API_EXTERNAL_URL"))!,
      (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY"))!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const supabase = supabaseAdmin;

    const { data: tenant, error: tErr } = await supabaseAdmin
      .from("tenants")
      .select("id, name, domain, logo_url, primary_color, sender_email, sender_name, reply_to_email, smtp_host, smtp_port, smtp_username, smtp_password, is_active, emails_paused, emails_paused_reason, welcome_email_subject, welcome_email_body, application_received_subject, application_received_body, application_received_button_label")
      .eq("id", tenantId)
      .maybeSingle();
    if (tErr || !tenant) return json({ error: "Tenant nicht gefunden" }, 404);
    if (tenant.is_active === false) {
      return json({ error: "Tenant ist deaktiviert — kein E-Mail-Versand.", inactive: true }, 503);
    }
    if (!tenant.smtp_host || !tenant.smtp_port || !tenant.smtp_username || !tenant.smtp_password) {
      return json({ error: "Tenant hat keine vollständige SMTP-Konfiguration" }, 400);
    }
    if (tenant.emails_paused) {
      return json({
        error: `E-Mail-Versand für diesen Mandanten ist pausiert${tenant.emails_paused_reason ? `: ${tenant.emails_paused_reason}` : ""}.`,
        paused: true,
      }, 503);
    }

    const senderName = tenant.sender_name ?? tenant.name;
    const senderEmail = tenant.sender_email ?? tenant.smtp_username;
    const brand = tenant.primary_color ?? "#0f172a";
    const greetingName = firstName || (fullName ? fullName.split(" ")[0] : "");

    // Placeholder-Map für DB-Templates.
    const phMap: Record<string, string> = {
      first_name: greetingName,
      last_name: lastName || "",
      full_name: fullName || `${firstName ?? ""} ${lastName ?? ""}`.trim(),
      email: to,
      tenant_name: tenant.name,
      company_name: tenant.name,
      sender_name: senderName,
      portal_link: registrationLink,
      booking_link: registrationLink,
      registration_link: registrationLink,
      ...(extraPlaceholders || {}),
    };
    const applyPh = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_m, k) => phMap[k] ?? "");

    // Template-Defaults aus tenant-Spalten laden.
    let dbSubject: string | null = null;
    let dbBody: string | null = null;
    let dbButton: string | null = null;
    if (!templateNameOverride || templateNameOverride === "invitation") {
      dbSubject = tenant.welcome_email_subject || null;
      dbBody = tenant.welcome_email_body || null;
    }
    if (templateNameOverride === "application_received") {
      dbSubject = tenant.application_received_subject || null;
      dbBody = tenant.application_received_body || null;
      dbButton = tenant.application_received_button_label || null;
    }

    const isDefaultInvitation = !templateNameOverride || templateNameOverride === "invitation" || templateNameOverride === "ai_acceptance_invitation";
    if (isDefaultInvitation && dbBody && isLegacyWelcomeTemplate(dbBody)) dbBody = null;

    const templateBody = introOverride && introOverride.trim()
      ? introOverride.trim()
      : (dbBody || (isDefaultInvitation ? DEFAULT_WELCOME_TEMPLATE : null));

    const subject = subjectOverride && subjectOverride.trim()
      ? subjectOverride.trim()
      : (dbSubject ? applyPh(dbSubject) : `🎉 Willkommen im Team – Ihre Registrierung in 5 Min`);
    const headline = headlineOverride && headlineOverride.trim()
      ? headlineOverride.trim()
      : "Willkommen im Team!";
    const buttonLabel = buttonLabelOverride && buttonLabelOverride.trim()
      ? buttonLabelOverride.trim()
      : (dbButton ? applyPh(dbButton) : "Jetzt registrieren");
    const renderedBody = templateBody
      ? renderTemplateBody(templateBody, phMap, brand, registrationLink, buttonLabel)
      : {
          html: `<p style="font-size:15px;line-height:1.65;color:#334155;margin:0 0 20px">Guten Tag${greetingName ? ` ${escapeHtml(greetingName)}` : ""},<br/><br/><strong>Ihr Profil hat uns überzeugt – lassen Sie uns direkt starten!</strong><br/><br/>Wir freuen uns sehr, Sie bei <strong>${escapeHtml(tenant.name)}</strong> begrüßen zu dürfen. Damit Sie sofort loslegen können, haben wir Ihren persönlichen Zugang zum Mitarbeiterportal bereits für Sie vorbereitet.</p>`,
          hasCta: false,
        };

    const logo = tenant.logo_url
      ? `<img src="${tenant.logo_url}" alt="${escapeHtml(tenant.name)}" style="max-height:48px;margin-bottom:24px"/>`
      : `<div style="font-weight:700;font-size:20px;margin-bottom:24px;color:${brand}">${escapeHtml(tenant.name)}</div>`;

    const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;max-width:600px;overflow:hidden;box-shadow:0 2px 12px rgba(15,23,42,0.06)">
<tr><td style="padding:32px 44px 0;text-align:center;font-size:56px;line-height:1">🎉🎊✨</td></tr>
<tr><td style="padding:16px 44px 8px">${logo}</td></tr>
<tr><td style="padding:0 44px">
<div style="background:linear-gradient(135deg, ${brand} 0%, ${brand}dd 100%);border-radius:12px;padding:32px 28px;text-align:center;color:#ffffff">
<div style="font-size:42px;line-height:1;margin-bottom:12px">🎉</div>
<div style="font-size:22px;font-weight:700;margin-bottom:6px">${escapeHtml(headline)}</div>
<div style="font-size:14px;opacity:0.92">Wir freuen uns, dass Sie dabei sind.</div>
</div>
</td></tr>
<tr><td style="padding:32px 44px 8px">
${renderedBody.html}
${renderedBody.hasCta ? "" : `<table cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 24px"><tr><td style="background:${brand};border-radius:10px">
<a href="${escapeAttr(registrationLink)}" style="display:inline-block;padding:15px 36px;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.4px;text-transform:uppercase">${escapeHtml(buttonLabel)}</a>
</td></tr></table>`}
<p style="font-size:12px;color:#94a3b8;margin:0 0 6px;text-align:center">Sollte der Button nicht funktionieren, kopieren Sie bitte den folgenden Link in Ihren Browser:</p>
<p style="font-size:12px;margin:0 0 28px;text-align:center;word-break:break-all"><a href="${escapeAttr(registrationLink)}" style="color:${brand}">${escapeHtml(registrationLink)}</a></p>
<hr style="border:none;border-top:1px solid #e2e8f0;margin:8px 0 24px"/>
<p style="font-size:13px;line-height:1.5;color:#64748b;margin:0">Geschäftsführung</p>
<p style="font-size:13px;line-height:1.5;color:#64748b;margin:0 0 32px">${escapeHtml(tenant.name)}</p>
</td></tr>
<tr><td style="padding:0 44px 32px">
<p style="font-size:11px;color:#94a3b8;margin:0;text-align:center">Diese E-Mail wurde an ${escapeHtml(to)} gesendet.</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;

    const transporter = nodemailer.createTransport({
      host: tenant.smtp_host,
      port: tenant.smtp_port,
      secure: tenant.smtp_port === 465,
      auth: { user: tenant.smtp_username, pass: tenant.smtp_password },
    });

    const smtpMeta = {
      smtp_host: tenant.smtp_host,
      smtp_port: tenant.smtp_port,
      smtp_secure: tenant.smtp_port === 465,
      smtp_username: tenant.smtp_username,
      from_email: senderEmail,
      from_name: senderName,
      reply_to: tenant.reply_to_email ?? senderEmail,
      subject,
      tenant_id: tenant.id,
      tenant_name: tenant.name,
      template_name: templateNameOverride || "invitation",
    };

    const verifyRes = await verifyOrPause(supabaseAdmin, tenant, transporter);
    if (!verifyRes.ok) {
      await logSend(supabaseAdmin, tenant.id, to, subject, html, senderEmail, "failed", verifyRes.reason, smtpMeta);
      return json({ error: `SMTP-Verbindung fehlgeschlagen: ${verifyRes.reason}`, paused: verifyRes.paused }, 502);
    }

    try {
      const info = await transporter.sendMail({
        from: `"${senderName}" <${senderEmail}>`,
        to,
        replyTo: tenant.reply_to_email ?? senderEmail,
        subject,
        html,
      });
      await logSend(supabaseAdmin, tenant.id, to, subject, html, senderEmail, "sent", undefined, { ...smtpMeta, message_id: info?.messageId ?? null });
      return json({ success: true }, 200);
    } catch (sendErr: any) {
      const reason = String(sendErr?.message ?? sendErr);
      await logSend(supabaseAdmin, tenant.id, to, subject, html, senderEmail, "failed", reason, smtpMeta);
      return json({ error: `E-Mail konnte nicht gesendet werden: ${reason}` }, 502);
    }
  } catch (err: any) {
    console.error(err);
    return json({ error: err?.message ?? "Unknown error" }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function escapeAttr(s: string) {
  return escapeHtml(s).replace(/`/g, "&#96;");
}

function isLegacyWelcomeTemplate(s: string) {
  const value = String(s || "");
  return LEGACY_WELCOME_MARKERS.some((marker) => value.includes(marker));
}

function renderTemplateBody(template: string, phMap: Record<string, string>, brand: string, registrationLink: string, defaultButtonLabel: string) {
  const applyPh = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_m, k) => phMap[k] ?? "");
  const source = applyPh(template).replace(/\r\n/g, "\n").trim();
  const lines = source.split("\n");
  const parts: string[] = [];
  let para: string[] = [];
  let listItems: string[] = [];
  let hasCta = false;

  const flushPara = () => {
    if (!para.length) return;
    parts.push(`<p style="font-size:15px;line-height:1.65;color:#334155;margin:0 0 18px">${para.map(escapeHtml).join("<br/>")}</p>`);
    para = [];
  };
  const flushList = () => {
    if (!listItems.length) return;
    parts.push(`<table cellpadding="0" cellspacing="0" width="100%" style="margin:4px 0 24px">${listItems.map((item, index) => `<tr><td width="44" valign="top" style="padding:6px 0"><div style="width:28px;height:28px;border-radius:50%;background:${brand};color:#fff;text-align:center;line-height:28px;font-weight:700;font-size:13px">${index + 1}</div></td><td style="padding:8px 0;font-size:15px;color:#0f172a">${escapeHtml(item)}</td></tr>`).join("")}</table>`);
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushPara();
      flushList();
      continue;
    }
    const cta = line.match(/^\{\{cta:([^|]+)\|([^}]+)\}\}$/);
    if (cta) {
      flushPara();
      flushList();
      const label = cta[1].trim() || defaultButtonLabel;
      const href = cta[2].trim() || registrationLink;
      hasCta = true;
      parts.push(`<table cellpadding="0" cellspacing="0" align="center" style="margin:4px auto 24px"><tr><td style="background:${brand};border-radius:10px"><a href="${escapeAttr(href)}" style="display:inline-block;padding:15px 36px;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.4px;text-transform:uppercase">${escapeHtml(label)}</a></td></tr></table>`);
      continue;
    }
    const list = line.match(/^\d+[.)]\s+(.+)$/);
    if (list) {
      flushPara();
      listItems.push(list[1]);
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();

  return { html: parts.join("\n"), hasCta };
}

async function logSend(admin: any, tenantId: string, to: string, subject: string, html: string, senderEmail: string, status: string, error?: string, metadata?: Record<string, unknown>) {
  try {
    await admin.from("email_send_log").insert({
      tenant_id: tenantId,
      template_name: (metadata as any)?.template_name || "invitation",
      recipient_email: to,
      status,
      error_message: error ?? null,
      rendered_subject: subject,
      rendered_html: html,
      sender_email: senderEmail,
      metadata: metadata ?? null,
    });
  } catch { /* non-critical */ }
}

async function verifyOrPause(admin: any, tenant: any, transporter: any): Promise<{ ok: boolean; reason?: string; paused?: boolean }> {
  try {
    await Promise.race([
      transporter.verify(),
      new Promise((_r, rej) => setTimeout(() => rej(new Error("verify timeout 8s")), 8000)),
    ]);
    const { error: healthOkErr } = await admin.from("tenant_smtp_health").upsert({
      tenant_id: tenant.id, consecutive_fails: 0,
      last_verify_at: new Date().toISOString(), last_verify_ok: true, updated_at: new Date().toISOString(),
    });
    if (healthOkErr) console.warn("[send-invitation-email] smtp health write skipped:", healthOkErr.message ?? healthOkErr);
    return { ok: true };
  } catch (e: any) {
    const reason = String(e?.message ?? e);
    let fails = 1;
    try {
      const { data: h, error: readErr } = await admin.from("tenant_smtp_health").select("consecutive_fails").eq("tenant_id", tenant.id).maybeSingle();
      if (readErr) console.warn("[send-invitation-email] smtp health read skipped:", readErr.message ?? readErr);
      fails = (h?.consecutive_fails ?? 0) + 1;
      const { error: writeErr } = await admin.from("tenant_smtp_health").upsert({
        tenant_id: tenant.id, consecutive_fails: fails,
        last_fail_at: new Date().toISOString(), last_fail_error: reason,
        last_verify_at: new Date().toISOString(), last_verify_ok: false, updated_at: new Date().toISOString(),
      });
      if (writeErr) console.warn("[send-invitation-email] smtp health fail write skipped:", writeErr.message ?? writeErr);
    } catch (healthErr: any) {
      console.warn("[send-invitation-email] smtp health skipped:", healthErr?.message ?? healthErr);
    }
    let paused = false;
    if (fails >= 3 && !tenant.emails_paused) {
      await admin.from("tenants").update({
        emails_paused: true,
        emails_paused_at: new Date().toISOString(),
        emails_paused_reason: `SMTP-Verify ${fails}x fehlgeschlagen: ${reason}`,
        emails_paused_by: "auto:smtp_verify",
      }).eq("id", tenant.id);
      await admin.from("activity_log").insert({
        action: "emails_auto_pausiert", entity_type: "tenant", entity_id: tenant.id,
        comment: `SMTP-Versand auto-pausiert nach ${fails} Verify-Fails: ${reason}`,
      }).then(() => {}, () => {});
      paused = true;
    }
    return { ok: false, reason, paused };
  }
}
