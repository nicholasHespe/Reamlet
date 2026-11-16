# Margin — build plan (Rust)

This folder is a self-contained plan for building Margin as a native Rust
application. It is written to be copied into an **empty repository** and worked
through by agents one stage at a time. Nothing here assumes access to the
existing Electron/TypeScript code: every feature the product needs is described
in these documents.

## What Margin is

A lightweight, standalone PDF viewer for Windows. People use it instead of
leaving dozens of PDFs open in browser tabs: one window, a vertical list of
document tabs, fast reading, light annotation (pen, highlight, text, shapes),
simple document surgery (combine, reorder, footer, watermark), form filling,
printing with per-page-size printer rules, and a browser extension that sends
PDFs straight to it.

## Why rewrite

Three goals, in priority order. Every design decision in these documents is
justified against them, and every stage is tested against them.

1. **Fast start-up** — a window is on screen and usable almost immediately,
   with or without a document.
2. **Low memory** — an idle window costs tens of megabytes, not hundreds; open
   tabs cost roughly their file size, not a renderer each.
3. **Responsive, smooth UI** — scrolling, zooming, drawing and tab switching
   never wait on PDF work, and the page is never blank while it catches up.

Target platform: **Windows 10/11 x64 first.** Platform-specific code sits
behind one seam so other platforms can follow, but nothing is built or tested
for them now.

This is a **fresh start**: there is no backwards compatibility with any
earlier product (then called Reamlet) — no settings, sessions or registry entries to
migrate. The browser extension is rebuilt too, with a new protocol (stage S13).

## The documents

| File | What it is | Who reads it |
|---|---|---|
| [01-product-spec.md](01-product-spec.md) | Every user-visible feature and behaviour, with exact constants. The definition of "feature complete". | Everyone, before anything else |
| [02-architecture.md](02-architecture.md) | The design from first principles: document model, render pipeline, threading, crates, and what is deliberately **not** carried over. | Everyone |
| [03-external-contracts.md](03-external-contracts.md) | Formats and protocols at the program's edges: settings and session files, command line, browser-extension protocol, registry entries, saved-PDF annotation format. | Stages that touch them |
| [04-quality-and-performance.md](04-quality-and-performance.md) | Performance budgets, how they are measured, test strategy, definition of done, working rules for agents. | Everyone |
| [stages/](stages/) | One file per stage: goal, scope, deliverables, acceptance tests. | The agent doing that stage |
| [STATUS.md](STATUS.md) | Ledger of stage state and hand-off notes. Updated at the end of every stage. | Everyone |

## Stages

Each stage ends with a working, tested increment. A stage is not started until
the stages it depends on are marked done in `STATUS.md`.

| # | Stage | Depends on | Result |
|---|---|---|---|
| S00 | [Foundations and decision spikes](stages/S00-foundations.md) | — | Workspace, CI, perf harness, toolkit and engine choices confirmed by measurement |
| S01 | [Core domain library](stages/S01-core-domain.md) | S00 | All pure logic: geometry, annotation model, edit model, undo, layout, rules, session logic |
| S02 | [PDF engine service](stages/S02-pdf-engine.md) | S00 | Open, measure, render tiles, extract text, outline, form info — off the UI thread |
| S03 | [Application shell](stages/S03-app-shell.md) | S00 | Window, custom title bar, menus, theme, settings, single instance, command line |
| S04 | [Viewer](stages/S04-viewer.md) | S01 S02 S03 | Tabs, smooth scroll and zoom, fit, rotate, page navigation, contents panel |
| S05 | [Text selection and Find](stages/S05-text-and-find.md) | S04 | Select and copy text; find across one or all documents |
| S06 | [Annotations I — drawing](stages/S06-annotations-drawing.md) | S04 | Pen, highlight, shapes, eraser, style controls, undo/redo |
| S07 | [Annotations II — editing and text](stages/S07-annotations-editing.md) | S06 | Select, move, restyle, clipboard, text boxes, hide annotations |
| S08 | [Save pipeline](stages/S08-save.md) | S07 | Annotations written as real PDF annotations; Save, Save As, close prompts |
| S09 | [Forms](stages/S09-forms.md) | S08 | Fill and save interactive form fields |
| S10 | [Document tools](stages/S10-document-tools.md) | S08 | Combine, reorder/remove pages, footer, watermark |
| S11 | [Printing](stages/S11-printing.md) | S08 | Print window with preview, N-up, booklet, driver preferences, printer-by-page-size |
| S12 | [Sessions, windows and shell integration](stages/S12-sessions-windows.md) | S08 | Session restore, moving tabs between windows, drag file out, copy file, reveal |
| S13 | [Browser bridge and extension](stages/S13-web-bridge.md) | S03 S12 | Rebuilt extension, native helper, real open results, flood protection |
| S14 | [Polish](stages/S14-polish.md) | S07 S12 | Spell-check, keyboard completeness, accessibility, diagnostics |
| S15 | [Packaging and release](stages/S15-packaging.md) | all | Installer, portable build, file association, release gates |

Tracks that can run in parallel once their dependencies are met:
S01, S02 and S03 with each other; S05 with S06; S09, S10, S11 and S12 with each
other; S13 with S09–S11.

## How an agent works a stage

1. Read `01`, `02` and `04` in full, then the stage file, then the sections of
   `03` the stage file names.
2. Read `STATUS.md` for hand-off notes from earlier stages.
3. Build the stage. Stay inside its scope; note anything discovered that belongs
   elsewhere in `STATUS.md` rather than building it.
4. Make every acceptance test in the stage file pass, plus the standing gates in
   `04-quality-and-performance.md`.
5. Update `STATUS.md`: mark the stage done, record decisions taken, deviations
   from this plan and why, and anything the next stage needs to know.

If the plan is wrong — an API does not exist, a budget is unreachable, a
behaviour is ambiguous — the agent stops, writes the finding in `STATUS.md`, and
asks the owner. It does not quietly build something else.
