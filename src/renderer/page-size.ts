// Reamlet — page sizes as people write them (mm or inches) and as PDFs hold them (points)
// SPDX-License-Identifier: GPL-3.0-or-later

export type Unit = 'mm' | 'in';

export const MM_PER_INCH  = 25.4;
export const MM_PER_POINT = MM_PER_INCH / 72;

/** A page size, short side first (a page is the same size whichever way up it is). */
export interface PageSizeMm { widthMm: number; heightMm: number }

// The same limits as the main process applies when it saves a rule (printer-rules.ts),
// so a size is turned down here, with a reason, rather than silently dropped there.
export const MIN_SIDE_MM = 10;
export const MAX_SIDE_MM = 5000;

/** `mm`, rounded to a tenth. */
const tenth = (mm: number) => Math.round(mm * 10) / 10;

/** A size with its sides in short-then-long order, rounded as rules are stored. */
export function normalizeSize(widthMm: number, heightMm: number): PageSizeMm {
  return { widthMm: tenth(Math.min(widthMm, heightMm)), heightMm: tenth(Math.max(widthMm, heightMm)) };
}

/** The size of a PDF page of `widthPt` x `heightPt` points. */
export function sizeOfPage(widthPt: number, heightPt: number): PageSizeMm {
  return normalizeSize(widthPt * MM_PER_POINT, heightPt * MM_PER_POINT);
}

/**
 * The size typed into the width and height boxes, or why it can't be one.
 * Accepts a decimal comma, as people type it.
 */
export function sizeFromInput(width: string, height: string, unit: Unit): PageSizeMm | { error: string } {
  const toMm = (text: string) => Number(text.trim().replace(',', '.')) * (unit === 'in' ? MM_PER_INCH : 1);
  const w = toMm(width), h = toMm(height);
  if (!width.trim() || !height.trim() || !Number.isFinite(w) || !Number.isFinite(h)) {
    return { error: 'Enter a width and a height.' };
  }
  if ([w, h].some(mm => mm < MIN_SIDE_MM || mm > MAX_SIDE_MM)) {
    // The limits in the unit the user typed, narrowed inwards so what's quoted is always accepted.
    const limits = unit === 'in'
      ? `${Math.ceil(MIN_SIDE_MM / MM_PER_INCH * 10) / 10} and ${Math.floor(MAX_SIDE_MM / MM_PER_INCH)} inches`
      : `${MIN_SIDE_MM} and ${MAX_SIDE_MM} mm`;
    return { error: `Each side must be between ${limits}.` };
  }
  return normalizeSize(w, h);
}

/** Drop trailing zeros: 101.60 -> "101.6", 4.00 -> "4". */
const trim = (n: number, digits: number) => String(Number(n.toFixed(digits)));

/** A size as shown to people, in both units: "101.6 × 152.4 mm (4 × 6 in)". */
export function describeSize({ widthMm, heightMm }: PageSizeMm): string {
  return `${trim(widthMm, 1)} × ${trim(heightMm, 1)} mm (${trim(widthMm / MM_PER_INCH, 2)} × ${trim(heightMm / MM_PER_INCH, 2)} in)`;
}

/** Whether two sizes are the same size as rules are stored (to a tenth of a millimetre). */
export function sameSize(a: PageSizeMm, b: PageSizeMm): boolean {
  const x = normalizeSize(a.widthMm, a.heightMm), y = normalizeSize(b.widthMm, b.heightMm);
  return x.widthMm === y.widthMm && x.heightMm === y.heightMm;
}
