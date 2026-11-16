# S11 — Printing

**Depends on:** S08 (S10 if it has landed, so multi-source documents print;
otherwise the same `materialise` call covers it later).
**Read first:** spec §11; `02` §9; `03` §2.

## Goal
A print window with an honest preview, N-up and booklet layouts, driver
preferences that apply to this print only, automatic printer choice by page
size — printing straight through Windows at the printer's own resolution.

## Start with a spike (recorded in `STATUS.md`)
Against the built-in "Microsoft Print to PDF" printer (output redirected to a
file) and, with the owner, one physical printer:
1. Build a `DEVMODE` from `DocumentProperties`, set paper size, orientation,
   copies, collate, colour, duplex; validate through the driver; `CreateDC`;
   `StartDoc`/`StartPage`/`EndPage`/`EndDoc`.
2. Draw a PDF page into a slot rectangle of the printer DC through the engine
   with a world transform. Compare vector/text output (engine's render-to-DC)
   with banded bitmap output at device DPI for correctness, speed and spool
   size. Choose the default and the fallback rule.
3. Confirm the driver preferences dialog opens modal to our window and returns
   a `DEVMODE` without altering the printer's saved defaults.

## Deliverables
1. **Platform printing API**: enumerate printers (name, is-default); printer
   preferences (owner window, optional starting `DEVMODE`) → chosen `DEVMODE`
   or cancelled; run job (printer, `DEVMODE`, job settings, sheet plan,
   document bytes) → ok or error text, on a worker thread with progress.
2. **Print window** (spec §11.2): all controls, defaults, the Booklet coupling,
   Pages validation, status line, Print/Close; per-printer preferences kept
   for the life of the window; controls locked while the driver dialog is
   open.
3. **Preview**: sheets from the core sheet plan, slots rendered via the tile
   service on demand (only visible sheets), zoom steps and Ctrl+wheel, fit to
   width on open, greyscale view, "Blank" slots and slot borders; rebuilds
   instantly on setting changes.
4. **What is printed**: the tab's document as it stands — `materialise` to
   bytes in memory, opened in the engine for the job. No save required.
5. **Job**: sheet size and orientation from the plan; scale option; copies,
   collate, colour, duplex in the `DEVMODE` merged with the user's driver
   preferences; job name = the file name; annotations and form values included
   (print-flagged, not hidden).
6. **Settings dialog** (File ▸ Settings…) with the printer-by-page-size editor
   (spec §11.4) and rule application when the print window opens.
7. Print entry points: Ctrl+P, toolbar, File menu, tab menu (which also
   activates the tab). Unavailable tabs cannot print.

## Acceptance
Automated (headless, fake platform):
- Control defaults and couplings: landscape default for a wide first page;
  Booklet sets and locks pages-per-sheet 2 and Short edge, and restores 1 and
  None when unticked; "No printers found" disables Print; bad page range shows
  the message and blocks printing.
- The preview shows exactly the sheets of the core plan for: single, range,
  each N-up, booklet, both orientations (compare sheet/slot structure).
- A rule matching the first page's size selects its printer if installed and
  the user has not picked one; a user's manual pick is never overridden; a
  rule for an uninstalled printer is ignored at print time and labelled in
  Settings.
- Settings dialog: add current page size, add custom size (mm, in, decimal
  comma), every error string, replace-on-same-size, remove, Cancel/Escape
  discards, Save persists (sanitised) to `settings.json`.
- Driver preferences result is passed to the job for that printer only and is
  gone when the window closes.
- A job that fails returns its error to the status line and re-enables Print;
  success closes the window.

Automated (Windows CI, real spooler, "Microsoft Print to PDF" to a temp file;
inspect the result with the engine):
- Single page per sheet: one output page per selected page, none blank,
  content matches the source (render comparison at low resolution).
- Page range filters; 2-up composes two pages per sheet with a blank slot
  padding the last; booklet produces two sides per sheet in the specified
  order; landscape and booklet sheets come out correctly oriented with all
  content present.
- A page displayed with `/Rotate` 90/180/270 prints as displayed; only the
  crop-box region prints; a page with no content stream prints (blank) with
  its annotations.
- Saved annotations and a filled form value appear in the output; annotations
  flagged hidden or no-print do not.
- Unsaved annotations and an unsaved rotation appear in the output without the
  file on disk changing.
- Small text / a barcode fixture is reproduced at device resolution (measure
  bar widths or compare against a high-resolution render).
- The printer's saved defaults (`GetPrinter` level 9 before and after) are
  byte-identical across a print with custom preferences.

Performance: opening the print window for the reference document shows the
first sheet ≤ 300 ms; changing a setting updates the preview on the next frame
(sharp shortly after); the UI stays within frame budget while a job spools.

Manual (owner): one real print each of plain, duplex, booklet, and a label
size through a rule; driver tray choice honoured for that print and not
afterwards.

## Out of scope
Print to file formats of our own; custom paper size management; printing
several tabs as one job.
