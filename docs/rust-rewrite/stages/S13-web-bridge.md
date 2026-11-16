# S13 — Browser bridge and extension

**Depends on:** S03, S12 (S04 for tabs).
**Read first:** spec §§12, 14, 2.3; `03` §§1, 4, 5.

## Goal
Clicking a PDF in the browser opens it in Margin — including on sites the
user is logged in to — and a PDF is never lost when something goes wrong.
Three pieces are built together: the app's side, the native helper, and the
browser extension.

## Start by verifying the browser APIs (recorded in `STATUS.md`)
The extension is Manifest V3 for Chromium browsers. Before designing its
internals, confirm against current browser documentation and a throwaway
extension:
1. Starting a download of an address from the extension, saved without a
   prompt even when the browser is set to "ask where to save each file", and
   whether it carries the user's session for that site.
2. Detecting that a download is new and in progress (as opposed to one listed
   from history or resumed at start-up).
3. Removing an entry from the browser's download list without deleting the
   file, and the path the browser reports for a finished download.
4. The least disruptive way to stop a top-level navigation that turns out to
   be a PDF, and to restore the tab afterwards (go back, or close if it has no
   history) — and to let it proceed untouched on failure.
5. That a fixed `key` in the manifest yields the same extension ID in each
   target browser, and what each browser's store does to that ID.
6. Native messaging limits and lifetime for a one-shot message per request.

If any of these cannot be done as `03` §4.4 assumes, adjust the extension's
internals — not the guarantees in spec §12.1 — and record what changed.

## Deliverables

**App**
1. Pipe `open` requests with `fromBrowser: true` (`03` §§4.3, 5): flood gate,
   `%PDF-` check, move into the Downloads folder under a safe unused name
   (copy if the move fails), open as a tab with `source_url`, honour
   `background`, reply with `ok` or a failure code once the tab exists.
   Switch-to-Already-Open matches on the source address.
2. Flood warning dialog after the quiet period (spec §12.5).
3. Housekeeping: at start-up (idle) and hourly, delete files in the Downloads
   folder that are over a day old and not referenced by any open tab or the
   saved session; never delete a file that is in use.
4. `--register-host` / `--unregister-host` (`03` §4.1), generating the manifest
   from the built-in allowed-ID list. A portable build offers the same two
   actions in the File menu ("Register Browser Helper" / "Unregister Browser
   Helper") — shown only when the helper is not registered for this folder, or
   is registered for it, respectively.

**Helper — `margin-native-host.exe`**
5. Implements `03` §4.3 exactly: framing, `ping`, `open`, version handling,
   failure codes, starting the app when it is not running, time-outs. No
   runtime dependencies, no window, exits when stdin closes.

**Extension — `extension/`**
6. Manifest V3, plain JavaScript, no build step, fixed `key`, minimum
   permissions.
7. Behaviour per spec §12.1–12.3 and `03` §4.4: PDF detection (response type,
   `.pdf` address, new downloads only), browser-side download, hand-over,
   tab restore on success, untouched fallback on failure, no double handling
   of its own downloads, background flag.
8. Popup per spec §12.2: master switch, per-site switch keyed on the browsing
   site, status line including the helper-unreachable state, "OFF" badge.
9. A short README: how to load it unpacked, how the ID is fixed, how to
   package it for a store.

## Acceptance

Automated — app (pipe client in the test, fake platform where needed):
- A browser `open` for a valid PDF: the file ends up in the Downloads folder,
  not at its original path; a tab exists with the source address; reply `ok`.
- The same name twice becomes " (2)"; unsafe names are made safe.
- A non-PDF file is refused with `not_pdf` and left where it was.
- `background: true` opens the tab without changing the foreground window.
- The same source address twice (setting on) activates the first tab and still
  replies `ok`.
- 25 browser opens in a second: 20 succeed, 5 get `busy` and their files are
  left untouched; the window is not raised by the refused ones; one warning
  saying 5 appears after the quiet period (injected clock). 25 non-browser
  opens all succeed.
- Housekeeping removes an old unreferenced file and keeps old-but-referenced
  and young files (injected clock); works with the folder missing.
- Registration writes the six keys and a manifest whose `path` is the helper
  beside the executable and whose `allowed_origins` match the built-in list;
  unregistration removes them (tests use a redirected registry root).

Automated — helper (spawned as a child with pipes, against a stub app serving
the pipe):
- `ping` with the app running, with it not running, and with no `Margin.exe`
  to be found.
- `open` relays the app's reply unchanged for `ok`, `not_pdf` and `busy`.
- App not running: the helper starts it (stub records `--background` when
  asked) and delivers the request once the pipe is up; an app that never
  answers gives `no_response` within the time-out.
- Missing file → `file_missing`; relative path → `file_missing`; invalid JSON
  → `bad_request`; `v: 99` → `unsupported_version` with the supported version.
- Two messages on one connection are both answered; replies are correctly
  framed.
- Working set ≤ 5 MB, executable ≤ 1 MB, round trip ≤ 20 ms with the app
  running.

Automated — extension (unit tests of its logic with the browser APIs mocked,
run with Node's built-in test runner):
- PDF detection: by response type, by address, by download metadata; frames
  and non-PDFs ignored.
- Switches: master off → nothing intercepted; a site disabled by its browsing
  context is skipped even when the PDF is hosted elsewhere.
- A download that is already complete or interrupted when first seen is never
  handed over; a download the extension started is not intercepted again.
- Success path removes the download-list entry and restores the tab; every
  failure code leaves the download in place and lets the tab load the PDF,
  without re-intercepting it.
- Popup status strings for each state, including helper unreachable.

End-to-end (Windows CI if a headless Chromium with the unpacked extension
proves workable in the verification step; otherwise manual and recorded as
such):
- A local test site serving a PDF behind a cookie login: clicking the link
  opens it in Margin; the browser tab returns to the linking page.
- With Margin's helper unregistered, the same click shows the PDF in the
  browser.

Manual (owner): install the extension in Edge or Chrome with Margin
installed; open a PDF from a public site and from a site that needs a login;
start a PDF download; open a PDF link in a background tab; turn a site off in
the popup; uninstall Margin and confirm PDFs open in the browser again.

## Out of scope
Firefox and Safari. Publishing to browser stores (the README says how; the
owner does it). Opening web addresses from the command line (removed from the
product).
