// Reamlet — the page side of the end-to-end print test (see print.mjs): builds
// print jobs with the app's own composer and renders PDFs to see what is on
// each page.
// SPDX-License-Identifier: GPL-3.0-or-later

import * as pdfjs from '../../node_modules/pdfjs-dist/build/pdf.mjs';
import * as PDFLib from '../../node_modules/pdf-lib/dist/pdf-lib.esm.js';
import { buildPrintPdf } from '../../out/renderer/print-compose.js';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../node_modules/pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href;

const { PDFDocument, PDFName, StandardFonts, rgb } = PDFLib;

const A4 = [595.28, 841.89];

/** The squares' corners on each page, as fractions of the page: a different corner each, so a page printed in the wrong place or the wrong way round shows. */
const CORNERS = [[0.08, 0.55], [0.52, 0.55], [0.52, 0.08], [0.08, 0.08]];

/**
 * A document whose pages are easy to tell apart when printed: each has a
 * large black square in its own corner and its number in large type. Page 1
 * also has a native annotation, a black bar drawn by its own appearance, as a
 * viewer draws it over the page.
 */
async function sourceDocument(numPages) {
  const doc  = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let n = 1; n <= numPages; n++) {
    const [w, h] = A4;
    const page = doc.addPage(A4);
    const [cx, cy] = CORNERS[(n - 1) % CORNERS.length];
    page.drawRectangle({ x: cx * w, y: cy * h, width: 0.4 * w, height: 0.4 * w, color: rgb(0, 0, 0) });
    page.drawText(String(n), { x: 0.45 * w, y: 0.45 * h, size: 72, font, color: rgb(0, 0, 0) });
    if (n === 1) addBarAnnotation(doc, page, [0.1 * w, 0.2 * h, 0.9 * w, 0.26 * h]);
  }
  return doc.save();
}

function addBarAnnotation(doc, page, [x0, y0, x1, y1]) {
  const w = x1 - x0, h = y1 - y0;
  const appearance = doc.context.flateStream(`0 0 0 rg 0 0 ${w} ${h} re f`, {
    Type: 'XObject', Subtype: 'Form', BBox: [0, 0, w, h],
  });
  const annot = doc.context.register(doc.context.obj({
    Type: 'Annot', Subtype: 'Square', Rect: [x0, y0, x1, y1], F: 4,
    AP: { N: doc.context.register(appearance) },
  }));
  page.node.set(PDFName.of('Annots'), doc.context.obj([annot]));
}

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

/** How much of each cell of a `GRID` × `GRID` grid over a page is dark. */
const GRID = 10;

/**
 * Each page as it lies on the paper. A printer's own PDF may carry a /Rotate
 * that only turns the page for reading on screen (CUPS-PDF's Ghostscript turns
 * pages so their text reads upright), so that is left out.
 */
async function coverage(b64) {
  const pdf = await pdfjs.getDocument({ data: fromBase64(b64) }).promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page     = await pdf.getPage(n);
    const base     = page.getViewport({ scale: 1, rotation: 0 });
    const viewport = page.getViewport({ scale: 300 / base.width, rotation: 0 });
    const canvas   = document.createElement('canvas');
    canvas.width   = Math.round(viewport.width);
    canvas.height  = Math.round(viewport.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;

    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const dark  = new Array(GRID * GRID).fill(0);
    const total = new Array(GRID * GRID).fill(0);
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4;
        const cell = Math.min(GRID - 1, Math.floor(y / canvas.height * GRID)) * GRID + Math.min(GRID - 1, Math.floor(x / canvas.width * GRID));
        total[cell]++;
        if (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < 128) dark[cell]++;
      }
    }
    pages.push({ size: [base.width, base.height], cells: dark.map((d, i) => d / total[i]) });
  }
  return pages;
}

window.printCheck = {
  GRID,
  /** A print job for `layout`, as the print window would build it. */
  async job(layout, numPages) {
    const { bytes, mediaWpt, mediaHpt } = await buildPrintPdf(await sourceDocument(numPages), {
      totalPages: numPages, pageRange: null, ...layout,
    });
    return { pdf: toBase64(bytes), mediaWpt, mediaHpt };
  },
  coverage,
};
document.title = 'ready';
