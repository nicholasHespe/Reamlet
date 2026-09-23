// Reamlet — Print composition
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Builds the PDF that is actually handed to the OS print pipeline. Sheets
// (single page, N-up grids, booklet spreads) are composited with pdf-lib,
// embedding source pages as vector XObjects via embedPdf/drawPage, rather
// than rasterizing them through <canvas> first. That keeps fine detail —
// barcodes, small type — intact at whatever resolution the printer itself
// uses, instead of baking it in at a fixed, low DPI before the OS ever sees
// it. See print-preview.ts for the on-screen preview, which still renders
// through pdf.js/<canvas>/PNG — screen resolution isn't the bottleneck there,
// only the printed output was.

// @ts-expect-error — pdf-lib is imported via direct path for Electron's file:// ESM loader
import * as _pdfLib from '../../node_modules/pdf-lib/dist/pdf-lib.esm.js';
import type * as PDFLibNS from 'pdf-lib';

const { PDFDocument, rgb, degrees, StandardFonts } = _pdfLib as unknown as typeof PDFLibNS;

type PDFPage         = import('pdf-lib').PDFPage;
type PDFEmbeddedPage = import('pdf-lib').PDFEmbeddedPage;

export interface BookletSheet {
  front: [number, number]; // [leftPage, rightPage] — both 1-indexed; 0 = blank
  back:  [number, number];
}

/** Imposition order for a saddle-stitched booklet. Shared by the on-screen preview and the print builder so they never disagree about page order. */
export function getBookletOrder(numPages: number): BookletSheet[] {
  const totalSlots = Math.ceil(numPages / 4) * 4;
  const numSheets  = totalSlots / 4;
  const sheets: BookletSheet[] = [];
  let low = 1, high = totalSlots;
  for (let i = 0; i < numSheets; i++) {
    sheets.push({ front: [high, low], back: [low + 1, high - 1] });
    low  += 2;
    high -= 2;
  }
  return sheets;
}

const PPS_COLS: Record<number, number> = { 2: 2, 4: 2, 6: 3, 9: 3, 16: 4 };

export interface BuildPrintPdfParams {
  totalPages: number;
  /** null = all pages. Ignored for booklet, which always uses every page. */
  pageRange: Set<number> | null;
  /** Pages per sheet (1, 2, 4, 6, 9, 16). Ignored (forced to 2) when isBooklet is set. */
  pps: number;
  isBooklet: boolean;
  /** Single-page paper size in PDF points, already adjusted for the chosen orientation. */
  paperW: number;
  paperH: number;
}

export interface BuildPrintPdfResult {
  bytes: Uint8Array;
  /** Physical sheet size actually used for every page of `bytes`, in points. Always portrait (mediaW <= mediaH). */
  mediaWpt: number;
  mediaHpt: number;
}

/**
 * Build the print-ready PDF: one page per physical sheet, laid out per
 * pageRange/pps/isBooklet, sized to `mediaWpt`x`mediaHpt`. A sheet wider than
 * it is tall (landscape orientation, or booklet's 2-up spreads) is rotated
 * onto portrait paper here — the physical stock printers actually carry —
 * rather than asking the driver to rotate it (see print-preview.ts's btnPrint
 * handler for why the driver can't be relied on for that).
 */
export async function buildPrintPdf(srcBytes: Uint8Array, params: BuildPrintPdfParams): Promise<BuildPrintPdfResult> {
  const { totalPages, pageRange, isBooklet, paperW, paperH } = params;
  const pps = isBooklet ? 2 : (params.pps || 1);

  const srcDoc = await PDFDocument.load(srcBytes, { ignoreEncryption: true });

  const sheetW = paperW * (isBooklet ? 2 : 1);
  const sheetH = paperH;
  const needsRotate = sheetW > sheetH;
  const mediaWpt = Math.min(sheetW, sheetH);
  const mediaHpt = Math.max(sheetW, sheetH);

  // ── Decide every sheet's slot layout up front, mirroring renderPreview() ──
  type Sheet = { slots: number[]; cols: number };
  const sheets: Sheet[] = [];

  if (isBooklet) {
    for (const sheet of getBookletOrder(totalPages)) {
      sheets.push({ slots: [...sheet.front], cols: 2 });
      sheets.push({ slots: [...sheet.back],  cols: 2 });
    }
  } else if (pps > 1) {
    const cols = PPS_COLS[pps] ?? 2;
    const visible: number[] = [];
    for (let p = 1; p <= totalPages; p++) if (pageRange === null || pageRange.has(p)) visible.push(p);
    for (let i = 0; i < visible.length; i += pps) {
      const chunk = visible.slice(i, i + pps);
      while (chunk.length < pps) chunk.push(0);
      sheets.push({ slots: chunk, cols });
    }
  } else {
    for (let p = 1; p <= totalPages; p++) {
      if (pageRange !== null && !pageRange.has(p)) continue;
      sheets.push({ slots: [p], cols: 1 });
    }
  }

  // ── Embed every referenced source page once ──
  const neededIdx = new Set<number>();
  for (const sheet of sheets) for (const p of sheet.slots) if (p >= 1 && p <= totalPages) neededIdx.add(p - 1);

  const naturalDoc = await PDFDocument.create();
  const font = await naturalDoc.embedFont(StandardFonts.Helvetica);

  const embeddedByPage = new Map<number, PDFEmbeddedPage>();
  if (neededIdx.size > 0) {
    const idxArr = [...neededIdx];
    const embeds = await naturalDoc.embedPdf(srcDoc, idxArr);
    idxArr.forEach((idx, i) => embeddedByPage.set(idx + 1, embeds[i]));
  }

  function drawSlot(page: PDFPage, pageNum: number, slotX: number, slotYFromBottom: number, slotW: number, slotH: number) {
    const embedded = embeddedByPage.get(pageNum);
    if (embedded) {
      const scale = Math.min(slotW / embedded.width, slotH / embedded.height);
      const dw = embedded.width * scale, dh = embedded.height * scale;
      page.drawPage(embedded, {
        x: slotX + (slotW - dw) / 2,
        y: slotYFromBottom + (slotH - dh) / 2,
        xScale: scale,
        yScale: scale,
      });
    } else {
      // Slot padded past the end of an N-up/booklet grid — same "Blank" affordance as the on-screen preview.
      page.drawRectangle({ x: slotX + 0.5, y: slotYFromBottom + 0.5, width: slotW - 1, height: slotH - 1, color: rgb(0.94, 0.94, 0.94) });
      const label = 'Blank';
      const size  = Math.min(slotW, slotH) * 0.07;
      const textW = font.widthOfTextAtSize(label, size);
      page.drawText(label, {
        x: slotX + (slotW - textW) / 2,
        y: slotYFromBottom + slotH / 2 - size / 2,
        size, font, color: rgb(0.73, 0.73, 0.73),
      });
    }
    page.drawRectangle({ x: slotX + 0.25, y: slotYFromBottom + 0.25, width: slotW - 0.5, height: slotH - 0.5, borderColor: rgb(0.87, 0.87, 0.87), borderWidth: 0.5 });
  }

  for (const sheet of sheets) {
    const rows = Math.ceil(sheet.slots.length / sheet.cols);
    const page = naturalDoc.addPage([sheetW, sheetH]);
    const slotW = sheetW / sheet.cols, slotH = sheetH / rows;
    sheet.slots.forEach((pageNum, i) => {
      const col = i % sheet.cols, row = Math.floor(i / sheet.cols);
      drawSlot(page, pageNum, col * slotW, sheetH - (row + 1) * slotH, slotW, slotH);
    });
  }

  if (!needsRotate) {
    return { bytes: await naturalDoc.save(), mediaWpt, mediaHpt };
  }

  // Rotate each natural (landscape) sheet 90° clockwise onto portrait paper —
  // see the comment above and print-preview.css's now-removed .rotate-sheet
  // for the on-screen-print approach this replaces. Verified empirically:
  // rotate 90° (pdf-lib's counterclockwise-positive convention) anchored at
  // (mediaW, 0) maps the natural sheet's top edge onto portrait paper's left
  // edge — "the sheet is turned clockwise to read it", matching prior behaviour.
  const finalDoc = await PDFDocument.create();
  const naturalPageCount = naturalDoc.getPageCount();
  const rotatedEmbeds = naturalPageCount > 0 ? await finalDoc.embedPdf(naturalDoc, [...Array(naturalPageCount).keys()]) : [];
  for (const embedded of rotatedEmbeds) {
    const page = finalDoc.addPage([mediaWpt, mediaHpt]);
    page.drawPage(embedded, { x: mediaWpt, y: 0, rotate: degrees(90) });
  }

  return { bytes: await finalDoc.save(), mediaWpt, mediaHpt };
}
