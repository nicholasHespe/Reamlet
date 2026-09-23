// Reamlet — annotation layer
// Manages canvas overlays per page and stores annotation objects in memory.
// SPDX-License-Identifier: GPL-3.0-or-later

import type { PDFViewer, PageData } from './viewer.js';
import type { Annotation, ShapeAnnotation, HighlightAnnotation, TextAnnotation } from './types.js';
import {
  TEXT_LINE_GAP, TEXT_FONT_STACK, textBaselineOffset, textUnderlineThickness,
  textBlockHeight, wrapText, type MeasureText,
} from './text-layout.js';

/** Width of a newly placed text box, in PDF points. */
const TEXT_DEFAULT_WIDTH = 160;

/** How a text box's text is drawn. */
export interface TextStyle {
  /** In points. */
  fontSize: number;
  bold: boolean;
  underline: boolean;
  color: string;
  /** Background behind the text, or null for none. */
  fillColor: string | null;
}

/**
 * Text the formatting bar works on: a text box being typed into, or the text
 * annotations among the current selection.
 */
export interface TextBarTarget {
  /** Element the bar is placed in; `bounds()` is in its coordinates. */
  readonly container: HTMLElement;
  /** The box the bar sits against, in CSS pixels. */
  bounds(): { left: number; top: number; width: number; height: number };
  /** An element whose resizing moves `bounds()`, if any. */
  readonly watch?: HTMLElement;
  readonly style: Readonly<TextStyle>;
  /** Restyle the text. The change is also kept for the next new text box. */
  setStyle(changes: Partial<TextStyle>): void;
  /** Delete the text: a box being typed is thrown away, a selection deleted. */
  remove(): void;
}

/** A change to the look of selected annotations; thickness is in points. */
export interface AnnotationStyleChange {
  color?: string;
  fillColor?: string | null;
  thickness?: number;
}

/** Annotation types with an interior that can be filled. */
const FILLABLE_TYPES = new Set<Annotation['type']>(['rect', 'oval', 'text']);
/** Annotation types drawn with a stroke of adjustable thickness. */
const STROKED_TYPES = new Set<Annotation['type']>(['draw', 'line', 'arrow', 'rect', 'oval']);

// Geometry of the editing textarea's chrome, kept here so the CSS below and the
// measurements taken off it cannot drift apart.
const TEXTAREA_BORDER    = 1;
const TEXTAREA_PADDING_X = 4;
const TEXTAREA_PADDING_Y = 2;
/** Distance from the textarea's left edge to the first glyph. */
const TEXTAREA_INSET     = TEXTAREA_BORDER + TEXTAREA_PADDING_X;

export class Annotator {
  pages: PageData[];
  viewer: PDFViewer | null;
  annotations: Annotation[];
  tool: string;
  color: string;
  thickness: number;
  /** Fill colour applied to newly placed rect/oval annotations; null for no fill. */
  fillColor: string | null;
  /** Style of the next new text box: whatever was last set in the text bar. */
  textStyle: TextStyle;
  /** Called with the text the formatting bar should work on, or to hide it. */
  onTextBarShow?: (target: TextBarTarget) => void;
  onTextBarHide?: () => void;
  /** Called whenever the set of selected annotations changes. */
  onSelectionChange?: () => void;
  _drawing: boolean;
  _currentPath: { pageNum: number; points: [number, number][]; color: string; thickness: number } | null;
  _shapeStart: { pageNum: number; pos: [number, number]; p: PageData } | null;
  _freehighlight: { pageNum: number; p: PageData; points: [number, number][] } | null;
  _erasing: boolean;
  _erasedAny: boolean;
  /** The selected annotations, by identity. */
  _selection: Set<Annotation>;
  /** An in-progress drag of the selection: where it began, and each annotation as it was. */
  _drag: { x: number; y: number; pageRect: DOMRect; originals: Map<Annotation, Annotation> } | null;
  /** An in-progress Shift+drag selection box, in normalised page coords. */
  _marquee: { pageNum: number; p: PageData; pageRect: DOMRect; from: [number, number]; to: [number, number] } | null;
  /** Annotations cut or copied, waiting to be pasted. */
  _clipboard: Annotation[];
  /** The text box being typed into, while one is open. */
  _textEdit: TextBarTarget | null;
  onCommit?: () => void;
  _handlers: Record<number, unknown>;
  _docMouseupHighlight!: (e: MouseEvent) => void;
  _docMousemoveDrag!: (e: MouseEvent) => void;
  _docMouseupDrag!: (e: MouseEvent) => void;
  _docKeydown!: (e: KeyboardEvent) => void;
  _lastCursorPageNum: number | null;
  _lastCursorNorm: [number, number] | null;

  /**
   * @param {Object[]} pages  - viewer.pages array (each has annotCanvas, wrapper)
   * @param {PDFViewer} viewer - needed for font size in text tool (optional)
   */
  constructor(pages: PageData[], viewer?: PDFViewer) {
    this.pages   = pages;
    this.viewer  = viewer || null;

    this.annotations = [];
    this.tool        = 'select';
    this.color       = '#ff3333';
    this.thickness   = 3;
    this.fillColor   = null;
    this.textStyle   = { fontSize: 14, bold: false, underline: false, color: '#111111', fillColor: null };

    this._drawing      = false;
    this._currentPath  = null;
    this._shapeStart   = null;
    this._freehighlight = null; // freehand highlight path when not on text

    this._erasing      = false; // eraser drag state
    this._erasedAny    = false;

    // Select / move state
    this._selection = new Set();
    this._drag      = null;
    this._marquee   = null;
    this._clipboard = [];
    this._textEdit  = null;
    this._lastCursorPageNum = null;
    this._lastCursorNorm    = null;

    this._handlers = {};
    this._attachAll();
  }

  setTool(tool: string) {
    this.tool = tool;
    this._clearSelection();
    this._updateCursors();
    // Canvas captures pointer events for active drawing tools.
    // Select uses wrapper-level capture so text selection still works.
    const canvasCaptures = ['draw', 'text', 'line', 'rect', 'oval', 'arrow', 'eraser'].includes(tool);
    this.pages.forEach(p => {
      p.annotCanvas.style.pointerEvents = canvasCaptures ? 'auto' : 'none';
      // Block form fields while a drawing tool is active so strokes aren't eaten by inputs.
      // Must be set on each individual field element because pointer-events:none on a parent
      // does not suppress children that have pointer-events:auto in their inline style.
      p.formLayer.querySelectorAll('[data-field-name]').forEach((el: Element) => {
        (el as HTMLElement).style.pointerEvents = canvasCaptures ? 'none' : 'auto';
      });
    });
  }

  setColor(color: string)       { this.color        = color; }
  setThickness(t: number)       { this.thickness    = t; }
  setFillColor(color: string | null) { this.fillColor = color; }

  clear() {
    this.annotations = [];
    this._clearSelection();
    this.pages.forEach(p => {
      const ctx = p.annotCanvas.getContext('2d')!;
      ctx.clearRect(0, 0, p.annotCanvas.width, p.annotCanvas.height);
    });
  }

  redrawAll() {
    this.pages.forEach((p, idx) => this._redrawPage(p, idx + 1));
  }

  // Redraw a single page's annotation overlay. Used to repaint a page whose
  // annotCanvas was just cleared by a (re)render outside the annotator's control
  // (e.g. PDFViewer.onPageRendered firing for a deferred off-screen page).
  redrawPage(pageNum: number) {
    const p = this.pages[pageNum - 1];
    if (p) this._redrawPage(p, pageNum);
  }

  /**
   * Transform stored annotation coordinates to match a 90° CW rotation applied
   * to the given page (or all pages when pageNum is null).
   * Must be called before redrawAll() / page re-render after rotation.
   */
  rotateAnnotations(pageNum: number | null, cwDegrees: number) {
    const steps = (Math.round(cwDegrees / 90) % 4 + 4) % 4;
    const targets = this.annotations.filter(a => pageNum === null || a.pageNum === pageNum);

    // An odd number of quarter turns swaps which page edge the width is a
    // fraction of, so restate it against the new one.
    if (steps % 2 === 1) {
      for (const ann of targets) {
        if (ann.type !== 'text') continue;
        const canvas = this.pages[ann.pageNum - 1]?.annotCanvas;
        if (canvas && canvas.height > 0) ann.width *= canvas.width / canvas.height;
      }
    }

    for (let s = 0; s < steps; s++) {
      for (const ann of targets) {
        if (ann.type === 'draw' || ann.type === 'freeHighlight') {
          ann.points = (ann.points as [number, number][]).map(([nx, ny]) => [1 - ny, nx]);
        } else if (ann.type === 'highlight') {
          ann.rects = ann.rects.map(r => ({
            x: 1 - (r.y + r.height),
            y: r.x,
            width: r.height,
            height: r.width,
          }));
        } else if (ann.type === 'text') {
          const { x, y } = ann;
          ann.x = 1 - y;
          ann.y = x;
        } else if (ann.type === 'line' || ann.type === 'arrow' || ann.type === 'rect' || ann.type === 'oval') {
          const { x1, y1, x2, y2 } = ann;
          ann.x1 = 1 - y1; ann.y1 = x1;
          ann.x2 = 1 - y2; ann.y2 = x2;
        } else {
          // Runtime guard: if a new Annotation type is added without a
          // corresponding branch here, warn rather than silently skip rotation
          // and leave coordinates in an inconsistent state.
          console.warn('rotateAnnotations: unhandled annotation type:', (ann as { type: unknown }).type);
        }
      }
    }
  }

  setAnnotations(json: string) {
    this._clearSelection(false);
    const data = JSON.parse(json) as Annotation[];
    this.annotations.splice(0, this.annotations.length, ...data);
    this.redrawAll();
  }

  // ── Selection ───────────────────────────────────────────────

  /** The selected annotations, in the order they were placed. */
  selectedAnnotations(): Annotation[] {
    return this.annotations.filter(a => this._selection.has(a));
  }

  hasSelection(): boolean {
    return this._selection.size > 0;
  }

  /**
   * Restyle the selected annotations: each takes the parts of `changes` that
   * apply to it (every type has a colour; only shapes and text have a fill;
   * only strokes have a thickness). `commit` records an undo step; a run of
   * uncommitted changes, such as a slider drag, ends with commitSelectedEdit().
   */
  updateSelected(changes: AnnotationStyleChange, commit = true) {
    let changed = false;
    for (const a of this._selection) {
      if (changes.color !== undefined && a.color !== changes.color) {
        a.color = changes.color;
        changed = true;
      }
      if (changes.fillColor !== undefined && FILLABLE_TYPES.has(a.type)) {
        const fillable = a as ShapeAnnotation | TextAnnotation;
        if (fillable.fillColor !== changes.fillColor) { fillable.fillColor = changes.fillColor; changed = true; }
      }
      if (changes.thickness !== undefined && STROKED_TYPES.has(a.type)) {
        const stroked = a as ShapeAnnotation;
        if (stroked.thickness !== changes.thickness) { stroked.thickness = changes.thickness; changed = true; }
      }
    }
    if (!changed) return;
    this.redrawAll();
    if (commit) this._pushHistory();
  }

  commitSelectedEdit() {
    this._pushHistory();
  }

  _setSelection(annotations: Iterable<Annotation>) {
    this._selection = new Set(annotations);
    this.redrawAll();
    this._selectionChanged();
  }

  _clearSelection(redraw = true) {
    const had = this._selection.size > 0;
    this._selection.clear();
    if (had && redraw) this.redrawAll();
    if (had) this._selectionChanged();
  }

  _selectionChanged() {
    this.onSelectionChange?.();
    this._refreshTextBar();
  }

  /** Show the text bar for the text box being typed, else for selected text, else hide it. */
  _refreshTextBar() {
    const target = this._textEdit ?? this._selectionTextTarget();
    if (target) this.onTextBarShow?.(target);
    else        this.onTextBarHide?.();
  }

  /** The text annotations in the selection as a formatting-bar target; null if there are none. */
  _selectionTextTarget(): TextBarTarget | null {
    const texts = this.selectedAnnotations().filter((a): a is TextAnnotation => a.type === 'text');
    if (texts.length === 0) return null;
    const first = texts[0];
    const p = this.pages[first.pageNum - 1];
    if (!p) return null;
    return {
      container: p.wrapper,
      bounds: () => {
        const { width: w, height: h } = p.annotCanvas;
        const b = this._getAnnotBounds(first, w, h)!;
        const sx = p.wrapper.offsetWidth / w, sy = p.wrapper.offsetHeight / h;
        return { left: b.x * sx, top: b.y * sy, width: b.w * sx, height: b.h * sy };
      },
      style: first,
      setStyle: (changes) => {
        for (const t of texts) Object.assign(t, changes);
        Object.assign(this.textStyle, changes);
        this.redrawAll();
        this._pushHistory();
      },
      remove: () => this.deleteSelected(),
    };
  }

  // ── Cut / paste ─────────────────────────────────────────────

  static readonly _cuttableTypes = ['text', 'rect', 'oval', 'line', 'arrow'];

  /** The selected annotations that can be cut, copied and pasted. */
  _cuttableSelection(): Annotation[] {
    return this.selectedAnnotations().filter(a => Annotator._cuttableTypes.includes(a.type));
  }

  canCopy(): boolean {
    return this._cuttableSelection().length > 0;
  }

  hasClipboard(): boolean {
    return this._clipboard.length > 0;
  }

  copy() {
    const items = this._cuttableSelection();
    if (items.length === 0) return;
    this._clipboard = JSON.parse(JSON.stringify(items)) as Annotation[];
  }

  cut() {
    const items = this._cuttableSelection();
    if (items.length === 0) return;
    this._clipboard = JSON.parse(JSON.stringify(items)) as Annotation[];
    this._removeAnnotations(items);
    this._pushHistory();
  }

  /**
   * Paste the clipboard at the cursor — the first item lands where a single
   * one would (text at its anchor, a shape centred), the rest keep their
   * places relative to it — or, with no cursor on a page, just offset. What
   * was pasted becomes the selection.
   */
  paste() {
    if (this._clipboard.length === 0) return;
    const clones = JSON.parse(JSON.stringify(this._clipboard)) as Annotation[];
    let dx = 0.03, dy = 0.03;
    if (this._lastCursorPageNum !== null && this._lastCursorNorm !== null) {
      const [cx, cy] = this._lastCursorNorm;
      const [ax, ay] = Annotator._pasteAnchor(clones[0]);
      dx = cx - ax;
      dy = cy - ay;
      for (const c of clones) c.pageNum = this._lastCursorPageNum;
    }
    for (const c of clones) this._moveAnnotation(c, dx, dy);
    this.annotations.push(...clones);
    this._pushHistory();
    this._setSelection(clones);
  }

  /** The point of an annotation that pasting puts at the cursor. */
  static _pasteAnchor(ann: Annotation): [number, number] {
    if (ann.type === 'text') return [ann.x, ann.y];
    const s = ann as ShapeAnnotation;
    return [(s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2];
  }

  deleteSelected() {
    const items = this.selectedAnnotations();
    if (items.length === 0) return;
    this._removeAnnotations(items);
    this._pushHistory();
  }

  /** Take annotations out of the document (and the selection), and redraw. */
  _removeAnnotations(items: Annotation[]) {
    const gone = new Set(items);
    for (let i = this.annotations.length - 1; i >= 0; i--) {
      if (gone.has(this.annotations[i])) this.annotations.splice(i, 1);
    }
    const hadSelection = items.some(a => this._selection.has(a));
    for (const a of items) this._selection.delete(a);
    this.redrawAll();
    if (hadSelection) this._selectionChanged();
  }

  // ── Private: event wiring ──────────────────────────────────

  _attachAll() {
    this.pages.forEach((p, idx) => this._attachPage(p, idx + 1));

    // Document-level mouseup for highlight (text selection) and drag end
    this._docMouseupHighlight = (e) => {
      // Freehand highlight commit
      if (this._freehighlight) {
        const fh = this._freehighlight;
        this._freehighlight = null;
        if (fh.points.length > 3) {
          this.annotations.push({
            type:      'freeHighlight',
            pageNum:   fh.pageNum,
            points:    fh.points,
            color:     this.color,
            thickness: 20 / (this.viewer?.scale ?? 1),
          });
          this._pushHistory();
        }
        return;
      }

      // Text-selection highlight commit
      if (this.tool !== 'highlight') return;
      const wrapper = (e.target as Element)?.closest?.('.page-wrapper');
      if (!wrapper) return;
      const pageNum = Number((wrapper as HTMLElement).dataset.page);
      if (!pageNum) return;
      const p = this.pages[pageNum - 1];
      if (p) this._captureHighlight(p, pageNum);
    };
    document.addEventListener('mouseup', this._docMouseupHighlight);

    // Document-level mousemove / mouseup for dragging the selection, and for
    // the Shift+drag selection box (select tool)
    this._docMousemoveDrag = (e) => {
      if (this._marquee) {
        const m = this._marquee;
        m.to = [(e.clientX - m.pageRect.left) / m.pageRect.width, (e.clientY - m.pageRect.top) / m.pageRect.height];
        this._redrawPage(m.p, m.pageNum);
        return;
      }
      if (!this._drag) return;
      const { pageRect } = this._drag;
      const dx = (e.clientX - this._drag.x) / pageRect.width;
      const dy = (e.clientY - this._drag.y) / pageRect.height;
      // Each annotation moves from where it was when the drag began; moving in
      // place keeps it the same object, so it stays selected.
      for (const [ann, orig] of this._drag.originals) {
        const moved = JSON.parse(JSON.stringify(orig)) as Annotation;
        this._moveAnnotation(moved, dx, dy);
        Object.assign(ann, moved);
      }
      this.redrawAll();
    };
    document.addEventListener('mousemove', this._docMousemoveDrag);

    this._docMouseupDrag = (e) => {
      if (this._marquee) {
        this._finishMarquee();
        this._endDrag();
        return;
      }
      if (!this._drag) return;
      const moved = Math.hypot(e.clientX - this._drag.x, e.clientY - this._drag.y) > 3;
      this._endDrag();
      if (moved) this._pushHistory();
      this._refreshTextBar();
    };
    document.addEventListener('mouseup', this._docMouseupDrag);

    // Escape clears selection
    this._docKeydown = (e) => {
      if (e.key === 'Escape' && this.tool === 'select') this._clearSelection();
    };
    document.addEventListener('keydown', this._docKeydown);
  }

  // Clear drag state and give the document its text selection back.
  _endDrag() {
    this._drag    = null;
    this._marquee = null;
    document.body.style.userSelect = '';
  }

  // Add everything the selection box touches to the selection.
  _finishMarquee() {
    const m = this._marquee!;
    const x0 = Math.min(m.from[0], m.to[0]), x1 = Math.max(m.from[0], m.to[0]);
    const y0 = Math.min(m.from[1], m.to[1]), y1 = Math.max(m.from[1], m.to[1]);
    const { width: w, height: h } = m.p.annotCanvas;
    const touched = this.annotations.filter(a => {
      if (a.pageNum !== m.pageNum) return false;
      const b = this._getAnnotBounds(a, w, h);
      if (!b) return false;
      return b.x / w <= x1 && (b.x + b.w) / w >= x0 && b.y / h <= y1 && (b.y + b.h) / h >= y0;
    });
    this._marquee = null;
    this._setSelection([...this._selection, ...touched]);
  }

  // Remove all document-level listeners. Call when the tab is closed.
  destroy() {
    this._endDrag();
    document.removeEventListener('mouseup',   this._docMouseupHighlight);
    document.removeEventListener('mousemove', this._docMousemoveDrag);
    document.removeEventListener('mouseup',   this._docMouseupDrag);
    document.removeEventListener('keydown',   this._docKeydown);
  }

  _attachPage(p: PageData, pageNum: number) {
    const canvas     = p.annotCanvas;
    const wrapper    = p.wrapper;
    const shapeTools = ['line', 'rect', 'oval', 'arrow'];

    // ── Canvas events (draw / shape / eraser tools) ──────────

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (this.tool === 'draw') {
        this._drawing = true;
        this._currentPath = { pageNum, points: [this._canvasPos(canvas, e)], color: this.color, thickness: this.thickness };
      } else if (shapeTools.includes(this.tool)) {
        this._shapeStart = { pageNum, pos: this._canvasPos(canvas, e), p };
      } else if (this.tool === 'eraser') {
        this._erasing   = true;
        this._erasedAny = false;
        const [cx, cy] = this._canvasPos(canvas, e);
        this._tryErase(pageNum, canvas, p, cx, cy);
      }
    };

    const onMove = (e: MouseEvent) => {
      const [cx, cy] = this._canvasPos(canvas, e);
      this._lastCursorPageNum = pageNum;
      this._lastCursorNorm    = [cx / canvas.width, cy / canvas.height];

      if (this.tool === 'draw' && this._drawing) {
        // Ignore events from canvases other than the one the stroke started on.
        // Guards against fast mouse moves that skip the mouseleave event.
        if (this._currentPath?.pageNum !== pageNum) return;
        const pos = this._canvasPos(canvas, e);
        this._currentPath.points.push(pos);
        const ctx = canvas.getContext('2d')!;
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

      } else if (this.tool === 'eraser' && this._erasing) {
        const [cx, cy] = this._canvasPos(canvas, e);
        this._tryErase(pageNum, canvas, p, cx, cy);
      }
    };

    const onUp = (e: MouseEvent) => {
      if (e.button !== 0) return;

      if (this.tool === 'draw' && this._drawing) {
        this._drawing = false;
        if (this._currentPath && this._currentPath.points.length > 1) {
          const w = canvas.width, h = canvas.height;
          const scale = this.viewer?.scale ?? 1;
          this.annotations.push({
            type:      'draw',
            pageNum,
            points:    this._currentPath.points.map(([x, y]) => [x / w, y / h]),
            color:     this._currentPath.color,
            thickness: this._currentPath.thickness / scale,
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
          const scale = this.viewer?.scale ?? 1;
          this.annotations.push({
            type: this.tool as ShapeAnnotation['type'], pageNum,
            x1: x1 / w, y1: y1 / h,
            x2: x2 / w, y2: y2 / h,
            color:     this.color,
            thickness: this.thickness / scale,
            fillColor: (this.tool === 'rect' || this.tool === 'oval') ? this.fillColor : null,
          });
          this._pushHistory();
        }
        this._redrawPage(p, pageNum);

      } else if (this.tool === 'text') {
        const [cx, cy] = this._canvasPos(canvas, e);
        const w = canvas.width, h = canvas.height;
        const idx = this._hitTest(pageNum, cx / w, cy / h);
        if (idx >= 0 && this.annotations[idx].type === 'text') {
          this._editTextBox(p, pageNum, idx);
        } else {
          this._placeTextBox(p, pageNum, [cx, cy]);
        }

      } else if (this.tool === 'eraser' && this._erasing) {
        this._erasing = false;
        if (this._erasedAny) this._pushHistory();
        this._erasedAny = false;
      }
    };

    canvas.addEventListener('mousedown',  onDown);
    canvas.addEventListener('mousemove',  onMove);
    canvas.addEventListener('mouseup',    onUp);

    // Commit and stop a freehand stroke the moment the cursor leaves the canvas.
    // This keeps each stroke confined to the page it started on; the user must
    // click again to begin a new stroke on another page.
    canvas.addEventListener('mouseleave', () => {
      if (this.tool !== 'draw' || !this._drawing) return;
      if (this._currentPath?.pageNum !== pageNum) return;
      this._drawing = false;
      if (this._currentPath && this._currentPath.points.length > 1) {
        const w = canvas.width, h = canvas.height;
        const scale = this.viewer?.scale ?? 1;
        this.annotations.push({
          type:      'draw',
          pageNum,
          points:    this._currentPath.points.map(([x, y]) => [x / w, y / h]),
          color:     this._currentPath.color,
          thickness: this._currentPath.thickness / scale,
        });
        this._pushHistory();
      }
      this._currentPath = null;
    });

    // ── Wrapper events (highlight + select tool) ─────────────

    // Freehand highlight: starts on mousedown on non-text areas
    const onWrapperDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      // Let form field inputs (checkboxes, text, select) handle their own
      // events, and the text bar and a text box being typed in theirs.
      if ((e.target as Element)?.closest('[data-field-name], .text-bar, textarea')) return;

      if (this.tool === 'highlight') {
        if (!(e.target as Element)?.closest('.textLayer span')) {
          e.preventDefault(); // don't start text selection
          const rect = wrapper.getBoundingClientRect();
          const nx = (e.clientX - rect.left) / rect.width;
          const ny = (e.clientY - rect.top)  / rect.height;
          this._freehighlight = { pageNum, p, points: [[nx, ny]] };
        }
        return;
      }

      if (this.tool === 'select') {
        const rect = wrapper.getBoundingClientRect();
        const nx = (e.clientX - rect.left) / rect.width;
        const ny = (e.clientY - rect.top)  / rect.height;
        const idx = this._hitTest(pageNum, nx, ny);
        // Ctrl/Shift+click adds or removes; Shift+drag on empty page draws a
        // selection box; a plain drag on empty page still selects page text.
        const additive = e.ctrlKey || e.metaKey || e.shiftKey;
        if (idx < 0) {
          if (e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
            window.getSelection()?.removeAllRanges();
            document.body.style.userSelect = 'none';
            this._marquee = { pageNum, p, pageRect: rect, from: [nx, ny], to: [nx, ny] };
          } else if (!additive) {
            this._clearSelection();
          }
          return;
        }

        // Starting a drag (or a selection change), not a text selection.
        e.preventDefault();
        e.stopPropagation();
        window.getSelection()?.removeAllRanges();

        const ann = this.annotations[idx];
        const selection = new Set(this._selection);
        if (additive) {
          if (selection.has(ann)) selection.delete(ann);
          else                    selection.add(ann);
        } else if (!selection.has(ann)) {
          selection.clear();
          selection.add(ann);
        }
        this._setSelection(selection);
        if (!selection.has(ann)) return; // just deselected: nothing to drag

        document.body.style.userSelect = 'none';
        this.onTextBarHide?.(); // back once the drag ends
        this._drag = {
          x: e.clientX, y: e.clientY, pageRect: rect,
          originals: new Map([...selection].map(a => [a, JSON.parse(JSON.stringify(a)) as Annotation])),
        };
      }
    };

    // Freehand highlight: draw stroke as mouse moves.
    // Redraw the whole page + full path each frame so round caps at segment
    // joints don't stack alpha (a single stroke never compounds with itself).
    const onWrapperMove = (e: MouseEvent) => {
      const rect = wrapper.getBoundingClientRect();
      this._lastCursorPageNum = pageNum;
      this._lastCursorNorm    = [(e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height];

      if (!this._freehighlight || this._freehighlight.pageNum !== pageNum) return;
      const nx = (e.clientX - rect.left) / rect.width;
      const ny = (e.clientY - rect.top)  / rect.height;
      const fh = this._freehighlight;
      fh.points.push([nx, ny]);

      this._redrawPage(p, pageNum);
      const cvs = p.annotCanvas;
      const ctx = cvs.getContext('2d')!;
      const w = cvs.width, h = cvs.height;
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = this.color;
      ctx.lineWidth   = 20;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
      ctx.beginPath();
      fh.points.forEach(([px, py], i) => {
        if (i === 0) ctx.moveTo(px * w, py * h); else ctx.lineTo(px * w, py * h);
      });
      ctx.stroke();
      ctx.restore();
    };

    // Double-click on text annotation to edit it
    const onWrapperDblClick = (e: MouseEvent) => {
      if (this.tool !== 'select') return;
      const rect = wrapper.getBoundingClientRect();
      const nx = (e.clientX - rect.left) / rect.width;
      const ny = (e.clientY - rect.top)  / rect.height;
      const idx = this._hitTest(pageNum, nx, ny);
      if (idx >= 0 && this.annotations[idx].type === 'text') {
        this._editTextBox(p, pageNum, idx);
      }
    };

    wrapper.addEventListener('mousedown',  onWrapperDown,    { capture: true });
    wrapper.addEventListener('mousemove',  onWrapperMove);
    wrapper.addEventListener('dblclick',   onWrapperDblClick);

    this._handlers[pageNum] = { onDown, onMove, onUp, canvas };
  }

  // ── Highlight (text selection → annotation) ─────────────────

  _captureHighlight(p: PageData, pageNum: number) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;

    const wrapper  = p.wrapper;
    const wrapRect = wrapper.getBoundingClientRect();

    const rects = [];
    for (let i = 0; i < sel.rangeCount; i++) {
      const range = sel.getRangeAt(i);
      for (const r of range.getClientRects()) {
        if (r.width < 1) continue;

        const el   = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        const span = el?.closest?.('.textLayer span');
        let textH  = r.height * 0.55;
        if (span) {
          const fs = parseFloat(window.getComputedStyle(span).fontSize);
          if (fs > 0) textH = Math.min(fs * 1.25, r.height * 0.9);
        }

        const trimV = (r.height - textH) / 2;
        rects.push({
          x:      (r.left - wrapRect.left) / wrapRect.width,
          y:      (r.top  - wrapRect.top  + trimV) / wrapRect.height,
          width:  r.width  / wrapRect.width,
          height: textH    / wrapRect.height,
        });
      }
    }
    sel.removeAllRanges();
    if (rects.length === 0) return;

    const annot: HighlightAnnotation = { type: 'highlight', pageNum, rects, color: this.color };
    this.annotations.push(annot);
    this._pushHistory();
    const ctx = p.annotCanvas.getContext('2d')!;
    this._drawAnnotation(ctx, annot, p.annotCanvas.width, p.annotCanvas.height);
  }

  // ── Text box placement ──────────────────────────────────────

  _placeTextBox(p: PageData, pageNum: number, [cx, cy]: number[]) {
    const canvas   = p.annotCanvas;
    const wrapper  = p.wrapper;
    const w = canvas.width, h = canvas.height;
    const scaleX   = wrapper.offsetWidth  / w;
    const scaleY   = wrapper.offsetHeight / h;
    const scale    = this.viewer?.scale ?? 1;

    this._openTextarea(wrapper, cx * scaleX, cy * scaleY, '', {
      style:   { ...this.textStyle },
      widthPx: TEXT_DEFAULT_WIDTH * scale * scaleX,
      onCommit: (text, widthPx, style) => {
        if (!text) return;
        const annot: TextAnnotation = {
          type: 'text', pageNum,
          x: cx / w, y: cy / h,
          width: widthPx / scaleX / w,
          text,
          ...style,
        };
        this.annotations.push(annot);
        this._pushHistory();
        const ctx = canvas.getContext('2d')!;
        this._drawAnnotation(ctx, annot, w, h);
      },
    });
  }

  _editTextBox(p: PageData, pageNum: number, idx: number) {
    const ann    = this.annotations[idx];
    const canvas = p.annotCanvas;
    const wrapper = p.wrapper;
    const w = canvas.width, h = canvas.height;
    const scaleX = wrapper.offsetWidth  / w;
    const scaleY = wrapper.offsetHeight / h;

    // Temporarily remove annotation so the canvas area is clear
    this._clearSelection(false);
    this.annotations.splice(idx, 1);
    this._redrawPage(p, pageNum);

    if (ann.type !== 'text') return; // _editTextBox is only called on text annotations
    const { fontSize, bold, underline, color, fillColor } = ann;

    this._openTextarea(wrapper, ann.x * w * scaleX, ann.y * h * scaleY, ann.text, {
      style:   { fontSize, bold, underline, color, fillColor },
      widthPx: ann.width * w * scaleX,
      onCommit: (text, widthPx, style) => {
        const newAnn: TextAnnotation = { ...ann, ...style, text, width: widthPx / scaleX / w };
        if (text) {
          this.annotations.splice(idx, 0, newAnn);
          this._pushHistory();
          this._redrawPage(p, pageNum);
        }
      },
      onCancel: () => {
        // Restore original on Escape
        this.annotations.splice(idx, 0, ann);
        this._redrawPage(p, pageNum);
      },
      onDelete: () => {
        this._pushHistory();
        this._redrawPage(p, pageNum);
      },
    });
  }

  // The textarea's content box is exactly `widthPx` wide, so the browser
  // soft-wraps at the same width the annotation will. Only width is
  // draggable; height grows to fit the text. `left`/`top` are the anchor of
  // the text, in the wrapper's CSS pixels.
  _openTextarea(
    wrapper: HTMLElement,
    left: number,
    top: number,
    initialText: string,
    { style, widthPx, onCommit, onCancel, onDelete }: {
      style: TextStyle;
      widthPx: number;
      onCommit?: (text: string, widthPx: number, style: TextStyle) => void;
      onCancel?: () => void;
      onDelete?: () => void;
    },
  ) {
    const scale = this.viewer?.scale ?? 1;
    const ta = document.createElement('textarea');
    ta.value = initialText;
    ta.style.cssText = `
      position:        absolute;
      left:            ${left - TEXTAREA_INSET}px;
      box-sizing:      content-box;
      width:           ${Math.max(widthPx, style.fontSize * scale)}px;
      border:          ${TEXTAREA_BORDER}px dashed rgba(128,128,128,0.6);
      font-kerning:    none;
      resize:          horizontal;
      z-index:         10;
      outline:         none;
      padding:         ${TEXTAREA_PADDING_Y}px ${TEXTAREA_PADDING_X}px;
      overflow:        hidden;
      white-space:     pre-wrap;
      word-break:      break-word;
    `;
    // Everything the style decides; re-run whenever it changes.
    const applyStyle = () => {
      const fontPx = style.fontSize * scale;
      ta.style.top            = `${top - fontPx / 2}px`;
      ta.style.font           = `${style.bold ? 'bold' : 'normal'} ${fontPx}px ${TEXT_FONT_STACK}`;
      ta.style.lineHeight     = `${(style.fontSize + TEXT_LINE_GAP) * scale}px`;
      ta.style.color          = style.color;
      ta.style.caretColor     = style.color;
      ta.style.textDecoration = style.underline ? 'underline' : 'none';
      ta.style.background     = style.fillColor ?? 'transparent';
    };
    // Grow to fit the wrapped text; reset first so it can shrink too.
    const fitHeight = () => {
      ta.style.height = 'auto';
      ta.style.height = `${ta.scrollHeight}px`;
    };
    applyStyle();
    wrapper.appendChild(ta);
    fitHeight();
    // Re-fit on width changes only — height changes are this callback's own doing.
    let lastWidth = ta.clientWidth;
    const resizeObserver = new ResizeObserver(() => {
      if (ta.clientWidth === lastWidth) return;
      lastWidth = ta.clientWidth;
      fitHeight();
    });
    resizeObserver.observe(ta);
    ta.focus();
    // Move caret to end if editing existing text
    if (initialText) { ta.selectionStart = ta.selectionEnd = initialText.length; }

    const contentWidth = () => ta.clientWidth - TEXTAREA_PADDING_X * 2;

    let closed = false;
    // Take the textarea down, once; returns its final content width, or null
    // if it was already closed.
    const close = (): number | null => {
      if (closed) return null;
      closed = true;
      resizeObserver.disconnect();
      const width = contentWidth();
      ta.remove();
      this._textEdit = null;
      this._refreshTextBar();
      return width;
    };
    const commit = () => {
      const text  = ta.value.trim();
      const width = close();
      if (width !== null) onCommit?.(text, width, { ...style });
    };
    const cancel = () => {
      if (close() !== null) onCancel?.();
    };

    ta.addEventListener('input',   fitHeight);
    ta.addEventListener('blur',    commit);
    ta.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });

    this._textEdit = {
      container: wrapper,
      bounds: () => ({ left: ta.offsetLeft, top: ta.offsetTop, width: ta.offsetWidth, height: ta.offsetHeight }),
      watch: ta,
      style,
      setStyle: (changes) => {
        Object.assign(style, changes);
        Object.assign(this.textStyle, changes);
        applyStyle();
        fitHeight();
      },
      remove: () => {
        if (close() !== null) onDelete?.();
      },
    };
    this._refreshTextBar();
  }

  // ── Text measurement ────────────────────────────────────────

  /** Off-screen canvas used only to measure text width. */
  _measureCanvas: HTMLCanvasElement | null = null;

  _measurer(fontPx: number, bold: boolean): MeasureText {
    this._measureCanvas ??= document.createElement('canvas');
    const ctx = this._measureCanvas.getContext('2d')!;
    ctx.font = `${bold ? 'bold ' : ''}${fontPx}px ${TEXT_FONT_STACK}`;
    return (text: string) => ctx.measureText(text).width;
  }

  /** The lines a text annotation occupies on a canvas `w` px wide. */
  _textLines(ann: TextAnnotation, w: number): string[] {
    const scale = this.viewer?.scale ?? 1;
    return wrapText(ann.text, ann.width * w, this._measurer(ann.fontSize * scale, ann.bold));
  }

  /** A text annotation's box in normalised page coords: stored width, wrapped height. */
  _textBounds(ann: TextAnnotation, w: number, h: number) {
    const scale = this.viewer?.scale ?? 1;
    const lines = this._textLines(ann, w);
    return {
      x: ann.x,
      y: ann.y,
      w: ann.width,
      h: textBlockHeight(lines.length, ann.fontSize) * scale / h,
    };
  }

  // ── Hit testing ─────────────────────────────────────────────

  _hitTest(pageNum: number, nx: number, ny: number) {
    const p = this.pages[pageNum - 1];
    const w = p?.annotCanvas.width  ?? 1;
    const h = p?.annotCanvas.height ?? 1;
    for (let i = this.annotations.length - 1; i >= 0; i--) {
      const a = this.annotations[i];
      if (a.pageNum !== pageNum) continue;
      if (this._annotContains(a, nx, ny, w, h)) return i;
    }
    return -1;
  }

  _annotContains(a: Annotation, nx: number, ny: number, w: number, h: number) {
    const tol = 0.015;
    if (a.type === 'draw' || a.type === 'freeHighlight') {
      for (let i = 0; i < a.points.length - 1; i++) {
        if (this._distToSegment(nx, ny, a.points[i], a.points[i + 1]) < tol) return true;
      }
    } else if (a.type === 'highlight') {
      return a.rects.some(r =>
        nx >= r.x - tol && nx <= r.x + r.width  + tol &&
        ny >= r.y - tol && ny <= r.y + r.height + tol
      );
    } else if (a.type === 'text') {
      const b = this._textBounds(a, w, h);
      const px = 4 / w, py = 4 / h; // small pixel tolerance
      return nx >= b.x - px && nx <= b.x + b.w + px &&
             ny >= b.y - py && ny <= b.y + b.h + py;
    } else if (a.type === 'rect' || a.type === 'oval') {
      const x1 = Math.min(a.x1, a.x2), x2 = Math.max(a.x1, a.x2);
      const y1 = Math.min(a.y1, a.y2), y2 = Math.max(a.y1, a.y2);
      return nx >= x1 - tol && nx <= x2 + tol && ny >= y1 - tol && ny <= y2 + tol;
    } else if (a.type === 'line' || a.type === 'arrow') {
      return this._distToSegment(nx, ny, [a.x1, a.y1], [a.x2, a.y2]) < tol;
    }
    return false;
  }

  _distToSegment(px: number, py: number, [ax, ay]: number[], [bx, by]: number[]) {
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  // ── Eraser ──────────────────────────────────────────────────

  _tryErase(pageNum: number, canvas: HTMLCanvasElement, p: PageData, cx: number, cy: number) {
    const w = canvas.width, h = canvas.height;
    const idx = this._hitTest(pageNum, cx / w, cy / h);
    if (idx >= 0) {
      this._removeAnnotations([this.annotations[idx]]);
      this._erasedAny = true;
    }
  }

  // ── Select / move ────────────────────────────────────────────

  _moveAnnotation(ann: Annotation, dx: number, dy: number) {
    if (ann.type === 'draw' || ann.type === 'freeHighlight') {
      ann.points = ann.points.map(([x, y]: [number, number]) => [x + dx, y + dy]);
    } else if (ann.type === 'highlight') {
      ann.rects = ann.rects.map(r => ({ ...r, x: r.x + dx, y: r.y + dy }));
    } else if (ann.type === 'text') {
      ann.x += dx; ann.y += dy;
    } else if (ann.type === 'rect' || ann.type === 'oval' || ann.type === 'line' || ann.type === 'arrow') {
      ann.x1 += dx; ann.y1 += dy;
      ann.x2 += dx; ann.y2 += dy;
    }
  }

  _getAnnotBounds(ann: Annotation, w: number, h: number) {
    if (ann.type === 'draw' || ann.type === 'freeHighlight') {
      const xs = ann.points.map(([nx]: [number, number]) => nx * w);
      const ys = ann.points.map(([, ny]: [number, number]) => ny * h);
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    } else if (ann.type === 'highlight') {
      const allX = ann.rects.flatMap(r => [r.x * w, (r.x + r.width) * w]);
      const allY = ann.rects.flatMap(r => [r.y * h, (r.y + r.height) * h]);
      return { x: Math.min(...allX), y: Math.min(...allY), w: Math.max(...allX) - Math.min(...allX), h: Math.max(...allY) - Math.min(...allY) };
    } else if (ann.type === 'text') {
      const b = this._textBounds(ann, w, h);
      return { x: b.x * w, y: b.y * h, w: b.w * w, h: b.h * h };
    } else if (ann.type === 'rect' || ann.type === 'oval' || ann.type === 'line' || ann.type === 'arrow') {
      const x1 = Math.min(ann.x1, ann.x2) * w, x2 = Math.max(ann.x1, ann.x2) * w;
      const y1 = Math.min(ann.y1, ann.y2) * h, y2 = Math.max(ann.y1, ann.y2) * h;
      return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }
    return null;
  }

  // ── Shape helpers ────────────────────────────────────────────

  _constrainShape(tool: string, x1: number, y1: number, x2: number, y2: number, shift: boolean): [number, number] {
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

  _drawPreview(canvas: HTMLCanvasElement, [x1, y1]: number[], [x2, y2]: number[]) {
    const ctx = canvas.getContext('2d')!;
    ctx.save();
    const filled = (this.tool === 'rect' || this.tool === 'oval') && !!this.fillColor;
    if (filled) ctx.fillStyle = this.fillColor!;
    ctx.strokeStyle = this.color;
    ctx.lineWidth   = this.thickness;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.setLineDash([4, 4]);
    this._drawShape(ctx, this.tool, x1, y1, x2, y2, filled);
    ctx.setLineDash([]);
    ctx.restore();
  }

  _drawShape(ctx: CanvasRenderingContext2D, type: string, x1: number, y1: number, x2: number, y2: number, fill = false) {
    if (type === 'line') {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    } else if (type === 'rect') {
      ctx.beginPath();
      ctx.rect(x1, y1, x2 - x1, y2 - y1);
      if (fill) ctx.fill();
      ctx.stroke();
    } else if (type === 'oval') {
      const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
      const rx = Math.max(Math.abs(x2 - x1) / 2, 1);
      const ry = Math.max(Math.abs(y2 - y1) / 2, 1);
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      if (fill) ctx.fill();
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

  // ── Drawing ─────────────────────────────────────────────────

  _redrawPage(p: PageData, pageNum: number) {
    const ctx = p.annotCanvas.getContext('2d')!;
    const { width: w, height: h } = p.annotCanvas;
    ctx.clearRect(0, 0, w, h);
    this.annotations
      .filter(a => a.pageNum === pageNum)
      .forEach(a => this._drawAnnotation(ctx, a, w, h));

    // Selection indicators and the selection box on top
    for (const sel of this._selection) {
      if (sel.pageNum === pageNum) this._drawSelectionIndicator(ctx, sel, w, h);
    }
    if (this._marquee?.pageNum === pageNum) {
      const { from: [ax, ay], to: [bx, by] } = this._marquee;
      ctx.save();
      ctx.strokeStyle = '#4488ff';
      ctx.fillStyle   = 'rgba(68, 136, 255, 0.08)';
      ctx.lineWidth   = 1;
      ctx.setLineDash([4, 3]);
      const x = Math.min(ax, bx) * w, y = Math.min(ay, by) * h;
      const rw = Math.abs(bx - ax) * w, rh = Math.abs(by - ay) * h;
      ctx.fillRect(x, y, rw, rh);
      ctx.strokeRect(x, y, rw, rh);
      ctx.restore();
    }
  }

  _drawSelectionIndicator(ctx: CanvasRenderingContext2D, ann: Annotation, w: number, h: number) {
    const b = this._getAnnotBounds(ann, w, h);
    if (!b) return;
    const pad = 5;
    ctx.save();
    ctx.strokeStyle = '#4488ff';
    ctx.lineWidth   = 2;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
    ctx.setLineDash([]);
    ctx.restore();
  }

  _drawAnnotation(ctx: CanvasRenderingContext2D, annot: Annotation, w: number, h: number) {
    const scale = this.viewer?.scale ?? 1;
    ctx.save();
    if (annot.type === 'draw') {
      ctx.strokeStyle = annot.color;
      ctx.lineWidth   = annot.thickness * scale;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
      ctx.beginPath();
      annot.points.forEach(([nx, ny]: [number, number], i: number) => {
        const x = nx * w, y = ny * h;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();

    } else if (annot.type === 'freeHighlight') {
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = annot.color;
      ctx.lineWidth   = annot.thickness * scale;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
      ctx.beginPath();
      annot.points.forEach(([nx, ny]: [number, number], i: number) => {
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
      const fs     = annot.fontSize * scale;
      const weight = annot.bold ? 'bold ' : '';
      if (annot.fillColor) {
        const b = this._textBounds(annot, w, h);
        ctx.fillStyle = annot.fillColor;
        ctx.fillRect(b.x * w, b.y * h, b.w * w, b.h * h);
      }
      ctx.fillStyle = annot.color;
      ctx.font      = `${weight}${fs}px ${TEXT_FONT_STACK}`;
      this._textLines(annot, w).forEach((line: string, i: number) => {
        const x = annot.x * w;
        // Offsets are in points and scaled here, so a line keeps the same
        // position on the page at every zoom level — and the same position
        // saver.ts writes it to in the saved PDF.
        const y = annot.y * h + textBaselineOffset(annot.fontSize, i) * scale;
        ctx.fillText(line, x, y);
        if (annot.underline) {
          const metrics = ctx.measureText(line);
          ctx.fillRect(x, y + TEXT_LINE_GAP * scale, metrics.width,
                       Math.max(1, textUnderlineThickness(annot.fontSize) * scale));
        }
      });

    } else if (annot.type === 'line' || annot.type === 'rect' || annot.type === 'oval' || annot.type === 'arrow') {
      const filled = (annot.type === 'rect' || annot.type === 'oval') && !!annot.fillColor;
      if (filled) ctx.fillStyle = annot.fillColor!;
      ctx.strokeStyle = annot.color;
      ctx.lineWidth   = annot.thickness * scale;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
      this._drawShape(ctx, annot.type, annot.x1 * w, annot.y1 * h, annot.x2 * w, annot.y2 * h, filled);
    }
    ctx.restore();
  }

  _canvasPos(canvas: HTMLCanvasElement, e: MouseEvent): [number, number] {
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
      pan:       'inherit', // pane-level cursor handles grab/grabbing
    };
    this.pages.forEach(p => {
      p.annotCanvas.style.cursor = (cursors as Record<string, string>)[this.tool] || 'default';
      p.wrapper.style.cursor     = this.tool === 'select' ? 'default' : '';
    });
  }

  // ── Undo / redo history ──────────────────────────────────────

  _pushHistory() {
    this.onCommit?.();
  }
}
