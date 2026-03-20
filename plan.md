# PDFox — Implementation Plan

## Architecture Overview

```
pdf-lite/
├── main.js              # Electron main process — window creation, file dialogs, IPC
├── preload.js           # Contextbridge — exposes safe IPC to renderer
├── renderer/
│   ├── index.html       # App shell — tab bar + viewer container
│   ├── app.js           # Renderer entry — tab management, keyboard shortcuts
│   ├── viewer.js        # PDF.js wrapper — load, render, scroll, zoom
│   ├── annotator.js     # Canvas overlay — draw, text box, highlight tools
│   └── saver.js         # pdf-lib integration — embed annotations on save
├── assets/
│   └── style.css        # Minimal UI styles
├── package.json
└── LICENSE              # GPL v3
```

## Phase 1 — Project Scaffold

- `package.json` with Electron, PDF.js, pdf-lib dependencies
- Electron `main.js`: creates BrowserWindow, handles `open-file` menu, IPC for open/save dialogs
- `preload.js`: exposes `window.api` (openFile, saveFile, saveCopy) via contextBridge
- `renderer/index.html`: tab bar div + viewer container div, loads app.js as module

## Phase 2 — Viewer (PDF.js)

- Load PDF.js worker via cdn or bundled
- `viewer.js` class `PDFViewer`:
  - `load(arrayBuffer)` — opens PDF, renders all pages into canvas elements stacked vertically
  - `setZoom(scale)` — re-renders at new scale
  - Scroll is native browser scroll
  - Exposes `getViewport(pageNum)` for coordinate mapping
- Keyboard shortcuts: `+`/`-` zoom, `Ctrl+0` fit width
- Text layer rendered by PDF.js for selection/copy

## Phase 3 — Tabs

- `app.js` manages array of tab state objects: `{ id, filePath, pdfBytes, viewer, annotator, dirty }`
- Tab bar renders one button per tab with close (`×`) button
- Opening a file creates a new tab; switching tabs shows/hides viewer containers
- Dirty indicator (`•`) shown on tab when unsaved annotations exist

## Phase 4 — Annotation Layer

- `annotator.js` class `Annotator`:
  - Manages a `<canvas>` overlay per page, z-indexed above PDF.js canvas
  - Stores annotations as plain objects: `{ type, pageNum, data, color, thickness }`
  - **Draw tool**: mousedown/move/up → collect freehand path points
  - **Highlight tool**: wraps PDF.js text selection — on mouseup reads `window.getSelection()`, maps rects to page coords, stores as highlight annotation, draws yellow rect on canvas
  - **Text box tool**: click → insert `<textarea>` absolutely positioned, on blur/enter → converts to annotation object, draws text on canvas
  - Toolbar: tool selector, colour picker, thickness slider
- All coordinates stored as normalized PDF page coords (0–1 range) for zoom independence

## Phase 5 — Save Logic

- `saver.js` function `embedAnnotations(pdfBytes, annotations, viewers)`:
  - Loads PDF bytes with `pdf-lib`
  - Iterates annotations by page
  - **Highlight**: `PDFDocument.getPage(n).drawRectangle()` with yellow semi-transparent fill, then add a PDF highlight annotation via `page.node.set(...)` for spec compliance
  - **Ink/Draw**: construct `PDFInkAnnotation` with path data transformed from page coords to PDF coords
  - **Text box**: add `PDFFreeTextAnnotation` with text content at mapped position
  - Returns modified `Uint8Array`
- IPC handler in main.js for `save-file` (overwrite) and `save-copy` (dialog)

## Phase 6 — Keyboard Shortcuts

| Shortcut        | Action               |
|-----------------|----------------------|
| `Ctrl+O`        | Open file            |
| `Ctrl+S`        | Save (overwrite)     |
| `Ctrl+Shift+S`  | Save copy            |
| `Ctrl+W`        | Close tab            |
| `Ctrl+T`        | New tab (open dialog)|
| `Ctrl++`/`-`    | Zoom in/out          |
| `Ctrl+0`        | Fit width            |
| `D`             | Draw tool            |
| `H`             | Highlight tool       |
| `T`             | Text box tool        |
| `Escape`        | Select/pan mode      |

## Phase 7 — Packaging

- `electron-builder` configured for Windows portable `.exe` (no installer)
- Single-file output via `target: portable`

## Open Questions / Decisions Made

- **PDF.js text layer**: Enabled for selection. Highlight tool captures native browser selection and maps it to canvas rects — simpler than implementing a custom hit-test.
- **Annotation storage during session**: Plain JS objects in memory per tab — no temp file, no DB.
- **Coordinate system**: Normalized 0–1 per page, converted to PDF units on save. This keeps annotator.js zoom-independent.
- **pdf-lib limitations**: No official ink annotation constructor; will use low-level `PDFDict`/`PDFArray` API to write PDF annotation dictionaries directly — documented in saver.js.
