// Reamlet — printer preferences that apply to one print, not to the printer.
// SPDX-License-Identifier: GPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { isDevMode, fileJournal, PrinterDefaults } from '../out/printer-defaults.js';

// A DEVMODE the right shape: dmSize (220) and dmDriverExtra at their offsets in the header.
function devMode(tag, extra = 12) {
  const bytes = Buffer.alloc(220 + extra);
  bytes.writeUInt16LE(220, 68);
  bytes.writeUInt16LE(extra, 70);
  bytes.write(tag, 100, 'ascii');
  return bytes.toString('base64');
}

const LABELS = devMode('labels');
const PAPER  = devMode('paper');

/** A printer's defaults in memory, recording every call made to it. */
function fakeStore(initial, { failWrites = [] } = {}) {
  const store = {
    defaults: { Brother: initial },
    log: [],
    async read(printer) { store.log.push(`read ${printer}`); return store.defaults[printer]; },
    async write(printer, value) {
      store.log.push(`write ${printer} ${tagOf(value)}`);
      if (failWrites.includes(tagOf(value))) throw new Error(`cannot write ${tagOf(value)}`);
      store.defaults[printer] = value;
    },
  };
  return store;
}

const tagOf = (value) => Buffer.from(value, 'base64').toString('ascii', 100, 106).replace(/\0+$/, '');

function memoryJournal(initial = null) {
  const journal = {
    pending: initial,
    save(p) { journal.pending = p; },
    clear() { journal.pending = null; },
    load() { return journal.pending; },
  };
  return journal;
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'reamlet-printer-defaults-test-'));
}

// ── Recognising settings ─────────────────────────────────────

test('settings are recognised by their length matching what they declare', () => {
  assert.equal(isDevMode(PAPER), true);
  assert.equal(isDevMode(devMode('x', 0)), true);
  assert.equal(isDevMode(devMode('x', 3000)), true);
});

test('anything else is not settings', () => {
  const truncated = Buffer.from(PAPER, 'base64').subarray(0, 100).toString('base64');
  for (const bad of [null, undefined, 42, '', 'not base64!', truncated, 'AAAA']) {
    assert.equal(isDevMode(bad), false, String(bad));
  }
});

// ── Applying them for one print ──────────────────────────────

test('the chosen settings are the defaults only until released, then the printer\'s own return', async () => {
  const store = fakeStore(PAPER);
  const release = await new PrinterDefaults(store, memoryJournal()).acquire('Brother', LABELS);

  assert.equal(store.defaults.Brother, LABELS, 'in force while the print starts');
  await release();
  assert.equal(store.defaults.Brother, PAPER, 'gone for the next print');
  assert.deepEqual(store.log, ['read Brother', 'write Brother labels', 'write Brother paper']);
});

test('a print with no chosen settings leaves the printer alone', async () => {
  const store = fakeStore(PAPER);
  const release = await new PrinterDefaults(store, memoryJournal()).acquire('Brother', null);
  await release();
  assert.deepEqual(store.log, []);
});

test('releasing twice restores once', async () => {
  const store = fakeStore(PAPER);
  const release = await new PrinterDefaults(store, memoryJournal()).acquire('Brother', LABELS);
  await release();
  store.defaults.Brother = devMode('changed-by-someone-else');
  await release();
  assert.equal(tagOf(store.defaults.Brother), 'change', 'the second release must not overwrite later changes');
});

test('the settings to restore are kept on record while the printer holds others', async () => {
  const journal = memoryJournal();
  const release = await new PrinterDefaults(fakeStore(PAPER), journal).acquire('Brother', LABELS);
  assert.deepEqual(journal.pending, { printer: 'Brother', devMode: PAPER });
  await release();
  assert.equal(journal.pending, null);
});

test('a print waits for the one before it to let go of the defaults', async () => {
  const store = fakeStore(PAPER);
  const defaults = new PrinterDefaults(store, memoryJournal());

  const releaseFirst = await defaults.acquire('Brother', LABELS);
  let secondHasThem = false;
  const second = defaults.acquire('Brother', null).then(release => { secondHasThem = true; return release; });

  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(secondHasThem, false, 'must not start while the first still holds them');

  await releaseFirst();
  await second;
  assert.equal(secondHasThem, true);
  assert.equal(store.defaults.Brother, PAPER, 'and it starts from the printer\'s own settings, not the first print\'s');
});

// ── When something goes wrong ────────────────────────────────

test('if the chosen settings can\'t be applied the printer is left as it was, and the next print isn\'t blocked', async () => {
  const store = fakeStore(PAPER, { failWrites: ['labels'] });
  const journal = memoryJournal();
  const defaults = new PrinterDefaults(store, journal);

  await assert.rejects(defaults.acquire('Brother', LABELS), /cannot write labels/);
  assert.equal(store.defaults.Brother, PAPER);
  assert.equal(journal.pending, null);

  const release = await defaults.acquire('Brother', null);
  await release();
});

test('if the printer\'s own settings can\'t be put back, releasing still finishes and recover() does it later', async () => {
  const store = fakeStore(PAPER, { failWrites: ['paper'] });
  const journal = memoryJournal();
  const defaults = new PrinterDefaults(store, journal);

  const release = await defaults.acquire('Brother', LABELS);
  const quiet = console.error;
  console.error = () => {};
  try { await release(); } finally { console.error = quiet; }
  assert.deepEqual(journal.pending, { printer: 'Brother', devMode: PAPER }, 'kept for the next start');

  const next = await defaults.acquire('Brother', null);   // not blocked by the failure
  await next();

  const store2 = fakeStore(LABELS);                       // what the printer was left holding
  await new PrinterDefaults(store2, journal).recover();
  assert.equal(store2.defaults.Brother, PAPER);
  assert.equal(journal.pending, null);
});

test('recover() does nothing when the last run finished cleanly', async () => {
  const store = fakeStore(PAPER);
  await new PrinterDefaults(store, memoryJournal()).recover();
  assert.deepEqual(store.log, []);
});

// ── The record kept across runs ──────────────────────────────

test('the journal survives a restart and can be cleared', () => {
  const file = path.join(tempDir(), 'sub', 'pending.json');
  fileJournal(file).save({ printer: 'Brother', devMode: PAPER });

  assert.deepEqual(fileJournal(file).load(), { printer: 'Brother', devMode: PAPER });
  fileJournal(file).clear();
  assert.equal(fileJournal(file).load(), null);
  fileJournal(file).clear(); // clearing nothing is fine
});

test('a journal that isn\'t one is ignored rather than written to a printer', () => {
  const dir = tempDir();
  const file = path.join(dir, 'pending.json');
  for (const junk of ['', 'not json', '{}', JSON.stringify({ printer: 'Brother', devMode: 'AAAA' }),
                      JSON.stringify({ printer: 7, devMode: PAPER })]) {
    fs.writeFileSync(file, junk);
    assert.equal(fileJournal(file).load(), null, junk);
  }
  assert.equal(fileJournal(path.join(dir, 'missing.json')).load(), null);
});
