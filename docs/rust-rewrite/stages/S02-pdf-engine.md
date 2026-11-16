# S02 — PDF engine service

**Depends on:** S00 (uses geometry types from S01 if available; otherwise
defines the minimum and reconciles later).
**Read first:** `02` §§1, 5, 11; spec §§1.4, 3, 4, 5, 10.

## Goal
`margin-engine`: everything that reads a PDF, behind a trait, running on its
own thread with a cancellable priority queue — plus a fake implementation that
lets UI stages be tested without PDFium.

## Deliverables
1. **`PdfEngine` trait** (synchronous, used only on the engine thread) and
   **`EngineHandle`** (cloneable, `Send`, what the rest of the app holds). The
   handle exposes requests that return immediately and deliver results to a
   channel / waker:
   - `open(source bytes) → DocHandle | error` (distinguishes: not a PDF,
     damaged, password required);
   - `page_count`, `page_info(i) → { visible box, media box, intrinsic
     rotation }` for all pages, without loading page content;
   - `render_tile(doc, page, rotation, zoom, tile rect, flags{annotations,
     forms}) → RGBA/BGRA buffer` in device pixels;
   - `render_base(doc, page, max side)`; `render_thumbnail`;
   - `page_text(doc, page) → characters with page-space boxes, in reading
     order, with line/word breaks`, including a separate list for text held in
     FreeText annotations (text + annotation rectangle);
   - `outline(doc) → tree of { title, target page index? }`;
   - `form_fields(doc, page) → [{ id, kind, rect, value, options, flags }]`,
     `set_form_value(doc, field, value)` (used by S09);
   - `close(doc)`.
2. **Scheduler**: priorities as `02` §5.3; every request carries a
   `Generation`; `cancel(generation)` and "cancel everything older than";
   cancellation checked between jobs and inside progressive renders;
   coalescing of duplicate tile requests; back-pressure so results cannot pile
   up unbounded.
3. **PDFium implementation**: pinned binary fetched by `xtask` with checksum
   verification; loaded on the engine thread *after* the window is shown;
   sub-rectangle rendering by matrix + clip; white page background; sub-pixel
   text as PDFium's default for LCD off (grayscale AA, so tiles can be scaled);
   annotation rendering on/off; form field rendering always on.
4. **Fake engine**: deterministic pages (solid colour + page number glyphs
   drawn procedurally), configurable artificial delay per job, scriptable
   failures. Same trait.
5. **Golden-image test utility**: compare buffers with a tolerance, write
   diffs on failure.
6. Engine phase marks wired into the perf log (`engine_ready`).

## Acceptance
- Opens every generated fixture; page infos match the generator's inputs,
  including a cropped page with a non-zero origin and a crop box hanging
  outside the media box.
- A tile rendered at zoom 4 for a sub-rectangle equals the corresponding crop
  of a whole-page render at zoom 4 (within tolerance).
- Rendering with annotations off omits a known annotation and keeps a known
  form field.
- Text of a fixture page comes back with boxes that land on the glyphs (checked
  by rendering and sampling ink under each box); FreeText annotation text is
  reported separately with its rectangle.
- Outline of the outline fixture matches; entries resolve to the right pages.
- A queued low-priority job is overtaken by a later high-priority one.
- Cancelling an in-flight render of a deliberately heavy page returns control
  to the queue within 10 ms; no result is delivered for a cancelled generation.
- "Password required", "not a PDF" and truncated-file cases return typed
  errors; none panics. A fuzz-ish test feeds 200 corrupted variants of a
  fixture without a crash or hang (per-open time-out in the test).
- Opening the 200-page reference document takes ≤ 30 ms after the library is
  loaded; a 512 px tile of a text page ≤ 15 ms (reference machine).
- The fake engine passes the same trait-level tests that do not depend on
  pixel content.
- No PDFium call happens off the engine thread (asserted in debug builds).

## Out of scope
Writing PDFs (S08), interactive form editing UI (S09), printing (S11), caching
of results (the tile cache is S04).
