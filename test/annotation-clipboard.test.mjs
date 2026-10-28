// Reamlet — the annotation clipboard: one for every tab and window, and where
// a paste puts what is on it.
// SPDX-License-Identifier: GPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  setClipboard, receiveClipboard, clipboardItems, clipboardHasItems, setClipboardListener, placeClipboard,
} from '../out/renderer/annotation-clipboard.js';

const A4 = [595, 842];
const A3 = [842, 1190];

const rect = (pageNum, x1, y1, x2, y2) => ({ type: 'rect', pageNum, x1, y1, x2, y2, color: '#f00', thickness: 2, fillColor: null });
const text = (pageNum, x, y, width) => ({
  type: 'text', pageNum, x, y, width, color: '#111', fontSize: 14, bold: false, underline: false, text: 'hi', fillColor: null,
});

const close = (actual, expected) => {
  for (const k of Object.keys(expected)) assert.ok(Math.abs(actual[k] - expected[k]) < 1e-9, `${k}: ${actual[k]} != ${expected[k]}`);
};

test('a copy is shared as JSON and can be received elsewhere', () => {
  let sent = null;
  setClipboardListener(json => { sent = json; });
  setClipboard([{ annotation: rect(1, 0.1, 0.1, 0.2, 0.2), pageSize: A4 }]);
  setClipboardListener(null);
  assert.equal(typeof sent, 'string');

  setClipboard([]);
  assert.equal(clipboardHasItems(), false);
  receiveClipboard(sent);
  assert.equal(clipboardHasItems(), true);
  assert.deepEqual(clipboardItems()[0].annotation, rect(1, 0.1, 0.1, 0.2, 0.2));
});

test('something that is not an annotation clipboard is ignored', () => {
  setClipboard([{ annotation: rect(1, 0.1, 0.1, 0.2, 0.2), pageSize: A4 }]);
  receiveClipboard('not json');
  receiveClipboard('{"a":1}');
  receiveClipboard('[1,2]');
  receiveClipboard(null);
  assert.equal(clipboardItems().length, 1);
});

test('the clipboard hands out copies, so a paste can\'t change it', () => {
  setClipboard([{ annotation: rect(1, 0.1, 0.1, 0.2, 0.2), pageSize: A4 }]);
  clipboardItems()[0].annotation.x1 = 0.9;
  assert.equal(clipboardItems()[0].annotation.x1, 0.1);
});

test('pasted at the cursor, the first one is centred there and the rest keep their places', () => {
  const items = [
    { annotation: rect(1, 0.1, 0.1, 0.3, 0.3), pageSize: A4 },
    { annotation: text(1, 0.5, 0.5, 0.2), pageSize: A4 },
  ];
  const [r, t] = placeClipboard(items, { pageNum: 2, at: [0.6, 0.6] }, 3, () => A4);
  close(r, { x1: 0.5, y1: 0.5, x2: 0.7, y2: 0.7 });
  close(t, { x: 0.9, y: 0.9, width: 0.2 });
  assert.equal(r.pageNum, 2);
  assert.equal(t.pageNum, 2);
});

test('pasted onto a bigger page, it keeps its size in points', () => {
  const items = [{ annotation: rect(1, 0.4, 0.4, 0.6, 0.6), pageSize: A4 }];
  const [r] = placeClipboard(items, { pageNum: 1, at: [0.5, 0.5] }, 1, () => A3);
  const wPt = (r.x2 - r.x1) * A3[0], hPt = (r.y2 - r.y1) * A3[1];
  assert.ok(Math.abs(wPt - 0.2 * A4[0]) < 1e-6);
  assert.ok(Math.abs(hPt - 0.2 * A4[1]) < 1e-6);
  close({ cx: (r.x1 + r.x2) / 2, cy: (r.y1 + r.y2) / 2 }, { cx: 0.5, cy: 0.5 });
});

test('a text box keeps its width in points too', () => {
  const [t] = placeClipboard([{ annotation: text(1, 0.1, 0.1, 0.4), pageSize: A4 }], { pageNum: 1, at: [0.2, 0.2] }, 1, () => A3);
  assert.ok(Math.abs(t.width * A3[0] - 0.4 * A4[0]) < 1e-6);
});

test('without a cursor, each stays on its page, nudged, and a page this document lacks becomes its last', () => {
  const items = [
    { annotation: rect(2, 0.1, 0.1, 0.2, 0.2), pageSize: A4 },
    { annotation: rect(9, 0.5, 0.5, 0.6, 0.6), pageSize: A4 },
  ];
  const [a, b] = placeClipboard(items, null, 3, () => A4);
  assert.equal(a.pageNum, 2);
  assert.equal(b.pageNum, 3);
  close(a, { x1: 0.13, y1: 0.13 });
  close(b, { x1: 0.53, y1: 0.53 });
});

test('with no page size to go on, nothing is rescaled', () => {
  const [r] = placeClipboard([{ annotation: rect(1, 0.4, 0.4, 0.6, 0.6), pageSize: null }], { pageNum: 1, at: [0.5, 0.5] }, 1, () => A3);
  close(r, { x1: 0.4, y1: 0.4, x2: 0.6, y2: 0.6 });
});

test('nothing to paste, or nowhere to paste it, places nothing', () => {
  assert.deepEqual(placeClipboard([], null, 3, () => A4), []);
  assert.deepEqual(placeClipboard([{ annotation: rect(1, 0, 0, 1, 1), pageSize: A4 }], null, 0, () => A4), []);
});
