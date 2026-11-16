# S00 — Foundations and decision spikes

**Depends on:** nothing.
**Read first:** `02-architecture.md` (all), `04-quality-and-performance.md` (all).

## Goal
An empty but real workspace in which every later stage can build, test and
measure — and the two riskiest technology choices (UI toolkit/backend and PDF
engine) confirmed by numbers rather than assumed.

## Deliverables
1. **Workspace** laid out as `02` §8: all crates present as stubs that compile;
   `xtask`; `rust-toolchain.toml` pinning stable; `Cargo.lock` committed;
   workspace-level lints; release profile tuned for size and start-up
   (`lto`, `codegen-units = 1`, `panic = "abort"` unless a later stage needs
   unwinding, `strip`).
2. **CI** (GitHub Actions, Windows runner): format, clippy, tests, `cargo deny`,
   release build, artefact upload. Caching so a no-op run is quick.
3. **Licence scaffolding**: `LICENSE` (GPL-3.0-or-later), SPDX headers,
   `deny.toml` allow-list, `assets/fonts/` with Liberation Sans Regular and
   Bold and their licence text, app icon (`.ico` and `.png`).
4. **Perf harness** as `04` §2: phase marks, `--perf-log`,
   `--exit-after-first-frame`, `--data-dir`, `cargo xtask perf` with `--check`,
   working-set sampling, JSON output, a committed baseline file.
5. **Toolkit spike** (`spikes/toolkit/`, thrown away afterwards): a window with
   a custom-drawn title row, a side list of 50 rows, and a scrollable,
   zoomable viewport showing a grid of 512 px textures uploaded from a
   background thread, with a vector polyline overlay following the pointer.
   Built twice: eframe + `glow`, eframe + `wgpu` (DX12 only). Measured with the
   harness: time to first painted frame, idle working set, p99 frame time
   during scripted scroll/zoom, idle CPU.
6. **Engine spike** (`spikes/engine/`): load pinned PDFium; open a fixture;
   get all page sizes without loading pages; render a 512 × 512 sub-rectangle
   of a page at zoom 3; render progressively and cancel mid-page; extract
   characters with boxes; list form fields. Measure: library load time, open
   time for a 200-page file, tile render time for a text page and an
   image-heavy page.
7. **Baseline** (with the owner's help, since it means launching the current
   app): the same start-up and memory scenarios measured on the existing
   Electron build on the reference machine.
8. **Decision record** in `STATUS.md`: reference machine specs, chosen backend,
   chosen engine binding approach (crate vs raw FFI, static vs DLL), the
   measured numbers, and the **confirmed budgets** table agreed with the owner
   (replacing the proposed values in `04` §1 if they change).
9. **Fixtures**: a generator (in a `margin-testkit` dev crate) for
   deterministic PDFs — n pages of text, mixed page sizes, rotated pages,
   cropped pages with non-zero origins, a page with no content stream, an
   outline, a simple form — plus the "reference document" (200 pages, ~10 MB,
   text and images) used by the budgets.

## Acceptance
- `cargo build --workspace --release` and `cargo test --workspace` pass locally
  and in CI.
- `cargo xtask perf` runs the empty-window scenario against the stub app
  (a blank window that exits after first frame) and prints a table; `--check`
  fails when a budget in the baseline file is deliberately lowered.
- Both toolkit spike variants and the engine spike have numbers recorded in
  `STATUS.md`.
- The chosen backend's spike meets: first painted frame ≤ 150 ms, idle working
  set ≤ 60 MB, p99 frame ≤ 16.7 ms, idle CPU 0 %. If neither backend does,
  stop and consult the owner (fallbacks: `02` §3).
- The engine spike cancels an in-flight page render within 10 ms of the
  request.
- Owner has signed off the budgets. (Spec §17 is already approved.)

## Out of scope
Any product feature. The spikes are deleted (or moved under `spikes/` and
excluded from the workspace) once their numbers are recorded.
