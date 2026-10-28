// Reamlet — the annotation clipboard: annotations cut or copied in any tab,
// ready to paste into any tab of any window. It is Reamlet's own, held as JSON
// (main keeps a copy for the other windows); the system clipboard is untouched.
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Annotation, ShapeAnnotation } from './types.js';

/** A size in PDF points: [width, height] of a page as it is displayed. */
export type PageSize = [number, number];

/** One annotation on the clipboard, and the size of the page it came from. */
export interface ClipboardItem {
  annotation: Annotation;
  pageSize:   PageSize | null;
}

let _items: ClipboardItem[] = [];
let _listener: ((json: string) => void) | null = null;

/** Be told, with the clipboard as JSON, whenever this window cuts or copies. */
export function setClipboardListener(listener: ((json: string) => void) | null) {
  _listener = listener;
}

export function clipboardHasItems(): boolean {
  return _items.length > 0;
}

export function clipboardItems(): ClipboardItem[] {
  return JSON.parse(JSON.stringify(_items)) as ClipboardItem[];
}

/** Put annotations on the clipboard (a cut or copy here). */
export function setClipboard(items: ClipboardItem[]) {
  const json = JSON.stringify(items);
  _items = JSON.parse(json) as ClipboardItem[];
  _listener?.(json);
}

/** Take the clipboard another window cut or copied to. Anything malformed is ignored. */
export function receiveClipboard(json: string | null) {
  if (!json) return;
  try {
    const items = JSON.parse(json) as unknown;
    if (Array.isArray(items) && items.every(i => i && typeof i === 'object' && 'annotation' in i)) {
      _items = items as ClipboardItem[];
    }
  } catch { /* not ours */ }
}

/** The point of an annotation that pasting puts at the cursor. */
export function pasteAnchor(ann: Annotation): [number, number] {
  if (ann.type === 'text') return [ann.x, ann.y];
  const s = ann as ShapeAnnotation;
  return [(s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2];
}

/**
 * Where the clipboard's annotations go on a paste. They are positioned in
 * fractions of the page, so on a page of another size each is rescaled about
 * the anchor to keep its size in points. With the cursor on a page they all go
 * to that page, the first one's anchor at the cursor and the rest keeping their
 * places relative to it; otherwise each stays on its own page (the last page,
 * if this document is shorter), nudged so it doesn't sit exactly on top.
 */
export function placeClipboard(
  items:      ClipboardItem[],
  cursor:     { pageNum: number; at: [number, number] } | null,
  pageCount:  number,
  pageSizeOf: (pageNum: number) => PageSize | null,
): Annotation[] {
  if (items.length === 0 || pageCount < 1) return [];
  const clones = JSON.parse(JSON.stringify(items)) as ClipboardItem[];
  const [ax, ay] = pasteAnchor(clones[0].annotation);
  return clones.map(({ annotation: a, pageSize: from }) => {
    a.pageNum = cursor ? cursor.pageNum : Math.min(Math.max(1, a.pageNum), pageCount);
    const to = pageSizeOf(a.pageNum);
    if (from && to && to[0] > 0 && to[1] > 0) {
      _scaleAbout(a, ax, ay, from[0] / to[0], from[1] / to[1]);
    }
    const [dx, dy] = cursor ? [cursor.at[0] - ax, cursor.at[1] - ay] : [0.03, 0.03];
    _move(a, dx, dy);
    return a;
  });
}

function _scaleAbout(a: Annotation, ax: number, ay: number, sx: number, sy: number) {
  const x = (v: number) => ax + (v - ax) * sx;
  const y = (v: number) => ay + (v - ay) * sy;
  if (a.type === 'text') {
    a.x = x(a.x); a.y = y(a.y);
    a.width *= sx;
  } else if (a.type === 'rect' || a.type === 'oval' || a.type === 'line' || a.type === 'arrow') {
    a.x1 = x(a.x1); a.y1 = y(a.y1);
    a.x2 = x(a.x2); a.y2 = y(a.y2);
  }
}

function _move(a: Annotation, dx: number, dy: number) {
  if (a.type === 'text') {
    a.x += dx; a.y += dy;
  } else if (a.type === 'rect' || a.type === 'oval' || a.type === 'line' || a.type === 'arrow') {
    a.x1 += dx; a.y1 += dy;
    a.x2 += dx; a.y2 += dy;
  }
}
