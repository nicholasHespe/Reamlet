// Reamlet — text saved into a PDF is drawn in the bundled Liberation Sans, so
// characters outside the PDF standard fonts' WinAnsi set save intact.
// SPDX-License-Identifier: GPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFDict, PDFStream } from 'pdf-lib';

import { embedAnnotations, embedFooter, embedWatermark } from '../out/renderer/saver.js';
import { makePdf, fakeViewer, readAnnotations, readDrawnText, FONT_FILES } from './helpers/pdf-fixtures.mjs';

const GREEK_AND_MATH = 'φ = 2π·r, Δx ≤ 5 → ∑ √∞ Ω ± °';

function textAnn(text, overrides = {}) {
  return {
    type: 'text', pageNum: 1, x: 0.1, y: 0.1, width: 0.8, text,
    color: '#000000', fontSize: 14, bold: false, underline: false, fillColor: null,
    ...overrides,
  };
}

async function save(annotations) {
  const src = await makePdf({ media: [0, 0, 612, 792] });
  return embedAnnotations(src, annotations, await fakeViewer(src), FONT_FILES);
}

/** Every embedded TrueType font program in the document. */
async function embeddedFontPrograms(bytes) {
  const doc = await PDFDocument.load(bytes);
  return doc.context.enumerateIndirectObjects()
    .map(([, obj]) => obj)
    .filter(obj => obj instanceof PDFDict && obj.get(PDFName.of('Type'))?.toString() === '/FontDescriptor')
    .map(desc => doc.context.lookup(desc.get(PDFName.of('FontFile2'))))
    .filter(stream => stream instanceof PDFStream);
}

test('Greek letters and math symbols save and read back unchanged', async () => {
  const out   = await save([textAnn(GREEK_AND_MATH)]);
  const drawn = await readDrawnText(out);
  assert.equal(drawn.map(d => d.str).join(''), GREEK_AND_MATH);
});

test('bold text with non-Latin characters saves too', async () => {
  const text  = 'Ψ ≠ ψ — Привет';
  const out   = await save([textAnn(text, { bold: true })]);
  const drawn = await readDrawnText(out);
  assert.equal(drawn.map(d => d.str).join(''), text);
});

test('a symbol in one annotation does not stop the rest of the document saving', async () => {
  const out = await save([
    textAnn('φ'),
    { type: 'rect', pageNum: 1, x1: 0.2, y1: 0.4, x2: 0.6, y2: 0.6,
      color: '#ff0000', thickness: 2, fillColor: null },
    textAnn('plain', { y: 0.8 }),
  ]);
  const drawn = await readDrawnText(out);
  assert.deepEqual(drawn.map(d => d.str).sort(), ['plain', 'φ']);
  assert.equal((await readAnnotations(out)).length, 1);
});

test('a character the font has no glyph for still saves the text around it', async () => {
  const out   = await save([textAnn('before 日本 after')]);
  const drawn = await readDrawnText(out);
  const text  = drawn.map(d => d.str).join('');
  assert.ok(text.startsWith('before') && text.endsWith('after'), `got "${text}"`);
});

test('non-Latin text wraps to the box using the embedded font', async () => {
  const text  = 'αβγδε ζηθικ λμνξο πρστυ φχψω ΑΒΓΔΕ ΖΗΘΙΚ ΛΜΝΞΟ';
  const width = 0.25;
  const out   = await save([textAnn(text, { width })]);
  const drawn = await readDrawnText(out);

  assert.ok(drawn.length > 1, `expected the text to wrap, got ${drawn.length} line(s)`);
  assert.equal(drawn.map(d => d.str).join(' '), text);
  for (const line of drawn) {
    assert.ok(line.width <= width * 612 + 0.01, `"${line.str}" is ${line.width.toFixed(1)}pt wide`);
  }
});

test('only the glyphs used are embedded, not the whole font', async () => {
  const out = await save([textAnn(GREEK_AND_MATH)]);
  const [program] = await embeddedFontPrograms(out);
  assert.ok(program, 'expected an embedded font program');
  assert.ok(program.getContents().length < FONT_FILES.regular.length / 4,
    `embedded font is ${program.getContents().length} bytes; the full face is ${FONT_FILES.regular.length}`);
});

test('only the faces some text uses are embedded', async () => {
  assert.equal((await embeddedFontPrograms(await save([textAnn('regular only')]))).length, 1);
  assert.equal((await embeddedFontPrograms(await save([textAnn('both'), textAnn('faces', { bold: true, y: 0.5 })]))).length, 2);
  assert.equal((await embeddedFontPrograms(await save([
    { type: 'line', pageNum: 1, x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.5, color: '#000000', thickness: 1, fillColor: null },
  ]))).length, 0, 'a document with no text should get no font');
});

test('footers and watermarks accept non-Latin text', async () => {
  const src = await makePdf({ media: [0, 0, 612, 792] });

  const footer = await embedFooter(src, { left: 'Σελίδα {page}', center: '', right: '', fontSize: 10 }, FONT_FILES);
  assert.equal((await readDrawnText(footer)).map(d => d.str).join(''), 'Σελίδα 1');

  const mark = await embedWatermark(src, { text: 'ΠΡΟΣΧΕΔΙΟ', fontSize: 40, opacity: 0.3, angle: 45 }, FONT_FILES);
  assert.equal((await readDrawnText(mark)).map(d => d.str).join(''), 'ΠΡΟΣΧΕΔΙΟ');
});
