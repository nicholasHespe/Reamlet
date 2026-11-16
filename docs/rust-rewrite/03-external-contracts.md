# 03 — External contracts

Formats and protocols at the program's edges: its own files, its command
line, the browser-extension bridge, the registry, and what it writes into
PDFs.

**This is a fresh start.** There is no requirement to read, migrate or clean
up anything an earlier version of Reamlet wrote, installed or registered. The
file formats in §§2–3 are this plan's own and may be changed by a stage that
has a good reason (record it in `STATUS.md`). Two things here are genuinely
external and must be implemented exactly: the browser-extension wire protocol
(§4.3), because the extension is a separate published project, and the saved
PDF format (§6), because other viewers read it.

---

## 1. Folders

| Purpose | Location |
|---|---|
| Data folder | `%APPDATA%\Reamlet\` |
| Settings | `%APPDATA%\Reamlet\settings.json` |
| Session | `%APPDATA%\Reamlet\session.json` |
| Downloads kept for tabs | `%APPDATA%\Reamlet\Downloads\` |
| Logs | `%APPDATA%\Reamlet\logs\` |

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
| `extensionId` | string | absent | Browser extension ID |
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
        { "filePath": "C:\\Users\\me\\AppData\\Roaming\\Reamlet\\Downloads\\b.pdf",
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

### 4.1 Native messaging host
- Host name: `com.reamlet.chromebridge`.
- Executable: `reamlet-native-host.exe`, installed beside `Reamlet.exe`.
- Manifest file `com.reamlet.chromebridge.json`, beside the executables:
  ```json
  {
    "name": "com.reamlet.chromebridge",
    "description": "Reamlet native messaging host",
    "path": "C:\\…\\reamlet-native-host.exe",
    "type": "stdio",
    "allowed_origins": [ "chrome-extension://<EXTENSION_ID>/" ]
  }
  ```
  A fresh install writes the placeholder ID `PLACEHOLDER_CHROME_ID`.
- Registration: for each browser, the **default value** of
  `HKCU\<key>\com.reamlet.chromebridge` is the manifest's full path.

  | Browser | `<key>` |
  |---|---|
  | Chrome | `Software\Google\Chrome\NativeMessagingHosts` |
  | Edge | `Software\Microsoft\Edge\NativeMessagingHosts` |
  | Brave | `Software\BraveSoftware\Brave-Browser\NativeMessagingHosts` |
  | Vivaldi | `Software\Vivaldi\NativeMessagingHosts` |
  | Opera | `Software\Opera Software\Opera\NativeMessagingHosts` |
  | Opera GX | `Software\Opera Software\Opera GX\NativeMessagingHosts` |

### 4.2 Extension ID
- *Get*: the first `allowed_origins` entry matching
  `chrome-extension://<id>/` yields `<id>`; none yields empty.
- *Set*: rewrite the manifest with `allowed_origins` =
  `["chrome-extension://<id>/"]` and store `extensionId` in settings.
- At every start-up (in the background), if settings hold an `extensionId`,
  re-apply it to the manifest, so reinstalling or updating (which rewrites
  the manifest) does not lose it. An unwritable manifest is ignored silently.

### 4.3 Wire protocol
Standard Chrome native messaging: each message, in both directions, is a
4-byte little-endian unsigned length followed by that many bytes of UTF-8 JSON.
The host handles any number of messages until stdin closes, then exits 0.

Request (all keys optional):
```json
{ "url": "https://… or C:\\path\\file.pdf", "bytes": "<base64>", "filename": "name.pdf", "background": true }
```
Handling, in this order:
1. Locate `Reamlet.exe`: beside the host; else
   `%LOCALAPPDATA%\Programs\Reamlet\Reamlet.exe`. Not found →
   `{"ok": false, "error": "Reamlet.exe not found", "checked": [<paths tried>]}`.
2. If `bytes` is present: decode; save into the Downloads folder (§1) under the
   safe form of `filename` (spec §12 naming rules; "download.pdf" if absent),
   never overwriting — claim a free name by exclusive create, numbering
   " (2)", " (3)"…; launch `Reamlet.exe <saved path> [--background]`.
3. Else `url` must be a non-empty string, otherwise
   `{"ok": false, "error": "missing url or bytes"}`.
   - If it is a local Windows path (`X:\…` or `\\…`): move that file into the
     Downloads folder under its own name (same no-overwrite rule); if the move
     fails, use the original path. Launch Reamlet with the resulting path.
   - Otherwise launch `Reamlet.exe <url> [--background]`.
4. Reamlet is launched detached (the host does not wait for it). Reply
   `{"ok": true}`; on any error `{"ok": false, "error": "<message>"}`.
   A message that is not valid JSON → `{"ok": false, "error": "parse error"}`.

---

## 5. Command line and instance protocol

- `Reamlet.exe [target] [--background]` as in spec §14. Arguments beginning
  with `-` other than those listed here are ignored.
- Maintenance subcommands (exit when done, show no window):
  `--register-host`, `--unregister-host` (write/remove §4.1 for the folder the
  executable is in), `--register-file-assoc`, `--unregister-file-assoc` (§7).
- Test/measurement switches used by the harness (`04`): `--data-dir <path>`
  (use this instead of `%APPDATA%\Reamlet`), `--exit-after-first-frame`,
  `--exit-after-first-page`, `--perf-log <file>`.
- Single instance: a named mutex scoped to the user session plus a named pipe
  (`\\.\pipe\Reamlet-<user SID>`). A second launch sends one length-prefixed
  JSON message `{ "target": string|null, "background": bool }` and exits 0
  without waiting. The pipe accepts connections only from the same user.
- The executable must be named `Reamlet.exe`.

---

## 6. Saved PDF: how annotations are written

Each annotation made in the app becomes one standard PDF annotation carrying
its own normal appearance stream, appended to the page's `/Annots` in creation
order (after any annotations already in the file). Nothing is drawn into the
page content. Other viewers must show them exactly as Reamlet did.

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

- `HKCU\Software\nicholasHespe\Reamlet\Capabilities`:
  `ApplicationName` = "Reamlet", `ApplicationDescription` = "Lightweight PDF
  viewer"; subkey `FileAssociations`: `.pdf` = `Reamlet.PDF`.
- `HKCU\Software\RegisteredApplications`: `Reamlet` =
  `Software\nicholasHespe\Reamlet\Capabilities`.
- ProgID `HKCU\Software\Classes\Reamlet.PDF`: default "PDF Document";
  `DefaultIcon` = the executable's icon; `shell\open\command` =
  `"<path>\Reamlet.exe" "%1"`.
- `HKCU\Software\Classes\.pdf\OpenWithProgids`: value `Reamlet.PDF`.
- After changes: `SHChangeNotify(SHCNE_ASSOCCHANGED)`.
- "Set as default" on the installer's last page: on current Windows the user's
  default can only be changed by the user, so the option opens the system
  default-apps page for Reamlet rather than writing protected keys.
- Uninstall removes all of the above and §4.1.
