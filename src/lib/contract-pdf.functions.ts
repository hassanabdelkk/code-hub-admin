import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { applyEmploymentStartDate, formatGermanDate, resolveContractPlaceholders } from "@/lib/contract-utils";

function extractSignatureStoragePath(value: string | null): string | null {
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) return value.replace(/^signatures\//, "");
  const match = value.match(/\/storage\/v1\/object\/(?:public|sign)\/signatures\/([^?]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

async function downloadSignatureBytes(supabaseAdmin: any, path: string | null): Promise<{ bytes: Uint8Array; kind: "png" | "jpg" } | null> {
  if (!path) return null;
  const storagePath = extractSignatureStoragePath(path);
  if (storagePath) {
    const { data, error } = await supabaseAdmin.storage.from("signatures").download(storagePath);
    if (error || !data) return null;
    const buf = new Uint8Array(await data.arrayBuffer());
    const kind = storagePath.toLowerCase().endsWith(".jpg") || storagePath.toLowerCase().endsWith(".jpeg") ? "jpg" : "png";
    return { bytes: buf, kind };
  }
  // If a full URL was stored (legacy company_signature_url), fetch directly.
  if (/^https?:\/\//i.test(path)) {
    try {
      const res = await fetch(path);
      if (!res.ok) return null;
      const buf = new Uint8Array(await res.arrayBuffer());
      const kind = path.toLowerCase().endsWith(".jpg") || path.toLowerCase().endsWith(".jpeg") ? "jpg" : "png";
      return { bytes: buf, kind };
    } catch {
      return null;
    }
  }
  return null;
}

async function createSignatureSignedUrl(supabaseAdmin: any, value: string | null): Promise<string | null> {
  if (!value) return null;
  const storagePath = extractSignatureStoragePath(value);
  if (storagePath) {
    return (await supabaseAdmin.storage.from("signatures").createSignedUrl(storagePath, 60 * 10)).data?.signedUrl ?? null;
  }
  return /^https?:\/\//i.test(value) ? value : null;
}

export const generateContractPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ contractId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Verify ownership via RLS-scoped client
    const { data: contract, error: cErr } = await context.supabase
      .from("contracts")
      .select("id, user_id, tenant_id, generated_content, signed_name, signature_image_url, signed_at, pdf_url")
      .eq("id", data.contractId)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!contract) throw new Error("Vertrag nicht gefunden");
    if (contract.user_id !== userId) throw new Error("Kein Zugriff auf diesen Vertrag");

    // Load tenant (admin – we just need company signature & meta)
    const { data: tenant } = await supabaseAdmin
      .from("tenants")
      .select("name, company_ceo_name, company_signature_url, company_address, company_city")
      .eq("id", contract.tenant_id!)
      .maybeSingle();

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("full_name, street, zip_code, city, employment_type, employment_start_date")
      .eq("user_id", contract.user_id)
      .maybeSingle();

    // Build PDF
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

    const pageWidth = 595.28; // A4
    const pageHeight = 841.89;
    const marginX = 50;
    const marginTop = 50;
    const marginBottom = 60;
    const fontSize = 10;
    const lineHeight = 14;
    const maxWidth = pageWidth - marginX * 2;

    let page = pdf.addPage([pageWidth, pageHeight]);
    let y = pageHeight - marginTop;

    const ensureSpace = (needed: number) => {
      if (y - needed < marginBottom) {
        page = pdf.addPage([pageWidth, pageHeight]);
        y = pageHeight - marginTop;
      }
    };

    const wrapLine = (text: string, useFont = font, size = fontSize): string[] => {
      if (!text) return [""];
      const words = text.split(/\s+/);
      const lines: string[] = [];
      let current = "";
      for (const w of words) {
        const test = current ? current + " " + w : w;
        if (useFont.widthOfTextAtSize(test, size) > maxWidth) {
          if (current) lines.push(current);
          current = w;
        } else {
          current = test;
        }
      }
      if (current) lines.push(current);
      return lines.length ? lines : [""];
    };

    // Sanitize: WinAnsi (Helvetica) can't render some unicode glyphs (e.g. § is fine, but smart quotes/emoji aren't).
    const sanitize = (s: string) =>
      s
        .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
        .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
        .replace(/[\u2013\u2014]/g, "-")
        .replace(/\u2026/g, "...")
        .replace(/\u00A0/g, " ");

    const drawParagraph = (raw: string, opts: { bold?: boolean; size?: number } = {}) => {
      const useFont = opts.bold ? fontBold : font;
      const size = opts.size ?? fontSize;
      const lh = size + 4;
      const text = sanitize(raw);
      const lines = wrapLine(text, useFont, size);
      for (const line of lines) {
        ensureSpace(lh);
        page.drawText(line, { x: marginX, y, size, font: useFont, color: rgb(0.1, 0.1, 0.1) });
        y -= lh;
      }
    };

    // Render contract content line by line, treating §-headings as bold.
    const [firstName, ...rest] = (profile?.full_name ?? "").split(" ");
    const lastName = rest.join(" ");
    const renderedContent = resolveContractPlaceholders(contract.generated_content || "", {
      firstName,
      lastName,
      address: [profile?.street, profile?.zip_code && profile?.city ? `${profile.zip_code} ${profile.city}` : profile?.city].filter(Boolean).join(", "),
      city: profile?.city ?? tenant?.company_city ?? "",
      employmentType: profile?.employment_type ?? "",
      companyName: tenant?.name ?? "",
      companyCeoName: tenant?.company_ceo_name ?? "",
      companyAddress: tenant?.company_address ?? "",
      startDate: formatGermanDate(profile?.employment_start_date),
    });
    const rawLines = renderedContent.split("\n");
    for (const rawLine of rawLines) {
      const line = rawLine.trimEnd();
      if (line === "") {
        y -= lineHeight / 2;
        continue;
      }
      const isHeading = /^§\s?\d+/.test(line) || /^ARBEITSVERTRAG/i.test(line);
      drawParagraph(line, { bold: isHeading, size: isHeading ? 11 : fontSize });
    }

    // Signature block
    y -= 30;
    ensureSpace(180);
    const sigBlockTop = y;
    page.drawLine({
      start: { x: marginX, y: sigBlockTop },
      end: { x: pageWidth - marginX, y: sigBlockTop },
      thickness: 0.5,
      color: rgb(0.7, 0.7, 0.7),
    });
    y -= 20;

    const colWidth = (pageWidth - marginX * 2 - 30) / 2;
    const leftX = marginX;
    const rightX = marginX + colWidth + 30;
    const sigImgHeight = 60;
    const sigY = y - sigImgHeight;

    // Employee signature (left)
    const empSig = await downloadSignatureBytes(supabaseAdmin, contract.signature_image_url);
    if (empSig) {
      try {
        const img = empSig.kind === "jpg" ? await pdf.embedJpg(empSig.bytes) : await pdf.embedPng(empSig.bytes);
        const scale = Math.min(colWidth / img.width, sigImgHeight / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        page.drawImage(img, { x: leftX, y: sigY + (sigImgHeight - h) / 2, width: w, height: h });
      } catch {
        /* ignore */
      }
    }

    // Company signature (right)
    const compSig = await downloadSignatureBytes(supabaseAdmin, tenant?.company_signature_url ?? null);
    if (compSig) {
      try {
        const img = compSig.kind === "jpg" ? await pdf.embedJpg(compSig.bytes) : await pdf.embedPng(compSig.bytes);
        const scale = Math.min(colWidth / img.width, sigImgHeight / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        page.drawImage(img, { x: rightX, y: sigY + (sigImgHeight - h) / 2, width: w, height: h });
      } catch {
        /* ignore */
      }
    }

    y = sigY - 6;
    page.drawLine({ start: { x: leftX, y }, end: { x: leftX + colWidth, y }, thickness: 0.5, color: rgb(0.3, 0.3, 0.3) });
    page.drawLine({ start: { x: rightX, y }, end: { x: rightX + colWidth, y }, thickness: 0.5, color: rgb(0.3, 0.3, 0.3) });
    y -= 14;

    const signedDate = new Date(contract.signed_at).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
    page.drawText(sanitize(contract.signed_name), { x: leftX, y, size: 10, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(sanitize(tenant?.company_ceo_name || tenant?.name || ""), { x: rightX, y, size: 10, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
    y -= 12;
    page.drawText(`Arbeitnehmer · ${signedDate}`, { x: leftX, y, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
    page.drawText(`Arbeitgeber · ${tenant?.name ?? ""}`, { x: rightX, y, size: 9, font, color: rgb(0.4, 0.4, 0.4) });

    y -= 24;
    ensureSpace(14);
    page.drawText("Dieses Dokument wurde digital unterzeichnet und ist rechtsgueltig.", {
      x: marginX,
      y,
      size: 8,
      font,
      color: rgb(0.5, 0.5, 0.5),
    });

    const pdfBytes = await pdf.save();

    // Upload to documents bucket
    const pdfPath = `${userId}/contract-${contract.id}.pdf`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("documents")
      .upload(pdfPath, pdfBytes, { contentType: "application/pdf", upsert: true });
    if (upErr) throw new Error(upErr.message);

    const { error: updErr } = await supabaseAdmin
      .from("contracts")
      .update({ pdf_url: pdfPath })
      .eq("id", contract.id);
    if (updErr) throw new Error(updErr.message);

    // Signed URL for immediate download
    const { data: signed } = await supabaseAdmin.storage
      .from("documents")
      .createSignedUrl(pdfPath, 60 * 5);

    return { pdfPath, signedUrl: signed?.signedUrl ?? null };
  });

export const getContractSignatureUrls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ contractId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: contract } = await context.supabase
      .from("contracts")
      .select("id, user_id, tenant_id, signature_image_url, pdf_url")
      .eq("id", data.contractId)
      .maybeSingle();
    if (!contract || contract.user_id !== userId) throw new Error("Kein Zugriff");

    const { data: tenant } = await supabaseAdmin
      .from("tenants")
      .select("company_signature_url")
      .eq("id", contract.tenant_id!)
      .maybeSingle();

    const employeeUrl = await createSignatureSignedUrl(supabaseAdmin, contract.signature_image_url);

    const compRaw = tenant?.company_signature_url ?? null;
    const companyUrl = await createSignatureSignedUrl(supabaseAdmin, compRaw);

    const pdfUrl = contract.pdf_url
      ? (await supabaseAdmin.storage.from("documents").createSignedUrl(contract.pdf_url, 60 * 5)).data?.signedUrl ?? null
      : null;

    return { employeeUrl, companyUrl, pdfUrl };
  });