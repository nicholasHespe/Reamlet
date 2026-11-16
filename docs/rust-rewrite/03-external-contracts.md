# 03 — External contracts

Formats and protocols at the program's edges: its own files, its command
line, the browser-extension bridge, the registry, and what it writes into
PDFs.

**This is a fresh start.** There is no requirement to read, migrate or clean
up anything the earlier product (then called Reamlet) wrote, installed or registered. The
file formats in §§2–3 are this plan's own and may be changed by a stage that
has a good reason (record it in `STATUS.md`). The browser bridge (§4) is
likewise this plan's own design, but its two ends ship separately (the
extension through browser stores, the helper with Margin), so once released
it changes only by version negotiation. The saved PDF format (§6) is external
in the full sense: other viewers read it.

---

## 1. Folders

| Purpose | Location |
|---|---|
| Data folder | `%APPDATA%\Margin\` |
| Settings | `%APPDATA%\Margin\settings.json` |
| Session | `%APPDATA%\Margin\session.json` |
| PDFs received from the browser | `%APPDATA%\Margin\Downloads\` |
| Logs | `%APPDATA%\Margin\logs\` |

Files in the data folder that are not listed here are ignored.

---

## 2. `settings.json`

UTF-8 JSON object, pretty-printed with two spaces and a trailing newline.
Unknown keys must be preserved when the file is rewritten. Every key is
optional; a missing or malformed value takes its default. A missing or corrupt
file is treated as `{}`.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `themeMode` | `"light"` \| `"dark"` \| `"system"` | `"system"` | §1.6 of the spec |
| `uiScale` | number 0.5–2.0 | `1.0` | UI scaling |
| `reuseOpenTab` | boolean | `true` | Switch to Already-Open Tab |
| `restoreSession` | boolean | `true` | Restore Tabs After a Crash |
| `persistentTabs` | boolean | `false` | Keep Tabs Between Sessions |
| `printerRules` | array of `{ "widthMm": number, "heightMm": number, "printer": string }` | `[]` | Printer by page size |

`printerRules` is sanitised whenever read or written: entries that are not
objects of that shape are dropped; each side must be finite and within
10–5000 mm; the printer name is trimmed and must be 1–256 characters; sides are
stored short-then-long, rounded to 0.1 mm; a later entry for the same size
replaces an earlier one; only the last 100 are kept. One bad entry never
discards the others.

Writes are atomic (write a temporary file beside it, then rename over).

---

## 3. `session.json`

```json
{
  "windows": [
    {
      "tabs": [
        { "filePath": "C:\\Docs\\a.pdf", "sourceUrl": null },
        { "filePath": "C:\\Users\\me\\AppData\\Roaming\\Margin\\Downloads\\b.pdf",
          "sourceUrl": "https://example.com/b.pdf" }
      ],
      "activeIndex": 1
    }
  ]
}
```
- `windows` in the order they were opened; `tabs` in tab-list order.
- Reading is tolerant: a tab is kept only if `filePath` is a string holding an
  absolute path; `sourceUrl` is a string or becomes `null`; `activeIndex`
  outside `0..tabs.len()` becomes `-1` (meaning "the last tab"); windows with no
  valid tabs are dropped; anything unparseable is an empty session.
- Additional per-tab or per-window keys may be added later; readers ignore
  unknown keys.
- Written atomically. Deleted when both session settings are off.

Path comparison everywhere (already-open matching, "is this download still
needed") is on the absolute path, case-insensitively.

---

## 4. Browser bridge

Three parts: the **extension** (in the browser), the **helper**
(`margin-native-host.exe`, started by the browser on demand) and the **app**.
The extension lets the browser download the PDF, then asks the helper to open
the finished file; the helper asks the running app and relays its real answer.

```
extension ──native messaging──▶ helper ──instance pipe (§5)──▶ app
          ◀────── reply ───────        ◀────── reply ────────
```

### 4.1 Registration
- Host name: `com.margin.bridge`.
- Manifest file `com.margin.bridge.json`, beside the executables:
  ```json
  {
    "name": "com.margin.bridge",
    "description": "Margin browser bridge",
    "path": "C:\\…\\margin-native-host.exe",
    "type": "stdio",
    "allowed_origins": [ "chrome-extension://<ID>/" ]
  }
  ```
- Registration: for each browser, the **default value** of
  `HKCU\<key>\com.margin.bridge` is the manifest's full path.

  | Browser | `<key>` |
  |---|---|
  | Chrome | `Software\Google\Chrome\NativeMessagingHosts` |
  | Edge | `Software\Microsoft\Edge\NativeMessagingHosts` |
  | Brave | `Software\BraveSoftware\Brave-Browser\NativeMessagingHosts` |
  | Vivaldi | `Software\Vivaldi\NativeMessagingHosts` |
  | Opera | `Software\Opera Software\Opera\NativeMessagingHosts` |
  | Opera GX | `Software\Opera Software\Opera GX\NativeMessagingHosts` |

### 4.2 Extension identity
- The extension's `manifest.json` carries a `key` (its public key), which gives
  it the same ID wherever it is loaded from — unpacked, or installed from a
  store that was given the same key. The private key is the owner's and is
  never committed.
- The list of allowed extension IDs is a constant in the app's source. The
  manifest's `allowed_origins` is generated from it at registration. If a
  browser store assigns a different ID, that ID is added to the constant.
  There is no user-editable ID.

### 4.3 Extension ⇄ helper
Standard native messaging framing: each message, in both directions, is a
4-byte little-endian unsigned length followed by that many bytes of UTF-8
JSON. Replies must stay under 1 MB (they are tiny). The helper handles any
number of messages until stdin closes, then exits 0. Every request has `v`
(protocol version, currently `1`) and `op`.

**`ping`** — is Margin there?
```json
→ { "v": 1, "op": "ping" }
← { "ok": true, "v": 1, "appVersion": "1.2.3", "running": true }
```
`ok: true` means the helper found `Margin.exe`; `running` says whether the
app answered on the pipe. It never starts the app.

**`open`** — open a finished download.
```json
→ { "v": 1, "op": "open", "path": "C:\\Users\\me\\Downloads\\report.pdf",
    "sourceUrl": "https://example.com/report.pdf", "background": false }
← { "ok": true }
← { "ok": false, "code": "not_pdf", "error": "The file is not a PDF." }
```
The helper, in order:
1. Checks `path` is an absolute path to an existing file → else `file_missing`.
2. Locates `Margin.exe` beside itself, else in
   `%LOCALAPPDATA%\Programs\Margin` → else `not_installed`.
3. Connects to the app's pipe. If nothing is listening, starts
   `Margin.exe` (with `--background` when asked) detached and retries the
   connection for up to 5 s → else `no_response`.
4. Sends the app an `open` request (§5) with `path`, `sourceUrl`,
   `background` and `fromBrowser: true`, waits up to 10 s for its reply and
   relays it unchanged.

The **app**, on a `fromBrowser` open: applies flood protection (→ `busy`);
checks the file starts with `%PDF-` (→ `not_pdf`); moves the file into its
Downloads folder under a safe, unused name (spec §12.4; if the move fails,
copies; if that fails → `internal`); opens the tab; replies `{ "ok": true }`.
The reply is sent once the tab exists — it does not wait for rendering.

Failure codes: `file_missing`, `not_installed`, `no_response`, `not_pdf`,
`busy`, `unsupported_version`, `bad_request`, `internal`. Each reply also
carries a human-readable `error`. A message that is not valid JSON gets
`bad_request`. A request whose `v` is higher than the helper knows gets
`unsupported_version` together with the highest `v` it supports, so a newer
extension can fall back.

### 4.4 What the extension must do
- **Downloads the user starts**: let the browser finish; on completion send
  `open` with the downloaded file's path. On `ok: true` remove the entry from
  the browser's download list (the file itself has been moved by the app). On
  any failure do nothing more — it is an ordinary completed download.
- **Navigations to a PDF**: start a browser download of that address (so the
  browser's session is used), saved without prompting, and treat it as above.
  On `ok: true` send the tab back (or close it if it has no history). On
  failure, or if the download cannot be started, let the tab load the PDF in
  the browser, and do not intercept that load again.
- Only act on downloads that are new and in progress when first seen; never on
  the browser's history of earlier downloads. Downloads the extension itself
  started are not intercepted a second time.
- `background` is true when the originating tab is not the active tab.
- Respect the master and per-site switches (spec §12.2) before doing anything.
- Call `ping` when the popup opens, to show the "isn't installed" status.
- Permissions are the minimum these behaviours need.

The exact browser APIs for "download without prompting", "remove from the
download list" and "stop the in-flight navigation" are verified at the start
of S13; if one is unavailable the behaviour in spec §12.1 still holds — in
particular, a PDF is never lost.

## 5. Command line and instance protocol

- `Margin.exe [path] [--background]` as in spec §14. Arguments beginning with
  `-` other than those listed here are ignored. Web addresses are not accepted.
- Maintenance subcommands (exit when done, show no window):
  `--register-host`, `--unregister-host` (write/remove §4.1 for the folder the
  executable is in), `--register-file-assoc`, `--unregister-file-assoc` (§7).
- Test/measurement switches used by the harness (`04`): `--data-dir <path>`
  (use this instead of `%APPDATA%\Margin`), `--exit-after-first-frame`,
  `--exit-after-first-page`, `--perf-log <file>`.
- The executable must be named `Margin.exe`.

**Instance pipe.** A named mutex scoped to the user session decides who is the
running instance; it serves a named pipe (`\\.\pipe\Margin-<user SID>`) that
accepts connections only from the same user. Messages in both directions are
a 4-byte little-endian length followed by UTF-8 JSON; one request, one reply,
per connection.

```json
→ { "op": "open", "path": "C:\\…\\a.pdf" | null, "sourceUrl": string | null,
    "background": bool, "fromBrowser": bool }
← { "ok": true }  |  { "ok": false, "code": "…", "error": "…" }

→ { "op": "ping" }
← { "ok": true, "appVersion": "1.2.3" }
```
- `open` with `path: null` just raises the window (unless `background`).
- A second launch of `Margin.exe` sends `open` (`fromBrowser: false`) and
  exits 0 **without waiting for the reply**. The helper (§4.3) waits for it.
- Flood protection and the move into the Downloads folder apply only when
  `fromBrowser` is true.

## 6. Saved PDF: how annotations are written

Each annotation made in the app becomes one standard PDF annotation carrying
its own normal appearance stream, appended to the page's `/Annots` in creation
order (after any annotations already in the file). Nothing is drawn into the
page content. Other viewers must show them exactly as Margin did.

Common to all: `/Type /Annot`, `/F 4` (print), `/Rect`, `/AP << /N <form
XObject> >>` where the form's `/BBox` equals `/Rect` and its matrix is identity
(the appearance is written in page coordinates). Colours are DeviceRGB, 0–1.
Strokes use round caps and round joins. Coordinates below are PDF user space.

| App annotation | `/Subtype` | Subtype entries | `/Rect` | Appearance |
|---|---|---|---|---|
| Pen stroke | `Ink` | `/InkList [[x y …]]`, `/BS << /W t >>`, `/C [r g b]` | points' bounds grown by `t` | stroked polyline, width `t` |
| Freehand highlight | `Ink` | as pen, plus `/CA 0.35` | same | same, through an ExtGState with `/CA 0.35 /ca 0.35` |
| Text highlight | `Highlight` | `/QuadPoints` (per rectangle: bottom-left, bottom-right, top-left, top-right), `/C`, `/CA 0.35` | union of rectangles | each rectangle filled separately at 35 % |
| Line | `Line` | `/L [x1 y1 x2 y2]`, `/BS << /W t >>`, `/C` | end points' bounds grown by `t` | one stroked segment |
| Arrow | `Line` | `/L [start tip]`, `/LE [/None /ClosedArrow]`, `/BS`, `/C`, `/IC` (= `/C`) | bounds of start, shaft end and head points grown by `t` | stroked shaft to the head's base; filled triangular head (spec §6.3) |
| Rectangle | `Square` | `/BS`, `/C`, `/IC [r g b]` only if filled | shape grown by `t/2` | closed path, fill-and-stroke if filled else stroke |
| Ellipse | `Circle` | as rectangle | shape grown by `t/2` | four Bézier arcs (κ = 4(√2 − 1)/3) |
| Text box | `FreeText` | `/Contents` (the text, UTF-16 hex string), `/DA (/Helv <size> Tf <r> <g> <b> rg)`, `/RD [p p p p]`, `/BS << /W 0 >>`, `/C` (fill colour) only if filled | the box (width × block height) grown by `p = size/2` on every side | optional filled box; each line's glyphs at its baseline in the embedded font; underline rules |

Text boxes:
- Layout follows spec §6.4 exactly, measured with the embedded font's advance
  widths. Text is upright in the page's displayed orientation: on a page shown
  rotated by R° clockwise, text and its boxes are turned R° counter-clockwise
  in page space.
- Font: Liberation Sans Regular and/or Bold, each embedded **once per file**,
  **subset** to the glyphs used, as a composite (Type 0 / CIDFontType2,
  Identity-H) font with a `/ToUnicode` map, so text extracts and searches
  correctly. A face no annotation uses is not embedded. A character with no
  glyph is skipped or drawn as the missing glyph; it never fails the save.

Page rotation: a page's user rotation is added to its existing `/Rotate`
(mod 360).

Footer and watermark are written into the page **content**, appended inside a
`q … Q` pair after wrapping the existing content in its own `q … Q` so its
graphics state cannot leak. Same embedded font rules. Watermark opacity via an
ExtGState.

Form values are written so that each field's `/V` and its widget appearance
agree (regenerate the appearance or have the engine do it); `/NeedAppearances`
alone is not sufficient.

Encrypted input: if the engine can open the file without a password, the saved
file is written unencrypted; otherwise opening already failed.

---

## 7. File association (per user)

- `HKCU\Software\nicholasHespe\Margin\Capabilities`:
  `ApplicationName` = "Margin", `ApplicationDescription` = "Lightweight PDF
  viewer"; subkey `FileAssociations`: `.pdf` = `Margin.PDF`.
- `HKCU\Software\RegisteredApplications`: `Margin` =
  `Software\nicholasHespe\Margin\Capabilities`.
- ProgID `HKCU\Software\Classes\Margin.PDF`: default "PDF Document";
  `DefaultIcon` = the executable's icon; `shell\open\command` =
  `"<path>\Margin.exe" "%1"`.
- `HKCU\Software\Classes\.pdf\OpenWithProgids`: value `Margin.PDF`.
- After changes: `SHChangeNotify(SHCNE_ASSOCCHANGED)`.
- "Set as default" on the installer's last page: on current Windows the user's
  default can only be changed by the user, so the option opens the system
  default-apps page for Margin rather than writing protected keys.
- Uninstall removes all of the above and the registrations in §4.1.
