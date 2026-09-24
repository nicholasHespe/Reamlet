// Reamlet — fill colour for rect/oval/text annotations.
// SPDX-License-Identifier: GPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';

import { embedAnnotations } from '../out/renderer/saver.js';
import { textBlockHeight, wrapText } from '../out/renderer/text-layout.js';
import { displaySize } from '../out/renderer/page-box.js';
import {
  makePdf, fakeViewer, readAnnotations, readFilledRects, embedBundledFont, FONT_FILES,
} from './helpers/pdf-fixtures.mjs';

const hexTo255 = (hex) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const hexTo01  = (hex) => hexTo255(hex).map(n => n / 255);

const near255 = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 1); // rounding
const near    = (a, b, eps = 0.02) => Math.abs(a - b) <= eps;

async function save(bytes, annotations) {
  const viewer = await fakeViewer(bytes);
  return embedAnnotations(bytes, annotations, viewer, FONT_FILES);
}

const ROTATIONS = [0, 90, 180, 270];

// ── Rect / oval fill → native /IC ────────────────────────────

for (const rotate of ROTATIONS) {
  test(`a filled rectangle writes an /IC matching its fill colour — /Rotate ${rotate}`, async () => {
    const src = await makePdf({ media: [0, 0, 612, 792], rotate });
    const ann = { type: 'rect', pageNum: 1, x1: 0.2, y1: 0.2, x2: 0.7, y2: 0.6,
                  color: '#000000', thickness: 2, fillColor: '#3388ff' };
    const out = await save(src, [ann]);
    const [saved] = await readAnnotations(out);
    assert.equal(saved.subtype, 'Square');
    assert.ok(saved.fillColor, 'expected an /IC entry');
    saved.fillColor.forEach((c, i) => assert.ok(near(c, hexTo01('#3388ff')[i]), `IC[${i}]`));
  });

  test(`an unfilled rectangle writes no /IC — /Rotate ${rotate}`, async () => {
    const src = await makePdf({ media: [0, 0, 612, 792], rotate });
    const ann = { type: 'rect', pageNum: 1, x1: 0.2, y1: 0.2, x2: 0.7, y2: 0.6,
                  color: '#000000', thickness: 2, fillColor: null };
    const out = await save(src, [ann]);
    const [saved] = await readAnnotations(out);
    assert.equal(saved.fillColor, null);
  });

  test(`a filled oval writes an /IC matching its fill colour — /Rotate ${rotate}`, async () => {
    const src = await makePdf({ media: [0, 0, 612, 792], rotate });
    const ann = { type: 'oval', pageNum: 1, x1: 0.2, y1: 0.2, x2: 0.7, y2: 0.6,
                  color: '#000000', thickness: 2, fillColor: '#33bb55' };
    const out = await save(src, [ann]);
    const [saved] = await readAnnotations(out);
    assert.equal(saved.subtype, 'Circle');
    saved.fillColor.forEach((c, i) => assert.ok(near(c, hexTo01('#33bb55')[i]), `IC[${i}]`));
  });

  test(`a line ignores fillColor — /Rotate ${rotate}`, async () => {
    // Lines and arrows have no interior to fill; a stray fillColor must not
    // produce an /IC entry a viewer could misapply.
    const src = await makePdf({ media: [0, 0, 612, 792], rotate });
    const ann = { type: 'line', pageNum: 1, x1: 0.2, y1: 0.2, x2: 0.7, y2: 0.6,
                  color: '#000000', thickness: 2, fillColor: '#33bb55' };
    const out = await save(src, [ann]);
    const [saved] = await readAnnotations(out);
    assert.equal(saved.subtype, 'Line');
    assert.equal(saved.fillColor, null);
  });
}

// ── Text background fill ──────────────────────────────────────
//
// pdf-lib draws a rotated/positioned rectangle as an axis-aligned path of the
// requested width/height, then applies rotation and translation as a separate
// transform — so the path's own bounding box is `[0, 0, width, height]] at
// every page rotation. readFilledRects() reads exactly that, which is what
// makes these checks rotation-agnostic without decoding a transform matrix.

for (const rotate of ROTATIONS) {
  test(`a filled text box draws one background rect, sized to the box — /Rotate ${rotate}`, async () => {
    const src      = await makePdf({ media: [0, 0, 612, 792], rotate });
    const fontSize = 14;
    const ann = { type: 'text', pageNum: 1, x: 0.1, y: 0.1, width: 0.3,
                  text: 'one two three four five six seven eight nine ten',
                  color: '#000000', fontSize, bold: false, underline: false,
                  fillColor: '#f5c518' };
    const out = await save(src, [ann]);

    const rects     = await readFilledRects(out, 1);
    const fillRects = rects.filter(r => near255(r.color, hexTo255('#f5c518')));
    assert.equal(fillRects.length, 1, `expected exactly one fill rect, got ${JSON.stringify(rects)}`);

    const display = displaySize({ x: 0, y: 0, width: 612, height: 792 }, rotate);
    assert.ok(near(fillRects[0].width, ann.width * display.width, 0.5),
      `fill width: got ${fillRects[0].width}, want ~${ann.width * display.width}`);
  });

  test(`text with no fillColor draws no background rect — /Rotate ${rotate}`, async () => {
    const src = await makePdf({ media: [0, 0, 612, 792], rotate });
    const ann = { type: 'text', pageNum: 1, x: 0.1, y: 0.1, width: 0.3, text: 'plain text',
                  color: '#000000', fontSize: 14, bold: false, underline: false, fillColor: null };
    const out   = await save(src, [ann]);
    const rects = await readFilledRects(out, 1);
    assert.equal(rects.length, 0, `expected no filled rects, got ${JSON.stringify(rects)}`);
  });
}

test('a narrower box wraps to more lines, so its fill box is taller', async () => {
  const src      = await makePdf({ media: [0, 0, 612, 792] });
  const fontSize = 14;
  const longText = 'The quick brown fox jumps over the lazy dog again and again and again.';

  const wide   = { type: 'text', pageNum: 1, x: 0.1, y: 0.1, width: 0.6, text: longText,
                   color: '#000000', fontSize, bold: false, underline: false, fillColor: '#ff0000' };
  const narrow = { ...wide, width: 0.2 };

  const [wideRect]   = await readFilledRects(await save(src, [wide]), 1);
  const [narrowRect] = await readFilledRects(await save(src, [narrow]), 1);

  assert.ok(narrowRect.height > wideRect.height,
    `narrow height ${narrowRect.height} should exceed wide height ${wideRect.height}`);
});

test('the fill box height matches textBlockHeight exactly, for the wrapping the saver itself computed', async () => {
  const src      = await makePdf({ media: [0, 0, 612, 792] });
  const fontSize = 14;
  const ann = { type: 'text', pageNum: 1, x: 0.1, y: 0.1, width: 0.15,
                text: 'a b c d e f g h i j k l m n o p',
                color: '#000000', fontSize, bold: false, underline: false, fillColor: '#00ff00' };
  const out = await save(src, [ann]);
  const [rect] = await readFilledRects(out, 1);

  // Recomputed with the real embedded font's metrics, the same way the saver
  // wraps this text, so the expected line count isn't a guess.
  const doc  = await PDFDocument.load(out);
  const font = await embedBundledFont(doc);
  const lines = wrapText(ann.text, ann.width * 612, (s) => font.widthOfTextAtSize(s, fontSize));

  assert.ok(lines.length > 1, 'fixture should actually wrap to more than one line');
  assert.ok(near(rect.height, textBlockHeight(lines.length, fontSize), 0.5));
});
