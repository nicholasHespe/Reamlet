// Reamlet — saved annotations stack the way they did on screen. Every one is a
// native annotation with its own appearance, written in the order it was
// placed, and viewers paint annotations in that order above the page content.
// SPDX-License-Identifier: GPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFArray } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

import { embedAnnotations } from '../out/renderer/saver.js';
import { HIGHLIGHT_OPACITY } from '../out/renderer/annotation-style.js';
import { textBlockHeight } from '../out/renderer/text-layout.js';
import {
  makePdf, fakeViewer, oracle, loadPdfJs, readAnnotations, readAnnotationPaths, FONT_FILES,
} from './helpers/pdf-fixtures.mjs';

const EPS = 0.02;

const rect   = { type: 'rect', pageNum: 1, x1: 0.1, y1: 0.1, x2: 0.6, y2: 0.3,
                 color: '#000000', thickness: 2, fillColor: '#3388ff' };
const oval   = { ...rect, type: 'oval', y1: 0.4, y2: 0.5 };
const line   = { ...rect, type: 'line', fillColor: null };
const arrow  = { ...line, type: 'arrow', x1: 0.7, x2: 0.9 };
const text   = { type: 'text', pageNum: 1, x: 0.15, y: 0.15, width: 0.4, text: 'on top of the box',
                 color: '#000000', fontSize: 14, bold: false, underline: false, fillColor: null };
const draw   = { type: 'draw', pageNum: 1, points: [[0.1, 0.8], [0.3, 0.85], [0.5, 0.8]],
                 color: '#00aa00', thickness: 2 };
const freeHl = { ...draw, type: 'freeHighlight', thickness: 20 };
const highlight = { type: 'highlight', pageNum: 1, color: '#ffff00',
                    rects: [{ x: 0.1, y: 0.6, width: 0.5, height: 0.03 },
                            { x: 0.1, y: 0.64, width: 0.3, height: 0.03 }] };

const ALL_TYPES = [highlight, rect, text, draw, oval, arrow, line, freeHl];
const SUBTYPES  = ['Highlight', 'Square', 'FreeText', 'Ink', 'Circle', 'Line', 'Line', 'Ink'];

async function save(annotations, src) {
  src ??= await makePdf({ media: [0, 0, 612, 792] });
  return embedAnnotations(src, annotations, await fakeViewer(src), FONT_FILES);
}

/** Subtypes of the annotations PDF.js paints, in the order it paints them. */
async function paintOrder(bytes) {
  const page = await (await loadPdfJs(bytes)).getPage(1);
  const subtypeById = new Map((await page.getAnnotations()).map(a => [a.id, a.subtype]));
  const { fnArray, argsArray } = await page.getOperatorList({ annotationMode: pdfjs.AnnotationMode.ENABLE });
  return fnArray.flatMap((op, i) => op === pdfjs.OPS.beginAnnotation ? [subtypeById.get(argsArray[i][0])] : []);
}

test('text placed over a shape is painted over it', async () => {
  assert.deepEqual(await paintOrder(await save([rect, text])), ['Square', 'FreeText']);
});

test('a shape placed over text is painted over it', async () => {
  assert.deepEqual(await paintOrder(await save([text, rect])), ['FreeText', 'Square']);
});

test('every annotation type is painted in the order it was placed', async () => {
  const out = await save(ALL_TYPES);
  assert.deepEqual(await paintOrder(out), SUBTYPES);
  assert.deepEqual(await paintOrder(await save([...ALL_TYPES].reverse())), [...SUBTYPES].reverse());
});

test('every annotation carries its own appearance', async () => {
  const saved = await readAnnotations(await save(ALL_TYPES));
  assert.deepEqual(saved.map(a => a.subtype), SUBTYPES);
  for (const a of saved) assert.ok(a.hasAppearance, `${a.subtype} has no /AP`);
});

test('nothing is drawn into the page content itself', async () => {
  const src = await makePdf({ media: [0, 0, 612, 792] });
  const contentOps = async (bytes) => {
    const page = await (await loadPdfJs(bytes)).getPage(1);
    return (await page.getOperatorList({ annotationMode: pdfjs.AnnotationMode.DISABLE })).fnArray;
  };
  assert.deepEqual(await contentOps(await save(ALL_TYPES, src)), await contentOps(src));
});

test('annotations already in the file are kept, and new ones stack above them', async () => {
  // An existing link, held in an indirect /Annots array as many PDFs store it.
  const doc  = await PDFDocument.load(await makePdf({ media: [0, 0, 612, 792] }));
  const page = doc.getPage(0);
  const link = doc.context.register(doc.context.obj({
    Type: 'Annot', Subtype: 'Link', Rect: [10, 10, 100, 30], Border: [0, 0, 0],
  }));
  page.node.set(PDFName.of('Annots'), doc.context.register(doc.context.obj([link])));
  const src = await doc.save();

  const out = await save([rect, text], src);
  assert.deepEqual((await readAnnotations(out)).map(a => a.subtype), ['Link', 'Square', 'FreeText']);
  const annots = (await PDFDocument.load(out)).getPage(0).node.Annots();
  assert.ok(annots instanceof PDFArray);
});

test('a highlight is one annotation covering all of its spans, at the canvas opacity', async () => {
  const out = await save([highlight]);
  const [saved] = await readAnnotations(out);
  assert.equal(saved.subtype, 'Highlight');
  assert.equal(saved.quadPoints.length, 8 * highlight.rects.length);

  const [{ paths }] = await readAnnotationPaths(out);
  assert.equal(paths.filter(p => p.painted === 'fill').length, highlight.rects.length);

  const page = await (await loadPdfJs(out)).getPage(1);
  const { fnArray, argsArray } = await page.getOperatorList({ annotationMode: pdfjs.AnnotationMode.ENABLE });
  const alphas = fnArray.flatMap((op, i) => op === pdfjs.OPS.setGState ? argsArray[i][0] : [])
    .filter(([key]) => key === 'ca' || key === 'CA').map(([, value]) => value);
  assert.ok(alphas.length > 0 && alphas.every(a => Math.abs(a - HIGHLIGHT_OPACITY) < 1e-6),
    `appearance opacity ${JSON.stringify(alphas)}, want ${HIGHLIGHT_OPACITY}`);
});

test('a freehand highlight is drawn translucent, a pen stroke opaque', async () => {
  const out = await save([freeHl, draw]);
  const saved = await readAnnotations(out);
  const doc = await PDFDocument.load(out);
  const annots = doc.getPage(0).node.Annots();
  const ca = (i) => annots.lookup(i).get(PDFName.of('CA'))?.asNumber();
  assert.equal(saved[0].subtype, 'Ink');
  assert.ok(Math.abs(ca(0) - HIGHLIGHT_OPACITY) < 1e-6);
  assert.equal(ca(1), undefined);
});

for (const rotate of [0, 90, 180, 270]) {
  test(`a text annotation's box, inside its padded /Rect, is where the text was placed — /Rotate ${rotate}`, async () => {
    const src = await makePdf({ media: [0, 0, 612, 792], rotate });
    const out = await save([text], src);

    const doc   = await PDFDocument.load(out);
    const dict  = doc.getPage(0).node.Annots().lookup(0);
    const num   = (key) => dict.lookup(PDFName.of(key)).asArray().map(n => n.asNumber());
    const [rx0, ry0, rx1, ry1] = num('Rect');
    const [dl, db, dr, dt] = num('RD');
    const inner = [rx0 + dl, ry0 + db, rx1 - dr, ry1 - dt];

    const { at, displayHeight } = await oracle(src, 1, rotate);
    const bottom = text.y + textBlockHeight(1, text.fontSize) / displayHeight;
    const corners = [at(text.x, text.y), at(text.x + text.width, bottom)];
    const want = [
      Math.min(corners[0][0], corners[1][0]), Math.min(corners[0][1], corners[1][1]),
      Math.max(corners[0][0], corners[1][0]), Math.max(corners[0][1], corners[1][1]),
    ];
    inner.forEach((v, i) => assert.ok(Math.abs(v - want[i]) < EPS, `RD box [${inner}] vs [${want}]`));
  });
}

test('saved text is exposed to Find through the annotation\'s text content', async () => {
  const long = { ...text, width: 0.15, text: 'Reamlet saves searchable text boxes' };
  const page = await (await loadPdfJs(await save([rect, long]))).getPage(1);
  const [freeText] = (await page.getAnnotations()).filter(a => a.subtype === 'FreeText');
  assert.ok(freeText.textContent.length > 1, 'fixture should wrap');
  assert.equal(freeText.textContent.join(' '), long.text);
});
