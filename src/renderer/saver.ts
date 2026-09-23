// Reamlet — save logic
// Embeds in-memory annotations into PDF bytes using pdf-lib.
// SPDX-License-Identifier: GPL-3.0-or-later

// @ts-expect-error — pdf-lib is imported via direct path for Electron's file:// ESM loader
import * as _pdfLib from '../../node_modules/pdf-lib/dist/pdf-lib.esm.js';
// @ts-expect-error — fontkit's UMD build, imported by path for the same reason; see `fontkit` below
import * as _fontkitModule from '../../node_modules/@pdf-lib/fontkit/dist/fontkit.umd.min.js';
import type * as PDFLibNS from 'pdf-lib';
import type { Annotation, DrawAnnotation, HighlightAnnotation, TextAnnotation, ShapeAnnotation } from './types.js';
import type { PDFViewer } from './viewer.js';
import type { FontFiles } from './fonts.js';
import { toPdfCoords, displaySize, type PageBox } from './page-box.js';
import {
  TEXT_LINE_GAP, textBaselineOffset, textUnderlineThickness, textBlockHeight, wrapText,
} from './text-layout.js';

// Cast the direct-path runtime import to the pdf-lib type surface
const { PDFDocument, PDFName, PDFArray, PDFNumber, degrees, rgb } =
  _pdfLib as unknown as typeof PDFLibNS;

type PDFDoc  = import('pdf-lib').PDFDocument;
type PDFPage = import('pdf-lib').PDFPage;
type PDFFont = import('pdf-lib').PDFFont;
type Fontkit = Parameters<PDFDoc['registerFontkit']>[0];

// The ES build of fontkit imports 'pako' by bare name, which Electron's file://
// loader cannot resolve, so the self-contained UMD build is used instead. Under
// Node it loads as CommonJS and arrives as the default export; as a browser
// module it exports nothing and registers `globalThis.fontkit` instead.
const fontkit: Fontkit =
  (_fontkitModule as { default?: Fontkit }).default ?? (globalThis as { fontkit?: Fontkit }).fontkit!;

/** The faces a document's text annotations use, each embedded once and shared; null if unused. */
interface TextFonts { regular: PDFFont | null; bold: PDFFont | null }

/** Embed one face as a subset, so the saved file carries only the glyphs drawn with it. */
function embedFace(pdfDoc: PDFDoc, bytes: Uint8Array): Promise<PDFFont> {
  pdfDoc.registerFontkit(fontkit);
  return pdfDoc.embedFont(bytes, { subset: true });
}

/**
 * Embed annotations into a PDF and return the modified bytes.
 * Also writes any user-applied page rotations into the PDF's /Rotate entry.
 */
export async function embedAnnotations(
  pdfBytes: Uint8Array, annotations: Annotation[], viewer: PDFViewer, fontFiles: FontFiles,
): Promise<Uint8Array> {
  const pdfDoc: PDFDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });

  // Write any form field values the user has edited
  const fieldValues = viewer?.fieldValues;
  if (fieldValues && Object.keys(fieldValues).length > 0) {
    try {
      const form = pdfDoc.getForm();
      for (const [name, value] of Object.entries(fieldValues)) {
        try {
          form.getTextField(name).setText(value == null ? '' : String(value));
          continue;
        } catch { /* ignore */ }
        try {
          const cb = form.getCheckBox(name);
          if (value) { cb.check(); } else { cb.uncheck(); }
          continue;
        } catch { /* ignore */ }
        try {
          const dd = form.getDropdown(name);
          if (value) dd.select(String(value));
        } catch { /* ignore */ }
      }
    } catch { /* PDF has no AcroForm — ignore */ }
  }

  // Text is drawn into the page content stream (not left to a viewer-generated
  // annotation appearance), so the fonts must be embedded up front — only the
  // faces some text actually uses, so documents without text are left alone.
  const textAnns = annotations.filter((a): a is TextAnnotation => a.type === 'text');
  const textFonts: TextFonts = {
    regular: textAnns.some(a => !a.bold) ? await embedFace(pdfDoc, fontFiles.regular) : null,
    bold:    textAnns.some(a =>  a.bold) ? await embedFace(pdfDoc, fontFiles.bold)    : null,
  };

  for (let pageIdx = 0; pageIdx < pdfDoc.getPageCount(); pageIdx++) {
    const pageNum = pageIdx + 1;
    const pdfPage: PDFPage = pdfDoc.getPage(pageIdx);

    // Write user rotation into the PDF page's /Rotate entry
    const userRot = viewer.pageRotations?.[pageNum] || 0;
    if (userRot !== 0) {
      const existingRot = pdfPage.getRotation().angle;
      pdfPage.setRotation(degrees((existingRot + userRot) % 360));
    }

    const pageAnns = annotations.filter(a => a.pageNum === pageNum);
    if (pageAnns.length === 0) continue;

    const box      = await viewer.getPageBox(pageNum);
    const totalRot = viewer.getTotalRotation(pageNum);

    for (const ann of pageAnns) {
      if      (ann.type === 'draw')          _addInkAnnotation      (pdfPage, ann,           box, totalRot);
      else if (ann.type === 'freeHighlight') _addInkAnnotation      (pdfPage, ann,           box, totalRot);
      else if (ann.type === 'highlight')     _addHighlightAnnotation(pdfPage, ann,           box, totalRot);
      else if (ann.type === 'text')          _drawTextAnnotation    (pdfPage, ann,           box, totalRot, textFonts);
      else if (ann.type === 'line')          _addLineAnnotation     (pdfPage, ann,           box, totalRot);
      else if (ann.type === 'arrow')         _addArrowAnnotation    (pdfPage, ann,           box, totalRot);
      else if (ann.type === 'rect')          _addSquareAnnotation   (pdfPage, ann,           box, totalRot);
      else if (ann.type === 'oval')          _addCircleAnnotation   (pdfPage, ann,           box, totalRot);
    }
  }

  return pdfDoc.save();
}

// ── Coordinate helpers ───────────────────────────────────────

/**
 * The visible box of a pdf-lib page — the CropBox clipped to the MediaBox, with
 * either box's corners normalised in case they were written the other way round.
 */
function visibleBox(page: PDFPage): PageBox {
  const norm = (b: { x: number; y: number; width: number; height: number }) => ({
    x0: Math.min(b.x, b.x + b.width),
    y0: Math.min(b.y, b.y + b.height),
    x1: Math.max(b.x, b.x + b.width),
    y1: Math.max(b.y, b.y + b.height),
  });
  const media = norm(page.getMediaBox());
  const crop  = norm(page.getCropBox());
  const x0 = Math.max(media.x0, crop.x0), x1 = Math.min(media.x1, crop.x1);
  const y0 = Math.max(media.y0, crop.y0), y1 = Math.min(media.y1, crop.y1);
  // An empty intersection means the boxes disagree beyond repair; the MediaBox
  // is the one the spec guarantees, so fall back to it rather than to nothing.
  if (x1 <= x0 || y1 <= y0) {
    return { x: media.x0, y: media.y0, width: media.x1 - media.x0, height: media.y1 - media.y0 };
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return { r, g, b };
}

// ── Annotation writers ───────────────────────────────────────

function _addInkAnnotation(pdfPage: PDFPage, ann: DrawAnnotation, box: PageBox, rot: number): void {
  const { r, g, b } = hexToRgb01(ann.color);

  const inkPoints = ann.points.flatMap(([nx, ny]: [number, number]) => {
    const [x, y] = toPdfCoords(nx, ny, box, rot);
    return [PDFNumber.of(x), PDFNumber.of(y)];
  });
  const inkListEntry = pdfPage.doc.context.obj(inkPoints);
  const inkList      = pdfPage.doc.context.obj([inkListEntry]);

  const pdfPts = ann.points.map(([nx, ny]: [number, number]) => toPdfCoords(nx, ny, box, rot));
  const xs  = pdfPts.map(([x]: [number, number]) => x);
  const ys  = pdfPts.map(([, y]: [number, number]) => y);
  const pad = ann.thickness;

  const annotDict = pdfPage.doc.context.obj({
    Type:    PDFName.of('Annot'),
    Subtype: PDFName.of('Ink'),
    Rect:    [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad],
    InkList: inkList,
    BS:      pdfPage.doc.context.obj({ W: ann.thickness }),
    C:       [r, g, b],
    CA:      PDFNumber.of(ann.type === 'freeHighlight' ? 0.4 : 1),
    F:       PDFNumber.of(4),
  });

  _appendAnnotation(pdfPage, annotDict);
}

function _addHighlightAnnotation(pdfPage: PDFPage, ann: HighlightAnnotation, box: PageBox, rot: number): void {
  const { r, g, b } = hexToRgb01(ann.color);

  for (const rect of ann.rects) {
    // All four corners of the highlight rect in normalised coords
    const tl = toPdfCoords(rect.x,              rect.y,               box, rot);
    const tr = toPdfCoords(rect.x + rect.width, rect.y,               box, rot);
    const bl = toPdfCoords(rect.x,              rect.y + rect.height, box, rot);
    const br = toPdfCoords(rect.x + rect.width, rect.y + rect.height, box, rot);

    const allX = [tl[0], tr[0], bl[0], br[0]];
    const allY = [tl[1], tr[1], bl[1], br[1]];
    const x1 = Math.min(...allX), x2 = Math.max(...allX);
    const y1 = Math.min(...allY), y2 = Math.max(...allY);

    // QuadPoints: BL, BR, TL, TR in PDF space
    const qp = [x1, y1, x2, y1, x1, y2, x2, y2];

    const annotDict = pdfPage.doc.context.obj({
      Type:       PDFName.of('Annot'),
      Subtype:    PDFName.of('Highlight'),
      Rect:       [x1, y1, x2, y2],
      QuadPoints: qp,
      C:          [r, g, b],
      CA:         PDFNumber.of(0.4),
      F:          PDFNumber.of(4),
    });

    _appendAnnotation(pdfPage, annotDict);
  }
}

/**
 * Draw a text annotation into the page's content stream, one line at a time, at
 * exactly the baselines the canvas overlay used and wrapped to the same box
 * width (see text-layout.ts, which both sides share).
 *
 * This deliberately does not emit a FreeText annotation. A FreeText without an
 * appearance stream is laid out by whichever viewer opens the file — it gets
 * top-aligned inside its /Rect with viewer-chosen padding, wrapped to the /Rect
 * width, and rendered in the single font named by /DA. That is why saved text
 * used to land below and right of where it was placed, lost its bold and
 * underline, and wrapped once a line grew past the box. Drawing the glyphs
 * ourselves is what makes the saved file match the screen.
 */
function _drawTextAnnotation(pdfPage: PDFPage, ann: TextAnnotation, box: PageBox, rot: number, fonts: TextFonts): void {
  const { r, g, b } = hexToRgb01(ann.color);
  const color = rgb(r, g, b);
  const font  = (ann.bold ? fonts.bold : fonts.regular)!;
  const size  = ann.fontSize;

  const display = displaySize(box, rot);

  // Reflow inside the stored box width, using the embedded font's metrics.
  const lines = wrapText(ann.text, ann.width * display.width,
                         (s) => font.widthOfTextAtSize(s, size));

  if (ann.fillColor) {
    const { r: fr, g: fg, b: fb } = hexToRgb01(ann.fillColor);
    const blockHeight = textBlockHeight(lines.length, size);
    const [fx, fy] = toPdfCoords(ann.x, ann.y + blockHeight / display.height, box, rot);
    pdfPage.drawRectangle({
      x: fx, y: fy,
      width:  ann.width * display.width,
      height: blockHeight,
      color:  rgb(fr, fg, fb),
      rotate: degrees(rot),
    });
  }

  lines.forEach((line, i) => {
    if (!line) return;
    const baselineFromTop = textBaselineOffset(size, i);
    const [x, y] = toPdfCoords(ann.x, ann.y + baselineFromTop / display.height, box, rot);

    // A page displayed with /Rotate R turns its content R° clockwise, so the
    // text has to be turned R° counter-clockwise to come out upright.
    pdfPage.drawText(line, { x, y, size, font, color, rotate: degrees(rot) });

    if (ann.underline) {
      const thickness = textUnderlineThickness(size);
      const [ux, uy] = toPdfCoords(
        ann.x,
        ann.y + (baselineFromTop + TEXT_LINE_GAP + thickness) / display.height,
        box, rot,
      );
      pdfPage.drawRectangle({
        x: ux, y: uy,
        width:  font.widthOfTextAtSize(line, size),
        height: thickness,
        color,
        rotate: degrees(rot),
      });
    }
  });
}

function _addLineAnnotation(pdfPage: PDFPage, ann: ShapeAnnotation, box: PageBox, rot: number): void {
  const { r, g, b } = hexToRgb01(ann.color);
  const [x1, y1] = toPdfCoords(ann.x1, ann.y1, box, rot);
  const [x2, y2] = toPdfCoords(ann.x2, ann.y2, box, rot);
  const pad = ann.thickness;
  const annotDict = pdfPage.doc.context.obj({
    Type:    PDFName.of('Annot'),
    Subtype: PDFName.of('Line'),
    Rect:    [Math.min(x1,x2)-pad, Math.min(y1,y2)-pad, Math.max(x1,x2)+pad, Math.max(y1,y2)+pad],
    L:       [x1, y1, x2, y2],
    BS:      pdfPage.doc.context.obj({ W: ann.thickness }),
    C:       [r, g, b],
    F:       PDFNumber.of(4),
  });
  _appendAnnotation(pdfPage, annotDict);
}

function _addArrowAnnotation(pdfPage: PDFPage, ann: ShapeAnnotation, box: PageBox, rot: number): void {
  const { r, g, b } = hexToRgb01(ann.color);
  const [x1, y1] = toPdfCoords(ann.x1, ann.y1, box, rot);
  const [x2, y2] = toPdfCoords(ann.x2, ann.y2, box, rot);
  const pad = ann.thickness * 5;
  const annotDict = pdfPage.doc.context.obj({
    Type:    PDFName.of('Annot'),
    Subtype: PDFName.of('Line'),
    Rect:    [Math.min(x1,x2)-pad, Math.min(y1,y2)-pad, Math.max(x1,x2)+pad, Math.max(y1,y2)+pad],
    L:       [x1, y1, x2, y2],
    LE:      [PDFName.of('None'), PDFName.of('OpenArrow')],
    BS:      pdfPage.doc.context.obj({ W: ann.thickness }),
    C:       [r, g, b],
    F:       PDFNumber.of(4),
  });
  _appendAnnotation(pdfPage, annotDict);
}

function _addSquareAnnotation(pdfPage: PDFPage, ann: ShapeAnnotation, box: PageBox, rot: number): void {
  const { r, g, b } = hexToRgb01(ann.color);
  const [x1, y1] = toPdfCoords(ann.x1, ann.y1, box, rot);
  const [x2, y2] = toPdfCoords(ann.x2, ann.y2, box, rot);
  // A Square's border is drawn inside its /Rect, whereas the canvas centres the
  // stroke on the path — grow the rect by half the stroke so both line up.
  const pad = ann.thickness / 2;
  const fill = ann.fillColor ? hexToRgb01(ann.fillColor) : null;
  const annotDict = pdfPage.doc.context.obj({
    Type:    PDFName.of('Annot'),
    Subtype: PDFName.of('Square'),
    Rect:    [Math.min(x1,x2) - pad, Math.min(y1,y2) - pad, Math.max(x1,x2) + pad, Math.max(y1,y2) + pad],
    BS:      pdfPage.doc.context.obj({ W: ann.thickness }),
    C:       [r, g, b],
    ...(fill ? { IC: [fill.r, fill.g, fill.b] } : {}),
    F:       PDFNumber.of(4),
  });
  _appendAnnotation(pdfPage, annotDict);
}

function _addCircleAnnotation(pdfPage: PDFPage, ann: ShapeAnnotation, box: PageBox, rot: number): void {
  const { r, g, b } = hexToRgb01(ann.color);
  const [x1, y1] = toPdfCoords(ann.x1, ann.y1, box, rot);
  const [x2, y2] = toPdfCoords(ann.x2, ann.y2, box, rot);
  // As with Square: the ellipse border is inset into its /Rect, so pad it out.
  const pad = ann.thickness / 2;
  const fill = ann.fillColor ? hexToRgb01(ann.fillColor) : null;
  const annotDict = pdfPage.doc.context.obj({
    Type:    PDFName.of('Annot'),
    Subtype: PDFName.of('Circle'),
    Rect:    [Math.min(x1,x2) - pad, Math.min(y1,y2) - pad, Math.max(x1,x2) + pad, Math.max(y1,y2) + pad],
    BS:      pdfPage.doc.context.obj({ W: ann.thickness }),
    C:       [r, g, b],
    ...(fill ? { IC: [fill.r, fill.g, fill.b] } : {}),
    F:       PDFNumber.of(4),
  });
  _appendAnnotation(pdfPage, annotDict);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _appendAnnotation(pdfPage: PDFPage, annotDict: any): void {

  const ref    = pdfPage.doc.context.register(annotDict);
  const annots = pdfPage.node.get(PDFName.of('Annots'));
  if (annots instanceof PDFArray) {
    annots.push(ref);
  } else {

    pdfPage.node.set(PDFName.of('Annots'), pdfPage.doc.context.obj([ref]));
  }
}

// ── Footer ───────────────────────────────────────────────────

export interface FooterConfig {
  left:     string;
  center:   string;
  right:    string;
  fontSize: number;
}

/**
 * Draw a 3-column footer on every page and return the modified bytes.
 * Tokens {page} and {total} are replaced with the current page number and total.
 */
export async function embedFooter(pdfBytes: Uint8Array, config: FooterConfig, fontFiles: FontFiles): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const font   = await embedFace(pdfDoc, fontFiles.regular);
  const total  = pdfDoc.getPageCount();
  const black  = rgb(0, 0, 0);
  const margin = 40;
  const yPos   = 20;

  for (let i = 0; i < total; i++) {
    const page    = pdfDoc.getPage(i);
    const box     = visibleBox(page);
    const baseY   = box.y + yPos;
    const resolve = (t: string) =>
      t.replace(/\{page\}/g, String(i + 1)).replace(/\{total\}/g, String(total));

    const l = resolve(config.left);
    const c = resolve(config.center);
    const r = resolve(config.right);

    if (l) {
      page.drawText(l, { x: box.x + margin, y: baseY, size: config.fontSize, font, color: black });
    }
    if (c) {
      const tw = font.widthOfTextAtSize(c, config.fontSize);
      page.drawText(c, { x: box.x + (box.width - tw) / 2, y: baseY, size: config.fontSize, font, color: black });
    }
    if (r) {
      const tw = font.widthOfTextAtSize(r, config.fontSize);
      page.drawText(r, { x: box.x + box.width - margin - tw, y: baseY, size: config.fontSize, font, color: black });
    }
  }

  return pdfDoc.save();
}

// ── Watermark ────────────────────────────────────────────────

export interface WatermarkConfig {
  text:     string;
  fontSize: number;
  opacity:  number;  // 0.0–1.0
  angle:    number;  // degrees
}

/**
 * Draw a centred, rotated text watermark on every page and return the modified bytes.
 */
export async function embedWatermark(pdfBytes: Uint8Array, config: WatermarkConfig, fontFiles: FontFiles): Promise<Uint8Array> {
  const pdfDoc     = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const font       = await embedFace(pdfDoc, fontFiles.regular);
  const grey       = rgb(0.5, 0.5, 0.5);
  const angleRad   = (config.angle * Math.PI) / 180;
  const lines      = config.text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const lineHeight = config.fontSize * 1.3;

  for (let i = 0; i < pdfDoc.getPageCount(); i++) {
    const page = pdfDoc.getPage(i);
    const box  = visibleBox(page);

    lines.forEach((line, li) => {
      const textWidth  = font.widthOfTextAtSize(line, config.fontSize);
      // Perpendicular offset (CCW 90° from text direction) to space lines.
      // Positive perpOffset moves toward the visual top of the page; line 0 is topmost.
      const perpOffset = ((lines.length - 1) / 2 - li) * lineHeight;

      // Centre each line at page centre then offset perpendicularly
      const x = box.x + box.width / 2
        - (textWidth / 2)        * Math.cos(angleRad)
        + (config.fontSize / 2)  * Math.sin(angleRad)
        - perpOffset             * Math.sin(angleRad);
      const y = box.y + box.height / 2
        - (textWidth / 2)        * Math.sin(angleRad)
        - (config.fontSize / 2)  * Math.cos(angleRad)
        + perpOffset             * Math.cos(angleRad);

      page.drawText(line, {
        x,
        y,
        size:    config.fontSize,
        font,
        color:   grey,
        opacity: config.opacity,
        rotate:  degrees(config.angle),
      });
    });
  }

  return pdfDoc.save();
}
