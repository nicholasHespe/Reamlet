// Reamlet — unit tests for the shared page-geometry helpers.
// SPDX-License-Identifier: GPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';

import { pageBoxFromViewBox, toPdfCoords, displayHeight } from '../out/renderer/page-box.js';
import { makePdf, loadPdfJs } from './helpers/pdf-fixtures.mjs';

test('a page box keeps the displayed region, corner included', () => {
  assert.deepEqual(pageBoxFromViewBox([0, 0, 612, 792]), { x: 0, y: 0, width: 612, height: 792 });
  assert.deepEqual(pageBoxFromViewBox([20, 30, 632, 822]), { x: 20, y: 30, width: 612, height: 792 });
});

test('a page box written corner-first still has positive dimensions', () => {
  assert.deepEqual(pageBoxFromViewBox([612, 792, 0, 0]), { x: 0, y: 0, width: 612, height: 792 });
});

test('PDF.js reports the displayed box, not the MediaBox, for a cropped page', async () => {
  const bytes = await makePdf({ media: [0, 0, 612, 792], crop: [50, 60, 562, 732] });
  const page  = await (await loadPdfJs(bytes)).getPage(1);
  const box   = pageBoxFromViewBox(page.getViewport({ scale: 1, rotation: 0 }).viewBox);
  assert.deepEqual(box, { x: 50, y: 60, width: 512, height: 672 });
});

test('a CropBox hanging outside the MediaBox is clipped to it', async () => {
  const bytes = await makePdf({ media: [0, 0, 612, 792], crop: [100, 100, 900, 900] });
  const page  = await (await loadPdfJs(bytes)).getPage(1);
  const box   = pageBoxFromViewBox(page.getViewport({ scale: 1, rotation: 0 }).viewBox);
  assert.deepEqual(box, { x: 100, y: 100, width: 512, height: 692 });
});

test('the four display corners map to the four corners of the box', () => {
  const box = { x: 20, y: 30, width: 600, height: 800 };
  assert.deepEqual(toPdfCoords(0, 0, box, 0),   [20, 830]);   // top-left → upper-left
  assert.deepEqual(toPdfCoords(1, 1, box, 0),   [620, 30]);   // bottom-right → lower-right
  assert.deepEqual(toPdfCoords(0, 0, box, 90),  [20, 30]);
  assert.deepEqual(toPdfCoords(0, 0, box, 180), [620, 30]);
  assert.deepEqual(toPdfCoords(0, 0, box, 270), [620, 830]);
});

test('quarter turns swap which side of the box a normalised y spans', () => {
  const box = { x: 0, y: 0, width: 600, height: 800 };
  assert.equal(displayHeight(box, 0), 800);
  assert.equal(displayHeight(box, 180), 800);
  assert.equal(displayHeight(box, 90), 600);
  assert.equal(displayHeight(box, 270), 600);
});
