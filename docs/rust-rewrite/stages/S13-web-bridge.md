# S13 — Web opens and browser bridge

**Depends on:** S03, S12 (S04 for tabs).
**Read first:** spec §§12, 14, 2.3; `03` §§1, 4, 5.

## Goal
Open PDFs from web addresses safely, and connect the published browser
extension through a tiny native helper.

## Deliverables
1. **Downloader** (worker thread): HTTPS only, ≤ 5 redirects with no
   downgrade, status check, streaming to an exclusively-created uniquely named
   file in the Downloads folder, `%PDF-` check (delete on failure), system
   proxy and certificate store, sensible time-outs (connect 15 s, stall 30 s),
   cancellable when its tab is closed.
2. **Web tabs**: a tab is created immediately in a downloading state (name from
   the URL, progress if the size is known), becomes a normal file-backed tab
   with `source_url` on success, and is removed on failure (failure goes to the
   aggregated report). Switch-to-Already-Open matches on source URL.
3. **Flood gate** wired to every web open request (command line and
   second-instance), refusing without raising the window; the single
   end-of-flood warning dialog; local files never gated.
4. **Failure aggregation**: one dialog per 1 s burst with the specified
   wording.
5. **Downloads housekeeping**: at start-up (idle) and hourly, delete files in
   the Downloads folder that are over a day old and not referenced by any open tab or the saved session; never delete a file that
   is in use.
6. **`reamlet-native-host.exe`**: implements `03` §4.3 exactly; no runtime
   dependencies; no window; exits when stdin closes.
7. **Registration**: `--register-host` / `--unregister-host` subcommands
   (manifest written with the correct escaped path, preserving an existing
   extension ID; six registry keys); menu access for the portable build
   (File ▸ Extension ID… dialog gains "Register browser helper" /
   "Unregister" buttons when not installed by the installer).
8. **Extension ID dialog** (spec §12) with get/set (`03` §4.2), field context
   menu, error message on failure; start-up re-application of the saved ID in
   the background.

## Acceptance
Automated (local HTTPS test server with a test certificate trusted for the
test process, or an injected transport):
- A good PDF downloads, is named from `Content-Disposition` (`filename*` over
  `filename`), else from the URL; unsafe names are made safe; a second
  download of the same name becomes " (2)".
- `http://` is refused with the message; a redirect to `http://` is refused;
  six redirects fail; 404 reports "HTTP 404"; a non-PDF body reports the
  not-a-PDF message and leaves no file behind.
- The tab appears before the download finishes; closing it cancels the
  transfer and removes the partial file.
- Opening the same URL twice (setting on) activates the first tab.
- 25 web requests in a second: 20 open, 5 are refused, the window is not
  raised by the refused ones, and one warning with "skipped 5" appears after
  the quiet period (injected clock); 25 local files all open.
- Three failures inside a second produce one dialog with counts.
- Housekeeping removes an old unreferenced file and keeps old-but-referenced
  and young files (injected clock); works with the folder missing.
- Native host (spawned as a child with pipes, `Reamlet.exe` replaced by a stub
  that records its arguments): URL message → launched with the URL; with
  `background` → `--background` appended; local path → file moved into
  Downloads and that path passed; `bytes` + `filename` → file written with the
  safe name, never overwriting; missing fields → the specified error; invalid
  JSON → "parse error"; two messages on one connection both answered; replies
  are correctly framed; Reamlet not found → error with `checked` paths.
- Host working set ≤ 5 MB, executable ≤ 1 MB, round-trip (message in →
  reply out) ≤ 20 ms excluding the launch.
- Registration writes the six keys and a manifest whose `path` is the host
  beside the executable and whose existing extension ID is preserved;
  unregistration removes them (tests use a redirected registry root).
- Extension ID: set writes manifest and settings; get reads it back; after the
  manifest is reset to the placeholder, start-up restores the ID.

Manual (owner): with the real extension installed in Edge or Chrome, clicking
a PDF link opens it in Reamlet; background open does not steal focus.

## Out of scope
The extension itself (separate project). Authenticated downloads (cookies,
logins) — the extension handles those by sending bytes.
