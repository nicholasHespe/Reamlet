# S05 — Text selection and Find

**Depends on:** S04.
**Read first:** spec §§4, 5; `02` §5.3–5.4.

## Goal
Select and copy text, and find text in one or all open documents, without ever
blocking the UI.

## Deliverables
1. **Text cache** per source page: characters with page-space boxes, lines and
   words, fetched from the engine on demand (priority 3 when the user is
   interacting with that page, priority 5 for indexing), shared between
   selection and find, dropped with the tab.
2. **Selection** (Select tool): caret-style drag selection in reading order,
   across pages; double-click word; triple-click line; clear on empty click;
   painted in the overlay as merged per-line rectangles
   (`rgba(0,120,255,0.3)`); I-beam cursor over text. Ctrl+C copies with line
   breaks preserved and sensible spaces.
3. **Page context menu** (spec §4) with Copy and Find working; Highlight, Cut
   and Paste present for S07 to wire.
4. **Find bar** UI exactly as spec §5: field, counter, previous/next, scope and
   mode toggles, close, dropdown for All scope, no-results styling, focus and
   select-all on open, 150 ms debounce.
5. **Search service** on the worker pool: takes (query, mode, scope, tab
   order), pulls page text as it becomes available, streams matches back per
   page; a new query cancels the old one; results keyed to the document's
   content version so they are invalidated when pages change.
6. **Match highlights** in the overlay (all matches amber, current orange with
   outline), following zoom/rotation; scroll-to-match centred; wrap-around
   navigation; first-current = first on/after the page in view.
7. **All scope**: per-document counts dropdown, row click switches tab and
   jumps; tab switch re-targets navigation to that tab's matches.
8. Script commands: find, find-next.

## Acceptance
Automated:
- Selecting from a point in line 2 to a point in line 5 of a fixture yields
  exactly the expected string; selection across a page boundary works;
  double/triple click select word/line; copy puts that text on the (fake)
  clipboard.
- Selection rectangles sit on the glyphs at zoom 0.5, 1, 3 and at 90° rotation
  (compare against engine character boxes transformed by the page view).
- Find: exact/wildcard/fuzzy results for a fixture equal the core matchers'
  results; a phrase broken across a line is found; a match inside a saved
  text-box annotation highlights the annotation's whole rectangle.
- Counter strings: "i of n", "No results", "n in doc"; no-results styling on
  and off; mode buttons are mutually exclusive and toggle back to exact.
- All scope lists only documents with matches, active first, with "1 match" /
  "n matches"; clicking a row activates the tab and centres its first match.
- Typing quickly issues one search after 150 ms of quiet; a superseded search
  delivers nothing.
- Perf: on the reference document, first results ≤ 300 ms after typing stops;
  frame times during a search stay within budget; searching 20 tabs keeps the
  UI responsive (watchdog silent).
- Closing the bar clears highlights and cancels work.
- Rotating a page or zooming keeps highlights on their text (golden image).

## Out of scope
Creating highlight annotations from a selection (S07). Searching unsaved text
boxes (not required).
