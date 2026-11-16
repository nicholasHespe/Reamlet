# 02 — Architecture

How Margin is built in Rust, reasoned from the three goals (fast start, low
memory, smooth UI) rather than from how any earlier version worked.

Library and crate names below are the plan's recommendation as of writing.
**Stage S00 confirms them by measurement** before anything depends on them, and
an agent must check current crate versions and APIs rather than trusting
details remembered here.

---

## 1. Principles

1. **The UI thread never does PDF work.** It lays out, handles input and draws
   what it already has. Parsing, rendering, text extraction, searching, saving,
   and printing all happen elsewhere and report back by message.
2. **Never show blank.** Whatever the user scrolls or zooms to, something
   correct-looking is on screen within one frame — a lower-resolution or
   previously rendered image scaled by the GPU — and is replaced by sharp
   output when ready. Replacement is atomic per tile: no flashes, no hiding.
3. **The document is a small edit model over immutable sources.** A source PDF's
   bytes are never modified in memory. Everything the user does — annotations,
   rotation, page order, form values, footers, watermarks — is a compact value
   layered on top. Rendering composes the two live; saving materialises them.
   This is what makes undo instant, tab moves lossless, and combine/reorder
   free.
4. **One geometry, two outputs.** The shapes drawn on screen and the shapes
   written into a saved PDF come from the same function producing the same
   display list in page points. What you see is, by construction, what is
   saved.
5. **Pay only for what is visible.** Start-up loads nothing a blank window does
   not need. A background tab holds its document, not its pixels. A restored
   session opens the active document first.
6. **One process.** All windows share one process, one PDF engine, one tile
   budget, one settings store. Moving a tab between windows is moving a value.
7. **Plain, testable seams.** Pure logic has no I/O and no UI. The PDF engine
   and the platform are traits with a real and a fake implementation, so every
   stage is testable headless.

---

## 2. What is deliberately not carried over

The previous implementation accumulated workarounds for its platform. None of
the following is to be reproduced; the stated replacement covers the need.

| Not carried over | Replaced by |
|---|---|
| Pages as blank placeholders rendered when an observer sees them; an eager "first ten screens" pass; hiding a page while it re-renders; callbacks to repaint overlays after a page re-render | The tile pipeline (§5): priority queue, always-available fallback imagery, atomic tile swaps, overlays drawn independently of page pixels |
| Zoom as a temporary CSS transform, then a debounced full re-render with scroll corrections before and after | Zoom is a view parameter; existing tiles are drawn scaled every frame; sharp tiles are requested continuously and cancelled when stale |
| "Sleeping" tabs after two minutes, wake-up spinner, stashed scroll and annotations | Background tabs keep their document open and drop their tiles (§6) |
| Undo as snapshots of the whole PDF (200 MB budget); reloading the document after reorder, footer, watermark, undo, save | Edit model snapshots with structural sharing (§4); nothing reloads |
| Annotations stored as fractions of the displayed page and re-computed on rotation | Annotations stored in page points (§4.2) |
| Printing by building an intermediate PDF, loading it in a hidden browser window, waiting on title changes and fixed time-outs | Direct GDI print job (§9) |
| Temporarily overwriting the printer's saved defaults for the length of a print, with a crash-recovery journal | A per-job `DEVMODE` passed to the job (§9) |
| Shelling out to PowerShell (clipboard, printer settings); `.bat` registration scripts | Direct Win32 calls; subcommands of the executable |
| The app downloading PDFs itself from a web address handed over by the browser (no logins, second fetch, PDF lost on failure); a user-entered extension ID | The browser downloads; the app receives a finished file and answers with a real result (`03` §4) |
| Tab moves between windows via file path, a 500 ms timer and a "discard changes?" prompt | A tab is a value moved between windows of one process |
| Whole files copied between processes; defensive buffer copies | One shared, reference-counted byte buffer per source |
| A bundled JavaScript runtime as the browser helper | A small native executable |
| Rendering every page to an image up front for print preview and for the reorder dialog | The same on-demand tile/thumbnail service as the viewer |

---

## 3. Technology choices

| Concern | Choice | Why |
|---|---|---|
| Language/tooling | Rust stable, Cargo workspace, MSVC target `x86_64-pc-windows-msvc` | |
| UI toolkit | **egui via eframe** (winit windowing) | Small, starts fast, immediate-mode so there is no retained widget tree to keep in memory or in sync; first-class custom painting and textures for the viewport; multi-window; headless UI tests (`egui_kittest`). |
| GPU backend | Chosen in S00 between eframe's `glow` and `wgpu` (DX12 only) backends by measured start-up, idle memory and frame time | Both are a one-line switch; the numbers decide. |
| PDF read/render | **PDFium** (prebuilt binary, pinned version and checksum) through the `pdfium-render` crate, dropping to raw `FPDF_*` bindings where needed | Fast, robust on real-world files, permissive licence, renders sub-rectangles, exact text geometry, form support, can render to a printer DC. |
| PDF write | **lopdf** for object-level edits and page import; our own small content-stream and annotation writer | Full control over exactly what is written; pure Rust. |
| Fonts | `ttf-parser` for metrics, `subsetter` (or equivalent) for subsetting; Liberation Sans Regular/Bold embedded in the executable | Same metrics on screen and in files. |
| Windows APIs | `windows` crate | Printing, drag-and-drop, clipboard, registry, spell-check, single-instance pipe. |
| Serialisation | `serde` + `serde_json` | Settings and session files. |
| Errors/logging | `thiserror` in libraries, `anyhow` at the edges, `tracing` to a rotating file in the data folder | |

Fallbacks, recorded so S00 does not have to invent them: if egui cannot meet
the budgets, evaluate Slint next; if PDFium proves unsuitable, MuPDF (AGPL —
compatible with GPL-3.0-or-later, but confirm with the owner).

Licence check: every dependency must be compatible with GPL-3.0-or-later;
`cargo deny` enforces an allow-list in CI.

---

## 4. The document model

### 4.1 Sources and documents
```
Source      = immutable PDF bytes (Arc<[u8]>) + identity (path, source URL, content hash)
Document    = { pages: Vector<PageRef>, annotations, form_values, footer, watermark }
PageRef     = { id: PageId, source: SourceId, source_index: u32, user_rotation: 0|90|180|270 }
```
- A freshly opened file is one `Source` and a `Document` whose `pages` list is
  that source's pages in order, with nothing else set.
- **Reorder/remove** edits `pages`. **Combine** creates a `Document` whose
  `pages` reference several sources (sharing their bytes) and copies the
  relevant annotations. **Rotate** edits `user_rotation`.
- `PageId` is stable for the life of the page in the document, so annotations
  and view state attach to a page, not to a page number.
- `Document` is a persistent (structurally shared) value — e.g. the `im`
  crate's vectors — so cloning it for undo costs almost nothing.

### 4.2 Annotations
- Stored in **page space**: the source page's own PDF user space — points,
  y up, unrotated, the same coordinates the file itself uses (so a page whose
  visible box does not start at the origin needs no special case when writing).
  Rotation and zoom are view transforms; annotations never change when the page
  is rotated or zoomed.
- Kinds: `Ink` (pen), `InkHighlight` (freehand highlighter), `TextHighlight`
  (rectangles), `Line`, `Arrow`, `Rect`, `Ellipse`, `Text`. Each has an id, a
  page id, a z-order (creation order) and its style.
- A `Text` annotation stores its anchor (top-left, page space), box width in
  points, string and style; it is laid out upright in the page's *displayed*
  orientation at draw and save time.

### 4.3 Display lists
`annotation → DisplayList` is a pure function in the core crate. A display list
is a short sequence of primitives in page points: stroked path (round caps and
joins), filled path, filled rectangle, positioned glyph run (font face, size,
per-glyph advances), with colour and opacity. Two consumers:
- the **screen painter** (transforms to pixels, tessellates);
- the **PDF writer** (emits appearance-stream operators).

Footer and watermark produce display lists the same way, per page. Text layout
(wrapping, baselines, underline) lives here and uses Liberation Sans advance
widths without kerning, so both consumers agree to the glyph.

### 4.4 History
A tab holds `history: Vec<HistoryEntry>` and a cursor.
`HistoryEntry = { document: Document, base: SourceSet }` — the base only changes
at a save, so entries share it. Undo/redo swaps the tab's current `Document`;
the viewer re-requests only tiles whose page content actually changed (page
order, rotation, footer, watermark — annotations are overlay and need no
re-render). A "clean" marker points at the entry matching the file on disk.
Limits: 100 entries; old `SourceSet`s retained only for undo are capped at
200 MB total, oldest dropped first.

### 4.5 Materialising
`materialise(document, sources, fonts) → PDF bytes` is the one path used by
Save, Save As, Print and anything else that needs real PDF bytes.
- Single source, page list unchanged: load the source with lopdf and edit in
  place (add annotations, set rotations, write form values, add footer and
  watermark content).
- Otherwise: build a new file by importing each referenced page's object graph
  from its source (deduplicating shared objects per source, resolving inherited
  page attributes), then apply the same edits.
- Runs on a worker thread; the UI shows progress only if it takes longer than
  ~150 ms.

After a save, the saved bytes become the tab's new single `Source`, the
`Document` resets to "that source, nothing else", and tiles are re-rendered in
the background while the old ones stay on screen — no reload state.

---

## 5. Rendering pipeline

### 5.1 Layout
Page sizes come from the engine without loading page content. Layout is pure
arithmetic: given zoom, per-page displayed size, gaps and viewport, compute
each page's rectangle and the scroll extent. Documents of any length lay out in
microseconds; scrollbars are right from the first frame.

### 5.2 Tiles
- A page at a given zoom is covered by **tiles** of 512 × 512 device pixels
  (final size tuned in S04). A tile is identified by
  (source, source page, rotation, zoom bucket, tile x/y, content version,
  annotations-hidden flag). Only tiles intersecting the viewport plus a margin
  are ever requested, so memory does not grow with zoom.
- Each page near the viewport also keeps one small **base image** (long side
  ≈ 384 px). It is the fallback drawn, scaled, under any tile not yet ready.
  Base images are tiny and are kept for a generous window of pages around the
  view, so fast scrolling lands on something.
- **Drawing a frame**: for each visible page — draw the base image stretched to
  the page rectangle; over it draw the best available tiles (exact zoom if
  present, else the nearest zoom, scaled); over that the overlay (§5.4).
  Nothing waits.
- **Zoom gesture**: zoom changes every frame; existing tiles are drawn scaled.
  New tiles are requested for the current zoom at reduced rate during the
  gesture and at full priority once the zoom has been still for ~80 ms.
  Requests for superseded zooms are cancelled.

### 5.3 Engine thread and scheduler
PDFium is not thread-safe, so one dedicated **engine thread** owns the library
and every open engine document. It serves a priority queue:

1. visible tiles of the active tab at the current zoom (centre-out);
2. base images for visible pages;
3. text/geometry queries the user is waiting on (selection, form hit-tests);
4. look-ahead tiles in the scroll direction; base images further out;
5. background work: find indexing, thumbnails, other tabs.

Jobs carry a generation number; the engine checks for cancellation between
jobs and, using PDFium's progressive rendering with a pause callback, *inside*
a long page render, so a stale request never holds up a fresh one for more than
a few milliseconds. Results are sent to the UI as CPU pixel buffers and
uploaded as textures with a per-frame upload budget (so a burst of tiles cannot
cause a long frame); the UI is woken to repaint when results arrive.

CPU-only work that does not need the engine (search matching, materialising,
font subsetting) runs on a small worker pool.

### 5.4 Overlay
Unsaved annotations, selection outlines, find highlights, text selection, the
in-progress stroke, footer and watermark previews are vector display lists
painted by the UI every frame in page space. They are sharp at every zoom,
follow the pointer with no latency, and cost nothing when the page tiles
change. Hide-annotations simply skips the annotation part of the overlay and
flips the tile key's flag (old tiles remain on screen until new ones land).

### 5.5 Memory policy
One global tile cache with a byte budget (default 192 MB of textures, less on
low-memory machines), least-recently-used eviction, visible tiles pinned.
Switching tab keeps the previous tab's tiles until the budget needs them, so
switching back is instant.

---

## 6. Tabs, windows and resources

```
App
 ├─ Settings, SessionStore, TileCache, Engine handle, Worker pool
 └─ Windows[]
      └─ Tabs[] ── Tab { id, document, history, view (zoom, scroll), tool state,
                         find state, source identity, load state }
```
- A tab's **load state** is one of: *Placeholder* (path only — restored but
  never activated), *Loading*, *Ready*, *Unavailable(reason)*.
- A *Ready* background tab costs its source bytes plus a few kilobytes; it
  holds no textures it is not pinning. If total source bytes of clean,
  file-backed, long-inactive tabs exceed a budget, their bytes and engine
  handle may be released and silently re-read on activation. This is invisible
  (no state shown) unless the re-read takes over ~100 ms, in which case the
  ordinary loading look applies.
- Files are read fully into memory when opened (no long-lived file handle), so
  other programs can move or replace them and our own save can replace them.
- Moving a tab between windows moves the `Tab` value. Tearing off creates a
  window and moves the tab into it.

---

## 7. Start-up sequence

1. Process start → parse the command line → try the single-instance mutex.
   If another instance exists: send the request over the named pipe, exit.
   (This path loads no GPU, no engine, no settings — a few milliseconds.)
2. Read `settings.json` (theme, scale) and `session.json` — small, synchronous.
3. Create the window with the right background colour and show it. Paint the
   chrome and tab list.
4. In parallel, off the UI thread: start the engine thread (load PDFium), start
   the pipe server, read the first document's bytes.
5. First document's first-page base image, then tiles.
6. Deferred to idle: clean-up sweep of old browser-received files, other
   restored tabs stay *Placeholder* until activated.

Nothing in steps 1–3 may touch the network, the printer subsystem, the spell
checker or the PDF engine.

---

## 8. Crates

```
margin/                     workspace
├─ crates/
│  ├─ margin-core           pure logic, no I/O, no UI, no unsafe            (S01)
│  ├─ margin-engine         PdfEngine trait, PDFium impl, engine thread,
│  │                         fake engine for tests                           (S02)
│  ├─ margin-pdfwrite       materialise: lopdf edits, page import,
│  │                         annotation + content writers, font subsetting   (S08, S10)
│  ├─ margin-platform       Platform trait + Windows impl: dialogs, drag-drop,
│  │                         clipboard, printing, registry, pipe, spell-check (S03…)
│  ├─ margin-ui             widgets, viewport, tabs, dialogs — egui only,
│  │                         talks to engine/platform through traits         (S03…)
│  ├─ margin-app            the executable `Margin.exe`: wiring, start-up  (S03)
│  └─ margin-native-host    `margin-native-host.exe`                       (S13)
├─ extension/                the browser extension (plain JavaScript, MV3)   (S13)
├─ assets/                   icon, fonts (with licence), fixtures for tests
├─ installer/                installer script                                (S15)
└─ xtask/                    build, package, perf-measure commands
```
Dependency direction: `core` ← everything; `engine`, `pdfwrite`, `platform`
depend only on `core`; `ui` depends on those three through traits; `app` wires
real implementations. `unsafe` is confined to `engine` and `platform`.

---

## 9. Printing design

- The print window computes a **sheet plan** (core, pure): for each physical
  sheet side, a list of slots, each a page reference and a rectangle. Preview
  and printing both consume the plan, so they cannot disagree.
- Preview renders slots through the ordinary tile service.
- The job: materialise the document to bytes (§4.5) and open it in the engine;
  build a `DEVMODE` by asking the driver for its defaults via
  `DocumentProperties`, merging the user's Printer Preferences result if any,
  then setting copies, collate, colour, duplex, orientation and paper size and
  validating it through the driver again; `CreateDC` with that `DEVMODE`;
  `StartDoc`; for each sheet `StartPage`, draw each slot with a world transform
  through the engine's render-to-DC path, `EndPage`; `EndDoc`. All on a worker
  thread; failures return the Win32 error text.
- Fidelity: slots are rendered through PDFium's device (vector/text) output
  where the driver accepts it, falling back to banded bitmaps at the printer's
  native resolution. Either way output is at device resolution.
- Printer Preferences = `DocumentProperties(hwnd, …, DM_IN_BUFFER |
  DM_IN_PROMPT | DM_OUT_BUFFER)` with the print window as owner; the returned
  `DEVMODE` is kept in memory for that print window only.

---

## 10. Platform seam

`margin-platform` exposes a `Platform` trait: file dialogs, message boxes
where native ones are used, start file drag, put file on clipboard, reveal in
file manager, enumerate printers, printer preferences, run print job, register
file association / native host, spell-check session, single-instance channel,
known folders, system theme and its change notifications, session-end
notification. The Windows implementation is the only one built. Tests use a
recording fake.

---

## 11. Risks to retire early (owned by S00/S02)

| Risk | How it is retired |
|---|---|
| Toolkit cannot hit start-up/memory budgets | S00 spike measures a real window with a textured viewport on both backends |
| PDFium sub-rectangle + progressive (cancellable) rendering not reachable through the binding | S02 proves it with a test that cancels a slow page within 10 ms; raw FFI if needed |
| Form filling API coverage | S02 lists what the binding exposes; S09 has a spike step first |
| lopdf page import correctness on real files | S08/S10 run a corpus round-trip test (materialise → reopen in engine → compare renders) |
| Vector printing to a DC | S11 starts with a spike against "Microsoft Print to PDF" |
| Custom title bar vs. native snap behaviour in winit | S03 acceptance tests cover hit-testing; fall back to a native caption with client-drawn content if unreachable |
