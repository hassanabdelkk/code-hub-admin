/**
 * Landing-Renderer (RAM-schonende Runtime-Version)
 * Läuft ohne TypeScript-Transpiling und ohne npm-Abhängigkeiten.
 */

import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { basename, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
const PORTAL_API_ENDPOINT = process.env.PORTAL_API_ENDPOINT || "";
// Basis-URL zum Portal für Theme-Assets (…/applications → …/landing-server-files).
const PORTAL_FILES_BASE = (process.env.PORTAL_FILES_BASE || PORTAL_API_ENDPOINT.replace(/\/applications\/?$/, "/landing-server-files")).replace(/\/+$/, "");
const PORT = Number(process.env.PORT || 3001);
const CACHE_TTL_MS = 60_000;
const ASSET_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const assetCache = new Map();

const LANDING_SELECT = "id,slug,domain,tenant_id,theme_id,branding,slots,logo_url,favicon_url,flow_type,source_slug,is_published,calendly_url,intermediate_company_name,updated_at,linked_fasttrack_landing_id,linked_fasttrack:landing_pages!linked_fasttrack_landing_id(domain,branding,calendly_url,intermediate_company_name,logo_url)";
const __dirname = dirname(fileURLToPath(import.meta.url));
// Themes-Verzeichnis: zuerst ENV, dann Portal-Repo (automatisch), dann lokales themes/
function resolveThemesDir() {
  const candidates = [
    process.env.THEMES_DIR,
    "/opt/apps/portal/src/landing-themes",
    join(__dirname, "..", "portal", "src", "landing-themes"),
    join(__dirname, "themes"),
  ].filter(Boolean);
  for (const p of candidates) {
    if (existsSync(p)) {
      console.log(`[themes] using ${p}`);
      return p;
    }
  }
  return join(__dirname, "themes");
}
const themesDir = resolveThemesDir();
const cache = new Map();
const themeCache = new Map();
const THEME_CACHE_TTL_MS = 30_000;


function requestJson(url, headers) {
  return new Promise((resolve, reject) => {
    const request = url.protocol === "http:" ? httpRequest : httpsRequest;
    const req = request(url, { method: "GET", headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
        if (body.length > 2_000_000) req.destroy(new Error("response too large"));
      });
      res.on("end", () => {
        resolve({
          ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300,
          status: res.statusCode || 0,
          text: body,
          json: () => JSON.parse(body),
        });
      });
    });
    req.setTimeout(10_000, () => req.destroy(new Error("request timeout")));
    req.on("error", reject);
    req.end();
  });
}

function requestBuffer(url, headers) {
  return new Promise((resolve, reject) => {
    const request = url.protocol === "http:" ? httpRequest : httpsRequest;
    const req = request(url, { method: "GET", headers }, (res) => {
      const chunks = [];
      let total = 0;
      res.on("data", (chunk) => {
        chunks.push(chunk);
        total += chunk.length;
        if (total > 10_000_000) req.destroy(new Error("response too large"));
      });
      res.on("end", () => {
        resolve({
          ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300,
          status: res.statusCode || 0,
          buf: Buffer.concat(chunks),
          ct: String(res.headers["content-type"] || "application/octet-stream"),
        });
      });
    });
    req.setTimeout(15_000, () => req.destroy(new Error("request timeout")));
    req.on("error", reject);
    req.end();
  });
}

function guessMime(name) {
  const ext = String(name).toLowerCase().split(".").pop() || "";
  return ({
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
    gif: "image/gif", svg: "image/svg+xml", ico: "image/x-icon",
    woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
    css: "text/css", js: "application/javascript", json: "application/json",
    html: "text/html", txt: "text/plain",
  })[ext] || "application/octet-stream";
}

async function loadAsset(themeId, file) {
  const safeTheme = String(themeId || "").replace(/[^a-z0-9_-]/gi, "");
  const safeFile = String(file || "").replace(/[^A-Za-z0-9._-]/g, "");
  if (!safeTheme || !safeFile) return null;
  const key = `${safeTheme}/${safeFile}`;
  const cached = assetCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached;
  // 1) Lokales FS (via Heartbeat gesynct)
  try {
    const localPath = join(themesDir, safeTheme, "assets", safeFile);
    if (existsSync(localPath)) {
      const buf = readFileSync(localPath);
      const entry = { buf, ct: guessMime(safeFile), expiresAt: Date.now() + ASSET_CACHE_TTL_MS };
      assetCache.set(key, entry);
      return entry;
    }
  } catch (_) { /* fall through */ }
  // 2) Portal-Fallback
  if (!PORTAL_FILES_BASE) return null;
  try {
    const url = new URL(`${PORTAL_FILES_BASE}/themes/${safeTheme}/assets/${safeFile}`);
    const res = await requestBuffer(url, { accept: "*/*" });
    if (!res.ok) return null;
    const entry = { buf: res.buf, ct: res.ct, expiresAt: Date.now() + ASSET_CACHE_TTL_MS };
    assetCache.set(key, entry);
    return entry;
  } catch (e) {
    console.error(`[landing-server] asset fetch failed ${key}:`, e?.message || e);
    return null;
  }
}

async function loadTheme(id) {
  const safeId = basename(String(id || "")).replace(/[^a-z0-9_-]/gi, "");
  if (!safeId) return null;
  const cached = themeCache.get(safeId);
  if (cached && Date.now() - cached.ts < THEME_CACHE_TTL_MS) return cached.theme;
  const dir = join(themesDir, safeId);
  const files = { html: "template.html", css: "style.css", js: "script.js" };
  const out = { id: safeId, html: "", css: "", js: "" };
  for (const [k, fname] of Object.entries(files)) {
    let content = "";
    try {
      if (existsSync(join(dir, fname))) {
        content = readFileSync(join(dir, fname), "utf8");
      }
    } catch (_) { content = ""; }
    // Fallback: fehlt/leer lokal → vom Portal nachladen (identische Quelle wie Heartbeat-Resync).
    if (!content && PORTAL_FILES_BASE) {
      try {
        const url = new URL(`${PORTAL_FILES_BASE}/themes/${safeId}/${fname}`);
        const res = await requestBuffer(url, { accept: "*/*" });
        if (res.ok && res.buf.length > 0) content = res.buf.toString("utf8");
      } catch (e) {
        console.warn(`[themes] portal fetch failed ${safeId}/${fname}: ${e?.message || e}`);
      }
    }
    out[k] = content;
  }
  if (!out.html) {
    themeCache.set(safeId, { ts: Date.now(), theme: null });
    return null;
  }
  themeCache.set(safeId, { ts: Date.now(), theme: out });
  return out;
}



async function loadLanding(domain) {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    console.error("[landing-server] SUPABASE_URL und SUPABASE_PUBLISHABLE_KEY müssen gesetzt sein.");
    return null;
  }

  const key = domain.toLowerCase().replace(/^www\./, "");
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.row;

  const apiUrl = new URL("/rest/v1/landing_pages", SUPABASE_URL);
  apiUrl.searchParams.set("select", LANDING_SELECT);
  apiUrl.searchParams.set("domain", `eq.${key}`);
  apiUrl.searchParams.set("is_published", "eq.true");
  apiUrl.searchParams.set("limit", "1");

  let row = null;
  try {
    const res = await requestJson(apiUrl, {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      accept: "application/json",
    });
    if (!res.ok) {
      console.error(`[landing-server] DB-Error für ${key}: HTTP ${res.status} ${res.text}`);
    } else {
      const rows = res.json();
      row = rows[0] || null;
    }
  } catch (e) {
    console.error(`[landing-server] DB-Error für ${key}:`, e?.message || e);
  }

  cache.set(key, { row, expiresAt: Date.now() + CACHE_TTL_MS });
  return row;
}

function applyPlaceholders(src, branding, slots) {
  // Computed Aliase, damit Slot-Defaults wie {{address}} / {{contact_email}} / {{contact_phone}}
  // automatisch aus den Branding-Firmendaten gefüllt werden.
  const b = { ...(branding || {}) };
  const addrParts = [b.strasse, [b.plz, b.stadt].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const aliases = {
    logo_text: b.firmenname || "",
    firmenname: b.firmenname || "",
    seo_title: b.seo_title || "",
    seo_description: b.seo_description || "",
    landing_domain: b.landing_domain || "",
    address: b.address || addrParts,
    contact_address: b.contact_address || addrParts,
    contact_email: b.contact_email || b.email || "",
    contact_phone: b.contact_phone || b.telefon || "",
    sitz_stadt: b.sitz_stadt || b.stadt || "",
    sitz_stadt_upper: b.sitz_stadt_upper || (b.stadt ? String(b.stadt).toUpperCase() : ""),
    hrb_nummer: b.hrb_nummer || b.hrb || "",
  };
  // Slots speichern bei manchen Themes eigene Branding-Felder (logo_text, firmenname,
  // contact_*). Live muss trotzdem die zentralen Firmendaten gewinnen, sonst bleiben
  // alte Theme-Defaults wie "CLE-Beratung" trotz geänderter Einstellungen sichtbar.
  const merged = { ...(slots || {}), ...aliases, ...b };
  // 3 Passes: Slot-Defaults können selbst {{branding}}-Platzhalter enthalten.
  let out = src;
  for (let i = 0; i < 3; i++) {
    let changed = false;
    for (const [k, v] of Object.entries(merged)) {
      const token = `{{${k}}}`;
      if (out.includes(token)) { out = out.split(token).join(String(v ?? "")); changed = true; }
    }
    if (!changed) break;
  }
  return out;
}

function injectLandingConfig(html, row) {
  const esc = (s) => String(s || "").replace(/[<>"']/g, (c) => ({ "<": "\\u003c", ">": "\\u003e", '"': '\\"', "'": "\\'" }[c]));
  const rawApi = row.branding?.api_endpoint || PORTAL_API_ENDPOINT;
  const apiEndpoint = String(rawApi || "").trim().replace(/[.,;\s]+$/g, "");
  const portalUrl = row.branding?.portal_url || "";
  const wa = row.branding?.whatsapp_enabled ? String(row.branding?.whatsapp_number || "").replace(/[^0-9]/g, "") : "";
  const cleanHtml = html.replace(/<script>\s*window\.PORTAL_API\s*=\s*[\s\S]*?<\/script>\s*/gi, "");
  const block = `<script>
window.PORTAL_API = "${esc(apiEndpoint)}";
window.PORTAL_URL = "${esc(portalUrl)}";
window.TENANT_ID = "${esc(row.tenant_id || "")}";
window.FLOW_TYPE = "${esc(row.flow_type)}";
window.SOURCE_SLUG = "${esc(row.source_slug || row.slug)}";
window.LANDING_ID = "${esc(row.id || "")}";
window.WHATSAPP_NUMBER = "${esc(wa)}";

(function(){
  // Fasttrack-Empfang: ?ref=<broker_landing_id> aus URL nach window.SOURCE_LANDING_ID übernehmen
  // und in jeden POST an PORTAL_API (Bewerbungs-Endpoint) source_landing_id + target_landing_id injizieren.
  try {
    var u = new URL(location.href);
    var ref = u.searchParams.get("ref");
    if (ref && /^[0-9a-f-]{36}$/i.test(ref)) {
      window.SOURCE_LANDING_ID = ref;
      try { sessionStorage.setItem("vermittlung_ref", ref); } catch(_){}
    } else {
      try { var s = sessionStorage.getItem("vermittlung_ref"); if (s) window.SOURCE_LANDING_ID = s; } catch(_){}
    }
  } catch(_){}
  var origFetch = window.fetch;
  if (typeof origFetch !== "function") return;
  window.fetch = function(input, init){
    try {
      var url = typeof input === "string" ? input : (input && input.url) || "";
      var api = window.PORTAL_API || "";
      if (api && url && url.indexOf(api) === 0 && init && init.body && typeof init.body === "string") {
        var b = JSON.parse(init.body);
        if (typeof b === "object" && b !== null) {
          if (window.SOURCE_LANDING_ID && !b.source_landing_id) b.source_landing_id = window.SOURCE_LANDING_ID;
          if (window.LANDING_ID && !b.target_landing_id) b.target_landing_id = window.LANDING_ID;
          init = Object.assign({}, init, { body: JSON.stringify(b) });
        }
      }
    } catch(_){}
    return origFetch.call(this, input, init);
  };
})();
</script>`;
  return /<\/head>/i.test(cleanHtml) ? cleanHtml.replace(/<\/head>/i, block + "</head>") : block + cleanHtml;
}

function cleanEmptyMeta(html, branding, domain) {
  let out = html;
  if (!branding?.seo_image) {
    out = out.replace(/\s*<meta[^>]*property=["']og:image["'][^>]*content=["']["'][^>]*>\s*/gi, "\n");
    out = out.replace(/\s*<meta[^>]*name=["']twitter:image["'][^>]*content=["']["'][^>]*>\s*/gi, "\n");
  }
  return out.replace(/\{\{landing_domain\}\}/g, domain);
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderImpressum(b = {}) {
  const addr = [b.strasse, [b.plz, b.stadt].filter(Boolean).join(" ")].filter(Boolean).map(escapeHtml).join("<br/>");
  const rows = [];
  rows.push(`<p><strong>${escapeHtml(b.firmenname)}</strong>${addr ? `<br/>${addr}` : ""}</p>`);
  if (b.geschaeftsfuehrer) rows.push(`<p><strong>Vertreten durch:</strong><br/>${escapeHtml(b.geschaeftsfuehrer)}</p>`);
  const contact = [];
  if (b.telefon) contact.push(`Telefon: <a href="tel:${escapeHtml(b.telefon)}">${escapeHtml(b.telefon)}</a>`);
  if (b.email) contact.push(`E-Mail: <a href="mailto:${escapeHtml(b.email)}">${escapeHtml(b.email)}</a>`);
  if (contact.length) rows.push(`<h3>Kontakt</h3><p>${contact.join("<br/>")}</p>`);
  const reg = [];
  if (b.registergericht) reg.push(`Registergericht: ${escapeHtml(b.registergericht)}`);
  if (b.hrb) reg.push(`Registernummer: ${escapeHtml(b.hrb)}`);
  if (reg.length) rows.push(`<h3>Registereintrag</h3><p>${reg.join("<br/>")}</p>`);
  const tax = [];
  if (b.ust_id) tax.push(`USt-IdNr.: ${escapeHtml(b.ust_id)}`);
  if (b.steuernummer) tax.push(`Steuernummer: ${escapeHtml(b.steuernummer)}`);
  if (tax.length) rows.push(`<h3>Umsatzsteuer</h3><p>${tax.join("<br/>")}</p>`);
  if (b.impressum) rows.push(`<div>${b.impressum}</div>`);
  return rows.join("\n");
}

function renderDatenschutz(b = {}) {
  const name = escapeHtml(b.firmenname);
  const email = escapeHtml(b.email);
  const address = [b.strasse, [b.plz, b.stadt].filter(Boolean).join(" ")].filter(Boolean).map(escapeHtml).join("<br/>");
  return `
    <h3>1. Verantwortlicher</h3>
    <p>Verantwortlich für die Datenverarbeitung auf dieser Website ist:<br/>${name}${address ? `<br/>${address}` : ""}${email ? `<br/>E-Mail: <a href="mailto:${email}">${email}</a>` : ""}</p>
    <h3>2. Bewerbungsdaten</h3>
    <p>Bei einer Bewerbung über unsere Website verarbeiten wir die von Ihnen angegebenen Daten ausschließlich zur Bearbeitung Ihrer Bewerbung. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO sowie § 26 BDSG.</p>
    <h3>3. Speicherdauer</h3>
    <p>Ihre Bewerbungsdaten werden bis zu 6 Monate nach Abschluss des Verfahrens gespeichert und anschließend gelöscht, sofern keine längere Aufbewahrungspflicht besteht oder Sie in eine längere Speicherung eingewilligt haben.</p>
    <h3>4. Ihre Rechte</h3>
    <p>Sie haben das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit sowie Widerspruch. Anfragen richten Sie bitte an ${email ? `<a href="mailto:${email}">${email}</a>` : name}.</p>
  `;
}

function buildLegalPage(title, body, row) {
  const firm = escapeHtml(row.branding?.firmenname || row.domain || "");
  const t = escapeHtml(title);
  return `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>${t} – ${firm}</title><meta name="robots" content="noindex,follow"/><link rel="stylesheet" href="/style.css"/><style>.legal-page{max-width:820px;margin:0 auto;padding:64px 24px 96px;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#1a1a1a;line-height:1.7}.legal-page h1{font-size:36px;margin:0 0 8px}.legal-page h3{font-size:18px;margin:28px 0 8px}.legal-page p{margin:0 0 12px}.legal-page a{color:#2563eb}.legal-back{display:inline-block;margin-bottom:24px;color:#64748b;text-decoration:none;font-size:14px}.legal-footer{max-width:820px;margin:0 auto;padding:24px;border-top:1px solid #e5e7eb;font-size:13px;color:#64748b;text-align:center}</style></head><body><main class="legal-page"><a href="/" class="legal-back">← Zurück zur Startseite</a><h1>${t}</h1>${body}</main><footer class="legal-footer">© ${new Date().getFullYear()} ${firm} · <a href="/impressum.html">Impressum</a> · <a href="/datenschutz.html">Datenschutz</a></footer></body></html>`;
}

async function renderHtml(row, host) {
  const theme = await loadTheme(row.theme_id);
  if (!theme) return { body: `Theme nicht gefunden: ${row.theme_id}`, status: 500 };
  // Branding-Logo automatisch in {{logo_image}}/{{favicon_image}}-Slots spiegeln,
  // damit Themes wie Eilers/TTS/AZB den hochgeladenen Logo nutzen.
  const slots = { ...(row.slots || {}) };
  // Rechtliches sind auf dem Live-Renderer echte Unterseiten. Alte gespeicherte
  // Slot-Werte (#impressum/#datenschutz) werden bewusst überschrieben, damit
  // die Startseite nicht mehr bis zu den Rechtstexten durchscrollt.
  slots.impressum_url = "impressum.html";
  slots.datenschutz_url = "datenschutz.html";
  // Cache-Buster aus updated_at, damit Browser/Cloudflare beim Logo-Wechsel neu laden.
  const ver = row.updated_at ? `?v=${Date.parse(row.updated_at) || ""}` : "";
  if (row.logo_url && !slots.logo_image) slots.logo_image = `/assets/logo${ver}`;
  if (row.favicon_url && !slots.favicon_image) slots.favicon_image = `/assets/favicon${ver}`;
  let html = applyPlaceholders(theme.html, row.branding, slots);
  html = html.replace(/<section[^>]*id=["'](?:impressum|datenschutz)["'][\s\S]*?<\/section>\s*/gi, "");
  html = cleanEmptyMeta(html, row.branding, host);
  html = injectLandingConfig(html, row);
  if (row.logo_url) html = html.replace(/assets\/logo\.[a-z]+/gi, `/assets/logo${ver}`);
  if (row.favicon_url) html = html.replace(/assets\/favicon\.[a-z]+/gi, `/assets/favicon${ver}`);
  return { body: html, status: 200 };
}


function renderLegal(row, type) {
  const body = type === "datenschutz" ? renderDatenschutz(row.branding || {}) : renderImpressum(row.branding || {});
  return buildLegalPage(type === "datenschutz" ? "Datenschutz" : "Impressum", body, row);
}

function renderCss(row) {
  return loadTheme(row.theme_id).then((theme) => theme ? applyPlaceholders(theme.css, row.branding, row.slots) : "/* theme missing */");
}

function renderJs(row) {
  return loadTheme(row.theme_id).then((theme) => theme ? applyPlaceholders(theme.js, row.branding, row.slots) : "// theme missing");
}


function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const path = url.pathname;

    if (path === "/_health") return send(res, 200, "ok");

    if (path === "/_internal/ask") {
      const domain = (url.searchParams.get("domain") || "").toLowerCase();
      if (!domain) return send(res, 400, "missing domain");
      const row = await loadLanding(domain);
      return row ? send(res, 200, "ok") : send(res, 404, "not found");
    }

    const host = String(req.headers.host || "").toLowerCase().split(":")[0];
    if (!host) return send(res, 400, "no host");
    const row = await loadLanding(host);
    if (!row) return send(res, 404, `Keine Landing für ${host} konfiguriert.`);

    if (path === "/style.css") {
      return send(res, 200, await renderCss(row), { "content-type": "text/css; charset=utf-8", "cache-control": "public,max-age=300" });
    }
    if (path === "/script.js") {
      return send(res, 200, await renderJs(row), { "content-type": "application/javascript; charset=utf-8", "cache-control": "public,max-age=300" });
    }
    if (path.startsWith("/assets/logo")) {
      return row.logo_url
        ? send(res, 302, "", { location: row.logo_url, "cache-control": "no-cache, no-store, must-revalidate" })
        : send(res, 404, "no logo");
    }
    if (path.startsWith("/assets/favicon")) {
      return row.favicon_url
        ? send(res, 302, "", { location: row.favicon_url, "cache-control": "no-cache, no-store, must-revalidate" })
        : send(res, 404, "no favicon");
    }
    if (path.startsWith("/assets/")) {
      const rel = path.slice("/assets/".length);
      if (!rel || rel.includes("..") || rel.includes("/")) return send(res, 404, "not found");
      const asset = await loadAsset(row.theme_id, rel);
      if (!asset) return send(res, 404, "asset not found");
      return send(res, 200, asset.buf, { "content-type": asset.ct, "cache-control": "public,max-age=86400,immutable" });
    }
    if (path === "/" || path === "/index.html") {
      const { body, status } = await renderHtml(row, host);
      return send(res, status, body, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
    }

    if (path === "/impressum" || path === "/impressum.html") {
      return send(res, 200, renderLegal(row, "impressum"), { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
    }
    if (path === "/datenschutz" || path === "/datenschutz.html") {
      return send(res, 200, renderLegal(row, "datenschutz"), { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
    }
    return send(res, 404, "not found");
  } catch (e) {
    console.error("[landing-server] request error:", e?.message || e);
    return send(res, 500, "internal error");
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[landing-server] listening on http://127.0.0.1:${PORT}`);
});