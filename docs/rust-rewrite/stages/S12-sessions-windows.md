# S12 — Sessions, windows and shell integration

**Depends on:** S08.
**Read first:** spec §§2.2, 2.5, 2.6, 2.7, 13, 14; `02` §§6, 7; `03` §§1, 3.

## Goal
Tabs outlive the app, move between windows, and their files can be dragged,
copied and revealed — all inside one process.

## Deliverables
1. **Multiple windows** in one process sharing engine, tile cache, settings and
   annotation clipboard; theme, UI scale and setting toggles apply to all at
   once; Hide annotations is per window; the app exits when the last window
   closes.
2. **Session store**: each window reports its restorable tabs (file-backed
   only, with source URL) and active index on every tab-list change; debounced
   write (500 ms), immediate write on Windows session-end notification and on
   exit; atomic; deleted when both settings are off; toggling a setting takes
   effect immediately.
3. **What a close means** (spec §13): user-closed window forgotten unless it is
   the last and Keep Tabs is on; a session-end (log-off/shutdown) is not a user
   close and must not forget anything; unsaved-changes prompts are skipped on
   session end (Windows will not wait) — the session is written first.
4. **Restore at start-up**: one window per saved window; tabs appear at once
   as placeholders; the active tab loads first, others when first activated
   (`02` §6); missing files become unavailable tabs; a command-line target is
   added to the first window as the active tab.
5. **Move a tab between windows**: drag from one tab list to another (insert
   at the drop position; target window raised when the drag enters it); the
   `Tab` value moves with document, history, view and tool state; a source
   window left empty closes.
6. **Tear off**: dropping a tab outside any tab list opens a new window at the
   drop point containing it; ignored for a window's only tab.
7. **Second-instance targets** go to the first window (restore if minimised,
   focus unless `--background`); `--background` on a cold start shows the
   window without activating it.
8. **File drag-out**: the grip starts a native OLE file drag (copy effect)
   after 6 px; faint grip and tooltip wording when dirty; no grip for pathless
   tabs.
9. **Tab menu**: Copy (file onto the clipboard as a file drop) and Open in
   Explorer (folder opened with the file selected), with their enablement
   rules; Save, Save As, Print wired.
10. Platform trait additions with fakes: drag source, clipboard file list,
    reveal, session-end notification, window activation without focus.

## Acceptance
Automated (core + headless UI, fake platform):
- Session file matches `03` §3 after: opening tabs, reordering, switching,
  closing a tab, opening a second window. Pathless tabs are never written.
- Close semantics: closing one of two windows drops only its tabs; closing the
  last with Keep Tabs off leaves an empty/deleted session, with it on keeps
  it; a simulated session-end followed by process exit keeps everything even
  with Keep Tabs off (Restore After Crash on), and nothing with both off.
- Restore: N saved tabs appear immediately; only the active tab's file has
  been read (assert on the fake file system); activating another loads it;
  a missing file gives an unavailable tab with reason and path that recovers
  when the file returns; a saved `activeIndex` of −1 activates the last tab;
  a command-line target becomes an extra active tab in window one.
- Moving a dirty tab between windows preserves its annotations, `*`, undo
  history (undo works in the new window), zoom and scroll; no prompt appears;
  the emptied source window closes.
- Tear-off creates a window with the tab; a single-tab window ignores it.
- Grip/menu enablement for clean, dirty and pathless tabs; tooltip strings.
- The session write is atomic: a simulated crash between temp write and rename
  leaves the previous file readable.

Automated (Windows CI):
- Kill the process (no clean exit) with three tabs open → relaunch with
  `--data-dir` restores them (perf log lists the tabs).
- Restore of a 20-tab session meets the start-up and memory budgets.
- Clipboard holds a file drop for the tab's path after Copy; the drag source
  offers `CF_HDROP` with that path (verified with an in-process drop target).

Manual (owner, on request): drag a tab between two windows and out to the
desktop; drag the grip into Explorer and into an email; log off with tabs open
and log back in.

## Out of scope
Receiving files from the browser (S13) — but `sourceUrl` is carried through
the session here.
