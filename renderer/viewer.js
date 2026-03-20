// PDFox — PDF.js viewer wrapper
// Handles loading, rendering, zoom, rotation and viewport exposure.
// SPDX-License-Identifier: GPL-3.0-or-later

import * as pdfjsLib from '../node_modules/pdfjs-dist/build/pdf.mjs';
const { TextLayer } = pdfjsLib;

// Point the worker at the bundled worker file
pdfjsLib.GlobalWorkerOptions.workerSrc =
  new URL('../node_modules/pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href;

export class PDFViewer {
  /**
   * @param {HTMLElement} container  - .pdf-pages element to render pages into
   */
  constructor(container) {
    this.container    = container;
    this.pdfDoc       = null;
    this.scale        = 1.0;
    this.pages        = []; // array of { wrapper, canvas, textDiv, annotCanvas }
    this.pageRotations = {}; // pageNum → extra rotation in degrees (0/90/180/270)
  }

  // Load from ArrayBuffer/Uint8Array and render all pages.
  // Always copies before handing to PDF.js — the worker transfers (detaches) the input buffer.
  async load(arrayBuffer) {
    const src      = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);
    const dataCopy = src.slice();
    const loadingTask = pdfjsLib.getDocument({ data: dataCopy });
    this.pdfDoc = await loadingTask.promise;
    this.pages  = [];
    this.pageRotations = {};
    this.container.innerHTML = '';
    for (let i = 1; i <= this.pdfDoc.numPages; i++) {
      await this._renderPage(i);
    }
  }

  // Re-render all pages at the new scale (preserves per-page rotations)
  async setZoom(scale) {
    this.scale = Math.max(0.25, Math.min(5, scale));
    for (let i = 1; i <= this.pdfDoc.numPages; i++) {
      await this._renderPage(i);
    }
  }

  // Rotate all pages by delta degrees (cumulative, clamped to 0/90/180/270)
  async rotateAll(delta) {
    for (let i = 1; i <= this.pdfDoc.numPages; i++) {
      this.pageRotations[i] = ((this.pageRotations[i] || 0) + delta + 360) % 360;
    }
    for (let i = 1; i <= this.pdfDoc.numPages; i++) {
      await this._renderPage(i);
    }
  }

  // Rotate a single page by delta degrees
  async rotatePage(pageNum, delta) {
    this.pageRotations[pageNum] = ((this.pageRotations[pageNum] || 0) + delta + 360) % 360;
    await this._renderPage(pageNum);
  }

  // Returns the page number of the page with the most screen area currently visible
  getVisiblePageNum() {
    const pane     = this.container.parentElement;
    const paneRect = pane.getBoundingClientRect();
    let best = 1, bestOverlap = 0;
    this.pages.forEach((p, idx) => {
      const r       = p.wrapper.getBoundingClientRect();
      const overlap = Math.min(r.bottom, paneRect.bottom) - Math.max(r.top, paneRect.top);
      if (overlap > bestOverlap) { bestOverlap = overlap; best = idx + 1; }
    });
    return best;
  }

  // Smooth-scroll the viewer pane to show the given page
  scrollToPage(pageNum) {
    const p = this.pages[pageNum - 1];
    if (p) p.wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Returns the PDF.js viewport for a given 1-based page number (includes user rotation)
  async getViewport(pageNum) {
    const page     = await this.pdfDoc.getPage(pageNum);
    const rotation = (page.rotate + (this.pageRotations[pageNum] || 0)) % 360;
    return page.getViewport({ scale: this.scale, rotation });
  }

  // Returns { width, height } of the unscaled PDF page in PDF pts (no user rotation)
  async getPageSize(pageNum) {
    const page = await this.pdfDoc.getPage(pageNum);
    const vp   = page.getViewport({ scale: 1.0 });
    return { width: vp.width, height: vp.height };
  }

  // Returns the PDF outline (bookmarks) array, or null if none
  async getOutline() {
    if (!this.pdfDoc) return null;
    return this.pdfDoc.getOutline();
  }

  // Resolve an outline destination (string or array) to a 1-based page number
  async resolveOutlineDest(dest) {
    if (!dest) return null;
    let explicitDest = dest;
    if (typeof dest === 'string') {
      explicitDest = await this.pdfDoc.getDestination(dest);
    }
    if (!Array.isArray(explicitDest) || !explicitDest[0]) return null;
    const pageIndex = await this.pdfDoc.getPageIndex(explicitDest[0]);
    return pageIndex + 1;
  }

  get pageCount() {
    return this.pdfDoc ? this.pdfDoc.numPages : 0;
  }

  // ── Private ────────────────────────────────────────────────

  async _renderPage(pageNum) {
    const page     = await this.pdfDoc.getPage(pageNum);
    const userRot  = this.pageRotations[pageNum] || 0;
    const rotation = (page.rotate + userRot) % 360;
    const viewport = page.getViewport({ scale: this.scale, rotation });
    const idx      = pageNum - 1;

    let wrapper, canvas, textDiv, annotCanvas;

    if (this.pages[idx]) {
      // Re-use existing DOM elements on zoom/rotate
      ({ wrapper, canvas, textDiv, annotCanvas } = this.pages[idx]);
    } else {
      wrapper     = document.createElement('div');
      canvas      = document.createElement('canvas');
      textDiv     = document.createElement('div');
      annotCanvas = document.createElement('canvas');

      wrapper.className     = 'page-wrapper';
      canvas.className      = 'pdf-canvas';
      textDiv.className     = 'textLayer';
      annotCanvas.className = 'annot-canvas';

      wrapper.dataset.page = pageNum;
      wrapper.append(canvas, textDiv, annotCanvas);
      this.container.appendChild(wrapper);
      this.pages[idx] = { wrapper, canvas, textDiv, annotCanvas };
    }

    // Resize wrapper and canvases to match viewport
    wrapper.style.width  = `${viewport.width}px`;
    wrapper.style.height = `${viewport.height}px`;

    canvas.width  = viewport.width;
    canvas.height = viewport.height;

    annotCanvas.width  = viewport.width;
    annotCanvas.height = viewport.height;
    annotCanvas.style.pointerEvents = 'none';

    // Render PDF content
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;

    // Render text layer for selection (PDF.js 4.x class-based API)
    textDiv.innerHTML = '';
    textDiv.style.width  = `${viewport.width}px`;
    textDiv.style.height = `${viewport.height}px`;
    const textLayer = new TextLayer({
      textContentSource: page.streamTextContent(),
      container: textDiv,
      viewport,
    });
    await textLayer.render();
  }
}
