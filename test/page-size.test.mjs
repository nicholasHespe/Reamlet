// Reamlet — page sizes as people write them and as PDFs hold them.
// SPDX-License-Identifier: GPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';

import { sizeOfPage, sizeFromInput, describeSize, sameSize, normalizeSize } from '../out/renderer/page-size.js';

test('a PDF page\'s size in points becomes millimetres, short side first', () => {
  assert.deepEqual(sizeOfPage(288, 432), { widthMm: 101.6, heightMm: 152.4 });   // 4 x 6 in
  assert.deepEqual(sizeOfPage(432, 288), { widthMm: 101.6, heightMm: 152.4 });   // turned round
  assert.deepEqual(sizeOfPage(595.28, 841.89), { widthMm: 210, heightMm: 297 }); // A4
});

test('a size can be typed in millimetres', () => {
  assert.deepEqual(sizeFromInput('100', '150', 'mm'), { widthMm: 100, heightMm: 150 });
  assert.deepEqual(sizeFromInput(' 150 ', ' 100 ', 'mm'), { widthMm: 100, heightMm: 150 });
});

test('or in inches', () => {
  assert.deepEqual(sizeFromInput('4', '6', 'in'), { widthMm: 101.6, heightMm: 152.4 });
  assert.deepEqual(sizeFromInput('8.5', '11', 'in'), { widthMm: 215.9, heightMm: 279.4 });
});

test('with a decimal comma, as many people type it', () => {
  assert.deepEqual(sizeFromInput('99,5', '148,5', 'mm'), { widthMm: 99.5, heightMm: 148.5 });
});

test('a size that isn\'t one says why not', () => {
  for (const [w, h] of [['', '150'], ['100', ''], ['abc', '150'], ['100', '1e999x'], ['  ', '  ']]) {
    assert.deepEqual(sizeFromInput(w, h, 'mm'), { error: 'Enter a width and a height.' }, `${w}|${h}`);
  }
});

test('and so does one too small or too large to be a page', () => {
  assert.match(sizeFromInput('2', '150', 'mm').error, /between 10 and 5000 mm/);
  assert.match(sizeFromInput('100', '6000', 'mm').error, /between 10 and 5000 mm/);
  assert.match(sizeFromInput('0.1', '6', 'in').error, /between 0\.4 and 196 inches/);
  assert.match(sizeFromInput('-4', '6', 'in').error, /between/);
});

test('the limits quoted are themselves accepted', () => {
  assert.ok(!('error' in sizeFromInput('0.4', '196', 'in')));
  assert.ok(!('error' in sizeFromInput('10', '5000', 'mm')));
});

test('a size is shown in both units', () => {
  assert.equal(describeSize({ widthMm: 101.6, heightMm: 152.4 }), '101.6 × 152.4 mm (4 × 6 in)');
  assert.equal(describeSize({ widthMm: 210, heightMm: 297 }), '210 × 297 mm (8.27 × 11.69 in)');
  assert.equal(describeSize({ widthMm: 100, heightMm: 150 }), '100 × 150 mm (3.94 × 5.91 in)');
});

test('sizes are the same when they agree to a tenth of a millimetre, whichever way up', () => {
  assert.equal(sameSize({ widthMm: 100, heightMm: 150 }, { widthMm: 150.04, heightMm: 99.96 }), true);
  assert.equal(sameSize({ widthMm: 100, heightMm: 150 }, { widthMm: 100, heightMm: 150.2 }), false);
});

test('normalising puts the short side first', () => {
  assert.deepEqual(normalizeSize(150, 100), { widthMm: 100, heightMm: 150 });
});
