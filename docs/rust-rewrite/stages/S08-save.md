# S08 — Save pipeline

**Depends on:** S07.
**Read first:** spec §§2.4, 7, 8; `02` §§4.4–4.5; `03` §6.

## Goal
`reamlet-pdfwrite` turns a document model into PDF bytes that every viewer
shows exactly as Reamlet did; Save, Save As and the unsaved-changes prompts
work end to end.

## Deliverables
1. **`materialise`** for the single-source, unchanged-page-list case (page
   import for other cases is S10, behind the same function): load with lopdf,
   apply edits, serialise. Runs on the worker pool.
2. **Annotation writer** per `03` §6: display list → appearance-stream
   operators; one annotation object per app annotation with the listed entries;
   appended to `/Annots` in creation order after existing ones; ExtGState for
   opacity; rectangles as specified (stroke padding, text padding and `/RD`).
3. **Font embedding**: subset Liberation Sans Regular/Bold to used glyphs, one
   font object per face per file, composite font with `/ToUnicode`; only faces
   in use; missing glyphs tolerated.
4. **Rotation** written to `/Rotate` (added to existing, mod 360), honouring
   inherited `/Rotate` from the page tree.
5. **Text upright on rotated pages** (turned counter to the displayed
   rotation), boxes and underlines included.
6. **Save** (Replace? prompt, atomic replace of the target, error reporting),
   **Save As** (system dialog, default name/folder rules, tab adopts the new
   path, title bar and tab update), Ctrl+S / Ctrl+Shift+S, toolbar and tab
   menu items.
7. **After save**: saved bytes become the tab's source; document model reset;
   history gains an entry marked clean (undo across the save still works, see
   `02` §4.4); view state untouched; tiles refreshed in the background with
   the old ones left in place; find results and text cache invalidated.
8. **Close prompts** (spec §2.4) for tab and window, including Save All
   aborting on a cancelled or failed save; Close Other Tabs with prompts.
9. **Progress**: a small non-modal indicator if materialising exceeds ~150 ms;
   the tab cannot be saved twice concurrently; editing during a save is either
   blocked for that tab or correctly rebased — choose blocking (simple) and
   show it.

## Acceptance
Automated (writer round-trips — build a model, materialise, inspect with lopdf
and re-open in the engine):
- Every annotation kind produces the subtype and entries in `03` §6; each has
  its own appearance stream; nothing is added to page content; `/F` is 4.
- Order: text over shape and shape over text are preserved; all kinds keep
  placement order; existing annotations stay first.
- A text highlight is one annotation covering all its rectangles at 35 %; a
  freehand highlight is translucent, a pen stroke opaque.
- Filled rectangle/ellipse write `/IC` equal to the fill; unfilled write none;
  a line ignores fill.
- Arrow: `/Subtype /Line` with `/LE [/None /ClosedArrow]` and an appearance
  whose head has the specified size in points on any page size; a plain line
  has no `/LE`.
- Text box: `/Rect` minus `/RD` is exactly where the box was placed, for
  `/Rotate` 0, 90, 180, 270; a filled box draws one background rectangle of
  box width × block height; narrower box → more lines → taller fill; saved
  lines are one pitch apart; every saved line fits the box width; a rotated
  page wraps against the width that was on screen.
- Unicode: Greek and maths symbols save and extract back unchanged through the
  engine's text extraction (proves `/ToUnicode`); bold non-Latin too; a glyph
  the font lacks does not stop the save or lose the surrounding text; only
  used glyphs are embedded (font stream far smaller than the full face); only
  used faces are embedded.
- Geometry: an annotation spanning the whole visible page covers the whole
  visible box on a page with a non-zero-origin crop box; annotations on
  different pages use their own page geometry; a user rotation is added to an
  existing `/Rotate`.
- **Visual equivalence**: for a fixture with one of every annotation kind, the
  engine's render of the saved file matches a render of the original page with
  the on-screen display list composited over it (tolerance), at rotations
  0 and 90.
- The engine's text extraction reports saved text boxes as annotation text
  (so Find sees them, S05).
- Saving twice in a row does not duplicate annotations.
- Corpus: materialise-with-one-annotation over the corpus folder — every file
  that opened still opens afterwards and its first page renders the same apart
  from the annotation.

Automated (UI, fake platform):
- Save on a file-backed tab asks to replace; Cancel leaves the file and dirty
  state untouched; Replace writes and clears `*`.
- A failing write (read-only target) reports "Save failed: …", leaves the
  original bytes on disk byte-for-byte, and the tab stays dirty.
- Save As default path rules (current path; Downloads\document.pdf); tab
  adopts the new path.
- After save: zoom and scroll identical; undo restores the pre-save document
  and sets `*`; redo returns to clean.
- Close prompts: wording for one and several dirty tabs; button sets for
  file-backed vs pathless tabs; Discard closes without writing; Save closes
  only on success; Save All stops at the first cancellation.
- Perf: saving the reference document with 50 annotations ≤ 500 ms with frame
  times in budget throughout.

## Out of scope
Form values (S09), page import/reorder/footer/watermark writing (S10).
