# S04 — Viewer

**Depends on:** S01, S02, S03.
**Read first:** spec §§1.3–1.5, 2 (except 2.5, 2.7), 3; `02` §§1, 5, 6;
`04` §1.

## Goal
Open PDFs in tabs and read them: smooth scrolling and zooming with no blank
frames, fit modes, rotation, page navigation, contents panel. This stage is
where the rewrite's third goal is won or lost — the acceptance tests are
mostly about smoothness.

## Deliverables
1. **Tab model and tab list** (spec §2.1): open, activate, close, reorder by
   drag within the list, loading/unavailable looks, tooltip, `*` marker
   (driven by a dirty flag that nothing sets yet). Tab context menu with
   Close and Close Other Tabs working; other items present, disabled.
2. **Opening**: File ▸ Open (multi-select, last becomes active, active loads
   first); command-line and second-instance targets (local paths); files
   dropped on the window; Switch-to-Already-Open; error dialog for explicit
   opens; Reopen Tab stack (20). Files read off the UI thread.
3. **Tile cache** (`02` §5.2, 5.5): keyed tiles, base images, byte budget, LRU,
   pinning of visible tiles, per-frame texture upload budget, eviction on tab
   close.
4. **Viewport widget**: layout from `reamlet-core`; draw order base → tiles →
   overlay hook (a callback later stages paint into, given the page's
   `PageView`); page shadow; overlay scrollbars (vertical and horizontal) with
   track click and thumb drag.
5. **Request policy**: each frame computes wanted tiles (visible, then
   look-ahead in scroll direction), issues engine requests with a generation
   per (tab, zoom, rotation, content version), cancels superseded generations;
   during a zoom gesture requests are rate-limited, then issued at full
   priority after ~80 ms of stillness.
6. **Input**: wheel (animated), Shift+wheel, precision touchpad pan and pinch,
   keyboard scrolling keys, Pan tool, Ctrl+wheel anchored zoom, zoom buttons
   and keys (centre-anchored), Ctrl+R.
7. **Fit**: fit width on open; Fit button toggle with icon/tooltip switching;
   View ▸ Fit Width / Fit Height; Ctrl+0; re-evaluation on resize.
8. **Rotate**: all pages / Shift for the page in view; view stays on the same
   page; sets dirty (through a `Document` edit + history push, so undo already
   works for it).
9. **Page navigation**: ‹ ›, page box, "/ N", smooth scroll-to-page, live
   current-page read-out.
10. **Contents panel**: appears only with an outline; tree with collapse
    state per tab; click navigates.
11. **Per-tab view state** (zoom, scroll, rotation, panel collapse state) kept
    while the tab lives; switching tabs restores it exactly.
12. **Unavailable** rendering and retry-on-activate (the restore path that
    creates such tabs arrives in S12; build and test it here with a tab whose
    file is deleted then restored).
13. Interaction script commands for the perf harness: open, scroll-by,
    scroll-to-page, zoom-at, rotate, switch-tab.

## Acceptance
Automated:
- Perf harness (reference document): launch-with-file to first sharp page ≤
  budget; scripted continuous scroll through 50 pages and a scripted zoom
  sweep 0.5 → 4 → 0.5 at the cursor: p99 frame ≤ 16.7 ms, no frame > 33 ms,
  **zero frames with blank area on a visible page**, UI-thread stall watchdog
  silent.
- Same script against the fake engine with a 200 ms artificial delay per tile:
  frame times unchanged (UI never waits on the engine) and no blank area once
  base images exist.
- Texture memory stays under the cache budget during a zoom-to-5× tour of a
  large page; working set after the reference tour ≤ budget.
- Tab switch back to a recently viewed tab presents cached content on the next
  frame.
- Headless UI tests: multi-open order and activation; already-open switching
  on/off; closing picks the right neighbour; reorder by drag; reopen-tab stack
  semantics incl. missing file message and the 20 limit; Fit button toggles
  and shows the right icon; fit-width zoom equals the core formula for the
  given panel widths; page box follows scrolling; navigation clamps; rotate
  all vs one page; the anchored point under the cursor stays within 1 px
  through a zoom gesture; scrollbars appear only on overflow and map drags
  proportionally; contents panel shows/hides with the outline and navigates;
  dropping two PDFs opens two tabs; an unavailable tab shows reason and path,
  is skipped by view commands, and loads once its file is back.
- Golden image: a known fixture page at zoom 1 and 2.5, rotations 0 and 90,
  matches reference within tolerance (tiles stitched without seams).

Manual (owner, on request): scrolling and zooming a real document feel smooth;
touchpad pinch feels right.

## Out of scope
Text selection (S05), annotations (S06–S07), saving (S08), moving tabs between
windows and drag-out (S12), URLs (S13).
