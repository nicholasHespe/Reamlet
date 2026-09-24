// Reamlet — print composition (vector print pipeline).
// SPDX-License-Identifier: GPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFNumber, StandardFonts, rgb } from 'pdf-lib';

import { buildPrintPdf, getBookletOrder } from '../out/renderer/print-compose.js';
import { embedAnnotations } from '../out/renderer/saver.js';
import {
  makePdf, fakeViewer, loadPdfJs, readDrawnText, readFilledRects, FONT_FILES,
} from './helpers/pdf-fixtures.mjs';

const A4 = [595.28, 841.89]; // pt, portrait

async function makeSource(numPages, size = A4) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < numPages; i++) {
    const page = doc.addPage(size);
    // A distinguishing vector mark per page so composited output is inspectable.
    page.drawRectangle({ x: 10, y: size[1] - 40, width: 20 + i * 5, height: 20, color: rgb(0, 0, 0) });
  }
  return doc.save();
}

function hasRasterImage(bytes) {
  return /\/Subtype\s*\/Image/.test(Buffer.from(bytes).toString('latin1'));
}

async function pageSizes(bytes) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map(p => [p.getWidth(), p.getHeight()]);
}

test('getBookletOrder pads to a multiple of 4 and pairs pages back-to-front', () => {
  assert.deepEqual(getBookletOrder(3), [{ front: [4, 1], back: [2, 3] }]);
  assert.deepEqual(getBookletOrder(5), [
    { front: [8, 1], back: [2, 7] },
    { front: [6, 3], back: [4, 5] },
  ]);
});

test('single page per sheet: one output page per selected source page, no rasterization', async () => {
  const src = await makeSource(3);
  const { bytes, mediaWpt, mediaHpt } = await buildPrintPdf(src, {
    totalPages: 3, pageRange: null, pps: 1, isBooklet: false, paperW: A4[0], paperH: A4[1],
  });
  const sizes = await pageSizes(bytes);
  assert.equal(sizes.length, 3);
  assert.equal(mediaWpt, A4[0]);
  assert.equal(mediaHpt, A4[1]);
  assert.ok(!hasRasterImage(bytes), 'print output should contain vector content only, no embedded raster image');
});

test('page range filters which source pages become output sheets', async () => {
  const src = await makeSource(5);
  const { bytes } = await buildPrintPdf(src, {
    totalPages: 5, pageRange: new Set([2, 4]), pps: 1, isBooklet: false, paperW: A4[0], paperH: A4[1],
  });
  const sizes = await pageSizes(bytes);
  assert.equal(sizes.length, 2);
});

test('2-up composites two source pages onto one sheet, padding the last with a blank slot', async () => {
  const src = await makeSource(3);
  const { bytes } = await buildPrintPdf(src, {
    totalPages: 3, pageRange: null, pps: 2, isBooklet: false, paperW: A4[0], paperH: A4[1],
  });
  const sizes = await pageSizes(bytes);
  assert.equal(sizes.length, 2); // ceil(3/2)
  assert.ok(!hasRasterImage(bytes));
});

test('booklet produces one sheet-side per output page (2 sides per physical sheet) and rotates onto portrait paper', async () => {
  const src = await makeSource(3);
  const { bytes, mediaWpt, mediaHpt } = await buildPrintPdf(src, {
    totalPages: 3, pageRange: null, pps: 1, isBooklet: true, paperW: A4[0], paperH: A4[1],
  });
  const sizes = await pageSizes(bytes);
  assert.equal(sizes.length, 2); // getBookletOrder(3) => 1 sheet => front+back
  // Booklet spreads are 2x the single-page width — always landscape — so
  // every output page should have been rotated onto portrait media.
  assert.ok(mediaWpt <= mediaHpt);
  for (const [w, h] of sizes) {
    assert.equal(w, mediaWpt);
    assert.equal(h, mediaHpt);
  }
  assert.ok(!hasRasterImage(bytes));
});

test('a sheet wider than tall (landscape orientation) is rotated onto portrait media', async () => {
  const src = await makeSource(1);
  const longSide = A4[1], shortSide = A4[0];
  const { bytes, mediaWpt, mediaHpt } = await buildPrintPdf(src, {
    totalPages: 1, pageRange: null, pps: 1, isBooklet: false, paperW: longSide, paperH: shortSide,
  });
  // Portrait paper stock: media is always the narrower x taller orientation.
  assert.equal(mediaWpt, shortSide);
  assert.equal(mediaHpt, longSide);
  const sizes = await pageSizes(bytes);
  assert.deepEqual(sizes[0], [shortSide, longSide]);
});

test('a sheet no wider than tall is left unrotated', async () => {
  const src = await makeSource(1);
  const { bytes, mediaWpt, mediaHpt } = await buildPrintPdf(src, {
    totalPages: 1, pageRange: null, pps: 1, isBooklet: false, paperW: A4[0], paperH: A4[1],
  });
  assert.equal(mediaWpt, A4[0]);
  assert.equal(mediaHpt, A4[1]);
  const sizes = await pageSizes(bytes);
  assert.deepEqual(sizes[0], [A4[0], A4[1]]);
});

// ── What reaches the printer ─────────────────────────────────
//
// The source pages are embedded with pdf-lib, which carries a page's content
// stream and nothing else; annotations, the CropBox and /Rotate all need
// handling for the printout to show what the viewer shows.

const EPS = 0.05;

/** Print `bytes` one page per sheet on paper `w` × `h` points. */
async function print(bytes, w, h) {
  const doc = await PDFDocument.load(bytes);
  return (await buildPrintPdf(bytes, {
    totalPages: doc.getPageCount(), pageRange: null, pps: 1, isBooklet: false, paperW: w, paperH: h,
  })).bytes;
}

/** Add a line of text to page 1's content at user-space point (x, y). */
async function withText(bytes, str, x, y) {
  const doc  = await PDFDocument.load(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.getPage(0).drawText(str, { x, y, size: 12, font });
  return doc.save();
}

const hex01 = (hex) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
const hasFill = (rects, hex) => rects.some(r => r.color && r.color.every((c, i) => Math.abs(c / 255 - hex01(hex)[i]) < 0.01));

async function annotatedSource() {
  const src = await withText(await makePdf({ media: [0, 0, 612, 792] }), 'Page body', 300, 400);
  return embedAnnotations(src, [
    { type: 'rect', pageNum: 1, x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.3, color: '#ff0000', thickness: 3, fillColor: '#3388ff' },
    { type: 'arrow', pageNum: 1, x1: 0.6, y1: 0.1, x2: 0.9, y2: 0.3, color: '#33bb55', thickness: 3, fillColor: null },
    { type: 'text', pageNum: 1, x: 0.15, y: 0.15, width: 0.4, text: 'Annotation text', color: '#000000',
      fontSize: 14, bold: false, underline: false, fillColor: null },
  ], await fakeViewer(src), FONT_FILES);
}

test('annotations saved on a page are printed, where they sit on the page', async () => {
  const src = await annotatedSource();
  const out = await print(src, 612, 792);

  const printedText = await readDrawnText(out);
  const note = printedText.find(t => t.str === 'Annotation text');
  assert.ok(note, `annotation text missing from the printout: ${JSON.stringify(printedText.map(t => t.str))}`);

  // Same paper as the page, so it prints at the same place: compare with
  // where the annotation's appearance puts it on the source page.
  const doc   = await PDFDocument.load(src);
  const annot = doc.getPage(0).node.Annots().lookup(2);
  const rect  = annot.lookup(PDFName.of('Rect')).asArray().map(n => n.asNumber());
  assert.ok(note.x >= rect[0] && note.x <= rect[2] && note.y >= rect[1] && note.y <= rect[3],
    `printed at (${note.x.toFixed(1)}, ${note.y.toFixed(1)}), outside its box [${rect.map(n => n.toFixed(1))}]`);

  const fills = await readFilledRects(out);
  assert.ok(hasFill(fills, '#3388ff'), 'the rectangle\'s fill is missing');
  assert.ok(printedText.some(t => t.str === 'Page body'), 'the page\'s own content is missing');
});

test('a filled form field prints its value', async () => {
  const doc  = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const field = doc.getForm().createTextField('name');
  field.addToPage(page, { x: 100, y: 690, width: 200, height: 24 });
  field.setText('Filled In Value');
  const out = await print(await doc.save(), 612, 792);
  assert.deepEqual((await readDrawnText(out)).map(t => t.str), ['Filled In Value']);
});

test('annotations flagged hidden, or not for printing, are left out', async () => {
  const src = await annotatedSource();
  const doc = await PDFDocument.load(src);
  const annots = doc.getPage(0).node.Annots();
  annots.lookup(0).set(PDFName.of('F'), PDFNumber.of(0));           // rect: not printable
  annots.lookup(2).set(PDFName.of('F'), PDFNumber.of(4 | 2));       // text: printable but hidden
  const out = await print(await doc.save(), 612, 792);
  assert.ok(!hasFill(await readFilledRects(out), '#3388ff'), 'a non-printing annotation was printed');
  assert.ok(!(await readDrawnText(out)).some(t => t.str === 'Annotation text'), 'a hidden annotation was printed');
});

test('a page with no content stream prints, with any annotations on it', async () => {
  const blank = await makePdf({ media: [0, 0, 612, 792] });
  assert.equal((await PDFDocument.load(await print(blank, 612, 792))).getPageCount(), 1);

  const annotated = await embedAnnotations(blank, [
    { type: 'text', pageNum: 1, x: 0.2, y: 0.2, width: 0.5, text: 'On a blank page', color: '#000000',
      fontSize: 14, bold: false, underline: false, fillColor: null },
  ], await fakeViewer(blank), FONT_FILES);
  assert.deepEqual((await readDrawnText(await print(annotated, 612, 792))).map(t => t.str), ['On a blank page']);
});

for (const rotate of [0, 90, 180, 270]) {
  test(`a page shown with /Rotate ${rotate} prints the way it is shown`, async () => {
    // Media laid out so every page shows portrait, then printed on portrait paper.
    const media = rotate % 180 === 0 ? [0, 0, 612, 792] : [0, 0, 792, 612];
    const src   = await withText(await makePdf({ media, rotate }), 'Mark', 150, 200);

    // Where a viewer shows the text, as a fraction of the shown page.
    const page = await (await loadPdfJs(src)).getPage(1);
    const vp   = page.getViewport({ scale: 1 });
    const [vx, vy] = vp.convertToViewportPoint(150, 200);
    const want = [vx / vp.width, vy / vp.height];

    const [mark] = await readDrawnText(await print(src, 612, 792));
    const got = [mark.x / 612, 1 - mark.y / 792];
    assert.ok(Math.abs(got[0] - want[0]) < EPS / 612 * 100 && Math.abs(got[1] - want[1]) < EPS / 792 * 100,
      `/Rotate ${rotate}: printed at [${got.map(n => n.toFixed(4))}], shown at [${want.map(n => n.toFixed(4))}]`);
  });
}

test('only the part of the page inside its CropBox is printed', async () => {
  const src = await withText(await makePdf({ media: [0, 0, 612, 792], crop: [100, 150, 400, 550] }), 'Inside', 120, 170);
  // Paper the size of the crop area: the visible area prints at full size, corner to corner.
  const out = await print(src, 300, 400);
  const [inside] = (await readDrawnText(out)).filter(t => t.str === 'Inside');
  assert.ok(Math.abs(inside.x - 20) < EPS && Math.abs(inside.y - 20) < EPS,
    `expected the crop's corner at the paper's corner, text at (20, 20), got (${inside.x}, ${inside.y})`);

  const doc = await PDFDocument.load(out);
  const forms = doc.context.enumerateIndirectObjects()
    .map(([, obj]) => obj)
    .filter(obj => obj.dict?.get(PDFName.of('Subtype'))?.toString() === '/Form');
  const bbox = forms[0].dict.lookup(PDFName.of('BBox')).asArray().map(n => n.asNumber());
  assert.deepEqual(bbox, [100, 150, 400, 550], 'the page should be clipped to its CropBox');
});
