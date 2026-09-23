// Reamlet — print composition (vector print pipeline).
// SPDX-License-Identifier: GPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, rgb } from 'pdf-lib';

import { buildPrintPdf, getBookletOrder } from '../out/renderer/print-compose.js';

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
