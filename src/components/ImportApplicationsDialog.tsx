import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Upload, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type Row = {
  full_name: string;
  email: string;
  phone: string | null;
  status: string;
  created_at: string | null;
  first_name?: string;
  last_name?: string;
};

// ---------- CSV ----------
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ";" && !inQuotes) {
      out.push(cur); cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseCsv(text: string): { rows: Row[]; errors: string[] } {
  const clean = text.replace(/^\uFEFF/, "");
  const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { rows: [], errors: ["Datei ist leer."] };
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idx = {
    name: header.findIndex((h) => h === "name" || h === "full_name"),
    email: header.findIndex((h) => h === "e-mail" || h === "email" || h === "mail"),
    phone: header.findIndex((h) => h === "telefon" || h === "phone"),
    status: header.findIndex((h) => h === "status"),
    date: header.findIndex((h) => h === "datum" || h === "created_at" || h === "date"),
  };
  const errors: string[] = [];
  if (idx.name === -1) errors.push("Spalte 'Name' fehlt.");
  if (idx.email === -1) errors.push("Spalte 'E-Mail' fehlt.");
  if (errors.length) return { rows: [], errors };
  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const full_name = (cols[idx.name] ?? "").trim();
    const email = (cols[idx.email] ?? "").trim();
    if (!full_name || !email) { errors.push(`Zeile ${i + 1}: Name oder E-Mail fehlt – übersprungen.`); continue; }
    const phone = idx.phone >= 0 ? (cols[idx.phone] ?? "").trim() || null : null;
    const status = (idx.status >= 0 ? (cols[idx.status] ?? "").trim() : "") || "neu";
    const rawDate = idx.date >= 0 ? (cols[idx.date] ?? "").trim() : "";
    let created_at: string | null = null;
    if (rawDate) { const d = new Date(rawDate); created_at = isNaN(d.getTime()) ? null : d.toISOString(); }
    const parts = full_name.split(/\s+/);
    const first_name = parts.length > 1 ? parts.slice(0, -1).join(" ") : full_name;
    const last_name = parts.length > 1 ? parts[parts.length - 1] : undefined;
    rows.push({ full_name, email, phone, status, created_at, first_name, last_name });
  }
  return { rows, errors };
}

// ---------- Freitext-Parser ----------
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
// Telefon: + oder 0 gefolgt von Ziffern/Leerzeichen/Klammern/Schrägstrich/Bindestrich, min. 7 Ziffern
const PHONE_RE = /(?:\+?\d[\d\s().\-/]{6,}\d)/;
const POSTAL_RE = /\b\d{4,5}\b/;
const DATE_RE = /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/;
// Label-Präfixe (Name, E-Mail, Telefon, …) am Zeilenanfang
const NAME_LABEL_RE = /^(vor[\s\-]*(?:und[\s\-]*)?nachname|vor[-\s]*nachname|vorname(?:\s*und\s*nachname)?|nachname|name)\s*[:\-]\s*/i;
const EMAIL_LABEL_RE = /^(e\s*-?\s*mail(?:\s*[-\s]?adresse)?|email|mail)\s*[:\-]\s*/i;
const PHONE_LABEL_RE = /^(telefonnummer|telefon|tel\.?|mobil|handy|phone)\s*[:\-]\s*/i;
// Zeilen, die NIE ein Name sind
const SKIP_LINE_RE = /^(bewerber\s*information|adresse|anschrift|wohnort|geboren|geburtsort|geburtsdatum|geburtsdatum\s*und[-\s]*ort|geburtstag|geburtdatum|staatsangeh\w*|familienstand|nationalit\w*|führerschein|c\/o)\s*[:\-]?/i;
// Länder / Bundesländer in eigenen Zeilen ignorieren
const COUNTRY_RE = /^(deutschland|österreich|schweiz|germany|austria|switzerland)$/i;

function normalizeInlineSeparators(s: string): string {
  return s.replace(/\s+(?=[|•·●])|(?<=[|•·●])\s*/g, " | ").replace(/\s*\|\s*/g, " | ");
}

function stripCtl(s: string): string {
  // Unsichtbare Steuerzeichen (LRE/RLE/PDF/LRM/RLM/BOM …) entfernen
  return s.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "");
}

function looksLikeAddress(line: string): boolean {
  if (/\b(str\.|straße|strasse|str\b|weg|gasse|platz|allee|ring|chaussee|ufer|hof)\b/i.test(line)) return true;
  if (POSTAL_RE.test(line) && /[A-Za-zÄÖÜäöüß]/.test(line)) return true;
  return false;
}

function titleCase(s: string): string {
  return s.toLowerCase().split(/\s+/).map((w) => w ? w[0].toUpperCase() + w.slice(1) : w).join(" ");
}

function cleanNameCandidate(s: string): string {
  return s
    .replace(NAME_LABEL_RE, "")
    .replace(/,\s*geb\.?\s+.*$/i, "")
    .replace(/\b(?:geb\.?|geboren)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function deriveNameFromEmail(email: string): string {
  const localPart = email.split("@")[0] ?? "";
  const base = localPart
    .replace(/[0-9]+$/g, "")
    .replace(/[._-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();

  if (!base) return email;
  return titleCase(base);
}

function isNameCandidate(s: string): boolean {
  // Nur Buchstaben/Leerzeichen/Bindestrich/Punkt/Apostroph, mind. 2 Zeichen, höchstens 6 Wörter
  if (s.length < 2 || s.length > 80) return false;
  if (s.split(/\s+/).length > 6) return false;
  return /^[A-Za-zÄÖÜäöüßÉéÈèÀàÂâÊêÎîÔôÛûÇçÑñÁáÍíÓóÚúğĞıİşŞçÇöÖüÜ'\-.\s]+$/.test(s);
}

function parseBlock(block: string): Row | null {
  const raw = block
    .split(/\r?\n/)
    .flatMap((l) => normalizeInlineSeparators(stripCtl(l)).split(/\s+\|\s+/))
    .map((l) => l.replace(/^[•·●○*]+\s*/, "").trim())
    .filter(Boolean);
  if (raw.length === 0) return null;

  // E-Mail extrahieren
  let email = "";
  for (const l of raw) { const m = l.match(EMAIL_RE); if (m) { email = m[0]; break; } }
  // Telefon extrahieren — Label-Zeile bevorzugt, sonst irgendwo (außer E-Mail-Zeile)
  let phone: string | null = null;
  for (const l of raw) {
    if (!PHONE_LABEL_RE.test(l)) continue;
    const m = l.replace(PHONE_LABEL_RE, "").match(PHONE_RE);
    if (m && m[0].replace(/\D/g, "").length >= 7) { phone = m[0].trim().replace(/\s+/g, " "); break; }
  }
  if (!phone) {
    for (const l of raw) {
      const without = l.replace(EMAIL_RE, "");
      const m = without.match(PHONE_RE);
      if (m && m[0].replace(/\D/g, "").length >= 7) { phone = m[0].trim().replace(/\s+/g, " "); break; }
    }
  }

  // Name finden
  let name = "";
  // 1) Explizite Name-Label-Zeile
  for (const l of raw) {
    if (NAME_LABEL_RE.test(l)) {
      const cand = cleanNameCandidate(l);
      if (isNameCandidate(cand)) { name = cand; break; }
    }
  }
  // 2) Fallback: erste plausible Zeile
  if (!name) {
    const nameParts: string[] = [];
    for (const l of raw) {
      if (EMAIL_LABEL_RE.test(l) || PHONE_LABEL_RE.test(l)) continue;
      const withoutEmailLabel = l.replace(EMAIL_LABEL_RE, "").trim();
      if (EMAIL_RE.test(withoutEmailLabel)) continue;
      if (PHONE_RE.test(l) && l.replace(/\D/g, "").length >= 7) continue;
      if (SKIP_LINE_RE.test(l)) continue;
      if (COUNTRY_RE.test(l)) continue;
      if (looksLikeAddress(l)) continue;
      if (DATE_RE.test(l)) continue;
      const cand = cleanNameCandidate(l);
      if (!isNameCandidate(cand)) continue;
      nameParts.push(cand);
      if (nameParts.length >= 2) break;
    }
    name = nameParts.join(" ").replace(/\s+/g, " ").trim();
  }
  if (!name && email) name = deriveNameFromEmail(email);
  if (!name || !email) return null;

  // Trailing-Kommas/Punkte entfernen
  name = name.replace(/[,;]+$/, "").trim();
  // ALL CAPS schön formatieren
  if (name === name.toUpperCase()) name = titleCase(name);

  const parts = name.split(/\s+/);
  const first_name = parts.length > 1 ? parts.slice(0, -1).join(" ") : name;
  const last_name = parts.length > 1 ? parts[parts.length - 1] : undefined;

  return { full_name: name, email: email.toLowerCase(), phone, status: "neu", created_at: null, first_name, last_name };
}

function parseFreeText(text: string): { rows: Row[]; errors: string[] } {
  const normalized = text.replace(/\r/g, "");
  const separatorRe = /(?:^|\n)\s*(?:-{3,}|_{3,}|[=]{3,})\s*(?=\n|$)/;
  const hasExplicitSeparators = separatorRe.test(normalized);
  const blocks = normalized
    .split(hasExplicitSeparators ? /(?:^|\n)\s*(?:-{3,}|_{3,}|[=]{3,})\s*(?=\n|$)/ : /\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
  const rows: Row[] = [];
  const errors: string[] = [];
  blocks.forEach((b, i) => {
    const r = parseBlock(b);
    if (r) rows.push(r);
    else errors.push(`Block ${i + 1}: konnte nicht geparst werden (E-Mail oder Name fehlt).`);
  });
  // Dedupe per E-Mail
  const seen = new Set<string>();
  const uniq = rows.filter((r) => { if (seen.has(r.email)) return false; seen.add(r.email); return true; });
  return { rows: uniq, errors };
}

// ---------- Component ----------
export function ImportApplicationsDialog({ onImported }: { onImported: () => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"csv" | "text">("text");
  const [rows, setRows] = useState<Row[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string>("");
  const [importing, setImporting] = useState(false);
  const [text, setText] = useState("");
  const [tenantId, setTenantId] = useState<string>("");
  const [tenants, setTenants] = useState<{ id: string; name: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    supabase.from("tenants").select("id, name").order("name").then(({ data }) => {
      setTenants((data ?? []) as { id: string; name: string }[]);
    });
  }, [open]);

  const reset = () => {
    setRows([]); setParseErrors([]); setFileName(""); setText("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleFile = async (file: File) => {
    setFileName(file.name);
    const t = await file.text();
    const { rows, errors } = parseCsv(t);
    setRows(rows); setParseErrors(errors);
  };

  const handleParseText = () => {
    const { rows, errors } = parseFreeText(text);
    setRows(rows); setParseErrors(errors);
  };

  const doImport = async () => {
    if (rows.length === 0) return;
    if (!tenantId) {
      toast({ title: "Mandant fehlt", description: "Bitte zuerst einen Mandanten auswählen.", variant: "destructive" });
      return;
    }
    setImporting(true);
    try {
      const chunkSize = 200;
      let inserted = 0;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize).map((r) => {
          const payload: Record<string, unknown> = {
            full_name: r.full_name,
            email: r.email,
            phone: r.phone,
            status: r.status || "neu",
            tenant_id: tenantId,
          };
          if (r.created_at) payload.created_at = r.created_at;
          if (r.first_name) payload.first_name = r.first_name;
          if (r.last_name) payload.last_name = r.last_name;
          return payload;
        });
        const { error } = await supabase.from("applications").insert(chunk as never);
        if (error) throw error;
        inserted += chunk.length;
      }
      toast({ title: "Import erfolgreich", description: `${inserted} Bewerbungen importiert.` });
      onImported();
      setOpen(false);
      reset();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unbekannter Fehler";
      toast({ title: "Import fehlgeschlagen", description: msg, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 text-xs gap-1.5">
          <Upload className="h-3.5 w-3.5" /> Import
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bewerbungen importieren</DialogTitle>
          <DialogDescription>
            CSV oder Freitext-Blöcke (durch <code>-----</code> oder Leerzeile getrennt).
            Mandant ist Pflicht – legt fest, von welchem SMTP die Mails an die Bewerber gehen.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Mandant <span className="text-destructive">*</span></Label>
            <Select value={tenantId} onValueChange={setTenantId}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Mandant auswählen…" />
              </SelectTrigger>
              <SelectContent>
                {tenants.map((t) => (
                  <SelectItem key={t.id} value={t.id} className="text-xs">{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Tabs value={mode} onValueChange={(v) => { setMode(v as "csv" | "text"); setRows([]); setParseErrors([]); }}>
            <TabsList className="grid grid-cols-2 h-9">
              <TabsTrigger value="text" className="text-xs">Freitext</TabsTrigger>
              <TabsTrigger value="csv" className="text-xs">CSV</TabsTrigger>
            </TabsList>

            <TabsContent value="text" className="space-y-2 mt-3">
              <Label className="text-xs text-muted-foreground">
                Pro Lead ein Block. Trenner: Leerzeile oder <code>-----</code>. Reihenfolge egal – Name, E-Mail und Telefon werden automatisch erkannt.
              </Label>
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={`Agnes Lazar\n+49 176 2027 3178\nmailbox.teamoffice@gmail.com\n\n-----\n\nAmina Alic\namina.alic@icloud.com\n017684669548`}
                className="font-mono text-xs min-h-[180px]"
              />
              <Button size="sm" variant="secondary" onClick={handleParseText} disabled={!text.trim()} className="h-8 text-xs">
                Vorschau erstellen
              </Button>
            </TabsContent>

            <TabsContent value="csv" className="space-y-2 mt-3">
              <Label className="text-xs text-muted-foreground">
                Format: <strong>Name;E-Mail;Telefon;Status;Datum</strong> (Semikolon-getrennt). Pflicht: Name, E-Mail.
              </Label>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                className="block w-full text-sm text-foreground file:mr-3 file:py-2 file:px-3 file:rounded-md file:border file:border-border file:bg-muted file:text-foreground hover:file:bg-muted/80 file:cursor-pointer"
              />
              {fileName && <p className="text-xs text-muted-foreground mt-1.5">Datei: {fileName}</p>}
            </TabsContent>
          </Tabs>

          {parseErrors.length > 0 && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs space-y-1 max-h-32 overflow-auto">
              <div className="flex items-center gap-1.5 font-medium text-destructive">
                <AlertCircle className="h-3.5 w-3.5" /> Hinweise ({parseErrors.length})
              </div>
              {parseErrors.slice(0, 20).map((e, i) => (
                <p key={i} className="text-destructive/90">{e}</p>
              ))}
              {parseErrors.length > 20 && <p className="text-muted-foreground">… und {parseErrors.length - 20} weitere</p>}
            </div>
          )}

          {rows.length > 0 && (
            <div className="rounded-md border border-border overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border-b border-border text-xs">
                <CheckCircle2 className="h-3.5 w-3.5 text-status-success" />
                <span className="font-medium">{rows.length} Einträge bereit zum Import</span>
                <span className="text-muted-foreground">— Vorschau aller Einträge</span>
              </div>
              <div className="overflow-auto max-h-[420px]">
                <table className="w-full text-xs">
                  <thead className="bg-muted/20 text-muted-foreground sticky top-0">
                    <tr>
                      <th className="text-left p-2 font-medium">#</th>
                      <th className="text-left p-2 font-medium">Name</th>
                      <th className="text-left p-2 font-medium">E-Mail</th>
                      <th className="text-left p-2 font-medium">Telefon</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="p-2 text-muted-foreground tabular-nums">{i + 1}</td>
                        <td className="p-2">{r.full_name}</td>
                        <td className="p-2">{r.email}</td>
                        <td className="p-2">{r.phone || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => { setOpen(false); reset(); }} disabled={importing}>Abbrechen</Button>
          <Button onClick={doImport} disabled={rows.length === 0 || importing || !tenantId} className="gap-1.5">
            {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {importing ? "Importiere…" : `${rows.length} importieren`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
