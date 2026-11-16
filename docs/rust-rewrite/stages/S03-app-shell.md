# S03 — Application shell

**Depends on:** S00 (S01 for settings types and strings).
**Read first:** spec §§1, 14; `02` §§6, 7, 10; `03` §§1, 2, 5;
`04` §1.1–1.2.

## Goal
`Reamlet.exe` starts, shows its window with full chrome, remembers its
settings, and runs as a single instance — and already meets the empty-window
start-up and memory budgets. No documents yet.

## Deliverables
1. **Start-up path** exactly as `02` §7, with the single-instance hand-over
   before anything else is initialised.
2. **Single instance**: mutex + named pipe (`03` §5); the running app receives
   `open` and `ping` requests (`03` §5) and replies to them (opening files is
   S04, browser hand-over S13; here an `open` is logged, the window is
   raised/restored unless `background`, and the reply is `ok`).
3. **Command line** parsing (`03` §5), including the measurement switches and
   stubs for the maintenance subcommands.
4. **Window**: sizes, custom title bar with native behaviours (spec §1.1) —
   drag, double-click maximise, resize borders, snap, snap-layout flyout on
   the maximise button, minimise/maximise/close buttons with their hover
   styling; correct first paint colour before show; per-monitor DPI.
5. **Menus**: File and View with every item, shortcut hint, toggle tick,
   submenu and tooltip in spec §1.2. Items whose feature is not built yet are
   present and disabled. Open/close behaviour as specified.
6. **Tools row** with all groups and buttons present (disabled until their
   stage), tooltips, and the **folding** behaviour (spec §1.2) fully working.
7. **Sidebar** shell (Tabs/Tools modes, resize, minimum), **contents panel**
   shell (hidden by default, resize, minimum), **empty state**.
8. **Theme**: light/dark/system, live system changes, applied to all windows;
   colour tokens from spec §1.6. **UI scaling** 50–200 %.
9. **Settings store**: load at start, atomic save, unknown keys preserved;
   the three File-menu toggles, theme and UI scale persist.
10. **Dialog framework**: modal card, message dialog helper (spec §1.7).
11. **Platform trait** skeleton with Windows implementation for what this stage
    uses (known folders, theme, pipe, window hit-testing) and a recording fake.
12. **Keyboard shortcut dispatcher**: one table mapping shortcuts to commands,
    aware of text-field focus (spec §7 last bullet); commands are an enum the
    menus, toolbar and keys all dispatch.
13. Logging to the data folder; panic hook that logs and shows a plain message.

## Acceptance
Automated:
- Perf harness: empty-window launch ≤ budget; idle working set ≤ budget; idle
  CPU 0 % over 5 s (no repaint loop); second-launch hand-over ≤ budget.
- Launching twice with `--data-dir` leaves one process; the first one's log
  shows the second's request; `--background` does not change the foreground
  window (platform test).
- Settings: toggles, theme and scale survive a restart; a hand-edited file with
  an unknown key and one malformed value keeps the unknown key and defaults
  the malformed one; a corrupt file is treated as empty and rewritten on next
  change.
- Headless UI tests: every menu item in the spec exists with its label and
  shortcut hint; toggles show ticks; the theme submenu ticks the current mode;
  the tools row folds in the order Document → Annotate → Main as width
  shrinks and unfolds as it grows; a folded group's dropdown closes on action,
  on Escape and on outside click but stays open for the colour and shapes
  buttons; sidebar and contents panel clamp at 120 px.
- Snapshot images of the chrome in dark and light at 100 % and 150 % scale.
- Hit-test unit tests for the custom frame: title row = caption, buttons =
  their native codes, edges/corners = resize, menus and tools = client.

Manual (owner, on request): window feels native — snap, snap-layout flyout,
double-click maximise, multi-monitor DPI change; no flash at start in either
theme.

## Out of scope
Tabs and documents (S04); the Settings dialog's contents (S11); session restore (S12).
