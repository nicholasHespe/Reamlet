// Reamlet — test helpers: synthetic PDFs, a stand-in viewer, and readers for
// pulling geometry back out of a saved file.
// SPDX-License-Identifier: GPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  PDFDocument, PDFName, PDFDict, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

import { FONT_FILE_NAMES } from '../../out/renderer/fonts.js';

const STANDARD_FONT_DATA_URL =
  fileURLToPath(new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url));

/** The bundled font files, as the app would fetch them from assets/fonts/. */
export const FONT_FILES = Object.fromEntries(
  Object.entries(FONT_FILE_NAMES).map(([face, name]) =>
    [face, readFileSync(new URL(`../../assets/fonts/${name}`, import.meta.url))]),
);

/** Embed a bundled face into `doc`, for measuring text the way the saver does. */
export async function embedBundledFont(doc, face = 'regular') {
  doc.registerFontkit(fontkit);
  return doc.embedFont(FONT_FILES[face], { subset: true });
}

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

/**
 * A copy of the document with every annotation's normal appearance stamped into
 * its page where a viewer paints it, and the annotations removed. Placement
 * follows PDF 32000 §12.5.5: the appearance's BBox, transformed by its Matrix,
 * is mapped onto the annotation's /Rect.
 */
export async function flattenAppearances(bytes) {
  const doc = await PDFDocument.load(bytes);
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      const dict   = annots.lookup(i, PDFDict);
      const apRef  = dict.lookupMaybe(PDFName.of('AP'), PDFDict)?.get(PDFName.of('N'));
      if (!apRef) continue;
      const stream = doc.context.lookup(apRef);
      const [bx0, by0, bx1, by1] = nums(stream.dict.lookup(PDFName.of('BBox')));
      const m = stream.dict.has(PDFName.of('Matrix')) ? nums(stream.dict.lookup(PDFName.of('Matrix'))) : [1, 0, 0, 1, 0, 0];
      const corners = [[bx0, by0], [bx1, by0], [bx0, by1], [bx1, by1]]
        .map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
      const tx0 = Math.min(...corners.map(c => c[0])), tx1 = Math.max(...corners.map(c => c[0]));
      const ty0 = Math.min(...corners.map(c => c[1])), ty1 = Math.max(...corners.map(c => c[1]));
      const [rx0, ry0, rx1, ry1] = nums(dict.lookup(PDFName.of('Rect')));
      const [x0, x1] = [Math.min(rx0, rx1), Math.max(rx0, rx1)];
      const [y0, y1] = [Math.min(ry0, ry1), Math.max(ry0, ry1)];
      const sx = (x1 - x0) / (tx1 - tx0), sy = (y1 - y0) / (ty1 - ty0);
      const name = page.node.newXObject('Ap', apRef);
      page.pushOperators(
        pushGraphicsState(),
        concatTransformationMatrix(sx, 0, 0, sy, x0 - tx0 * sx, y0 - ty0 * sy),
        drawObject(name),
        popGraphicsState(),
      );
    }
    page.node.delete(PDFName.of('Annots'));
  }
  return doc.save();
}

/** Text a viewer paints on the page, from page content and annotation appearances alike. */
export async function readPaintedText(bytes, pageNum = 1) {
  return readDrawnText(await flattenAppearances(bytes), pageNum);
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
