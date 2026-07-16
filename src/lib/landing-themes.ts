// Theme-Registry: HTML/CSS/JS als raw Strings, damit sie im Server-Function-Bundle
// (Cloudflare Workers) verfügbar sind — kein FS-Zugriff zur Laufzeit.

import sharedFormHtml from "../landing-themes/_shared/form-section.html?raw";
import sharedFormCss from "../landing-themes/_shared/form-section.css?raw";
import sharedFormJs from "../landing-themes/_shared/form-section.js?raw";
import azbFormHtml from "../landing-themes/_shared/form-section-azb.html?raw";
import azbFormCss from "../landing-themes/_shared/form-section-azb.css?raw";
import ttsFormHtml from "../landing-themes/_shared/form-section-tts.html?raw";
import ttsFormCss from "../landing-themes/_shared/form-section-tts.css?raw";
import eilFormHtml from "../landing-themes/_shared/form-section-eilers.html?raw";
import eilFormCss from "../landing-themes/_shared/form-section-eilers.css?raw";
import mirFormHtml from "../landing-themes/_shared/form-section-mirror.html?raw";
import mirFormCss from "../landing-themes/_shared/form-section-mirror.css?raw";
import cleFormHtml from "../landing-themes/_shared/form-section-cle.html?raw";
import cleFormCss from "../landing-themes/_shared/form-section-cle.css?raw";
import ttsbFormHtml from "../landing-themes/_shared/form-section-tts-beratung.html?raw";
import ttsbFormCss from "../landing-themes/_shared/form-section-tts-beratung.css?raw";
import ftFormHtml from "../landing-themes/_shared/form-section-for-tel.html?raw";
import ftFormCss from "../landing-themes/_shared/form-section-for-tel.css?raw";
import jgFormHtml from "../landing-themes/_shared/form-section-job-gleiter.html?raw";
import jgFormCss from "../landing-themes/_shared/form-section-job-gleiter.css?raw";
import tlFormHtml from "../landing-themes/_shared/form-section-tester-lab.html?raw";
import tlFormCss from "../landing-themes/_shared/form-section-tester-lab.css?raw";
import qgFormHtml from "../landing-themes/_shared/form-section-qa-grid.html?raw";
import qgFormCss from "../landing-themes/_shared/form-section-qa-grid.css?raw";
import thFormHtml from "../landing-themes/_shared/form-section-talent-hub.html?raw";
import thFormCss from "../landing-themes/_shared/form-section-talent-hub.css?raw";
import caFormHtml from "../landing-themes/_shared/form-section-career-atlas.html?raw";
import caFormCss from "../landing-themes/_shared/form-section-career-atlas.css?raw";
import dsFormHtml from "../landing-themes/_shared/form-section-device-stack.html?raw";
import dsFormCss from "../landing-themes/_shared/form-section-device-stack.css?raw";
import qrFormHtml from "../landing-themes/_shared/form-section-quality-report.html?raw";
import qrFormCss from "../landing-themes/_shared/form-section-quality-report.css?raw";
import cpFormHtml from "../landing-themes/_shared/form-section-connect-people.html?raw";
import cpFormCss from "../landing-themes/_shared/form-section-connect-people.css?raw";

import ttlHtml from "../landing-themes/theme-tester-lab/template.html?raw";
import ttlCss from "../landing-themes/theme-tester-lab/style.css?raw";
import ttlJs from "../landing-themes/theme-tester-lab/script.js?raw";
import ttlMeta from "../landing-themes/theme-tester-lab/meta.json";

import tqgHtml from "../landing-themes/theme-qa-grid/template.html?raw";
import tqgCss from "../landing-themes/theme-qa-grid/style.css?raw";
import tqgJs from "../landing-themes/theme-qa-grid/script.js?raw";
import tqgMeta from "../landing-themes/theme-qa-grid/meta.json";

import tthHtml from "../landing-themes/theme-talent-hub/template.html?raw";
import tthCss from "../landing-themes/theme-talent-hub/style.css?raw";
import tthJs from "../landing-themes/theme-talent-hub/script.js?raw";
import tthMeta from "../landing-themes/theme-talent-hub/meta.json";

import tcaHtml from "../landing-themes/theme-career-atlas/template.html?raw";
import tcaCss from "../landing-themes/theme-career-atlas/style.css?raw";
import tcaJs from "../landing-themes/theme-career-atlas/script.js?raw";
import tcaMeta from "../landing-themes/theme-career-atlas/meta.json";

import tdsHtml from "../landing-themes/theme-device-stack/template.html?raw";
import tdsCss from "../landing-themes/theme-device-stack/style.css?raw";
import tdsJs from "../landing-themes/theme-device-stack/script.js?raw";
import tdsMeta from "../landing-themes/theme-device-stack/meta.json";

import tqrHtml from "../landing-themes/theme-quality-report/template.html?raw";
import tqrCss from "../landing-themes/theme-quality-report/style.css?raw";
import tqrJs from "../landing-themes/theme-quality-report/script.js?raw";
import tqrMeta from "../landing-themes/theme-quality-report/meta.json";

import tcpHtml from "../landing-themes/theme-connect-people/template.html?raw";
import tcpCss from "../landing-themes/theme-connect-people/style.css?raw";
import tcpJs from "../landing-themes/theme-connect-people/script.js?raw";
import tcpMeta from "../landing-themes/theme-connect-people/meta.json";






import t10Html from "../landing-themes/theme-10/template.html?raw";
import t10Css from "../landing-themes/theme-10/style.css?raw";
import t10Js from "../landing-themes/theme-10/script.js?raw";
import t10Meta from "../landing-themes/theme-10/meta.json";

import tttsHtml from "../landing-themes/theme-tts-consultant/template.html?raw";
import tttsCss from "../landing-themes/theme-tts-consultant/style.css?raw";
import tttsJs from "../landing-themes/theme-tts-consultant/script.js?raw";
import tttsMeta from "../landing-themes/theme-tts-consultant/meta.json";


import teilHtml from "../landing-themes/theme-eilers-replica/template.html?raw";
import teilCss from "../landing-themes/theme-eilers-replica/style.css?raw";
import teilJs from "../landing-themes/theme-eilers-replica/script.js?raw";
import teilMeta from "../landing-themes/theme-eilers-replica/meta.json";

import tazbRepHtml from "../landing-themes/theme-azb-replica/template.html?raw";
import tazbRepCss from "../landing-themes/theme-azb-replica/style.css?raw";
import tazbRepJs from "../landing-themes/theme-azb-replica/script.js?raw";
import tazbRepMeta from "../landing-themes/theme-azb-replica/meta.json";


import tmirHtml from "../landing-themes/theme-mirror-site/template.html?raw";
import tmirCss from "../landing-themes/theme-mirror-site/style.css?raw";
import tmirJs from "../landing-themes/theme-mirror-site/script.js?raw";
import tmirMeta from "../landing-themes/theme-mirror-site/meta.json";

import tcleHtml from "../landing-themes/theme-cle-beratung/template.html?raw";
import tcleCss from "../landing-themes/theme-cle-beratung/style.css?raw";
import tcleJs from "../landing-themes/theme-cle-beratung/script.js?raw";
import tcleMeta from "../landing-themes/theme-cle-beratung/meta.json";

import ttsbHtml from "../landing-themes/theme-tts-beratung/template.html?raw";
import ttsbCss from "../landing-themes/theme-tts-beratung/style.css?raw";
import ttsbJs from "../landing-themes/theme-tts-beratung/script.js?raw";
import ttsbMeta from "../landing-themes/theme-tts-beratung/meta.json";

import tftHtml from "../landing-themes/theme-for-tel/template.html?raw";
import tftCss from "../landing-themes/theme-for-tel/style.css?raw";
import tftJs from "../landing-themes/theme-for-tel/script.js?raw";
import tftMeta from "../landing-themes/theme-for-tel/meta.json";

import tjgHtml from "../landing-themes/theme-job-gleiter/template.html?raw";
import tjgCss from "../landing-themes/theme-job-gleiter/style.css?raw";
import tjgJs from "../landing-themes/theme-job-gleiter/script.js?raw";
import tjgMeta from "../landing-themes/theme-job-gleiter/meta.json";




export type ThemeSlot = {
  key: string;
  label: string;
  type: "text" | "longtext" | "textarea" | "image" | "color";
  default: string;
};

export type ThemeFiles = {
  id: string;
  name: string;
  description: string;
  html: string;
  css: string;
  js: string;
  slots: ThemeSlot[];
};

function pickSlots(meta: any): ThemeSlot[] {
  return Array.isArray(meta?.slots) ? (meta.slots as ThemeSlot[]) : [];
}

// Jedes Theme bekommt eine eigene Bewerbungs-Sektion (inline, direkt auf der
// Landing Page). CTAs zeigen auf #bewerbung-form. Das /bewerbung im Portal
// ist ausschließlich für das geführte Bewerbungsgespräch (Chat/Tel) gedacht
// und nicht für Stammdaten-Eingabe.
void sharedFormHtml; void sharedFormCss; void sharedFormJs;

function pickFormAssets(id: string): { html: string; css: string } {
  if (id === "theme-tts-consultant") return { html: ttsFormHtml, css: ttsFormCss };
  if (id === "theme-eilers-replica") return { html: eilFormHtml, css: eilFormCss };
  if (id === "theme-azb-replica") return { html: azbFormHtml, css: azbFormCss };
  if (id === "theme-mirror-site") return { html: mirFormHtml, css: mirFormCss };
  if (id === "theme-cle-beratung") return { html: cleFormHtml, css: cleFormCss };
  if (id === "theme-tts-beratung") return { html: ttsbFormHtml, css: ttsbFormCss };
  if (id === "theme-for-tel") return { html: ftFormHtml, css: ftFormCss };
  if (id === "theme-job-gleiter") return { html: jgFormHtml, css: jgFormCss };
  if (id === "theme-tester-lab") return { html: tlFormHtml, css: tlFormCss };
  if (id === "theme-qa-grid") return { html: qgFormHtml, css: qgFormCss };
  if (id === "theme-career-atlas") return { html: caFormHtml, css: caFormCss };
  if (id === "theme-device-stack") return { html: dsFormHtml, css: dsFormCss };
  if (id === "theme-quality-report") return { html: qrFormHtml, css: qrFormCss };
  if (id === "theme-connect-people") return { html: cpFormHtml, css: cpFormCss };
  if (id === "theme-talent-hub") return { html: thFormHtml, css: thFormCss };
  return { html: sharedFormHtml, css: sharedFormCss };

}

// Themes mit bereits eingebauter Bewerbungs-Sektion (z.B. Privacy Guardian)
const HAS_OWN_FORM = new Set<string>([]);

// Modal-Wrapper: Formular ist standardmäßig versteckt und öffnet sich erst,
// wenn der Nutzer auf einen "Jetzt bewerben"-CTA (href="#bewerbung-form") klickt.
// Dadurch bleibt die Landing kompakt/seriös statt einem überlangen One-Pager.
const MODAL_CSS = `
/* ===== Bewerbungs-Modal ===== */
#lov-apply-modal{position:fixed;inset:0;z-index:9999;display:none;align-items:flex-start;justify-content:center;padding:40px 16px;overflow-y:auto;background:rgba(8,12,24,.62);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
#lov-apply-modal.is-open{display:flex}
#lov-apply-modal .lov-apply-dialog{position:relative;width:100%;max-width:880px;background:#fff;border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,.35);overflow:hidden;animation:lovApplyIn .25s ease}
@keyframes lovApplyIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
#lov-apply-modal .lov-apply-close{position:absolute;top:14px;right:14px;z-index:2;width:38px;height:38px;border-radius:50%;border:0;background:rgba(15,23,42,.85);color:#fff;font-size:22px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .2s}
#lov-apply-modal .lov-apply-close:hover{background:#0f172a}
#lov-apply-modal .lov-apply-body{max-height:calc(100vh - 80px);overflow-y:auto}
#lov-apply-modal .lov-apply-body > section{padding-top:32px;padding-bottom:32px}
body.lov-apply-open{overflow:hidden}
`;
const MODAL_JS = `
(function(){
  if (window.__lovApplyModalReady) return; window.__lovApplyModalReady = true;
  function open(){ var m=document.getElementById('lov-apply-modal'); if(!m) return; m.classList.add('is-open'); document.body.classList.add('lov-apply-open'); }
  function close(){ var m=document.getElementById('lov-apply-modal'); if(!m) return; m.classList.remove('is-open'); document.body.classList.remove('lov-apply-open'); if(location.hash==='#bewerbung-form'){ history.replaceState(null,'',location.pathname+location.search); } }
  document.addEventListener('click', function(e){
    var a = e.target && e.target.closest ? e.target.closest('a[href*="#bewerbung-form"]') : null;
    if (a){ e.preventDefault(); e.stopImmediatePropagation(); open(); return; }
    if (e.target && (e.target.id==='lov-apply-modal' || (e.target.classList && e.target.classList.contains('lov-apply-close')))){ e.preventDefault(); close(); }
  }, true);
  document.addEventListener('keydown', function(e){ if(e.key==='Escape') close(); });
  if (location.hash === '#bewerbung-form') open();
  window.addEventListener('hashchange', function(){ if(location.hash==='#bewerbung-form') open(); });
})();
`;

function withSharedForm(t: ThemeFiles): ThemeFiles {
  if (HAS_OWN_FORM.has(t.id)) return t;
  const { html: formHtml, css: formCss } = pickFormAssets(t.id);
  const modalHtml = `\n<div id="lov-apply-modal" role="dialog" aria-modal="true" aria-label="Bewerbungsformular">\n  <div class="lov-apply-dialog">\n    <button type="button" class="lov-apply-close" aria-label="Schließen">×</button>\n    <div class="lov-apply-body">${formHtml}</div>\n  </div>\n</div>\n`;
  const injectedHtml = t.html.includes("</body>")
    ? t.html.replace("</body>", `${modalHtml}\n</body>`)
    : t.html + modalHtml;
  const injectedCss = `${t.css}\n\n/* ===== Inline Bewerbungs-Sektion ===== */\n${formCss}\n${MODAL_CSS}`;
  const baseJs = t.js.includes("application-form") ? t.js : `${t.js}\n\n${sharedFormJs}`;
  const injectedJs = `${baseJs}\n${MODAL_JS}`;
  return { ...t, html: injectedHtml, css: injectedCss, js: injectedJs };
}


export const THEMES: ThemeFiles[] = [
  { id: t10Meta.id, name: t10Meta.name, description: t10Meta.description, html: t10Html, css: t10Css, js: t10Js, slots: pickSlots(t10Meta) },
  { id: tttsMeta.id, name: tttsMeta.name, description: tttsMeta.description, html: tttsHtml, css: tttsCss, js: tttsJs, slots: pickSlots(tttsMeta) },
  
  { id: teilMeta.id, name: teilMeta.name, description: teilMeta.description, html: teilHtml, css: teilCss, js: teilJs, slots: pickSlots(teilMeta) },
  { id: tazbRepMeta.id, name: tazbRepMeta.name, description: tazbRepMeta.description, html: tazbRepHtml, css: tazbRepCss, js: tazbRepJs, slots: pickSlots(tazbRepMeta) },
  { id: tmirMeta.id, name: tmirMeta.name, description: tmirMeta.description, html: tmirHtml, css: tmirCss, js: tmirJs, slots: pickSlots(tmirMeta) },
  { id: tcleMeta.id, name: tcleMeta.name, description: tcleMeta.description, html: tcleHtml, css: tcleCss, js: tcleJs, slots: pickSlots(tcleMeta) },
  { id: ttsbMeta.id, name: ttsbMeta.name, description: ttsbMeta.description, html: ttsbHtml, css: ttsbCss, js: ttsbJs, slots: pickSlots(ttsbMeta) },
  { id: tftMeta.id, name: tftMeta.name, description: tftMeta.description, html: tftHtml, css: tftCss, js: tftJs, slots: pickSlots(tftMeta) },
  { id: tjgMeta.id, name: tjgMeta.name, description: tjgMeta.description, html: tjgHtml, css: tjgCss, js: tjgJs, slots: pickSlots(tjgMeta) },
  { id: ttlMeta.id, name: ttlMeta.name, description: ttlMeta.description, html: ttlHtml, css: ttlCss, js: ttlJs, slots: pickSlots(ttlMeta) },
  { id: tqgMeta.id, name: tqgMeta.name, description: tqgMeta.description, html: tqgHtml, css: tqgCss, js: tqgJs, slots: pickSlots(tqgMeta) },
  { id: tthMeta.id, name: tthMeta.name, description: tthMeta.description, html: tthHtml, css: tthCss, js: tthJs, slots: pickSlots(tthMeta) },
  { id: tcaMeta.id, name: tcaMeta.name, description: tcaMeta.description, html: tcaHtml, css: tcaCss, js: tcaJs, slots: pickSlots(tcaMeta) },
  { id: tdsMeta.id, name: tdsMeta.name, description: tdsMeta.description, html: tdsHtml, css: tdsCss, js: tdsJs, slots: pickSlots(tdsMeta) },
  { id: tqrMeta.id, name: tqrMeta.name, description: tqrMeta.description, html: tqrHtml, css: tqrCss, js: tqrJs, slots: pickSlots(tqrMeta) },
  { id: tcpMeta.id, name: tcpMeta.name, description: tcpMeta.description, html: tcpHtml, css: tcpCss, js: tcpJs, slots: pickSlots(tcpMeta) },
].map(withSharedForm);



export function getTheme(id: string): ThemeFiles | undefined {
  return THEMES.find((t) => t.id === id);
}

export const THEME_LIST = THEMES.map((t) => ({
  id: t.id,
  name: t.name,
  description: t.description,
  slots: t.slots,
}));
