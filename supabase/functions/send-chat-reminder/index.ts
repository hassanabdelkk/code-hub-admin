// Deno Edge Function: send-chat-reminder
//
// Wird vom Admin-Chat manuell per Button getriggert ("📨 Erinnerung senden").
// Schickt dem Mitarbeiter eine kurze E-Mail "Du hast eine neue Nachricht von
// {Teamleiter}" mit Login-Link. Nutzt Tenant-SMTP analog zu send-invitation-email.
//
// Payload: { userId: string, leaderName?: string }
//
// Deploy:
//   supabase functions deploy send-chat-reminder --no-verify-jwt

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import nodemailer from "https://esm.sh/nodemailer@6.9.14";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Payload {
  userId: string;
  leaderName?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { userId, leaderName } = (await req.json()) as Payload;
    if (!userId) return json({ error: "userId required" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // Profil + Tenant
    const { data: profile } = await admin
      .from("profiles")
      .select("user_id, full_name, tenant_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!profile?.tenant_id) return json({ error: "Profil/Tenant nicht gefunden" }, 404);

    // Email aus auth.users
    const { data: authUser, error: authErr } = await admin.auth.admin.getUserById(userId);
    if (authErr || !authUser?.user?.email) return json({ error: "E-Mail nicht gefunden" }, 404);
    const to = authUser.user.email;

    // 🚫 Suppression-Check: Adresse durch Bounces gesperrt?
    const { data: suppressed } = await admin
      .from("suppressed_emails")
      .select("email, reason")
      .ilike("email", to)
      .maybeSingle();
    if (suppressed) {
      return json({
        error: `Diese Adresse ist gesperrt (Bounce: ${suppressed.reason}). Bitte direkt anrufen.`,
        suppressed: true,
      }, 409);
    }

    // ⏱️ Rate-Limit: max. 1 Reminder / 24h pro Empfänger
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recent } = await admin
      .from("email_send_log")
      .select("created_at")
      .eq("template_name", "chat_reminder")
      .eq("status", "sent")
      .ilike("recipient_email", to)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recent) {
      const hoursAgo = Math.round((Date.now() - new Date(recent.created_at).getTime()) / 3600000);
      return json({
        error: `Bereits vor ${hoursAgo}h ein Reminder gesendet. Bitte warte 24h zwischen Erinnerungen.`,
        skipped: true,
        lastSentAt: recent.created_at,
      }, 409);
    }

    // Ungelesene Nachrichten zählen (vom Admin/Teamleiter an diesen Mitarbeiter)
    const { count } = await admin
      .from("chat_messages")
      .select("id", { count: "exact", head: true })
      .eq("receiver_id", userId)
      .eq("read", false);
    if (!count || count === 0) {
      return json({ error: "Keine ungelesenen Nachrichten – Erinnerung nicht nötig.", skipped: true }, 409);
    }


    const { data: tenant } = await admin
      .from("tenants")
      .select("id, name, domain, logo_url, primary_color, sender_email, sender_name, reply_to_email, smtp_host, smtp_port, smtp_username, smtp_password, is_active, emails_paused, emails_paused_reason, email_signature, team_leader_name, reminder_chat_subject, reminder_chat_body")
      .eq("id", profile.tenant_id)
      .maybeSingle();
    if (!tenant) return json({ error: "Tenant nicht gefunden" }, 404);
    if (tenant.is_active === false) return json({ error: "Tenant deaktiviert", inactive: true }, 503);
    if (!tenant.smtp_host || !tenant.smtp_port || !tenant.smtp_username || !tenant.smtp_password) {
      return json({ error: "Tenant hat keine vollständige SMTP-Konfiguration" }, 400);
    }
    if (tenant.emails_paused) {
      return json({ error: `E-Mail-Versand pausiert${tenant.emails_paused_reason ? `: ${tenant.emails_paused_reason}` : ""}`, paused: true }, 503);
    }

    const senderName = tenant.sender_name ?? tenant.name;
    const senderEmail = tenant.sender_email ?? tenant.smtp_username;
    const brand = tenant.primary_color ?? "#0f172a";
    const firstName = (profile.full_name ?? "").split(" ")[0] || "Hallo";
    const leader = leaderName?.trim() || tenant.team_leader_name || "deinem Teamleiter";
    const loginUrl = `https://${tenant.domain}/login`;

    // Template aus Tenant (oder Default), Platzhalter ersetzen
    const DEFAULT_SUBJECT = "Neue Nachricht von {{team_leader_name}} – {{tenant_name}}";
    const DEFAULT_BODY = `Hi {{first_name}},\n\ndu hast {{unread_count}} ungelesene Nachricht(en) von {{team_leader_name}} im Mitarbeiter-Portal.\n\nBitte logge dich kurz ein und antworte – so geht's für dich am schnellsten weiter.\n\n{{cta:Jetzt einloggen|{{login_link}}}}\n\nFalls der Button nicht funktioniert: {{login_link}}`;
    const tplSubject = (tenant.reminder_chat_subject || DEFAULT_SUBJECT);
    const tplBody = (tenant.reminder_chat_body || DEFAULT_BODY);

    const vars: Record<string, string> = {
      first_name: firstName,
      team_leader_name: leader,
      tenant_name: tenant.name,
      company_name: tenant.name,
      login_link: loginUrl,
      portal_link: loginUrl,
      email: to,
      unread_count: String(count),
    };
    const replaceVars = (s: string) =>
      s.replace(/\{\{(\w+)\}\}/g, (_m, k) => (vars[k] !== undefined ? vars[k] : `{{${k}}}`));
    const subject = replaceVars(tplSubject);

    // Body: erst Vars ersetzen, dann CTA-Syntax, dann Newlines + Links
    let bodyResolved = replaceVars(tplBody);
    bodyResolved = bodyResolved.replace(/\{\{cta:([^|}]+)\|([^}]+)\}\}/g, (_m, label, href) => {
      const url = replaceVars(String(href).trim());
      return `<table cellpadding="0" cellspacing="0" style="margin:16px 0"><tr><td style="background:${brand};border-radius:8px"><a href="${url}" style="display:inline-block;padding:14px 28px;color:#fff;text-decoration:none;font-weight:600;font-size:15px">${escapeHtml(String(label).trim())}</a></td></tr></table>`;
    });
    const bodyHtml = bodyResolved
      .split(/\n/).map((line) => /<table|<a |<div|<p|<h[1-6]/.test(line) ? line : escapeHtml(line)).join("<br>");

    const logo = tenant.logo_url
      ? `<img src="${tenant.logo_url}" alt="${escapeHtml(tenant.name)}" style="max-height:40px;margin-bottom:24px"/>`
      : `<div style="font-weight:700;font-size:20px;margin-bottom:24px;color:${brand}">${escapeHtml(tenant.name)}</div>`;
    const sig = tenant.email_signature
      ? `<hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0"/><div style="font-size:12px;color:#94a3b8;line-height:1.5">${escapeHtml(tenant.email_signature).replace(/\n/g, "<br>")}</div>`
      : `<hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0"/><p style="font-size:12px;color:#94a3b8;margin:0">Diese E-Mail wurde an ${escapeHtml(to)} gesendet.</p>`;

    const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:40px;max-width:560px">
<tr><td>
${logo}
<div style="font-size:15px;line-height:1.6;color:#475569">${bodyHtml}</div>
${sig}
</td></tr></table>
</td></tr></table>
</body></html>`;

    const transporter = nodemailer.createTransport({
      host: tenant.smtp_host,
      port: tenant.smtp_port,
      secure: tenant.smtp_port === 465,
      auth: { user: tenant.smtp_username, pass: tenant.smtp_password },
    });

    try {
      const info = await transporter.sendMail({
        from: `"${senderName}" <${senderEmail}>`,
        to,
        replyTo: tenant.reply_to_email ?? senderEmail,
        subject,
        html,
      });
      await admin.from("email_send_log").insert({
        tenant_id: tenant.id,
        template_name: "chat_reminder",
        recipient_email: to,
        status: "sent",
        rendered_subject: subject,
        rendered_html: html,
        sender_email: senderEmail,
        metadata: { message_id: info?.messageId ?? null, unread_count: count, user_id: userId, tenant_id: tenant.id },
      });
      return json({ success: true, unread: count }, 200);
    } catch (sendErr: any) {
      const reason = String(sendErr?.message ?? sendErr);
      await admin.from("email_send_log").insert({
        tenant_id: tenant.id,
        template_name: "chat_reminder",
        recipient_email: to,
        status: "failed",
        error_message: reason,
        rendered_subject: subject,
        rendered_html: html,
        sender_email: senderEmail,
      });
      return json({ error: `Versand fehlgeschlagen: ${reason}` }, 502);
    }
  } catch (err: any) {
    console.error(err);
    return json({ error: err?.message ?? "Unknown error" }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
