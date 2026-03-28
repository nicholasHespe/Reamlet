// Reamlet — Print Preview renderer
// SPDX-License-Identifier: GPL-3.0-or-later

// @ts-expect-error — pdfjs-dist direct path for Electron ESM
import * as _pdfjsLib from '../../node_modules/pdfjs-dist/build/pdf.mjs';
import type * as PDFJSLib from 'pdfjs-dist';
const pdfjsLib = _pdfjsLib as unknown as typeof PDFJSLib;
pdfjsLib.GlobalWorkerOptions.workerSrc =
  new URL('../../node_modules/pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href;

const previewArea    = document.getElementById('preview-area')!;
const inpCopies      = document.getElementById('inp-copies')      as HTMLInputElement;
const selPages       = document.getElementById('sel-pages')       as HTMLSelectElement;
const inpPagesCustom = document.getElementById('inp-pages-custom') as HTMLInputElement;
const selScale       = document.getElementById('sel-scale')       as HTMLSelectElement;
const btnPrint       = document.getElementById('btn-print')       as HTMLButtonElement;
const btnClose       = document.getElementById('btn-close')       as HTMLButtonElement;
const statusEl       = document.getElementById('status')!;

let totalPages = 0;

// Parse "1-3, 5, 7-9" into Set<number>
function parsePageRange(str: string, total: number): Set<number> {
  const result = new Set<number>();
  for (const part of str.split(',')) {
    const trimmed = part.trim();
    const range = trimmed.match(/^(\d+)\s*[-\u2013]\s*(\d+)$/);
    if (range) {
      const from = parseInt(range[1]), to = parseInt(range[2]);
      for (let p = Math.max(1, from); p <= Math.min(total, to); p++) result.add(p);
    } else {
      const n = parseInt(trimmed);
      if (!isNaN(n) && n >= 1 && n <= total) result.add(n);
    }
  }
  return result;
}

function updatePageVisibility() {
  const mode = selPages.value;
  const selected = mode === 'custom' && inpPagesCustom.value.trim()
    ? parsePageRange(inpPagesCustom.value, totalPages)
    : null; // null = all
  document.querySelectorAll<HTMLElement>('.print-page').forEach(el => {
    const page = parseInt(el.dataset.page!);
    el.classList.toggle('excluded', selected !== null && !selected.has(page));
  });
}

function updateGreyscale() {
  const grey = (document.querySelector('input[name="color"]:checked') as HTMLInputElement)?.value === 'grey';
  previewArea.classList.toggle('greyscale', grey);
}

function updateScale() {
  const fit = selScale.value === 'fit';
  document.querySelectorAll('.print-page').forEach(el => el.classList.toggle('fit', fit));
}

selPages.addEventListener('change', () => {
  inpPagesCustom.classList.toggle('hidden', selPages.value !== 'custom');
  updatePageVisibility();
});
inpPagesCustom.addEventListener('input', updatePageVisibility);
document.querySelectorAll('input[name="color"]').forEach(el =>
  el.addEventListener('change', updateGreyscale));
selScale.addEventListener('change', updateScale);

btnClose.addEventListener('click', () => window.close());

btnPrint.addEventListener('click', async () => {
  const copies   = Math.max(1, parseInt(inpCopies.value) || 1);
  const grey     = (document.querySelector('input[name="color"]:checked') as HTMLInputElement)?.value === 'grey';
  const scaleVal = selScale.value;
  const scaleFactor = scaleVal === 'fit' || scaleVal === '100' ? 100 : parseInt(scaleVal);

  btnPrint.disabled = true;
  await window.api.executePrint({ copies, color: !grey, scaleFactor });
  btnPrint.disabled = false;
});

window.api.onPdfData(async ({ buffer }) => {
  statusEl.textContent = 'Rendering pages…';
  const bytes  = new Uint8Array(buffer);
  const pdfDoc = await pdfjsLib.getDocument({ data: bytes }).promise;
  totalPages   = pdfDoc.numPages;

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const page     = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas   = document.createElement('canvas');
    canvas.width   = viewport.width;
    canvas.height  = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;

    const img   = new Image();
    img.src     = canvas.toDataURL('image/png');
    img.style.cssText = `width: ${viewport.width / 1.5}px; height: auto;`;

    const wrapper       = document.createElement('div');
    wrapper.className   = 'print-page fit'; // fit is default
    wrapper.dataset.page = String(pageNum);
    wrapper.appendChild(img);
    previewArea.appendChild(wrapper);
  }

  statusEl.textContent = `${totalPages} page${totalPages === 1 ? '' : 's'}`;
  updateScale(); // apply initial scale state
});
