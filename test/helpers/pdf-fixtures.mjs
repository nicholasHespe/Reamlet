// Reamlet — test helpers: synthetic PDFs, a stand-in viewer, and readers for
// pulling geometry back out of a saved file.
// SPDX-License-Identifier: GPL-3.0-or-later

import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const STANDARD_FONT_DATA_URL =
  fileURLToPath(new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url));

/** Build a single-page PDF with an explicit MediaBox / CropBox / Rotate. */
export async function makePdf({ media, crop, rotate }) {
  const doc  = await PDFDocument.create();
  const page = doc.addPage([Math.abs(media[2] - media[0]), Math.abs(media[3] - media[1])]);
  page.node.set(PDFName.of('MediaBox'), doc.context.obj(media));
  if (crop)   page.node.set(PDFName.of('CropBox'), doc.context.obj(crop));
  if (rotate) page.node.set(PDFName.of('Rotate'),  doc.context.obj(rotate));
  return doc.save();
}

export function loadPdfJs(bytes) {
  return pdfjs.getDocument({
    data: bytes.slice(),
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
  }).promise;
}

/**
 * A stand-in for PDFViewer exposing exactly the surface embedAnnotations() uses.
 * Page boxes come from the PDF.js viewport, the same source the real viewer uses.
 */
export async function fakeViewer(bytes, { userRotations = {} } = {}) {
  const doc   = await loadPdfJs(bytes);
  const boxes = {};
  const base  = {};
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const [x0, y0, x1, y1] = page.getViewport({ scale: 1, rotation: 0 }).viewBox;
    boxes[i] = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    base[i]  = page.rotate;
  }
  return {
    pageRotations:     { ...userRotations },
    pageBaseRotations: base,
    fieldValues:       {},
    getPageBox:        async (n) => boxes[n],
    getTotalRotation:  (n) => ((base[n] + (userRotations[n] || 0)) % 360 + 360) % 360,
  };
}

/**
 * Ground truth for "where does this on-screen point live in PDF user space?".
 *
 * PDF.js's own viewport transform is what draws the page, so inverting it with
 * convertToPdfPoint gives an answer derived from the renderer rather than from
 * the code under test.
 */
export async function oracle(bytes, pageNum, totalRot) {
  const doc  = await loadPdfJs(bytes);
  const page = await doc.getPage(pageNum);
  const vp   = page.getViewport({ scale: 1, rotation: totalRot });
  return {
    /** Normalised display coords (0–1, y-down) → [x, y] in PDF user space. */
    at: (nx, ny) => vp.convertToPdfPoint(nx * vp.width, ny * vp.height),
    displayWidth:  vp.width,
    displayHeight: vp.height,
  };
}

// ── Reading geometry back out of a saved file ────────────────

const nums = (arr) => arr.asArray().map(n => n.asNumber());

/** Every annotation dictionary on a page, as plain objects. */
export async function readAnnotations(bytes, pageIdx = 0) {
  const doc   = await PDFDocument.load(bytes);
  const page  = doc.getPage(pageIdx);
  const annots = page.node.Annots();
  if (!annots) return [];
  const out = [];
  for (let i = 0; i < annots.size(); i++) {
    const dict = annots.lookup(i);
    const get  = (k) => dict.get(PDFName.of(k));
    const inkList = get('InkList');
    out.push({
      subtype:    get('Subtype')?.asString?.().replace(/^\//, ''),
      rect:       get('Rect')       ? nums(get('Rect'))       : null,
      line:       get('L')          ? nums(get('L'))          : null,
      quadPoints: get('QuadPoints') ? nums(get('QuadPoints')) : null,
      inkList:    inkList ? inkList.asArray().map(e => nums(doc.context.lookup(e) ?? e)) : null,
      color:      get('C')  ? nums(get('C'))  : null,
      fillColor:  get('IC') ? nums(get('IC')) : null,
      lineEndings: get('LE') ? get('LE').asArray().map(n => n.asString().replace(/^\//, '')) : null,
      hasAppearance: !!get('AP'),
    });
  }
  return out;
}

/** Text drawn into the page content stream, with each run's baseline origin. */
export async function readDrawnText(bytes, pageNum = 1) {
  const doc  = await loadPdfJs(bytes);
  const page = await doc.getPage(pageNum);
  const tc   = await page.getTextContent();
  return tc.items
    .filter(it => it.str !== '')
    .map(it => ({ str: it.str, x: it.transform[4], y: it.transform[5], width: it.width }));
}

/**
 * Filled rectangles drawn straight into the page content stream (as opposed to
 * a native /Annot), e.g. a text annotation's background fill. pdf-lib builds
 * such a rectangle as an axis-aligned path of the given width/height at the
 * local origin, then rotates and positions it with a separate transform — so
 * the path's own bounding box stays `[0, 0, width, height]` regardless of page
 * rotation, which is what this reads back, tagged with the active fill colour.
 */
export async function readFilledRects(bytes, pageNum = 1) {
  const doc  = await loadPdfJs(bytes);
  const page = await doc.getPage(pageNum);
  const opList = await page.getOperatorList();
  const OPS = pdfjs.OPS;

  const rects = [];
  let fillColor = null;
  let pending   = null;
  for (let i = 0; i < opList.fnArray.length; i++) {
    const op   = opList.fnArray[i];
    const args = opList.argsArray[i];
    if (op === OPS.setFillRGBColor) {
      fillColor = [args[0], args[1], args[2]];
    } else if (op === OPS.constructPath) {
      const [minX, minY, maxX, maxY] = args[2];
      pending = { width: maxX - minX, height: maxY - minY };
    } else if (op === OPS.fill && pending) {
      rects.push({ color: fillColor, width: pending.width, height: pending.height });
      pending = null;
    }
  }
  return rects;
}

// Number of coordinates each path-construction operator consumes.
const PATH_ARG_COUNTS = {
  [pdfjs.OPS.moveTo]: 2, [pdfjs.OPS.lineTo]: 2, [pdfjs.OPS.curveTo]: 6,
  [pdfjs.OPS.curveTo2]: 4, [pdfjs.OPS.curveTo3]: 4, [pdfjs.OPS.closePath]: 0,
  [pdfjs.OPS.rectangle]: 4,
};
const PAINT_OPS = new Map(
  ['stroke', 'closeStroke', 'fill', 'eoFill', 'fillStroke', 'eoFillStroke',
   'closeFillStroke', 'closeEOFillStroke', 'endPath'].map(name => [pdfjs.OPS[name], name]),
);

/**
 * The paths each annotation's appearance paints, in the order PDF.js renders
 * them. Each annotation gives its /Rect and a list of paths; a path lists the
 * points its moveTo/lineTo operators visit, whether it was closed, and the
 * operator that painted it. Coordinates are in the appearance's own space,
 * which is page space for an appearance whose BBox is its /Rect.
 */
export async function readAnnotationPaths(bytes, pageNum = 1) {
  const page = await (await loadPdfJs(bytes)).getPage(pageNum);
  const { fnArray, argsArray } = await page.getOperatorList({ annotationMode: pdfjs.AnnotationMode.ENABLE });

  const annots = [];
  let current = null;
  let pending = null;
  for (let i = 0; i < fnArray.length; i++) {
    const op = fnArray[i], args = argsArray[i];
    if (op === pdfjs.OPS.beginAnnotation) {
      current = { rect: Array.from(args[1]), paths: [] };
      annots.push(current);
    } else if (op === pdfjs.OPS.endAnnotation) {
      current = null;
    } else if (current && op === pdfjs.OPS.constructPath) {
      const [ops, coords] = args;
      const points = [];
      let closed = false;
      let k = 0;
      for (const pathOp of ops) {
        if (pathOp === pdfjs.OPS.moveTo || pathOp === pdfjs.OPS.lineTo) points.push([coords[k], coords[k + 1]]);
        if (pathOp === pdfjs.OPS.closePath) closed = true;
        k += PATH_ARG_COUNTS[pathOp] ?? 0;
      }
      pending = { points, closed };
    } else if (current && pending && PAINT_OPS.has(op)) {
      current.paths.push({ ...pending, painted: PAINT_OPS.get(op) });
      pending = null;
    }
  }
  return annots;
}
