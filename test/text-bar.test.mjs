// Reamlet — the text bar's − / + buttons step through a fixed list of sizes.
// SPDX-License-Identifier: GPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';

import { stepFontSize } from '../out/renderer/text-bar.js';

test('+ and − move to the neighbouring size in the list', () => {
  assert.equal(stepFontSize(14, 1), 16);
  assert.equal(stepFontSize(14, -1), 12);
  assert.equal(stepFontSize(36, 1), 48);
});

test('a size between list entries steps to the nearest one in that direction', () => {
  assert.equal(stepFontSize(13, 1), 14);
  assert.equal(stepFontSize(13, -1), 12);
});

test('the ends of the list hold', () => {
  assert.equal(stepFontSize(8, -1), 8);
  assert.equal(stepFontSize(96, 1), 96);
});
