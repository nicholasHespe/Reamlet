// Reamlet — keeping a flood of web-address requests from swamping the app (#108).
// SPDX-License-Identifier: GPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WebOpenGate, describeFailures,
  WEB_OPEN_LIMIT, WEB_OPEN_WINDOW_MS, WEB_OPEN_QUIET_MS,
} from '../out/web-opens.js';

const SECOND = 1000;

/** Offer `count` requests, one every `everyMs` from `start`; the outcome of each. */
function offer(gate, count, start = 0, everyMs = 100) {
  return Array.from({ length: count }, (_, i) => gate.admit(start + i * everyMs));
}

// ── Letting people through ───────────────────────────────────

test('the limits are generous enough for a person opening several links', () => {
  assert.ok(WEB_OPEN_LIMIT >= 10, 'a handful of PDFs from one page must not trip it');
  assert.ok(WEB_OPEN_WINDOW_MS >= 10 * SECOND);
});

test('requests up to the limit all get through', () => {
  const gate = new WebOpenGate(5, 30 * SECOND, 30 * SECOND);
  assert.deepEqual(offer(gate, 5), [true, true, true, true, true]);
  assert.equal(gate.takeSkipped(10 * 60 * SECOND), 0);
});

test('requests spread out over time never trip the limit', () => {
  const gate = new WebOpenGate(3, 30 * SECOND, 30 * SECOND);
  // One every 11 s: never more than three inside any 30 s.
  const results = offer(gate, 40, 0, 11 * SECOND);
  assert.ok(results.every(Boolean));
});

// ── Shutting out a flood ─────────────────────────────────────

test('requests past the limit are skipped', () => {
  const gate = new WebOpenGate(3, 30 * SECOND, 30 * SECOND);
  assert.deepEqual(offer(gate, 6), [true, true, true, false, false, false]);
});

test('a drip of requests stays shut out rather than getting the limit again each window', () => {
  const gate = new WebOpenGate(3, 30 * SECOND, 30 * SECOND);
  // Every 5 s for 10 minutes: the window would reopen after 30 s on its own,
  // but a request is always less than the quiet period behind the last.
  const results = offer(gate, 120, 0, 5 * SECOND);
  assert.equal(results.filter(Boolean).length, 3);
  assert.equal(gate.takeSkipped(119 * 5 * SECOND + 1), 0, 'still arriving, so not over');
});

test('requests are let through again once the flood has stopped', () => {
  const gate = new WebOpenGate(3, 30 * SECOND, 30 * SECOND);
  offer(gate, 10);                          // flood, last skipped at 0.9 s
  const later = 0.9 * SECOND + 30 * SECOND; // quiet for the full period
  assert.deepEqual(offer(gate, 4, later), [true, true, true, false]);
});

test('a request just short of the quiet period is still part of the flood', () => {
  const gate = new WebOpenGate(2, 30 * SECOND, 30 * SECOND);
  offer(gate, 5, 0, 0); // all at t=0
  assert.equal(gate.admit(30 * SECOND - 1), false);
});

// ── Reporting what was skipped ───────────────────────────────

test('skipped requests are counted once the flood goes quiet, then forgotten', () => {
  const gate = new WebOpenGate(3, 30 * SECOND, 30 * SECOND);
  offer(gate, 10, 0, 0); // 3 let through, 7 skipped
  assert.equal(gate.takeSkipped(5 * SECOND), 0, 'not over yet');
  assert.equal(gate.takeSkipped(30 * SECOND), 7);
  assert.equal(gate.takeSkipped(31 * SECOND), 0, 'reported only once');
});

test('the count is not cut short by asking while requests are still arriving', () => {
  const gate = new WebOpenGate(2, 30 * SECOND, 30 * SECOND);
  offer(gate, 4, 0, 0);                    // 2 skipped
  assert.equal(gate.takeSkipped(10 * SECOND), 0);
  offer(gate, 3, 20 * SECOND, 0);          // 3 more skipped, the flood goes on
  assert.equal(gate.takeSkipped(30 * SECOND), 0, 'quiet only counts from the last skipped request');
  assert.equal(gate.takeSkipped(50 * SECOND), 5);
});

test('a flood reported late is not lost when the next request arrives first', () => {
  const gate = new WebOpenGate(2, 30 * SECOND, 30 * SECOND);
  offer(gate, 5, 0, 0);                    // 3 skipped
  assert.equal(gate.admit(60 * SECOND), true, 'quiet long enough, so a new request opens');
  assert.equal(gate.takeSkipped(60 * SECOND), 3);
});

test('the default limits apply to a real flood', () => {
  const gate = new WebOpenGate();
  const results = offer(gate, 1000, 0, 50);
  assert.equal(results.filter(Boolean).length, WEB_OPEN_LIMIT);
  assert.equal(gate.takeSkipped(1000 * 50 + WEB_OPEN_QUIET_MS), 1000 - WEB_OPEN_LIMIT);
});

// ── Reporting failures together ──────────────────────────────

test('a single failure is reported as it always was', () => {
  assert.deepEqual(describeFailures(['HTTP 403']), {
    title: 'Reamlet — Could not open URL',
    message: 'HTTP 403',
  });
});

test('several failures become one report with each reason counted', () => {
  const { title, message } = describeFailures(['HTTP 403', 'HTTP 404', 'HTTP 403', 'HTTP 403']);
  assert.equal(title, 'Reamlet — Could not open 4 URLs');
  assert.equal(message, 'HTTP 403 (×3)\nHTTP 404 (×1)');
});

test('a long list of different reasons is cut short', () => {
  const reasons = Array.from({ length: 9 }, (_, i) => `getaddrinfo ENOTFOUND host${i}`);
  const lines = describeFailures(reasons).message.split('\n');
  assert.equal(lines.length, 6);
  assert.equal(lines[5], '…and 4 other reasons');
});
