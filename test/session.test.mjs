// Reamlet — which tabs outlive the app, and the downloaded files kept for them.
// SPDX-License-Identifier: GPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  toWindowSession, readSession, writeSession, shouldRestore, afterUserClose,
  normalizePath, isInside, referencedFiles, adoptDownload, cleanupDownloads,
  safePdfName, pdfFileName, uniquePath, createUniqueFile,
} from '../out/session.js';

const DAY = 24 * 60 * 60 * 1000;

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'reamlet-session-test-'));
}

function touch(file, ageMs = 0, contents = '%PDF-1.7') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  const t = (Date.now() - ageMs) / 1000;
  fs.utimesSync(file, t, t);
  return file;
}

const tab = (filePath, sourceUrl = null) => ({ filePath, sourceUrl });
const abs = (name) => path.resolve('/docs', name);

// ── Validating what the renderer or a file hands over ────────

test('a window session keeps absolute file paths and their source URLs', () => {
  const ws = toWindowSession({
    tabs: [tab(abs('a.pdf')), tab(abs('b.pdf'), 'https://example.com/b.pdf')],
    activeIndex: 1,
  });
  assert.deepEqual(ws, {
    tabs: [tab(abs('a.pdf')), tab(abs('b.pdf'), 'https://example.com/b.pdf')],
    activeIndex: 1,
  });
});

test('entries that are not restorable files are dropped', () => {
  const ws = toWindowSession({
    tabs: [tab('Combined.pdf'), null, { filePath: 42 }, tab(abs('real.pdf')), 'junk'],
    activeIndex: 0,
  });
  assert.deepEqual(ws.tabs, [tab(abs('real.pdf'))]);
});

test('an active index that points nowhere becomes -1', () => {
  assert.equal(toWindowSession({ tabs: [tab(abs('a.pdf'))], activeIndex: 5 }).activeIndex, -1);
  assert.equal(toWindowSession({ tabs: [tab(abs('a.pdf'))], activeIndex: 'x' }).activeIndex, -1);
  assert.equal(toWindowSession({ tabs: [tab(abs('a.pdf'))] }).activeIndex, -1);
});

test('input that is not a window session is rejected', () => {
  for (const bad of [null, undefined, 'tabs', 3, {}, { tabs: 'x' }]) {
    assert.equal(toWindowSession(bad), null, JSON.stringify(bad));
  }
});

// ── Saving and loading ───────────────────────────────────────

test('a written session reads back the same', () => {
  const file = path.join(tempDir(), 'session.json');
  const session = { windows: [
    { tabs: [tab(abs('a.pdf')), tab(abs('b.pdf'))], activeIndex: 1 },
    { tabs: [tab(abs('c.pdf'), 'https://example.com/c.pdf')], activeIndex: 0 },
  ] };
  writeSession(file, session);
  assert.deepEqual(readSession(file), session);
  assert.equal(fs.existsSync(`${file}.tmp`), false, 'the temporary file should be renamed away');
});

test('a missing or damaged session file reads as an empty session', () => {
  const dir = tempDir();
  assert.deepEqual(readSession(path.join(dir, 'nope.json')), { windows: [] });
  fs.writeFileSync(path.join(dir, 'bad.json'), '{"windows": [ {"tabs": ');
  assert.deepEqual(readSession(path.join(dir, 'bad.json')), { windows: [] });
  fs.writeFileSync(path.join(dir, 'odd.json'), '{"windows": "no"}');
  assert.deepEqual(readSession(path.join(dir, 'odd.json')), { windows: [] });
});

test('windows left with no restorable tabs are not restored', () => {
  const file = path.join(tempDir(), 'session.json');
  fs.writeFileSync(file, JSON.stringify({ windows: [
    { tabs: [], activeIndex: -1 },
    { tabs: [tab('relative.pdf')], activeIndex: 0 },
    { tabs: [tab(abs('keep.pdf'))], activeIndex: 0 },
  ] }));
  assert.deepEqual(readSession(file).windows.map(w => w.tabs.length), [1]);
});

// ── Deciding what survives ───────────────────────────────────

test('a saved session is reopened when either setting asks for it', () => {
  const saved = { windows: [{ tabs: [tab(abs('a.pdf'))], activeIndex: 0 }] };
  assert.equal(shouldRestore({ restoreSession: true,  persistentTabs: false }, saved), true);
  assert.equal(shouldRestore({ restoreSession: false, persistentTabs: true  }, saved), true);
  assert.equal(shouldRestore({ restoreSession: false, persistentTabs: false }, saved), false);
  assert.equal(shouldRestore({ restoreSession: true,  persistentTabs: true  }, { windows: [] }), false);
});

test('closing one window of several forgets only that window', () => {
  const windows = new Map([
    [1, { tabs: [tab(abs('a.pdf'))], activeIndex: 0 }],
    [2, { tabs: [tab(abs('b.pdf'))], activeIndex: 0 }],
  ]);
  for (const persistentTabs of [false, true]) {
    const left = afterUserClose(windows, 1, { isLastWindow: false, persistentTabs });
    assert.deepEqual([...left.keys()], [2]);
  }
  assert.equal(windows.size, 2, 'the input map is not modified');
});

test('closing the last window keeps its tabs only with persistent tabs on', () => {
  const windows = new Map([[7, { tabs: [tab(abs('a.pdf'))], activeIndex: 0 }]]);
  assert.equal(afterUserClose(windows, 7, { isLastWindow: true, persistentTabs: false }).size, 0);
  assert.deepEqual(afterUserClose(windows, 7, { isLastWindow: true, persistentTabs: true }), windows);
});

// ── Downloaded files ─────────────────────────────────────────

test('paths compare regardless of spelling, and case on Windows', () => {
  assert.equal(normalizePath('/a/b/../c.pdf', 'linux'), path.resolve('/a/c.pdf'));
  assert.equal(normalizePath('/A/C.pdf', 'win32'), normalizePath('/a/c.PDF', 'win32'));
  assert.notEqual(normalizePath('/A/C.pdf', 'linux'), normalizePath('/a/c.pdf', 'linux'));
});

test('isInside tells a folder\'s files from its neighbours', () => {
  const dir = path.resolve('/tmp/ReamletDownloads');
  assert.equal(isInside(path.join(dir, 'x.pdf'), dir), true);
  assert.equal(isInside(path.join(dir, 'sub', 'x.pdf'), dir), true);
  assert.equal(isInside(dir, dir), false);
  assert.equal(isInside(path.resolve('/tmp/ReamletDownloadsOther/x.pdf'), dir), false);
  assert.equal(isInside(path.resolve('/tmp/x.pdf'), dir), false);
});

test('a download is moved out of the temp inbox into the downloads folder', () => {
  const root = tempDir();
  const inbox = path.join(root, 'inbox'), downloads = path.join(root, 'downloads');
  const src = touch(path.join(inbox, 'report.pdf'), 0, 'contents');

  const adopted = adoptDownload(src, inbox, downloads);
  assert.equal(adopted, path.join(downloads, 'report.pdf'));
  assert.equal(fs.readFileSync(adopted, 'utf8'), 'contents');
  assert.equal(fs.existsSync(src), false);
});

test('a download never overwrites one already kept', () => {
  const root = tempDir();
  const inbox = path.join(root, 'inbox'), downloads = path.join(root, 'downloads');
  touch(path.join(downloads, 'report.pdf'), 0, 'first');
  touch(path.join(downloads, 'report (2).pdf'), 0, 'second');
  const adopted = adoptDownload(touch(path.join(inbox, 'report.pdf'), 0, 'third'), inbox, downloads);
  assert.equal(adopted, path.join(downloads, 'report (3).pdf'));
  assert.equal(fs.readFileSync(path.join(downloads, 'report.pdf'), 'utf8'), 'first');
});

test('a download is named after the file the server sent', () => {
  const url = 'https://example.com/files/dl?id=7';
  assert.equal(pdfFileName('attachment; filename="Invoice 2024-05.pdf"', url), 'Invoice 2024-05.pdf');
  assert.equal(pdfFileName('inline; filename=plain.pdf', url), 'plain.pdf');
  assert.equal(
    pdfFileName(`attachment; filename="fallback.pdf"; filename*=UTF-8''R%C3%A9sum%C3%A9%20final.pdf`, url),
    'Résumé final.pdf',
  );
  assert.equal(pdfFileName(`attachment; filename*=UTF-8''%E0%A4%A`, url), 'dl.pdf');
});

test('without a server filename, a download is named after its URL', () => {
  assert.equal(pdfFileName(null, 'https://x.sharepoint.com/Shared%20Documents/Q3%20Report.pdf'), 'Q3 Report.pdf');
  assert.equal(pdfFileName(undefined, 'https://example.com/view?id=1'), 'view.pdf');
  assert.equal(pdfFileName('', 'https://example.com/'), 'download.pdf');
  assert.equal(pdfFileName(null, 'https://example.com/bad%E0.pdf'), 'bad%E0.pdf');
});

test('a download name is safe to save on Windows', () => {
  assert.equal(safePdfName('..\\..\\evil.pdf'), 'evil.pdf');
  assert.equal(safePdfName('a/b/../c.pdf'), 'c.pdf');
  assert.equal(safePdfName('what?:*<>|.pdf'), 'what______.pdf');
  assert.equal(safePdfName('CON.pdf'), '_CON.pdf');
  assert.equal(safePdfName('report'), 'report.pdf');
  assert.equal(safePdfName('Report.PDF'), 'Report.PDF');
  assert.equal(safePdfName('trailing. '), 'trailing.pdf');
  assert.equal(safePdfName(''), 'download.pdf');
  assert.ok(safePdfName('x'.repeat(300)).length <= 200);
});

test('a download never takes a name already used, numbering from (2)', () => {
  const dir = tempDir();
  assert.equal(uniquePath(dir, 'report.pdf'), path.join(dir, 'report.pdf'));
  const first = createUniqueFile(dir, 'report.pdf');
  const second = createUniqueFile(dir, 'report.pdf');
  const third = createUniqueFile(dir, 'report.pdf');
  assert.deepEqual([first, second, third].map(f => path.basename(f)), ['report.pdf', 'report (2).pdf', 'report (3).pdf']);
  assert.equal(uniquePath(dir, 'report.pdf'), path.join(dir, 'report (4).pdf'));
});

test('files outside the inbox, or that cannot be moved, keep their path', () => {
  const root = tempDir();
  const inbox = path.join(root, 'inbox'), downloads = path.join(root, 'downloads');
  const elsewhere = touch(path.join(root, 'mine.pdf'));
  assert.equal(adoptDownload(elsewhere, inbox, downloads), elsewhere);
  assert.ok(fs.existsSync(elsewhere));
  const gone = path.join(inbox, 'vanished.pdf');
  assert.equal(adoptDownload(gone, inbox, downloads), gone);
});

test('cleanup removes old downloads no tab needs, and keeps the rest', () => {
  const root = tempDir();
  const inbox = path.join(root, 'inbox'), downloads = path.join(root, 'downloads');
  const oldUnused   = touch(path.join(downloads, 'old-unused.pdf'), 8 * DAY);
  const oldInTab    = touch(path.join(downloads, 'old-in-tab.pdf'), 8 * DAY);
  const recent      = touch(path.join(downloads, 'recent.pdf'), 60 * 1000);
  const oldInInbox  = touch(path.join(inbox, 'stale.pdf'), 2 * DAY);

  const keep = referencedFiles(
    { windows: [{ tabs: [tab(oldInTab)], activeIndex: 0 }] },
    { windows: [] },
  );
  const removed = cleanupDownloads([inbox, downloads, path.join(root, 'missing')], keep, DAY);

  assert.deepEqual(removed.sort(), [oldInInbox, oldUnused].sort());
  assert.ok(fs.existsSync(oldInTab), 'a file a tab still needs is kept however old it is');
  assert.ok(fs.existsSync(recent), 'a recent download is kept');
});

test('files referenced by any of several sessions are all kept', () => {
  const keep = referencedFiles(
    { windows: [{ tabs: [tab(abs('open-now.pdf'))], activeIndex: 0 }] },
    { windows: [{ tabs: [tab(abs('saved.pdf'))], activeIndex: 0 },
                { tabs: [tab(abs('other-window.pdf'))], activeIndex: 0 }] },
  );
  for (const name of ['open-now.pdf', 'saved.pdf', 'other-window.pdf']) {
    assert.ok(keep.has(normalizePath(abs(name))), name);
  }
});
