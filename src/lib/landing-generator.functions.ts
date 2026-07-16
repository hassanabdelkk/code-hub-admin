import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import JSZip from "jszip";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getTheme } from "./landing-themes";
import { THEME_ASSETS } from "./theme-assets.generated";

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Ungültige Hex-Farbe");

// Akzeptiert "example.com", "www.example.com" oder volle URLs.
// Wird vor der URL-Validierung normalisiert (https:// prepended, trailing slash entfernt).
const normalizeUrl = (v: unknown) => {
  if (typeof v !== "string") return v;
  const trimmed = v.trim();
  if (!trimmed) return trimmed;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withScheme.replace(/\/+$/, "");
};
const UrlLike = z.preprocess(normalizeUrl, z.string().url().max(500));
const OptionalUrlLike = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? "" : normalizeUrl(v)),
  z.union([z.string().url().max(500), z.literal("")]),
);

const BrandingSchema = z.object({
  firmenname: z.string().min(1).max(120),
  primary_color: HexColor,
  secondary_color: HexColor,
  whatsapp_number: z.string().max(40).default(""),
  whatsapp_enabled: z.coerce.boolean().default(false),
  email: z.string().email().max(255),
  telefon: z.string().max(40).default(""),
  telefon_2: z.string().max(40).default(""),
  strasse: z.string().max(200).default(""),
  plz: z.string().max(20).default(""),
  stadt: z.string().max(120).default(""),
  hrb: z.string().max(60).default(""),
  registergericht: z.string().max(120).default(""),
  ust_id: z.string().max(40).default(""),
  steuernummer: z.string().max(40).default(""),
  geschaeftsfuehrer: z.string().max(120).default(""),
  impressum: z.string().max(5000).default(""),
  landing_domain: z.string().min(1, "Landing-Domain ist Pflicht (für SEO/Canonical)").max(255),
  api_endpoint: UrlLike,
  portal_url: OptionalUrlLike.default(""),
  supabase_url: OptionalUrlLike.default(""),
  supabase_anon_key: z.string().max(2000).optional().or(z.literal("")).default(""),
  tenant_id: z.string().max(120).optional().or(z.literal("")).default(""),

  flow_type: z.enum(["classic", "fast"]).default("classic"),
  // Funnel-Tracking: kurzer Slug pro Landing (z.B. "kw24-fast-de").
  // Wird mit jeder Bewerbung gespeichert → Konversion pro Landing messbar.
  source_slug: z.string().max(120).default(""),
  // SEO / Browser-Tab
  seo_title: z.string().max(160).default(""),
  seo_description: z.string().max(320).default(""),
  seo_image: z.string().max(500).default(""),
});

const InputSchema = z.object({
  themeId: z.string().min(1).max(40),
  branding: BrandingSchema,
  // Logo als data-URL: "data:image/png;base64,...."
  logoDataUrl: z.string().max(15_000_000).optional().nullable(),
  faviconDataUrl: z.string().max(1_000_000).optional().nullable(),
  // Theme-Slot-Werte (Texte/Bilder/Farben aus dem UI-Theme-Editor).
  slots: z.record(z.string().min(1).max(60), z.string().max(20_000)).optional().default({}),
});

function cleanLandingDomain(d: string): string {
  return String(d ?? "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

function applyPlaceholders(
  src: string,
  branding: z.infer<typeof BrandingSchema>,
  slotValues: Record<string, string> = {},
): string {
  // Computed Aliase: address/contact_email/contact_phone aus Firmendaten ableiten,
  // damit Slot-Defaults (Impressum/Datenschutz) automatisch korrekt befüllt werden.
  const b: Record<string, unknown> = { ...branding };
  const addrParts = [b.strasse as string, [b.plz as string, b.stadt as string].filter(Boolean).join(" ")]
    .filter(Boolean).join(", ");
  const aliases: Record<string, string> = {
    address: addrParts,
    contact_address: addrParts,
    contact_email: (b.email as string) || "",
    contact_phone: (b.telefon as string) || "",
    sitz_stadt: (b.stadt as string) || "",
  };
  const merged: Record<string, unknown> = { ...aliases, ...b, ...slotValues };
  let out = src;
  // Mehrere Passes: Slot-Werte können selbst {{branding}}-Tokens enthalten.
  for (let i = 0; i < 3; i++) {
    let changed = false;
    for (const [key, value] of Object.entries(merged)) {
      const token = `{{${key}}}`;
      if (out.includes(token)) {
        out = out.split(token).join(String(value ?? ""));
        changed = true;
      }
    }
    if (!changed) break;
  }
  return out;
}

// Entfernt leere/kaputte Meta-Tags (og:image ohne Wert, Canonical/og:url ohne Domain).
function cleanEmptyMetaTags(html: string, b: z.infer<typeof BrandingSchema>): string {
  let out = html;
  if (!b.seo_image) {
    out = out.replace(/\s*<meta[^>]*property=["']og:image["'][^>]*content=["']["'][^>]*>\s*/gi, "\n");
    out = out.replace(/\s*<meta[^>]*name=["']twitter:image["'][^>]*content=["']["'][^>]*>\s*/gi, "\n");
  }
  if (!b.landing_domain) {
    out = out.replace(/\s*<link[^>]*rel=["']canonical["'][^>]*href=["']https?:\/\/\/[^"']*["'][^>]*>\s*/gi, "\n");
    out = out.replace(/\s*<meta[^>]*property=["']og:url["'][^>]*content=["']https?:\/\/\/[^"']*["'][^>]*>\s*/gi, "\n");
  }
  return out;
}

// Injiziert window.PORTAL_API/TENANT_ID/PORTAL_URL/FLOW_TYPE in jedes generierte
// HTML — unabhängig davon, ob das Theme-Template einen <script>-Block dafür hat.
// Garantiert, dass Bewerbungen die richtige tenant_id mitsenden → Reminder/Accept-
// Mail nutzen automatisch den korrekten Tenant-SMTP.
function injectLandingConfig(html: string, b: z.infer<typeof BrandingSchema>): string {
  const escape = (s: string) => String(s ?? "").replace(/[<>"']/g, (c) => ({ "<": "\\u003c", ">": "\\u003e", '"': '\\"', "'": "\\'" }[c]!));
  const block = `<script>
window.PORTAL_API = "${escape(b.api_endpoint)}";
window.PORTAL_URL = "${escape(b.portal_url ?? "")}";
window.TENANT_ID = "${escape(b.tenant_id ?? "")}";
window.FLOW_TYPE = "${escape(b.flow_type)}";
window.SOURCE_SLUG = "${escape(b.source_slug ?? "")}";
window.WHATSAPP_NUMBER = "${escape(b.whatsapp_enabled ? (b.whatsapp_number ?? "").replace(/[^0-9]/g, "") : "")}";
</script>`;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, block + "</head>");
  return block + html;
}

function parseDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const mime = match[1];
  const base64 = match[2];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { mime, bytes };
}

function escapeHtml(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function renderImpressum(b: z.infer<typeof BrandingSchema>): string {
  const addr = [b.strasse, [b.plz, b.stadt].filter(Boolean).join(" ")].filter(Boolean).map(escapeHtml).join("<br/>");
  const rows: string[] = [];
  rows.push(`<p><strong>${escapeHtml(b.firmenname)}</strong><br/>${addr}</p>`);
  if (b.geschaeftsfuehrer) rows.push(`<p><strong>Vertreten durch:</strong><br/>${escapeHtml(b.geschaeftsfuehrer)}</p>`);
  const contact: string[] = [];
  if (b.telefon) contact.push(`Telefon: <a href="tel:${escapeHtml(b.telefon)}">${escapeHtml(b.telefon)}</a>`);
  if (b.email) contact.push(`E-Mail: <a href="mailto:${escapeHtml(b.email)}">${escapeHtml(b.email)}</a>`);
  if (contact.length) rows.push(`<h3>Kontakt</h3><p>${contact.join("<br/>")}</p>`);
  const reg: string[] = [];
  if (b.registergericht) reg.push(`Registergericht: ${escapeHtml(b.registergericht)}`);
  if (b.hrb) reg.push(`Registernummer: ${escapeHtml(b.hrb)}`);
  if (reg.length) rows.push(`<h3>Registereintrag</h3><p>${reg.join("<br/>")}</p>`);
  const tax: string[] = [];
  if (b.ust_id) tax.push(`USt-IdNr.: ${escapeHtml(b.ust_id)}`);
  if (b.steuernummer) tax.push(`Steuernummer: ${escapeHtml(b.steuernummer)}`);
  if (tax.length) rows.push(`<h3>Umsatzsteuer</h3><p>${tax.join("<br/>")}</p>`);
  if (b.impressum) rows.push(`<div>${b.impressum}</div>`);
  rows.push(`<p style="margin-top:24px;font-size:13px;opacity:.7;">Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV: ${escapeHtml(b.geschaeftsfuehrer || b.firmenname)}, ${addr.replace(/<br\/>/g, ", ")}</p>`);
  return rows.join("\n");
}

function renderDatenschutz(b: z.infer<typeof BrandingSchema>): string {
  const name = escapeHtml(b.firmenname);
  const email = escapeHtml(b.email);
  return `
    <h3>1. Verantwortlicher</h3>
    <p>Verantwortlich für die Datenverarbeitung auf dieser Website ist:<br/>
    ${name}<br/>${escapeHtml(b.strasse)}<br/>${escapeHtml([b.plz, b.stadt].filter(Boolean).join(" "))}<br/>
    E-Mail: <a href="mailto:${email}">${email}</a></p>

    <h3>2. Erhebung und Verarbeitung personenbezogener Daten</h3>
    <p>Wir verarbeiten personenbezogene Daten, die Sie uns über das Bewerbungsformular zur Verfügung stellen (z.&nbsp;B. Name, Anschrift, Geburtsdatum, Kontaktdaten), zur Durchführung des Bewerbungsverfahrens gemäß Art.&nbsp;6 Abs.&nbsp;1 lit.&nbsp;b DSGVO sowie § 26 BDSG.</p>

    <h3>3. Speicherdauer</h3>
    <p>Ihre Bewerbungsdaten werden bis zu 6 Monate nach Abschluss des Verfahrens gespeichert und anschließend gelöscht, sofern keine längere Aufbewahrungspflicht besteht oder Sie in eine längere Speicherung eingewilligt haben.</p>

    <h3>4. Empfänger</h3>
    <p>Eine Weitergabe an Dritte erfolgt nur, wenn dies zur Durchführung des Bewerbungsverfahrens erforderlich ist (z.&nbsp;B. an Partnerunternehmen im Rahmen einer Vermittlung) oder Sie eingewilligt haben.</p>

    <h3>5. Ihre Rechte</h3>
    <p>Sie haben das Recht auf Auskunft (Art.&nbsp;15 DSGVO), Berichtigung (Art.&nbsp;16 DSGVO), Löschung (Art.&nbsp;17 DSGVO), Einschränkung der Verarbeitung (Art.&nbsp;18 DSGVO), Datenübertragbarkeit (Art.&nbsp;20 DSGVO) sowie das Recht auf Widerspruch (Art.&nbsp;21 DSGVO). Anfragen richten Sie bitte an <a href="mailto:${email}">${email}</a>.</p>

    <h3>6. Beschwerderecht</h3>
    <p>Sie haben das Recht, sich bei einer Datenschutzaufsichtsbehörde über die Verarbeitung Ihrer personenbezogenen Daten zu beschweren.</p>

    <h3>7. SSL-Verschlüsselung</h3>
    <p>Diese Website nutzt aus Sicherheitsgründen eine SSL-/TLS-Verschlüsselung zur Übertragung vertraulicher Inhalte.</p>
  `;
}

function buildLegalPage(title: string, body: string, b: z.infer<typeof BrandingSchema>): string {
  const t = escapeHtml(title);
  const firm = escapeHtml(b.firmenname);
  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${t} – ${firm}</title>
<meta name="robots" content="noindex,follow" />
<link rel="stylesheet" href="style.css" />
<style>
  .legal-page { max-width: 820px; margin: 0 auto; padding: 64px 24px 96px; font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color:#1a1a1a; line-height:1.7; }
  .legal-page h1 { font-size: 36px; margin: 0 0 8px; }
  .legal-page h3 { font-size: 18px; margin: 28px 0 8px; }
  .legal-page p { margin: 0 0 12px; }
  .legal-page a { color: #2563eb; }
  .legal-back { display:inline-block; margin-bottom: 24px; color:#64748b; text-decoration:none; font-size:14px; }
  .legal-back:hover { color:#1a1a1a; }
  .legal-footer { max-width:820px; margin: 0 auto; padding: 24px; border-top:1px solid #e5e7eb; font-size:13px; color:#64748b; text-align:center; }
</style>
</head>
<body>
<main class="legal-page">
  <a href="index.html" class="legal-back">← Zurück zur Startseite</a>
  <h1>${t}</h1>
  ${body}
</main>
<footer class="legal-footer">
  © ${new Date().getFullYear()} ${firm} ·
  <a href="impressum.html">Impressum</a> ·
  <a href="datenschutz.html">Datenschutz</a>
</footer>
</body>
</html>`;
}

export const generateLandingZip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    // Admin-Check
    const { data: roleRow, error: roleErr } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (roleErr) throw new Error(roleErr.message);
    if (!roleRow) throw new Error("Nicht autorisiert");

    const theme = getTheme(data.themeId);
    if (!theme) throw new Error(`Theme nicht gefunden: ${data.themeId}`);

    const slots = { ...(data.slots ?? {}) };
    // Domain user-freundlich säubern (https://, trailing slash entfernen)
    const cleanedBranding = { ...data.branding, landing_domain: cleanLandingDomain(data.branding.landing_domain) };

    // Impressum/Datenschutz immer als echte Unterseiten — Slots überschreiben.
    slots.impressum_url = "impressum.html";
    slots.datenschutz_url = "datenschutz.html";

    // Hochgeladenes Logo/Favicon automatisch in {{logo_image}}/{{favicon_image}}
    // spiegeln, damit Themes wie Eilers/TTS/AZB den Branding-Upload anzeigen.
    if (data.logoDataUrl && !slots.logo_image) slots.logo_image = "assets/logo.png";
    if (data.faviconDataUrl && !slots.favicon_image) slots.favicon_image = "assets/favicon.png";

    const portalBase = (cleanedBranding.portal_url || "").replace(/\/+$/, "");
    const ctaRaw = (slots.cta_url ?? "").trim();
    const isAbsolute = /^https?:\/\//i.test(ctaRaw);
    if (!isAbsolute) {
      const path = ctaRaw.startsWith("/") ? ctaRaw : "/bewerbung";
      slots.cta_url = portalBase ? `${portalBase}${path}` : "#bewerbung-form";
    }

    let html = applyPlaceholders(theme.html, cleanedBranding, slots);

    if (portalBase) {
      html = html.replace(/href=(["'])\/bewerbung(\/[^"']*)?(\?[^"']*)?(#[^"']*)?\1/gi,
        (_m, q, p = "", qs = "", h = "") => `href=${q}${portalBase}/bewerbung${p}${qs}${h}${q}`);
    }

    // Inline-Sektionen für Impressum/Datenschutz aus index.html entfernen —
    // diese leben jetzt als eigene Unterseiten.
    html = html.replace(/<section[^>]*id=["'](?:impressum|datenschutz)["'][\s\S]*?<\/section>\s*/gi, "");

    html = cleanEmptyMetaTags(html, cleanedBranding);
    html = injectLandingConfig(html, cleanedBranding);
    const css = applyPlaceholders(theme.css, cleanedBranding, slots);
    const js = applyPlaceholders(theme.js, cleanedBranding, slots);

    const impressumHtml = buildLegalPage("Impressum", renderImpressum(cleanedBranding), cleanedBranding);
    const datenschutzHtml = buildLegalPage("Datenschutz", renderDatenschutz(cleanedBranding), cleanedBranding);

    const zip = new JSZip();
    zip.file("index.html", html);
    zip.file("impressum.html", impressumHtml);
    zip.file("datenschutz.html", datenschutzHtml);
    zip.file("style.css", css);
    zip.file("script.js", js);
    zip.file(
      "README.txt",
      `Landing Page: ${data.branding.firmenname}\nTheme: ${theme.name}\nGeneriert: ${new Date().toISOString()}\n\n` +
        `Upload-Anleitung:\n` +
        `1. Diesen Ordner per FTP (FileZilla) ins Web-Root deines VPS kopieren\n` +
        `   (z.B. /var/www/${data.branding.landing_domain || "kunde"}/)\n` +
        `2. nginx/Apache konfigurieren, sodass index.html ausgeliefert wird\n` +
        `3. SSL-Zertifikat (Let's Encrypt) für die Domain einrichten\n\n` +
        `Bewerbungen werden an: ${data.branding.api_endpoint} gesendet.\n`,
    );

    // Theme-eigene statische Assets (Hero-Bilder, Testimonials, Partner-Logos)
    // aus src/landing-themes/<id>/assets/ in die ZIP packen.
    const themeAssets = THEME_ASSETS[data.themeId] ?? {};
    for (const [name, b64] of Object.entries(themeAssets)) {
      // Base64 → Uint8Array (Worker-kompatibel)
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      zip.folder("assets")!.file(name, bytes);
    }

    if (data.logoDataUrl) {
      const parsed = parseDataUrl(data.logoDataUrl);
      if (parsed) {
        const ext = parsed.mime.includes("svg")
          ? "svg"
          : parsed.mime.includes("jpeg") || parsed.mime.includes("jpg")
            ? "jpg"
            : parsed.mime.includes("webp")
              ? "webp"
              : "png";
        // Theme erwartet assets/logo.png — wir nehmen die richtige Endung und
        // patchen das HTML, falls anders.
        const filename = `logo.${ext}`;
        zip.folder("assets")!.file(filename, parsed.bytes);
        if (ext !== "png") {
          const finalHtml = html.split("assets/logo.png").join(`assets/${filename}`);
          zip.file("index.html", finalHtml);
        }
      }
    } else {
      // Platzhalter, damit der <img>-Tag nicht ins Leere zeigt
      zip.folder("assets")!.file(
        "logo.png",
        new Uint8Array([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
          0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
          0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
          0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
          0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
          0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
        ]),
      );
    }

    // Favicon (optional) — bei Fehlen 1×1-PNG-Platzhalter, damit assets/favicon.png nicht 404 wirft
    if (data.faviconDataUrl) {
      const fav = parseDataUrl(data.faviconDataUrl);
      if (fav) {
        const ext = fav.mime.includes("svg")
          ? "svg"
          : fav.mime.includes("png")
            ? "png"
            : fav.mime.includes("ico") || fav.mime.includes("icon")
              ? "ico"
              : "png";
        zip.folder("assets")!.file(`favicon.${ext}`, fav.bytes);
      }
    } else {
      zip.folder("assets")!.file(
        "favicon.png",
        new Uint8Array([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
          0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
          0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
          0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
          0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
          0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
        ]),
      );
    }

    const buffer = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    // Base64 für Transport über JSON
    let binary = "";
    for (let i = 0; i < buffer.length; i++) binary += String.fromCharCode(buffer[i]);
    const base64 = btoa(binary);

    const safeName = data.branding.firmenname.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const datum = new Date().toISOString().slice(0, 10);
    const filename = `landing-${safeName}-${theme.id}-${datum}.zip`;

    return { zipBase64: base64, filename };
  });