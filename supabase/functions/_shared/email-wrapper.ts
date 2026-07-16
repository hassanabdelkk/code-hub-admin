// Shared email wrapper – ein einheitliches, professionelles Layout für alle
// Bewerber-Mails (Buchungsbestätigung, Reminder, Zusagen, Einladungen).
//
// Features:
//  - Logo oben (tenant.logo_url) mit Textfallback
//  - Preheader (versteckter Vorschautext, den Gmail neben dem Betreff zeigt)
//  - Primärfarben-Buttons via {{cta:Label|URL}}
//  - Ansprechpartner-Karte unten (Name + Foto)
//  - Footer: Firmenname + "Antworten Sie einfach auf diese E-Mail"
//  - Optionaler Spam-Hinweis-Block (spam_hint: true)
//  - Automatisch generierte Plain-Text-Version (Spam-Score ↓)
//
// Benutzung aus einer Edge-Function:
//   import { renderEmail, htmlToText } from "../_shared/email-wrapper.ts";
//   const { html, text } = renderEmail({ subject, body, preheader, spamHint, tenant, recruiter, vars });

export type TenantBrand = {
  name: string;
  logo_url?: string | null;
  primary_color?: string | null;
  email_signature?: string | null;
  reply_to_email?: string | null;
  sender_email?: string | null;
};

export type RecruiterBrand = {
  name?: string | null;
  avatar_url?: string | null;
  role_label?: string | null; // z.B. "Personalabteilung"
};

export type RenderOptions = {
  subject: string;
  body: string;
  preheader?: string;
  spamHint?: boolean;
  tenant: TenantBrand;
  recruiter?: RecruiterBrand | null;
  vars?: Record<string, string>;
};

const DEFAULT_COLOR = "#0f172a";

export function renderTemplate(text: string, vars: Record<string, string> = {}): string {
  let out = text;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v ?? "");
  }
  return out;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Verwandelt HTML in nüchternen Plain-Text (für multipart/alternative)
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>(\s*)/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "  • ")
    // Buttons/CTA <a href="X">Label</a> → Label ( X )
    .replace(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ( $1 )")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function renderBodyWithCta(body: string, color: string): string {
  // CTA-Syntax: {{cta:Label|URL}}
  return body.replace(/\{\{cta:([^|}]+)\|([^}]+)\}\}/g, (_m, label, href) => {
    const safeLabel = String(label).trim();
    const safeHref = String(href).trim();
    return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;"><tr><td style="background:${color};border-radius:8px;"><a href="${safeHref}" style="display:inline-block;padding:14px 32px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">${escapeHtml(safeLabel)}</a></td></tr></table>`;
  });
}

export function renderEmail(opts: RenderOptions): { html: string; text: string; subject: string } {
  const { tenant, recruiter, vars = {}, spamHint = false } = opts;
  const color = tenant.primary_color || DEFAULT_COLOR;
  const year = new Date().getFullYear();
  const subject = renderTemplate(opts.subject, vars);
  const preheaderText = opts.preheader ? renderTemplate(opts.preheader, vars) : "";

  // Body: Templatevariablen ersetzen, CTA-Buttons rendern, \n → <br>
  const resolvedBody = renderBodyWithCta(renderTemplate(opts.body, vars), color).replace(/\n/g, "<br>");

  const logoBlock = tenant.logo_url
    ? `<div style="text-align:center;margin-bottom:28px;"><img src="${tenant.logo_url}" alt="${escapeHtml(tenant.name)}" style="max-height:56px;max-width:220px;height:auto;" /></div>`
    : `<div style="text-align:center;margin-bottom:28px;"><div style="font-size:22px;font-weight:700;color:${color};">${escapeHtml(tenant.name)}</div></div>`;

  const spamHintBlock = spamHint
    ? `<div style="margin:24px 0 8px;padding:14px 16px;background:#fef3c7;border-left:4px solid #f59e0b;border-radius:6px;color:#78350f;font-size:13px;line-height:1.55;">💡 <strong>Tipp:</strong> Sollten Sie diese E-Mail nicht im Posteingang finden, schauen Sie kurz in den Spam-Ordner und markieren Sie uns bitte als „Kein Spam" – so gelangen künftige Nachrichten sicher zu Ihnen.</div>`
    : "";

  const recruiterBlock = recruiter?.name
    ? `<div style="margin-top:32px;padding-top:24px;border-top:1px solid #e5e7eb;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">
          <tr>
            ${recruiter.avatar_url ? `<td style="width:56px;vertical-align:middle;padding-right:14px;"><img src="${recruiter.avatar_url}" alt="${escapeHtml(recruiter.name)}" style="width:56px;height:56px;border-radius:50%;object-fit:cover;" /></td>` : ""}
            <td style="vertical-align:middle;">
              <div style="font-weight:600;color:#111827;font-size:15px;">${escapeHtml(recruiter.name)}</div>
              <div style="color:#6b7280;font-size:13px;margin-top:2px;">${escapeHtml(recruiter.role_label || "Personalabteilung")} · ${escapeHtml(tenant.name)}</div>
            </td>
          </tr>
        </table>
      </div>`
    : "";

  const signatureBlock = tenant.email_signature
    ? `<div style="margin-top:20px;color:#9ca3af;font-size:12px;line-height:18px;">${renderTemplate(tenant.email_signature, vars).replace(/\n/g, "<br>")}</div>`
    : "";

  const replyHint = `<div style="text-align:center;color:#6b7280;font-size:12px;margin-top:14px;">Haben Sie Fragen? Antworten Sie einfach auf diese E-Mail.</div>`;

  const preheaderHidden = preheaderText
    ? `<div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0;">${escapeHtml(preheaderText)}</div>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
${preheaderHidden}
<div style="max-width:600px;margin:0 auto;padding:32px 16px;">
  <div style="background:#ffffff;border-radius:12px;padding:36px 28px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
    ${logoBlock}
    <h1 style="color:#111827;font-size:22px;font-weight:700;margin:0 0 20px;line-height:1.35;">${escapeHtml(subject)}</h1>
    <div style="color:#374151;font-size:15px;line-height:26px;">${resolvedBody}</div>
    ${spamHintBlock}
    ${recruiterBlock}
    ${signatureBlock}
  </div>
  ${replyHint}
  <div style="text-align:center;margin-top:12px;color:#9ca3af;font-size:11px;">© ${year} ${escapeHtml(tenant.name)}</div>
</div>
</body>
</html>`;

  const text = htmlToText(html);
  return { html, text, subject };
}
