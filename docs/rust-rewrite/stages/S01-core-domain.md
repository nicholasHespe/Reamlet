# S01 — Core domain library

**Depends on:** S00.
**Read first:** spec §§3, 5, 6, 7, 9.3–9.4, 11.3–11.4, 12, 13; `02` §4;
`03` §§2, 3.

## Goal
`reamlet-core`: every piece of logic that needs no I/O, no UI and no PDF
engine, as plain data types and pure functions with exhaustive unit tests.
Later stages wire these up; they should rarely need to add logic of their own.

## Deliverables (modules)

**`geometry`** — points, rectangles, affine transforms; `PageBox` (visible box
= crop ∩ media, corners normalised, falling back to the media box when the
intersection is empty); `PageView` transform between page space and screen
space for a zoom, rotation (0/90/180/270) and origin, with exact inverses;
displayed size (width/height swap on quarter turns).

**`layout`** — given page displayed sizes, zoom, gap 12, padding 20, viewport:
page rectangles, scroll extent, visible page range, "most visible page",
scroll target for a page, tiles covering a rectangle; fit-width, fit-page and
fit-height zoom (spec §3.2) and the is-fit-width test; zoom-about-a-point
(the anchored point stays fixed); zoom clamp 0.25–5 and 0.1 stepping.

**`model`** — `Source` identity, `PageRef`, `PageId`, `Document`, annotation
types and styles (`02` §4), palette (20 named swatches), defaults; operations
returning a new `Document`: add/remove/replace annotations, move, restyle
(each kind takes only what applies), rotate one/all, reorder/remove pages,
combine, set footer/watermark, set form value.

**`history`** — entries, cursor, push (truncates redo), undo, redo, clean
marker and dirty derivation, limits (100 entries; byte cap on retained bases),
coalescing of a live drag/slider into one entry.

**`annot_geom`** — annotation → display list (`02` §4.3): ink, highlight
rectangles, line, arrow (head rules, spec §6.3), rectangle, ellipse, text
(with fill and underline); bounds; hit-testing with tolerances expressed in
page units supplied by the caller; shift-constraint helpers; paste anchor;
translate.

**`text_layout`** — font metrics trait (advance per char, units per em) with an
implementation over the embedded Liberation Sans faces; `wrap_text`; baseline
offsets; block height; underline geometry; font-size stepping list.

**`overlays`** — footer (three columns, tokens for page and total, margins) and
watermark (multi-line, centred, rotated) → display lists for a given page box.

**`find`** — NFKC + case folding with an index map back to source characters;
exact, wildcard and fuzzy matchers (spec §5) over a page's character sequence,
returning ranges; match ordering; "first match on or after page".

**`print_plan`** — page-range parser; N-up column table; booklet imposition;
sheet plan: sheet size from first page + orientation, slot rectangles, page
fitted and centred in a slot, blanks; scale option; whether a sheet must be
turned for portrait stock.

**`printer_rules`** — sanitise, find nearest within 3 mm either way up; page
size parsing from user text (mm/in, decimal comma, limits and their error
strings); size description string; same-size test.

**`session`** — session types; tolerant parse (`03` §3); what to remember after
a user closes a window (one of several vs last, with/without persistent tabs);
should-restore; set of files still referenced; path normalisation and
inside-folder test.

**`web`** — safe PDF file name; unused-name numbering;
flood gate (20 per 30 s, 30 s quiet, skipped count, injectable clock); failure
report wording.

**`settings`** — typed settings with defaults; tolerant parse preserving
unknown keys; serialisation (`03` §2).

**`strings`** — every user-facing string in the spec, in one place.

## Acceptance
All unit tests, named for the behaviour they pin. At minimum:

- *Geometry*: the four display corners map to the four box corners at each
  rotation; a box with a non-zero origin round-trips; a crop box outside the
  media box is clipped; reversed corners give positive sizes;
  screen→page→screen is identity at every zoom and rotation.
- *Layout*: zooming about a point leaves that point fixed; fit-width uses the
  1 %-of-screen gutters; fit-page is the smaller of the two rules; the most
  visible page is right at page boundaries; 10 000 pages lay out in < 1 ms
  (benchmark).
- *Annotations*: arrow shaft stops at the head base; both wings one head length
  from the tip; an arrow shorter than its head has no shaft; head length
  max(10, 4t); display lists preserve creation order; restyle applies fill only
  to fillable kinds and thickness only to stroked kinds; hit-test picks the
  topmost; shift-constraint gives squares and 45° steps.
- *Text*: wraps at word boundaries; hard newlines kept; over-long word split;
  no line exceeds the width; zero width does not loop; block height follows
  line count; a narrower box gives more lines; size stepping (in-list,
  between-list, ends).
- *Rotation model*: annotations are unchanged by page rotation; a text box's
  display list is upright for each displayed rotation.
- *History*: undo to the clean entry is clean; pushing after undo discards
  redo and, if the clean entry was in it, the document can no longer become
  clean by undo; limits drop oldest; a slider drag is one entry.
- *Find*: exact is case-insensitive and NFKC; wildcard `*` and `?`; fuzzy
  thresholds (0 below 3 chars, max(1, ⌊n/5⌋) otherwise); matches may cross a
  line break; ranges map back to original characters after normalisation.
- *Print plan*: booklet pads to a multiple of four and pairs pages as the spec
  formula says; page range parsing incl. en dash, out-of-range, empty result;
  2/4/6/9/16-up grids; last sheet padded with blanks; landscape sheets flagged
  for turning; every selected page appears exactly once.
- *Printer rules*: exact match; either way up; 4 × 6 in in points matches a
  4 × 6 in rule; 100 × 150 mm and 4 × 6 in are the same; A6 is neither;
  nearest wins regardless of order; non-finite sizes match nothing; sanitising
  drops bad entries, trims names, replaces duplicates, caps at 100; size
  parsing errors and quoted limits are themselves accepted.
- *Session*: absolute paths and source URLs kept; bad entries dropped; bad
  active index → −1; damaged file → empty; closing one window of several
  forgets only it; closing the last keeps tabs only with persistent tabs;
  paths compare case-insensitively.
- *Web*: unsafe names made safe (reserved characters, device names, trailing
  dots, length, missing extension, empty → "download.pdf"); flood gate — up to
  the limit pass, spread-out requests never trip it, a slow drip stays shut
  out, reopening after quiet, skipped count reported once and only after
  quiet; flood warning wording.
- *Settings*: unknown keys survive a round trip; malformed values fall back
  per key.

No dependency on windowing, engine, or `std::fs` beyond tests.

## Out of scope
Rendering, PDF reading or writing, any I/O, any UI.
