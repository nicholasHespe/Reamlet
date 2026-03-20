// PDFox — save logic
// Embeds in-memory annotations into PDF bytes using pdf-lib.
// SPDX-License-Identifier: GPL-3.0-or-later

import { PDFDocument, PDFName, PDFArray, PDFDict, PDFNumber, PDFString, PDFHexString, rgb, degrees } from '../node_modules/pdf-lib/dist/pdf-lib.esm.js';

/**
 * Embed annotations into a PDF and return the modified bytes.
 *
 * @param {Uint8Array}  pdfBytes    - original PDF bytes
 * @param {Object[]}    annotations - flat annotation list from Annotator
 * @param {PDFViewer}   viewer      - to query unscaled page dimensions
 * @returns {Promise<Uint8Array>}
 */
export async function embedAnnotations(pdfBytes, annotations, viewer) {
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });

  for (let pageIdx = 0; pageIdx < pdfDoc.getPageCount(); pageIdx++) {
    const pageNum  = pageIdx + 1;
    const pageAnns = annotations.filter(a => a.pageNum === pageNum);
    if (pageAnns.length === 0) continue;

    const pdfPage  = pdfDoc.getPage(pageIdx);
    const { width: pdfW, height: pdfH } = await viewer.getPageSize(pageNum);

    for (const ann of pageAnns) {
      if      (ann.type === 'draw')      _addInkAnnotation      (pdfDoc, pdfPage, ann, pdfW, pdfH);
      else if (ann.type === 'highlight') _addHighlightAnnotation(pdfDoc, pdfPage, ann, pdfW, pdfH);
      else if (ann.type === 'text')      _addFreeTextAnnotation (pdfDoc, pdfPage, ann, pdfW, pdfH);
      else if (ann.type === 'line')      _addLineAnnotation     (pdfDoc, pdfPage, ann, pdfW, pdfH);
      else if (ann.type === 'arrow')     _addArrowAnnotation    (pdfDoc, pdfPage, ann, pdfW, pdfH);
      else if (ann.type === 'rect')      _addSquareAnnotation   (pdfDoc, pdfPage, ann, pdfW, pdfH);
      else if (ann.type === 'oval')      _addCircleAnnotation   (pdfDoc, pdfPage, ann, pdfW, pdfH);
    }
  }

  return pdfDoc.save();
}

// ── Helpers ──────────────────────────────────────────────────

// Convert normalised canvas coords (0–1, y-down) to PDF coords (pt, y-up)
function toPdfCoords(nx, ny, pdfW, pdfH) {
  return [nx * pdfW, (1 - ny) * pdfH];
}

function hexToRgb01(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return { r, g, b };
}

function _addInkAnnotation(pdfDoc, pdfPage, ann, pdfW, pdfH) {
  const { r, g, b } = hexToRgb01(ann.color);
  const context = pdfPage.doc;

  // Build InkList: array of arrays of alternating x,y numbers
  const inkPoints = ann.points.flatMap(([nx, ny]) => {
    const [x, y] = toPdfCoords(nx, ny, pdfW, pdfH);
    return [PDFNumber.of(x), PDFNumber.of(y)];
  });
  const inkListEntry = pdfPage.doc.context.obj(inkPoints);
  const inkList      = pdfPage.doc.context.obj([inkListEntry]);

  // Bounding box from extremes
  const xs = ann.points.map(([nx]) => nx * pdfW);
  const ys = ann.points.map(([, ny]) => (1 - ny) * pdfH);
  const pad = ann.thickness;
  const rect = [
    Math.min(...xs) - pad, Math.min(...ys) - pad,
    Math.max(...xs) + pad, Math.max(...ys) + pad,
  ];

  const annotDict = pdfPage.doc.context.obj({
    Type:     PDFName.of('Annot'),
    Subtype:  PDFName.of('Ink'),
    Rect:     rect,
    InkList:  inkList,
    BS:       pdfPage.doc.context.obj({ W: ann.thickness }),
    C:        [r, g, b],
    F:        PDFNumber.of(4), // print flag
  });

  _appendAnnotation(pdfPage, annotDict);
}

function _addHighlightAnnotation(pdfDoc, pdfPage, ann, pdfW, pdfH) {
  const { r, g, b } = hexToRgb01(ann.color);

  for (const rect of ann.rects) {
    const x1 = rect.x * pdfW;
    const y1 = (1 - (rect.y + rect.height)) * pdfH;
    const x2 = (rect.x + rect.width) * pdfW;
    const y2 = (1 - rect.y) * pdfH;

    // QuadPoints: four corners of the quad, bottom-left, bottom-right, top-left, top-right
    const qp = [x1, y1, x2, y1, x1, y2, x2, y2];

    const annotDict = pdfPage.doc.context.obj({
      Type:        PDFName.of('Annot'),
      Subtype:     PDFName.of('Highlight'),
      Rect:        [x1, y1, x2, y2],
      QuadPoints:  qp,
      C:           [r, g, b],
      CA:          PDFNumber.of(0.4), // opacity
      F:           PDFNumber.of(4),
    });

    _appendAnnotation(pdfPage, annotDict);
  }
}

function _addFreeTextAnnotation(pdfDoc, pdfPage, ann, pdfW, pdfH) {
  const { r, g, b } = hexToRgb01(ann.color);
  const [px, py] = toPdfCoords(ann.x, ann.y, pdfW, pdfH);
  const boxW = 200;
  const boxH = ann.fontSize * 2 + 4;

  const da = `${r.toFixed(2)} ${g.toFixed(2)} ${b.toFixed(2)} rg /Helvetica ${ann.fontSize} Tf`;

  const annotDict = pdfPage.doc.context.obj({
    Type:    PDFName.of('Annot'),
    Subtype: PDFName.of('FreeText'),
    Rect:    [px, py - boxH, px + boxW, py],
    Contents: PDFString.of(ann.text),
    DA:      PDFString.of(da),
    F:       PDFNumber.of(4),
  });

  _appendAnnotation(pdfPage, annotDict);
}

function _addLineAnnotation(pdfDoc, pdfPage, ann, pdfW, pdfH) {
  const { r, g, b } = hexToRgb01(ann.color);
  const [x1, y1] = toPdfCoords(ann.x1, ann.y1, pdfW, pdfH);
  const [x2, y2] = toPdfCoords(ann.x2, ann.y2, pdfW, pdfH);
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

function _addArrowAnnotation(pdfDoc, pdfPage, ann, pdfW, pdfH) {
  const { r, g, b } = hexToRgb01(ann.color);
  const [x1, y1] = toPdfCoords(ann.x1, ann.y1, pdfW, pdfH);
  const [x2, y2] = toPdfCoords(ann.x2, ann.y2, pdfW, pdfH);
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

function _addSquareAnnotation(pdfDoc, pdfPage, ann, pdfW, pdfH) {
  const { r, g, b } = hexToRgb01(ann.color);
  // Normalised y-down → PDF y-up: flip both corners
  const x1 = ann.x1 * pdfW, x2 = ann.x2 * pdfW;
  const y1 = (1 - ann.y2) * pdfH, y2 = (1 - ann.y1) * pdfH;
  const annotDict = pdfPage.doc.context.obj({
    Type:    PDFName.of('Annot'),
    Subtype: PDFName.of('Square'),
    Rect:    [Math.min(x1,x2), Math.min(y1,y2), Math.max(x1,x2), Math.max(y1,y2)],
    BS:      pdfPage.doc.context.obj({ W: ann.thickness }),
    C:       [r, g, b],
    F:       PDFNumber.of(4),
  });
  _appendAnnotation(pdfPage, annotDict);
}

function _addCircleAnnotation(pdfDoc, pdfPage, ann, pdfW, pdfH) {
  const { r, g, b } = hexToRgb01(ann.color);
  const x1 = ann.x1 * pdfW, x2 = ann.x2 * pdfW;
  const y1 = (1 - ann.y2) * pdfH, y2 = (1 - ann.y1) * pdfH;
  const annotDict = pdfPage.doc.context.obj({
    Type:    PDFName.of('Annot'),
    Subtype: PDFName.of('Circle'),
    Rect:    [Math.min(x1,x2), Math.min(y1,y2), Math.max(x1,x2), Math.max(y1,y2)],
    BS:      pdfPage.doc.context.obj({ W: ann.thickness }),
    C:       [r, g, b],
    F:       PDFNumber.of(4),
  });
  _appendAnnotation(pdfPage, annotDict);
}

// Append an annotation dict ref to the page's /Annots array
function _appendAnnotation(pdfPage, annotDict) {
  const ref = pdfPage.doc.context.register(annotDict);
  const annots = pdfPage.node.get(PDFName.of('Annots'));
  if (annots instanceof PDFArray) {
    annots.push(ref);
  } else {
    pdfPage.node.set(PDFName.of('Annots'), pdfPage.doc.context.obj([ref]));
  }
}
