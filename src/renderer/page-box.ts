// Reamlet — page geometry shared by the viewer and the saver
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * The region of a PDF page that is actually displayed — the CropBox clipped to
 * the MediaBox — expressed in PDF points in the page's own user space.
 *
 * `x`/`y` are the lower-left corner, which is *not* always the origin: a page
 * can carry a MediaBox with a non-zero origin, or a CropBox inset into it. Any
 * code converting between screen coordinates and PDF user space has to add that
 * corner back, or the result lands in the wrong part of the page.
 */
export interface PageBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Build a PageBox from a PDF.js viewport's `viewBox` — [xMin, yMin, xMax, yMax]
 * of the region PDF.js renders. Corners are re-normalised here so a box written
 * with its corners the other way round still yields positive dimensions.
 */
export function pageBoxFromViewBox(viewBox: number[]): PageBox {
  const [ax, ay, bx, by] = viewBox;
  const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx);
  const y0 = Math.min(ay, by), y1 = Math.max(ay, by);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** A rectangle as pdf-lib reports a page's MediaBox or CropBox. */
interface Box { x: number; y: number; width: number; height: number }

/**
 * The visible box of a pdf-lib page — the CropBox clipped to the MediaBox, with
 * either box's corners normalised in case they were written the other way round.
 */
export function visibleBox(page: { getMediaBox(): Box; getCropBox(): Box }): PageBox {
  const norm = (b: Box) => ({
    x0: Math.min(b.x, b.x + b.width),
    y0: Math.min(b.y, b.y + b.height),
    x1: Math.max(b.x, b.x + b.width),
    y1: Math.max(b.y, b.y + b.height),
  });
  const media = norm(page.getMediaBox());
  const crop  = norm(page.getCropBox());
  const x0 = Math.max(media.x0, crop.x0), x1 = Math.min(media.x1, crop.x1);
  const y0 = Math.max(media.y0, crop.y0), y1 = Math.min(media.y1, crop.y1);
  // An empty intersection means the boxes disagree beyond repair; the MediaBox
  // is the one the spec guarantees, so fall back to it rather than to nothing.
  if (x1 <= x0 || y1 <= y0) {
    return { x: media.x0, y: media.y0, width: media.x1 - media.x0, height: media.y1 - media.y0 };
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * Convert normalised display coords (0–1, y-down, relative to the page as it is
 * shown on screen) to a point in PDF user space (y-up).
 *
 * `rot` is the total display rotation — the PDF's own /Rotate plus any rotation
 * the user applied. The formulas invert the PDF.js viewport transform, with W
 * and H the box's width and height:
 *   rot=0:   pdf = (nx·W,     (1-ny)·H)
 *   rot=90:  pdf = (ny·W,     nx·H)
 *   rot=180: pdf = ((1-nx)·W, ny·H)
 *   rot=270: pdf = ((1-ny)·W, (1-nx)·H)
 * The box's lower-left corner is added to both axes at the end.
 */
export function toPdfCoords(nx: number, ny: number, box: PageBox, rot: number): [number, number] {
  const { x: bx, y: by, width: w, height: h } = box;
  switch (((rot || 0) % 360 + 360) % 360) {
    case 90:  return [bx +       ny * w, by +       nx * h];
    case 180: return [bx + (1 - nx) * w, by +       ny * h];
    case 270: return [bx + (1 - ny) * w, by + (1 - nx) * h];
    default:  return [bx +       nx * w, by + (1 - ny) * h];
  }
}

/**
 * The size of the page as displayed, which is what an annotation's normalised
 * coordinates are a fraction of — width and height swap for quarter turns.
 */
export function displaySize(box: PageBox, rot: number): { width: number; height: number } {
  return (Math.abs(rot) % 180 === 0)
    ? { width: box.width,  height: box.height }
    : { width: box.height, height: box.width };
}
