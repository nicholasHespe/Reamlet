# S10 — Document tools

**Depends on:** S08.
**Read first:** spec §§9, 1.4, 7; `02` §§4.1, 4.3, 4.5; `03` §6 (footer and
watermark).

## Goal
Combine, reorder/remove pages, footer and watermark — as edits to the document
model that show instantly and are written correctly on save.

## Deliverables
1. **Multi-source documents in the viewer**: a tab's page list may reference
   several sources; tiles, text, find, outline and thumbnails all resolve
   through `PageRef`. Content-version bumps invalidate only affected pages.
2. **Reorder dialog** (spec §9.2): progressive thumbnails via the engine
   (priority 5, cancelled on close), drag-to-move, arrows with
   scroll-into-view, select, remove, live "Page n" labels, validation
   messages, Apply/Cancel. Applying is one history entry.
3. **Combine dialog** (spec §9.1): pick-in-order list with badges; result tab
   "Combined.pdf", pathless, dirty, with suggested save location (first
   source's folder, `combined.pdf`). Pages carry their rotations and unsaved
   annotations (copied to new `PageId`s). Sources are shared, not copied.
4. **Footer dialog** (spec §9.3) and **Watermark dialog** (spec §9.4) with live
   previews drawn from the same core display lists as the real thing. Applying
   sets the document's footer/watermark (one history entry each); the viewer
   shows them on every page via the overlay immediately.
   - Applying a footer or watermark when one is already present replaces it
     (record this choice; today they would stack on re-apply).
5. **Outline with edited page lists**: contents entries follow their pages;
   entries for removed pages are hidden; in a combined document the contents
   panel shows the first source's outline only if all its pages are present in
   order — otherwise no panel (record the rule chosen).
6. **Writer**: `materialise` for changed page lists — import page object
   graphs from each source into a new file with per-source object
   de-duplication, inherited attributes (`/Resources`, `/MediaBox`, `/CropBox`,
   `/Rotate`) resolved onto each page, existing page annotations carried,
   links to pages that no longer exist dropped; then the common edit stage.
   Footer/watermark content writer (`q…Q` wrapping, font rules, opacity
   ExtGState, positioned against the visible box).
   Outline in the output: preserved when the page list is the source's
   unchanged list; otherwise omitted.
7. Find, text selection and contents stay correct after each operation.

## Acceptance
Automated:
- Reorder [3,1,2] then save: the output's pages are the source's 3,1,2 by
  content (render comparison) and annotations made before the reorder are on
  the same pages they were drawn on.
- Remove a page: its annotations go with it; undo brings both back.
- Removing every page is refused with the message; an unchanged order is a
  no-op (no history entry, not dirty).
- Combine A (2 pages, one unsaved annotation, one page rotated) and B
  (3 pages): the new tab shows 5 pages with the annotation and rotation;
  saving it yields a 5-page file that renders the same; A and B are unchanged
  and their dirty states untouched; memory grows by far less than A + B
  (sources shared).
- Combine with fewer than two available tabs / fewer than two selected shows
  the messages; unavailable tabs are not listed.
- Footer: with a cropped, non-zero-origin page the text sits inside the
  visible box; right-aligned text ends 40 pt from the visible right edge;
  page/total tokens are right after a reorder; the date is fixed at apply
  time; all-None does nothing.
- Watermark: centred on the visible box at the given angle; multi-line order
  and spacing; opacity present in the saved content; empty text does nothing;
  non-Latin text works.
- Footer and watermark are visible in the viewer immediately, identical
  (tolerance) to the engine's render of the saved file, and are not hidden by
  Hide annotations.
- Each operation is one undo step and leaves existing annotations in place.
- Imported pages: shared resources are written once (object count sanity
  check); a page relying on inherited `/MediaBox` and `/Resources` renders the
  same after import; output opens in the engine and passes a structural check
  (every reference resolves).
- Corpus: reverse-page-order materialise over the corpus — reopen and compare
  each page's render with the source page.
- Reorder dialog is usable immediately on a 500-page document (thumbnails
  stream in; frame times in budget).

## Out of scope
Merging interactive form fields or outlines across sources. Splitting,
extracting or inserting blank pages (not in the product).
