# S06 — Annotations I: drawing

**Depends on:** S04 (S05 for text-drag highlighting; if S05 is not done, build
the freehand highlighter here and add text highlighting when it lands).
**Read first:** spec §§6.1–6.3, 6.7, 7, 3.5; `02` §§4, 5.4.

## Goal
Draw on documents: pen, highlighter, lines, arrows, rectangles, ellipses,
eraser — with style controls and instant undo/redo. Drawing must feel like ink:
no lag at any zoom.

## Deliverables
1. **Overlay painter**: paints a core display list through a page view —
   stroked paths with round caps/joins, fills, opacity — tessellated per frame
   (cache tessellations per annotation keyed by zoom bucket if profiling shows
   the need). Translucent strokes must not darken at self-overlaps (render the
   stroke as one shape).
2. **Tool state** per tab: current tool, colour, fill, thickness; tool buttons,
   Shapes menu with last-shape memory, letter shortcuts, cursors (spec §6.1).
3. **Style controls** (spec §6.2): colour and fill popups with the 20 swatches
   (+ No fill), current-value indication, thickness slider in screen pixels →
   points.
4. **Tools**: Draw (page-confined, ends on leaving the page, ≥ 2 points);
   Line/Arrow/Rectangle/Ellipse with dashed preview, Shift constraint, 2 px
   minimum, fill for closed shapes; Highlight — text-drag (from the S05
   selection, trimmed rectangles) and freehand (20 px on screen, > 3 points);
   Eraser (whole annotation under the pointer, one undo step per drag).
   Pointer capture so a drag that leaves the window still ends cleanly.
5. **Commit path**: every finished gesture produces a new `Document` and one
   history entry; the tab's dirty state derives from history.
6. **Undo/redo**: buttons and shortcuts; text-field focus rule.
7. **Hide annotations** toggle (window-wide): overlay annotations skipped,
   tile flag flipped for in-file annotations, auto-off when an annotating tool
   is chosen; old tiles remain until replacements arrive.
8. Input smoothing kept minimal and honest: points are stored as sampled
   (optionally thinned by a small distance threshold); no lag-inducing
   filtering.
9. Script commands: select-tool, set-colour, drag-path.

## Acceptance
Automated:
- Each tool, driven by synthetic input, yields the expected annotation in page
  space at zoom 0.5, 1 and 3 and at page rotations 0/90/180/270 (the same
  screen gesture on a rotated page lands on the same visible spot).
- Thickness: slider 6 at zoom 2 stores 3 pt; the stroke measures 6 px on
  screen at zoom 2 and 3 px at zoom 1.
- A pen stroke that crosses onto the next page ends at the boundary; nothing is
  added to the second page.
- Shift gives a square, a circle, and 0/45/90° lines; a 1 px drag creates
  nothing.
- A freehand highlight crossing itself has uniform opacity (pixel test); pen is
  opaque; highlight opacity is 35 %.
- Eraser drag over three annotations removes three and adds one history entry;
  one undo restores all three.
- Later annotations paint over earlier ones for every pair of kinds (golden).
- Undo/redo sequences restore exact `Document` values; redo is discarded after
  a new action; `*` clears when undone to the opened state and returns on redo.
- Hide annotations hides overlay and in-file annotations but not form fields;
  selecting the Draw tool un-hides.
- Golden images of each annotation kind at two zooms.
- Perf: scripted fast pen stroke of 2 000 points — every pointer event is
  reflected by the next frame, p99 frame ≤ 16.7 ms; a page with 500
  annotations scrolls within budget.

## Out of scope
Selecting, moving, restyling existing annotations, clipboard, text boxes (S07);
writing to PDF (S08).
