# 04 — Quality, performance and working rules

## 1. Performance budgets

These are the reason for the rewrite, so they are gates, not aspirations. The
numbers are the plan's proposed targets; **S00 measures the current Electron
build on the reference machine and confirms or adjusts them with the owner**
before they become binding. After that, a stage may not be marked done while a
budget it could affect is failing.

Reference machine: the owner's development PC (Windows 11). Record its CPU,
RAM, GPU and display in `STATUS.md`. CI runs the same measurements on a hosted
runner and gates on *regression against its own baseline* (±15 %), since
absolute numbers differ between machines.

### 1.1 Start-up
| Measure | Budget |
|---|---|
| Launch → window visible and fully painted, no document, no session | ≤ 150 ms |
| Launch with a 200-page, 10 MB PDF → first page sharp on screen | ≤ 350 ms |
| Second launch while running → process exits (request handed over) | ≤ 30 ms |
| Second launch with a file → tab visible in the running window | ≤ 100 ms |
| Restore a 20-tab session → window painted with all tabs listed | ≤ 200 ms |

All are medians of 10 warm runs (after one discarded run).

### 1.2 Memory (private working set)
| State | Budget |
|---|---|
| Empty window, idle | ≤ 60 MB |
| One 200-page, 10 MB PDF open, scrolled through, idle | ≤ 180 MB |
| Each additional background tab | ≤ its file size + 5 MB |
| 20 tabs of ~2 MB PDFs restored, one viewed | ≤ 150 MB |
| Native messaging host | ≤ 5 MB |

### 1.3 Responsiveness
| Measure | Budget |
|---|---|
| UI thread frame time while scrolling or zooming the reference document | p99 ≤ 16.7 ms, no frame > 33 ms |
| Longest single block of the UI thread, any operation | ≤ 8 ms outside a frame's own drawing |
| Frames showing any blank page area during scroll/zoom of a loaded document | 0 |
| Pointer move → ink/drag visible | next frame |
| Tab switch → content of the new tab visible | ≤ 50 ms (next frame when its tiles are cached) |
| Zoom settles → visible tiles sharp, typical text page | ≤ 150 ms |
| Undo/redo | ≤ 1 frame for annotation changes |
| Save a 10 MB document with 50 annotations | ≤ 500 ms, UI never blocked |
| Find, 200 pages, first results shown | ≤ 300 ms after typing stops; UI never blocked |
| Idle CPU, window open, nothing happening | 0 % (no repaint loop) |

### 1.4 Size
| Artefact | Budget |
|---|---|
| `Margin.exe` + engine library | ≤ 20 MB |
| `margin-native-host.exe` | ≤ 1 MB |
| Installer | ≤ 15 MB |

## 2. How performance is measured

Built in S00, extended by later stages:

- **Phase marks**: the app records monotonic timestamps for `process_start`,
  `window_created`, `first_frame_presented`, `engine_ready`,
  `first_page_base`, `first_page_sharp`, and writes them to the file named by
  `--perf-log`. `--exit-after-first-frame` / `--exit-after-first-page` make runs
  scriptable.
- **`cargo xtask perf`**: runs the start-up scenarios N times against fixture
  documents in a throwaway `--data-dir`, reads the perf logs, samples private
  working set, and prints a table plus a JSON file. `--check` compares with
  the committed budgets/baseline and fails on regression.
- **Scripted interaction**: a `--script <file>` mode (debug and perf builds)
  replays a recorded input sequence (scroll, zoom, switch tab, draw) while a
  frame-time recorder and a "blank pixels on a visible page" detector run.
  Used for §1.3.
- **Diagnostics overlay** (Ctrl+Shift+F12): frame time graph, engine queue
  depth, tile cache bytes, textures, working set. Ships in release builds.
- Criterion micro-benchmarks for hot pure functions (layout, wrapping,
  matching, display-list building) where a stage adds one.

## 3. Test strategy

| Layer | What | Where it runs |
|---|---|---|
| Unit | Pure logic in `margin-core`; every numbered behaviour in the spec that is pure has a test named after the behaviour | `cargo test`, everywhere |
| Engine | Open/measure/render/text against fixture PDFs; golden images compared with a small per-pixel tolerance; cancellation timing | `cargo test -p margin-engine` |
| Writer round-trip | Build a document model → materialise → reopen with lopdf (assert objects per `03` §6) **and** with the engine (assert it renders like the on-screen display list, within tolerance) | `cargo test -p margin-pdfwrite` |
| UI (headless) | `egui_kittest`: drive widgets and the viewport with synthetic input against the fake engine and fake platform; assert state and, where layout matters, snapshot images | `cargo test -p margin-ui` |
| Platform | Windows-only integration tests for registry, pipe, clipboard, drag source, print-to-PDF; each cleans up after itself and uses unique names | Windows CI job |
| End-to-end | Launch the real executable with `--data-dir` and `--script`; assert on perf log, files written, exit code | Windows CI job |
| Corpus | A folder of real-world PDFs (rotated, cropped, encrypted-without-password, huge, malformed, forms, CJK); open + render first page + materialise round-trip must not panic or hang | nightly / before release |

Fixtures are generated in code where possible (deterministic, tiny) and checked
in under `assets/fixtures/` otherwise, each with a line in a README saying what
it exercises and where it came from (must be redistributable).

Tests describe behaviour ("a 4 × 6 in label and a 100 × 150 mm label match the
same rule"), not implementation.

## 4. Standing gates (every stage, every commit to main)

- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`.
- `cargo test --workspace` green on Windows.
- `cargo deny check` (licences compatible with GPL-3.0-or-later; advisories).
- No `unwrap`/`expect`/`panic!` on paths reachable from user input or file
  content outside tests; a malformed PDF produces an error, not a crash.
- No blocking call on the UI thread: file I/O over a few kilobytes, engine
  calls, network, printing, spell-check and registry access all go through the
  worker/engine channels. A debug-build watchdog logs any UI-thread stall over
  8 ms with a backtrace.
- `unsafe` only in `margin-engine` and `margin-platform`, each block with a
  comment stating why it is sound.
- `cargo xtask perf --check` green.
- Public items in library crates have doc comments; each crate has a short
  README stating its purpose and boundaries.

## 5. Definition of done for a stage

1. Every deliverable in the stage file exists.
2. Every acceptance test in the stage file is automated and passing, or is
   explicitly listed in the stage file as a manual check and has been done by
   the owner.
3. Standing gates pass.
4. The spec sections the stage cites are fully implemented — or the gap is
   written in `STATUS.md` with the owner's agreement.
5. `STATUS.md` is updated with hand-off notes.

## 6. Working rules for agents

- **Headless first.** Verify with tests, the perf harness and logs. Do not
  launch windows on the owner's desktop without asking; when a manual visual
  check is genuinely needed, ask, say what to look for, and keep it short.
- **Stay in scope.** If something outside the stage is needed, add the smallest
  seam that unblocks you and record it; do not build the next stage early.
- **The spec wins over habit.** Where this plan gives a constant, a wording or
  a rule, use it. Where it is silent, choose the simplest behaviour consistent
  with the goals and record the choice.
- **Do not port.** There is no earlier code to translate. If a behaviour seems
  to need a time-out, a retry loop, a reload or a hidden window to work, the
  design is wrong — stop and rethink it against `02` §1.
- **Verify libraries, don't remember them.** Check the current documentation of
  every crate and Windows API before relying on it; record versions chosen.
- **Small commits, on a branch per stage**, each leaving the workspace
  building and tests green.
- **Never weaken a budget or delete a failing test to finish.** Report it.
- User-facing strings come from the spec verbatim and live in one module, so a
  later translation layer is possible.

## 7. `STATUS.md` format

```
# Status

Reference machine: …
Confirmed budgets: (link or table, after S00)
Toolkit / backend / engine decisions: …

| Stage | State | Branch/PR | Date | Notes |
|---|---|---|---|---|
| S00 | done | … | … | … |

## Hand-off notes
### S00
- decisions taken …
- deviations from the plan and why …
- what the next stages need to know …
- open questions for the owner …
```
