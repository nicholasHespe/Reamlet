// Reamlet — which printer to use for which page size.
// SPDX-License-Identifier: GPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeRules, findRule, MM_PER_POINT, SIZE_TOLERANCE_MM } from '../out/printer-rules.js';

const rule = (widthMm, heightMm, printer) => ({ widthMm, heightMm, printer });

const LABEL_4X6_IN = rule(101.6, 152.4, 'D530 Pro (LAN)');
const A4_PRINTER   = rule(210, 297, 'Downstairs');

// ── Which rule a page matches ────────────────────────────────

test('a page of exactly the rule\'s size matches it', () => {
  assert.equal(findRule([LABEL_4X6_IN], 101.6, 152.4), LABEL_4X6_IN);
});

test('a page matches whichever way up it is', () => {
  assert.equal(findRule([LABEL_4X6_IN], 152.4, 101.6), LABEL_4X6_IN);
});

test('the size of a 4 x 6 inch PDF page, in points, is a 4 x 6 inch rule', () => {
  assert.equal(findRule([LABEL_4X6_IN], 288 * MM_PER_POINT, 432 * MM_PER_POINT), LABEL_4X6_IN);
});

test('pages a little off the rule\'s size still match, as PDFs are rarely exact', () => {
  assert.equal(findRule([LABEL_4X6_IN], 101.6 + SIZE_TOLERANCE_MM, 152.4 - SIZE_TOLERANCE_MM), LABEL_4X6_IN);
  assert.equal(findRule([LABEL_4X6_IN], 101.6 + SIZE_TOLERANCE_MM + 0.1, 152.4), null);
});

test('a 100 x 150 mm label and a 4 x 6 inch label are the same label', () => {
  assert.equal(findRule([LABEL_4X6_IN], 100, 150), LABEL_4X6_IN);
});

test('but A6 is neither of them', () => {
  assert.equal(findRule([LABEL_4X6_IN], 105, 148), null);
});

test('a page of no rule\'s size matches nothing', () => {
  assert.equal(findRule([LABEL_4X6_IN, A4_PRINTER], 215.9, 279.4), null); // US Letter
  assert.equal(findRule([], 210, 297), null);
});

test('with several rules in reach, the closest wins whatever the order', () => {
  const near = rule(100, 150, 'Near');
  const far  = rule(102, 152, 'Far');
  assert.equal(findRule([far, near], 100.2, 150.2), near);
  assert.equal(findRule([near, far], 100.2, 150.2), near);
  assert.equal(findRule([near, far], 101.9, 151.9), far);
});

test('a size that isn\'t a number matches nothing', () => {
  for (const bad of [NaN, Infinity, undefined]) {
    assert.equal(findRule([LABEL_4X6_IN], bad, 152.4), null);
  }
});

// ── What is accepted as a rule ───────────────────────────────

test('rules are kept short side first and to a tenth of a millimetre', () => {
  assert.deepEqual(sanitizeRules([rule(152.4, 101.6, 'P'), rule(100.04, 150.06, 'Q')]), [
    rule(101.6, 152.4, 'P'),
    rule(100, 150.1, 'Q'),
  ]);
});

test('printer names are trimmed', () => {
  assert.deepEqual(sanitizeRules([rule(100, 150, '  D530 Pro  ')]), [rule(100, 150, 'D530 Pro')]);
});

test('two rules for one size keep the later: that is how one is changed', () => {
  assert.deepEqual(sanitizeRules([rule(100, 150, 'Old'), rule(150, 100, 'New')]), [rule(100, 150, 'New')]);
});

test('a bad rule is dropped without losing the good ones', () => {
  const good = rule(100, 150, 'P');
  const rules = sanitizeRules([
    good,
    null, 'x', 42, {},
    rule(NaN, 150, 'P'),
    rule(100, Infinity, 'P'),
    rule(5, 150, 'P'),            // too small to be a page
    rule(100, 9000, 'P'),         // too big to be a page
    rule(-100, 150, 'P'),
    rule(100, 150, ''),
    rule(100, 150, '   '),
    rule(100, 150, 'x'.repeat(300)),
    { widthMm: '100', heightMm: '150', printer: 'P' },
    { widthMm: 100, heightMm: 150, printer: 7 },
  ]);
  assert.deepEqual(rules, [good]);
});

test('anything that isn\'t a list of rules is no rules', () => {
  for (const bad of [undefined, null, 'rules', 7, {}, { 0: rule(100, 150, 'P') }]) {
    assert.deepEqual(sanitizeRules(bad), []);
  }
});

test('the list is capped, keeping the most recent', () => {
  const many = Array.from({ length: 150 }, (_, i) => rule(20 + i, 300, `P${i}`));
  const kept = sanitizeRules(many);
  assert.equal(kept.length, 100);
  assert.equal(kept.at(-1).printer, 'P149');
});
