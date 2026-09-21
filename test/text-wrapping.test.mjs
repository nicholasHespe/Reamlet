// Reamlet — a text annotation's box width is the user's to set, and the text
// reflows inside it. These check the wrapping itself and that a saved file gets
// the same lines the canvas overlay draws.
// SPDX-License-Identifier: GPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';

import { wrapText, textBlockHeight, TEXT_LINE_GAP } from '../out/renderer/text-layout.js';
import { embedAnnotations } from '../out/renderer/saver.js';
import { makePdf, fakeViewer, readDrawnText } from './helpers/pdf-fixtures.mjs';

// A monospace stand-in: every character is 10 wide, so line widths are countable.
const mono = (s) => s.length * 10;

test('text breaks at word boundaries to fit the box', () => {
  assert.deepEqual(
    wrapText('the quick brown fox jumps', 100, mono),
    ['the quick', 'brown fox', 'jumps'],
  );
});

test('a wider box takes more words per line', () => {
  assert.deepEqual(
    wrapText('the quick brown fox jumps', 200, mono),
    ['the quick brown fox', 'jumps'],
  );
});

test('newlines the user typed stay as hard breaks', () => {
  assert.deepEqual(
    wrapText('one two\nthree', 100, mono),
    ['one two', 'three'],
  );
  assert.deepEqual(wrapText('a\n\nb', 100, mono), ['a', '', 'b']);
});

test('a word too long for the box is split rather than left to overflow', () => {
  assert.deepEqual(
    wrapText('supercalifragilistic', 50, mono),
    ['super', 'calif', 'ragil', 'istic'],
  );
});

test('no line ever exceeds the box width', () => {
  const text = 'Reamlet is a lightweight standalone PDF viewer for Windows, and this ' +
               'sentence exists purely to be long enough to wrap several times over.';
  for (const width of [40, 75, 130, 260, 1000]) {
    for (const line of wrapText(text, width, mono)) {
      assert.ok(mono(line) <= width || line.length === 1,
        `width ${width}: "${line}" is ${mono(line)} wide`);
    }
  }
});

test('an empty box width falls back to one line instead of looping', () => {
  assert.deepEqual(wrapText('hello there', 0, mono), ['hello there']);
});

test('the box height follows the line count', () => {
  assert.equal(textBlockHeight(1, 14), 14 + TEXT_LINE_GAP);
  assert.equal(textBlockHeight(3, 14), 3 * (14 + TEXT_LINE_GAP));
  // An empty annotation still occupies one line's worth of box.
  assert.equal(textBlockHeight(0, 14), 14 + TEXT_LINE_GAP);
});

// ── End to end: what actually lands in the saved file ────────

const LONG = 'The quick brown fox jumps over the lazy dog again and again and again.';

async function saveText(overrides) {
  const src    = await makePdf({ media: [0, 0, 612, 792] });
  const viewer = await fakeViewer(src);
  const ann = {
    type: 'text', pageNum: 1, x: 0.1, y: 0.1, width: 0.3, text: LONG,
    color: '#000000', fontSize: 14, bold: false, underline: false,
    ...overrides,
  };
  return { out: await embedAnnotations(src, [ann], viewer), ann };
}

test('a long single-line annotation is wrapped in the saved file', async () => {
  const { out } = await saveText();
  const drawn = await readDrawnText(out);

  assert.ok(drawn.length > 1, `expected several lines, got ${drawn.length}`);
  assert.equal(drawn.map(d => d.str).join(' '), LONG);
});

test('every saved line fits the width the box was given', async () => {
  const { out } = await saveText();
  const drawn = await readDrawnText(out);
  const maxWidth = 0.3 * 612;
  for (const line of drawn) {
    assert.ok(line.width <= maxWidth + 0.01,
      `"${line.str}" is ${line.width.toFixed(1)}pt wide, box is ${maxWidth}pt`);
  }
});

test('saved lines stack down the page one line height apart', async () => {
  const { out } = await saveText();
  const drawn = await readDrawnText(out);
  const step = 14 + TEXT_LINE_GAP;

  for (let i = 1; i < drawn.length; i++) {
    assert.ok(Math.abs(drawn[i].x - drawn[0].x) < 0.01, 'lines share a left edge');
    assert.ok(Math.abs((drawn[i - 1].y - drawn[i].y) - step) < 0.01,
      `line ${i} is ${(drawn[i - 1].y - drawn[i].y).toFixed(2)}pt below the last, want ${step}`);
  }
});

test('narrowing the box reflows the same text into more lines', async () => {
  const wide   = await readDrawnText((await saveText({ width: 0.6 })).out);
  const narrow = await readDrawnText((await saveText({ width: 0.2 })).out);

  assert.ok(narrow.length > wide.length,
    `narrow box gave ${narrow.length} lines, wide gave ${wide.length}`);
  // Same text either way — only the break points move.
  assert.equal(narrow.map(d => d.str).join(' '), wide.map(d => d.str).join(' '));
});

test('a rotated page wraps against the width that is on screen', async () => {
  // On a quarter-turned page the displayed width is the page's height, so a box
  // of the same fraction is physically wider and fits more words per line.
  const src = await makePdf({ media: [0, 0, 612, 792], rotate: 90 });
  const ann = {
    type: 'text', pageNum: 1, x: 0.1, y: 0.1, width: 0.3, text: LONG,
    color: '#000000', fontSize: 14, bold: false, underline: false,
  };
  const out   = await embedAnnotations(src, [ann], await fakeViewer(src));
  const drawn = await readDrawnText(out);

  assert.equal(drawn.map(d => d.str).join(' '), LONG);
  for (const line of drawn) {
    assert.ok(line.width <= 0.3 * 792 + 0.01,
      `"${line.str}" is ${line.width.toFixed(1)}pt, box is ${0.3 * 792}pt`);
  }
});
