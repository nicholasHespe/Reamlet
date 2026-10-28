// Reamlet — Print composition
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Builds the PDF that is actually handed to the OS print pipeline. Sheets
// (single page, N-up grids, booklet spreads) are composited with pdf-lib,
// embedding source pages as vector XObjects via embedPages/drawPage, rather
// than rasterizing them through <canvas> first. That keeps fine detail —
// barcodes, small type — intact at whatever resolution the printer itself
// uses, instead of baking it in at a fixed, low DPI before the OS ever sees
// it. See print-preview.ts for the on-screen preview, which still renders
// through pdf.js/<canvas>/PNG — screen resolution isn't the bottleneck there,
// only the printed output was.

// @ts-expect-error — pdf-lib is imported via direct path for Electron's file:// ESM loader
import * as _pdfLib from '../../node_modules/pdf-lib/dist/pdf-lib.esm.js';
import type * as PDFLibNS from 'pdf-lib';
import { visibleBox } from './page-box.js';

const {
  PDFDocument, PDFDict, PDFArray, PDFNumber, PDFName, PDFRef, PDFStream, rgb, degrees, StandardFonts,
  pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject,
} = _pdfLib as unknown as typeof PDFLibNS;

type PDFPage         = import('pdf-lib').PDFPage;
type PDFEmbeddedPage = import('pdf-lib').PDFEmbeddedPage;
type PDFOperator     = import('pdf-lib').PDFOperator;
type PDFDictT        = import('pdf-lib').PDFDict;
type PDFStreamT      = import('pdf-lib').PDFStream;

/** A source page ready to draw onto a sheet, and the clockwise turn a viewer shows it at. */
interface PrintPage {
  embedded: PDFEmbeddedPage;
  rotation: 0 | 90 | 180 | 270;
}

// Annotation flags (PDF 32000 §12.5.3).
const ANNOT_HIDDEN = 1 << 1;
const ANNOT_PRINT  = 1 << 2;

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
 * it is tall (landscape orientation, or booklet's 2-up spreads) is drawn a
 * quarter turn clockwise onto portrait paper — the physical stock printers
 * actually carry — rather than asking the driver to rotate it (see
 * print-preview.ts's btnPrint handler for why the driver can't be relied on
 * for that).
 */
export async function buildPrintPdf(srcBytes: Uint8Array, params: BuildPrintPdfParams): Promise<BuildPrintPdfResult> {
  const { totalPages, pageRange, isBooklet, paperW, paperH } = params;
  const pps = isBooklet ? 2 : (params.pps || 1);

  const srcDoc = await PDFDocument.load(srcBytes, { ignoreEncryption: true });

  const sheetW = paperW * (isBooklet ? 2 : 1);
  const sheetH = paperH;
  const turned = sheetW > sheetH;
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

  const doc  = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const printPages = new Map<number, PrintPage>();
  if (neededIdx.size > 0) {
    const srcPages = [...neededIdx].map(idx => srcDoc.getPage(idx));
    srcPages.forEach(drawAnnotationsIntoPage);
    // Only the part of each page a viewer shows: its CropBox within its MediaBox.
    const boxes  = srcPages.map(p => {
      const box = visibleBox(p);
      return { left: box.x, bottom: box.y, right: box.x + box.width, top: box.y + box.height };
    });
    const embeds = await doc.embedPages(srcPages, boxes);
    [...neededIdx].forEach((idx, i) => printPages.set(idx + 1, {
      embedded: embeds[i],
      rotation: (((Math.round(srcPages[i].getRotation().angle / 90) * 90) % 360 + 360) % 360) as PrintPage['rotation'],
    }));
  }

  function drawSlot(page: PDFPage, pageNum: number, slotX: number, slotYFromBottom: number, slotW: number, slotH: number) {
    const printPage = printPages.get(pageNum);
    if (printPage) {
      // Laid out as it is displayed: a quarter turn swaps width and height.
      const { embedded, rotation } = printPage;
      const quarterTurn = rotation % 180 !== 0;
      const shownW = quarterTurn ? embedded.height : embedded.width;
      const shownH = quarterTurn ? embedded.width  : embedded.height;
      const scale  = Math.min(slotW / shownW, slotH / shownH);
      const x0 = slotX + (slotW - shownW * scale) / 2;
      const y0 = slotYFromBottom + (slotH - shownH * scale) / 2;
      // drawPage turns the page counter-clockwise about its own origin, so
      // that origin goes at the corner the turn swings the page back into place from.
      const w = embedded.width * scale, h = embedded.height * scale;
      const [dx, dy] = { 0: [0, 0], 90: [0, w], 180: [w, h], 270: [h, 0] }[rotation];
      page.drawPage(embedded, {
        x: x0 + dx,
        y: y0 + dy,
        xScale: scale,
        yScale: scale,
        rotate: degrees(-rotation),
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
    const page = doc.addPage([mediaWpt, mediaHpt]);
    // Lay the sheet out in its own upright coordinates; a turned sheet's top
    // edge runs down the paper's left edge.
    if (turned) page.pushOperators(pushGraphicsState(), concatTransformationMatrix(0, 1, -1, 0, mediaWpt, 0));
    const slotW = sheetW / sheet.cols, slotH = sheetH / rows;
    sheet.slots.forEach((pageNum, i) => {
      const col = i % sheet.cols, row = Math.floor(i / sheet.cols);
      drawSlot(page, pageNum, col * slotW, sheetH - (row + 1) * slotH, slotW, slotH);
    });
    if (turned) page.pushOperators(popGraphicsState());
  }

  return { bytes: await doc.save(), mediaWpt, mediaHpt };
}

// ── Annotations ───────────────────────────────────────────────

/**
 * Draw every printable annotation's appearance into its page's content, as a
 * viewer draws it over the page. embedPages() carries a page's content stream
 * and nothing else, so without this a printout would lose every annotation —
 * text boxes, shapes, highlights, and the values in filled form fields. A page
 * with no content stream at all, which embedPages() rejects, gets one here too.
 */
function drawAnnotationsIntoPage(page: PDFPage): void {
  const ops: PDFOperator[] = [];
  const annots = page.node.Annots();
  for (let i = 0; i < (annots?.size() ?? 0); i++) {
    const annot = annots!.lookupMaybe(i, PDFDict);
    const found = annot ? printableAppearance(annot) : null;
    if (!found) continue;
    const name = page.node.newXObject('Annot', found.ref);
    ops.push(pushGraphicsState(), concatTransformationMatrix(...found.placement), drawObject(name), popGraphicsState());
  }

  // Keep whatever state the page's own content leaves behind from leaking into the annotations.
  const context = page.doc.context;
  if (ops.length > 0 && page.node.Contents()) {
    page.node.wrapContentStreams(context.getPushGraphicsStateContentStream(), context.getPopGraphicsStateContentStream());
  }
  if (ops.length > 0 || !page.node.Contents()) page.pushOperators(...ops);
}

/**
 * The appearance a printer should show for `annot`, and the matrix that puts
 * it on the page; null when it has none or isn't meant to be printed. A field
 * whose appearance depends on its state (a checkbox, say) uses the state it is in.
 */
function printableAppearance(annot: PDFDictT): { ref: import('pdf-lib').PDFRef; placement: [number, number, number, number, number, number] } | null {
  const flags = annot.lookupMaybe(PDFName.of('F'), PDFNumber)?.asNumber() ?? 0;
  if (!(flags & ANNOT_PRINT) || (flags & ANNOT_HIDDEN)) return null;

  const normal = annot.lookupMaybe(PDFName.of('AP'), PDFDict)?.get(PDFName.of('N'));
  let ref = normal instanceof PDFRef ? normal : null;
  if (ref && !(annot.context.lookup(ref) instanceof PDFStream)) {
    const state = annot.lookupMaybe(PDFName.of('AS'), PDFName);
    const byState = annot.context.lookup(ref, PDFDict).get(state ?? PDFName.of('Off'));
    ref = byState instanceof PDFRef ? byState : null;
  }
  if (!ref) return null;
  const stream = annot.context.lookup(ref);
  if (!(stream instanceof PDFStream)) return null;

  const rect = numbers(annot.lookupMaybe(PDFName.of('Rect'), PDFArray));
  const placement = rect ? appearancePlacement(stream, rect) : null;
  return placement ? { ref, placement } : null;
}

/**
 * The matrix mapping an appearance onto its annotation's /Rect, per PDF
 * 32000 §12.5.5: the stream's BBox, transformed by its own /Matrix, is scaled
 * and moved to fill the /Rect. (The /Matrix itself is applied by drawing the
 * stream as a form XObject.)
 */
function appearancePlacement(stream: PDFStreamT, rect: number[]): [number, number, number, number, number, number] | null {
  const bbox = numbers(stream.dict.lookupMaybe(PDFName.of('BBox'), PDFArray));
  if (!bbox) return null;
  const m = numbers(stream.dict.lookupMaybe(PDFName.of('Matrix'), PDFArray)) ?? [1, 0, 0, 1, 0, 0];
  const corners = [[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[0], bbox[3]], [bbox[2], bbox[3]]]
    .map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
  const tx0 = Math.min(...corners.map(c => c[0])), tx1 = Math.max(...corners.map(c => c[0]));
  const ty0 = Math.min(...corners.map(c => c[1])), ty1 = Math.max(...corners.map(c => c[1]));
  if (tx1 <= tx0 || ty1 <= ty0) return null;
  const x0 = Math.min(rect[0], rect[2]), x1 = Math.max(rect[0], rect[2]);
  const y0 = Math.min(rect[1], rect[3]), y1 = Math.max(rect[1], rect[3]);
  const sx = (x1 - x0) / (tx1 - tx0), sy = (y1 - y0) / (ty1 - ty0);
  return [sx, 0, 0, sy, x0 - tx0 * sx, y0 - ty0 * sy];
}

/** The numbers in a PDF array, or null if it is missing or holds anything else. */
function numbers(arr: import('pdf-lib').PDFArray | undefined): number[] | null {
  if (!arr) return null;
  const out: number[] = [];
  for (let i = 0; i < arr.size(); i++) {
    const n = arr.lookupMaybe(i, PDFNumber);
    if (!n) return null;
    out.push(n.asNumber());
  }
  return out;
}
