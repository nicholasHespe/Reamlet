// Reamlet — footers and watermarks are positioned from the page geometry too,
// so they drift off a cropped or offset page in exactly the same way.
// SPDX-License-Identifier: GPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';

import { embedFooter, embedWatermark } from '../out/renderer/saver.js';
import { makePdf, readDrawnText } from './helpers/pdf-fixtures.mjs';

const near = (a, b, eps = 0.5) => Math.abs(a - b) <= eps;

test('a footer sits inside the visible page, not the MediaBox origin', async () => {
  const src = await makePdf({ media: [20, 30, 632, 822] });
  const out = await embedFooter(src, { left: 'L', center: '', right: '', fontSize: 10 });

  const [drawn] = await readDrawnText(out);
  assert.equal(drawn.str, 'L');
  assert.ok(near(drawn.x, 20 + 40), `footer x: got ${drawn.x}, want 60`);
  assert.ok(near(drawn.y, 30 + 20), `footer y: got ${drawn.y}, want 50`);
});

test('a right-aligned footer measures against the cropped width', async () => {
  const src = await makePdf({ media: [0, 0, 612, 792], crop: [50, 60, 562, 732] });
  const out = await embedFooter(src, { left: '', center: '', right: 'R', fontSize: 10 });

  const [drawn] = await readDrawnText(out);
  // Right edge of the crop box, less the margin and the glyph width.
  assert.ok(near(drawn.x + drawn.width, 562 - 40), `footer right edge: got ${drawn.x + drawn.width}`);
  assert.ok(near(drawn.y, 60 + 20), `footer y: got ${drawn.y}`);
});

test('a watermark centres on the visible page', async () => {
  const src = await makePdf({ media: [0, 0, 612, 792], crop: [50, 60, 562, 732] });
  const out = await embedWatermark(src, { text: 'DRAFT', fontSize: 40, opacity: 0.3, angle: 0 });

  const [drawn] = await readDrawnText(out);
  assert.equal(drawn.str, 'DRAFT');
  assert.ok(near(drawn.x + drawn.width / 2, 50 + 512 / 2, 1), `watermark centre x: got ${drawn.x + drawn.width / 2}`);
  assert.ok(near(drawn.y + 40 / 2, 60 + 672 / 2, 1), `watermark centre y: got ${drawn.y}`);
});
