// Reamlet — text annotation layout, shared by the canvas overlay and the saver.
//
// All values are in PDF points (1/72"), the same unit an unscaled page uses.
// The canvas overlay multiplies them by the viewer scale; the saver writes them
// into the page as-is. Keeping one definition is what makes a text annotation
// land on the same baseline on screen and in the saved file at any zoom level.
//
// SPDX-License-Identifier: GPL-3.0-or-later

/** Vertical gap between lines, and between a baseline and its underline. */
export const TEXT_LINE_GAP = 2;

/**
 * Font stack for on-screen text. Helvetica and Arial share the metrics of the
 * Liberation Sans the saver embeds (see fonts.ts). Text is laid out without
 * kerning on both sides, since the saved file draws glyphs at their plain
 * advance widths.
 */
export const TEXT_FONT_STACK = 'Helvetica, Arial, sans-serif';

/** Distance from the annotation's anchor y down to the baseline of line `lineIndex`. */
export function textBaselineOffset(fontSize: number, lineIndex: number): number {
  return lineIndex * (fontSize + TEXT_LINE_GAP) + fontSize / 2 + TEXT_LINE_GAP;
}

/** Thickness of the underline rule drawn under a line of text. */
export function textUnderlineThickness(fontSize: number): number {
  return fontSize / 12;
}

/** Height of a block of `lineCount` lines, anchor y to the last line's descender. */
export function textBlockHeight(lineCount: number, fontSize: number): number {
  return Math.max(1, lineCount) * (fontSize + TEXT_LINE_GAP);
}

/** Measures the advance width of a string at the annotation's font and size. */
export type MeasureText = (text: string) => number;

/**
 * Break `text` into the lines it occupies inside a box `maxWidth` wide. Typed
 * newlines are hard breaks; everything else is greedy word wrapping, splitting
 * a word too long for the box. `measure` is supplied by the caller so screen
 * and saved-file wrapping can each use their own font metrics.
 */
export function wrapText(text: string, maxWidth: number, measure: MeasureText): string[] {
  const lines: string[] = [];

  for (const paragraph of text.split('\n')) {
    if (paragraph === '') { lines.push(''); continue; }
    // A box too narrow to hold anything would make the loops below spin, so
    // fall back to one line per paragraph rather than wrapping to nothing.
    if (!(maxWidth > 0)) { lines.push(paragraph); continue; }

    let line = '';
    for (const word of paragraph.split(' ')) {
      const candidate = line === '' ? word : `${line} ${word}`;
      if (measure(candidate) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line !== '') lines.push(line);
      // The word now starts a line of its own; split it if it still doesn't fit.
      let rest = word;
      while (measure(rest) > maxWidth) {
        const head = longestPrefixWithin(rest, maxWidth, measure);
        if (head === rest) break; // not even one character fits — let it overflow
        lines.push(head);
        rest = rest.slice(head.length);
      }
      line = rest;
    }
    lines.push(line);
  }

  return lines;
}

/** The longest leading run of `word` that fits in `maxWidth`, at least one character. */
function longestPrefixWithin(word: string, maxWidth: number, measure: MeasureText): string {
  let fits = 1;
  for (let n = 1; n <= word.length; n++) {
    if (measure(word.slice(0, n)) > maxWidth) break;
    fits = n;
  }
  return word.slice(0, fits);
}
