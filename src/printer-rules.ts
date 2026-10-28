// Reamlet — which printer to use for which page size.
//
// A rule says "documents whose pages are this size print on that printer"; the
// print window picks the printer of the rule a document's first page matches.
// Meant for the likes of shipping labels, which always go to the same label
// printer whatever else is printed.
//
// Main-process logic with no Electron dependency: main.ts wires it to settings
// and IPC, and the tests exercise it directly.
//
// SPDX-License-Identifier: GPL-3.0-or-later

export interface PrinterRule {
  /** The page's size, short side first: a label is the same label turned round. */
  widthMm:  number;
  heightMm: number;
  printer:  string;
}

/** A PDF point is 1/72 inch. */
export const MM_PER_POINT = 25.4 / 72;

/**
 * How far a page's sides may be from a rule's and still match. Wide enough that
 * a 4 × 6 inch label and a 100 × 150 mm one are the same label (they differ by
 * up to 2.4 mm), narrow enough that A6 (105 × 148 mm) isn't either of them.
 */
export const SIZE_TOLERANCE_MM = 3;

/** Smallest and largest side that can be a page: below it is a typo, above it a plotter. */
const MIN_SIDE_MM = 10;
const MAX_SIDE_MM = 5000;
const MAX_RULES   = 100;
const MAX_PRINTER_NAME = 256;

/** A rule with its sides in short-then-long order, rounded to a tenth of a millimetre. */
function toRule(widthMm: number, heightMm: number, printer: string): PrinterRule {
  const round = (mm: number) => Math.round(mm * 10) / 10;
  return {
    widthMm:  round(Math.min(widthMm, heightMm)),
    heightMm: round(Math.max(widthMm, heightMm)),
    printer,
  };
}

/** How far apart two sizes are, as the larger of the differences between their sides. */
function distanceMm(a: PrinterRule, widthMm: number, heightMm: number): number {
  const short = Math.min(widthMm, heightMm);
  const long  = Math.max(widthMm, heightMm);
  return Math.max(Math.abs(a.widthMm - short), Math.abs(a.heightMm - long));
}

/**
 * The rules in `value` that make sense, normalised. Anything else is dropped
 * rather than failing the lot, so one bad entry in a hand-edited settings file
 * doesn't lose the others. Two rules for the same size keep only the later,
 * which is how a rule is changed.
 */
export function sanitizeRules(value: unknown): PrinterRule[] {
  if (!Array.isArray(value)) return [];
  const rules: PrinterRule[] = [];
  for (const item of value) {
    const { widthMm, heightMm, printer } = (item ?? {}) as Partial<Record<keyof PrinterRule, unknown>>;
    if (typeof widthMm !== 'number' || typeof heightMm !== 'number' || typeof printer !== 'string') continue;
    if (![widthMm, heightMm].every(mm => Number.isFinite(mm) && mm >= MIN_SIDE_MM && mm <= MAX_SIDE_MM)) continue;
    const name = printer.trim();
    if (!name || name.length > MAX_PRINTER_NAME) continue;

    const rule = toRule(widthMm, heightMm, name);
    const same = rules.findIndex(r => r.widthMm === rule.widthMm && r.heightMm === rule.heightMm);
    if (same >= 0) rules.splice(same, 1);
    rules.push(rule);
  }
  return rules.slice(-MAX_RULES);
}

/**
 * The rule for a page of this size, or null. Whichever way up the page is, and
 * whichever rule is nearest if several are within tolerance.
 */
export function findRule(rules: PrinterRule[], widthMm: number, heightMm: number): PrinterRule | null {
  if (!Number.isFinite(widthMm) || !Number.isFinite(heightMm)) return null;
  let best: PrinterRule | null = null;
  let bestDistance = Infinity;
  for (const rule of rules) {
    const d = distanceMm(rule, widthMm, heightMm);
    if (d <= SIZE_TOLERANCE_MM && d < bestDistance) { best = rule; bestDistance = d; }
  }
  return best;
}
