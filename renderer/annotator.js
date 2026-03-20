// PDFox — annotation layer
// Manages canvas overlays per page and stores annotation objects in memory.
// SPDX-License-Identifier: GPL-3.0-or-later

export class Annotator {
  /**
   * @param {Object[]} pages  - viewer.pages array (each has annotCanvas, wrapper)
   */
  constructor(pages) {
    this.pages       = pages;
    this.annotations = [];
    this.tool        = 'select';
    this.color       = '#f5c518';
    this.thickness   = 3;
    this.textBold      = false;
    this.textUnderline = false;

    this._drawing     = false;
    this._currentPath = null;
    this._shapeStart  = null;

    this._history = ['[]'];
    this._histIdx = 0;

    this._handlers = {};
    this._attachAll();
  }

  setTool(tool) {
    this.tool = tool;
    this._updateCursors();
    const canvasCaptures = ['draw', 'text', 'line', 'rect', 'oval', 'arrow', 'eraser'].includes(tool);
    this.pages.forEach(p => {
      p.annotCanvas.style.pointerEvents = canvasCaptures ? 'auto' : 'none';
    });
  }

  setColor(color)       { this.color       = color; }
  setThickness(t)       { this.thickness   = t; }
  setTextBold(b)        { this.textBold      = b; }
  setTextUnderline(b)   { this.textUnderline = b; }

  clear() {
    this.annotations = [];
    this.pages.forEach(p => {
      const ctx = p.annotCanvas.getContext('2d');
      ctx.clearRect(0, 0, p.annotCanvas.width, p.annotCanvas.height);
    });
    this._history = ['[]'];
    this._histIdx = 0;
  }

  redrawAll() {
    this.pages.forEach((p, idx) => this._redrawPage(p, idx + 1));
  }

  undo() {
    if (this._histIdx <= 0) return;
    this._histIdx--;
    const data = JSON.parse(this._history[this._histIdx]);
    this.annotations.splice(0, this.annotations.length, ...data);
    this.redrawAll();
  }

  redo() {
    if (this._histIdx >= this._history.length - 1) return;
    this._histIdx++;
    const data = JSON.parse(this._history[this._histIdx]);
    this.annotations.splice(0, this.annotations.length, ...data);
    this.redrawAll();
  }

  // ── Private: event wiring ──────────────────────────────────

  _attachAll() {
    this.pages.forEach((p, idx) => this._attachPage(p, idx + 1));
    document.addEventListener('mouseup', (e) => {
      if (this.tool !== 'highlight') return;
      const wrapper = e.target.closest?.('.page-wrapper');
      if (!wrapper) return;
      const pageNum = Number(wrapper.dataset.page);
      if (!pageNum) return;
      const p = this.pages[pageNum - 1];
      if (p) this._captureHighlight(p, pageNum);
    });
  }

  _attachPage(p, pageNum) {
    const canvas     = p.annotCanvas;
    const shapeTools = ['line', 'rect', 'oval', 'arrow'];

    const onDown = (e) => {
      if (e.button !== 0) return;
      if (this.tool === 'draw') {
        this._drawing = true;
        this._currentPath = { pageNum, points: [this._canvasPos(canvas, e)], color: this.color, thickness: this.thickness };
      } else if (shapeTools.includes(this.tool)) {
        this._shapeStart = { pageNum, pos: this._canvasPos(canvas, e), p };
      }
    };

    const onMove = (e) => {
      if (this.tool === 'draw' && this._drawing) {
        const pos = this._canvasPos(canvas, e);
        this._currentPath.points.push(pos);
        const ctx = canvas.getContext('2d');
        const pts = this._currentPath.points;
        if (pts.length < 2) return;
        ctx.save();
        ctx.strokeStyle = this._currentPath.color;
        ctx.lineWidth   = this._currentPath.thickness;
        ctx.lineCap     = 'round';
        ctx.lineJoin    = 'round';
        ctx.beginPath();
        ctx.moveTo(pts[pts.length - 2][0], pts[pts.length - 2][1]);
        ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
        ctx.stroke();
        ctx.restore();
      } else if (this._shapeStart?.pageNum === pageNum && shapeTools.includes(this.tool)) {
        const [x2, y2] = this._constrainShape(this.tool, ...this._shapeStart.pos, ...this._canvasPos(canvas, e), e.shiftKey);
        this._redrawPage(p, pageNum);
        this._drawPreview(canvas, this._shapeStart.pos, [x2, y2]);
      }
    };

    const onUp = (e) => {
      if (e.button !== 0) return;

      if (this.tool === 'draw' && this._drawing) {
        this._drawing = false;
        if (this._currentPath && this._currentPath.points.length > 1) {
          const w = canvas.width, h = canvas.height;
          this.annotations.push({
            type:      'draw',
            pageNum,
            points:    this._currentPath.points.map(([x, y]) => [x / w, y / h]),
            color:     this._currentPath.color,
            thickness: this._currentPath.thickness,
          });
          this._pushHistory();
        }
        this._currentPath = null;

      } else if (this._shapeStart?.pageNum === pageNum && shapeTools.includes(this.tool)) {
        const [x1, y1] = this._shapeStart.pos;
        const [x2, y2] = this._constrainShape(this.tool, x1, y1, ...this._canvasPos(canvas, e), e.shiftKey);
        this._shapeStart = null;
        if (Math.abs(x2 - x1) > 2 || Math.abs(y2 - y1) > 2) {
          const w = canvas.width, h = canvas.height;
          this.annotations.push({
            type:      this.tool,
            pageNum,
            x1: x1 / w, y1: y1 / h,
            x2: x2 / w, y2: y2 / h,
            color:     this.color,
            thickness: this.thickness,
          });
          this._pushHistory();
        }
        this._redrawPage(p, pageNum);

      } else if (this.tool === 'text') {
        this._placeTextBox(p, pageNum, this._canvasPos(canvas, e));

      } else if (this.tool === 'eraser') {
        const [cx, cy] = this._canvasPos(canvas, e);
        const w = canvas.width, h = canvas.height;
        const idx = this._hitTest(pageNum, cx / w, cy / h);
        if (idx >= 0) {
          this.annotations.splice(idx, 1);
          this._pushHistory();
          this._redrawPage(p, pageNum);
        }
      }
    };

    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseup',   onUp);
    this._handlers[pageNum] = { onDown, onMove, onUp, canvas };
  }

  // Capture the browser text selection as a highlight annotation.
  // Uses the computed font-size of each selected span to size rects accurately,
  // avoiding the extra line-height that raw getClientRects() includes.
  _captureHighlight(p, pageNum) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;

    const wrapper  = p.wrapper;
    const wrapRect = wrapper.getBoundingClientRect();

    const rects = [];
    for (let i = 0; i < sel.rangeCount; i++) {
      const range = sel.getRangeAt(i);
      for (const r of range.getClientRects()) {
        if (r.width < 1) continue;

        // Find the PDF.js text span at this position to read its actual font-size.
        // elementFromPoint skips pointer-events:none elements (annot-canvas),
        // so it sees through to the text layer span.
        const el   = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        const span = el?.closest?.('.textLayer span');
        let textH  = r.height * 0.55; // fallback: 55% of rect if no span found
        if (span) {
          const fs = parseFloat(window.getComputedStyle(span).fontSize);
          if (fs > 0) textH = Math.min(fs * 1.25, r.height * 0.9);
        }

        const trimV = (r.height - textH) / 2;
        rects.push({
          x:      (r.left - wrapRect.left) / wrapRect.width,
          y:      (r.top  - wrapRect.top + trimV) / wrapRect.height,
          width:  r.width  / wrapRect.width,
          height: textH    / wrapRect.height,
        });
      }
    }
    sel.removeAllRanges();
    if (rects.length === 0) return;

    const annot = { type: 'highlight', pageNum, rects, color: this.color };
    this.annotations.push(annot);
    this._pushHistory();
    const ctx = p.annotCanvas.getContext('2d');
    this._drawAnnotation(ctx, annot, p.annotCanvas.width, p.annotCanvas.height);
  }

  // Place an editable textarea styled to preview the final canvas output
  _placeTextBox(p, pageNum, [cx, cy]) {
    const wrapper  = p.wrapper;
    const canvas   = p.annotCanvas;
    const w = canvas.width, h = canvas.height;
    const fontSize = 13;
    const scaleX   = wrapper.offsetWidth  / w;
    const scaleY   = wrapper.offsetHeight / h;
    const weight   = this.textBold      ? 'bold'      : 'normal';
    const decor    = this.textUnderline ? 'underline' : 'none';

    const ta = document.createElement('textarea');
    ta.style.cssText = `
      position:        absolute;
      left:            ${cx * scaleX}px;
      top:             ${cy * scaleY}px;
      min-width:       120px;
      min-height:      ${fontSize + 6}px;
      background:      transparent;
      border:          1px dashed rgba(128,128,128,0.6);
      font:            ${weight} ${fontSize}px system-ui, sans-serif;
      color:           ${this.color};
      text-decoration: ${decor};
      line-height:     ${fontSize + 2}px;
      caret-color:     ${this.color};
      resize:          both;
      z-index:         10;
      outline:         none;
      padding:         0;
      overflow:        hidden;
    `;
    wrapper.appendChild(ta);
    ta.focus();

    const bold      = this.textBold;
    const underline = this.textUnderline;

    let committed = false;
    const commit = () => {
      if (committed) return;
      committed = true;
      const text = ta.value.trim();
      ta.remove();
      if (!text) return;
      const annot = {
        type:      'text',
        pageNum,
        x:         cx / w,
        y:         cy / h,
        text,
        color:     this.color,
        fontSize,
        bold,
        underline,
      };
      this.annotations.push(annot);
      this._pushHistory();
      const ctx = canvas.getContext('2d');
      this._drawAnnotation(ctx, annot, w, h);
    };

    ta.addEventListener('blur', commit);
    ta.addEventListener('keydown', e => {
      if (e.key === 'Escape') { committed = true; ta.remove(); }
    });
  }

  // ── Private: hit testing ────────────────────────────────────

  _hitTest(pageNum, nx, ny) {
    for (let i = this.annotations.length - 1; i >= 0; i--) {
      const a = this.annotations[i];
      if (a.pageNum !== pageNum) continue;
      if (this._annotContains(a, nx, ny)) return i;
    }
    return -1;
  }

  _annotContains(a, nx, ny) {
    const tol = 0.012;
    if (a.type === 'draw') {
      for (let i = 0; i < a.points.length - 1; i++) {
        if (this._distToSegment(nx, ny, a.points[i], a.points[i + 1]) < tol) return true;
      }
    } else if (a.type === 'highlight') {
      return a.rects.some(r =>
        nx >= r.x - tol && nx <= r.x + r.width  + tol &&
        ny >= r.y - tol && ny <= r.y + r.height + tol
      );
    } else if (a.type === 'text') {
      return Math.abs(nx - a.x) < 0.12 && Math.abs(ny - a.y) < 0.05;
    } else if (a.type === 'rect' || a.type === 'oval') {
      const x1 = Math.min(a.x1, a.x2), x2 = Math.max(a.x1, a.x2);
      const y1 = Math.min(a.y1, a.y2), y2 = Math.max(a.y1, a.y2);
      return nx >= x1 - tol && nx <= x2 + tol && ny >= y1 - tol && ny <= y2 + tol;
    } else if (a.type === 'line' || a.type === 'arrow') {
      return this._distToSegment(nx, ny, [a.x1, a.y1], [a.x2, a.y2]) < tol;
    }
    return false;
  }

  _distToSegment(px, py, [ax, ay], [bx, by]) {
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  // ── Private: shape helpers ──────────────────────────────────

  _constrainShape(tool, x1, y1, x2, y2, shift) {
    if (!shift) return [x2, y2];
    if (tool === 'rect' || tool === 'oval') {
      const dx = x2 - x1, dy = y2 - y1;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      return [x1 + Math.sign(dx) * d, y1 + Math.sign(dy) * d];
    }
    if (tool === 'line' || tool === 'arrow') {
      const dx = x2 - x1, dy = y2 - y1;
      const len   = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      return [x1 + Math.cos(angle) * len, y1 + Math.sin(angle) * len];
    }
    return [x2, y2];
  }

  _drawPreview(canvas, [x1, y1], [x2, y2]) {
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.strokeStyle = this.color;
    ctx.lineWidth   = this.thickness;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.setLineDash([4, 4]);
    this._drawShape(ctx, this.tool, x1, y1, x2, y2);
    ctx.setLineDash([]);
    ctx.restore();
  }

  _drawShape(ctx, type, x1, y1, x2, y2) {
    if (type === 'line') {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    } else if (type === 'rect') {
      ctx.beginPath();
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    } else if (type === 'oval') {
      const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
      const rx = Math.max(Math.abs(x2 - x1) / 2, 1);
      const ry = Math.max(Math.abs(y2 - y1) / 2, 1);
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (type === 'arrow') {
      const headLen = Math.max(10, ctx.lineWidth * 4);
      const angle   = Math.atan2(y2 - y1, x2 - x1);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
    }
  }

  // ── Private: drawing ───────────────────────────────────────

  _redrawPage(p, pageNum) {
    const ctx = p.annotCanvas.getContext('2d');
    const { width: w, height: h } = p.annotCanvas;
    ctx.clearRect(0, 0, w, h);
    this.annotations
      .filter(a => a.pageNum === pageNum)
      .forEach(a => this._drawAnnotation(ctx, a, w, h));
  }

  _drawAnnotation(ctx, annot, w, h) {
    ctx.save();
    if (annot.type === 'draw') {
      ctx.strokeStyle = annot.color;
      ctx.lineWidth   = annot.thickness;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
      ctx.beginPath();
      annot.points.forEach(([nx, ny], i) => {
        const x = nx * w, y = ny * h;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();

    } else if (annot.type === 'highlight') {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle   = annot.color;
      annot.rects.forEach(r => {
        ctx.fillRect(r.x * w, r.y * h, r.width * w, r.height * h);
      });

    } else if (annot.type === 'text') {
      const weight = annot.bold ? 'bold ' : '';
      ctx.fillStyle = annot.color;
      ctx.font      = `${weight}${annot.fontSize}px system-ui, sans-serif`;
      annot.text.split('\n').forEach((line, i) => {
        const x = annot.x * w;
        const y = annot.y * h + i * (annot.fontSize + 2) + annot.fontSize;
        ctx.fillText(line, x, y);
        if (annot.underline) {
          const metrics = ctx.measureText(line);
          ctx.fillRect(x, y + 2, metrics.width, Math.max(1, annot.fontSize / 12));
        }
      });

    } else if (['line', 'rect', 'oval', 'arrow'].includes(annot.type)) {
      ctx.strokeStyle = annot.color;
      ctx.lineWidth   = annot.thickness;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
      this._drawShape(ctx, annot.type, annot.x1 * w, annot.y1 * h, annot.x2 * w, annot.y2 * h);
    }
    ctx.restore();
  }

  _canvasPos(canvas, e) {
    const rect   = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    return [(e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY];
  }

  _updateCursors() {
    const cursors = {
      select:    'default',
      draw:      'crosshair',
      highlight: 'text',
      text:      'text',
      line:      'crosshair',
      rect:      'crosshair',
      oval:      'crosshair',
      arrow:     'crosshair',
      eraser:    'cell',
    };
    this.pages.forEach(p => {
      p.annotCanvas.style.cursor = cursors[this.tool] || 'default';
    });
  }

  // ── Private: undo/redo history ──────────────────────────────

  _pushHistory() {
    this._history.splice(this._histIdx + 1);
    this._history.push(JSON.stringify([...this.annotations]));
    this._histIdx++;
  }
}
