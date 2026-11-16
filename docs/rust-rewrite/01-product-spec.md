# 01 — Product specification

This is the definition of "feature complete". It describes what the user sees
and what the product does, not how it is built. Where a number appears it is a
requirement, not an example. Sections are numbered so stage files can cite them.

Terms: a **point** (pt) is 1/72 inch, the unit of PDF page space. **Zoom** is
logical pixels per point (zoom 1.0 draws one point as one logical pixel).
**Logical pixels** (px) are DPI-independent; the app is per-monitor DPI aware.

---

## 1. Window and chrome

### 1.1 Window
- Default size 1280 × 900, minimum 640 × 480, title "Reamlet", app icon.
- No native title bar: the app draws its own (1.2). All native window behaviour
  is kept: resize from every edge and corner, drag by the title row,
  double-click the title row to maximise/restore, Windows snap (drag to edge,
  Win+arrows), the Windows 11 snap-layout flyout on the maximise button,
  minimise/restore animations, correct taskbar behaviour.
- The window is first shown already painted in the right theme. No white or
  wrong-theme flash.
- Several windows can be open at once; they are equals.

### 1.2 Top bar (82 px: title row 38 px + tools row 44 px)
**Title row**, left to right:
- **File** menu: Open… (Ctrl+O) · Save (Ctrl+S) · Save As… (Ctrl+Shift+S) ·
  — · Print… (Ctrl+P) · — · Close Tab (Ctrl+W) · Reopen Tab (Ctrl+Shift+T) ·
  — · ☑ Switch to Already-Open Tab · ☑ Restore Tabs After a Crash ·
  ☑ Keep Tabs Between Sessions · — · Settings… · Extension ID… · — · Quit.
  The three ☑ items are toggles showing a tick when on; the two session ones
  carry tooltips ("Reopen your tabs if Reamlet closed without you closing it: a
  crash, power loss or system restart" / "Reopen your tabs every time Reamlet
  starts, even after you close it").
- **View** menu: UI Scaling ▸ (50, 75, 100, 125, 150, 200 %) · — · Fit Width ·
  Fit Height · — · Theme ▸ (Light, Dark, System Default — tick on the current).
- Centre: the active tab's full file path (or "Reamlet" with no tab), dim,
  12 px, single line. When too long it is truncated **from the start** so the
  file name stays visible.
- Right: minimise, maximise/restore, close buttons, each 46 px wide; close
  turns `#c42b1c` with white glyph on hover.
- Menus open on click, close on outside click or Escape, show shortcut hints
  right-aligned and dim; submenus open on hover.

**Tools row**: three groups — annotation tools (left of centre), page
navigation and view tools (centre), document actions (right of centre).

- *Annotate group*: Select (Esc) · Draw (D) · Highlight (H) · Shapes ▾ (menu:
  Line L, Arrow A, Rectangle R, Ellipse O; the button shows the icon of the
  shape last picked, Rectangle initially, and is lit while any shape tool is
  active) · Text (T) · Eraser (E) · | · Colour swatch button · Fill swatch
  button · Thickness slider (1–20, default 3, 80 px wide).
- *Main group*: ‹ previous page · page number input · "/ N" · › next page
  (these four never fold) · | · Fit button · Rotate · Zoom out · Zoom in ·
  Pan (P).
- *Document group*: Undo · Redo · | · Find · Print · Save · Save As · | ·
  Hide annotations (eye / eye-off icon).
- Every button has a tooltip naming it and its shortcut.
- **Folding**: when the row is too narrow, groups collapse one at a time in the
  order Document, then Annotate, then Main's view tools. A collapsed group
  shows a single toggle button (icon + label + caret) that opens the group's
  tools as a dropdown under it. Choosing a tool or action closes the dropdown;
  opening a colour picker or the shapes menu does not. Escape or an outside
  click closes it. Groups un-collapse as soon as there is room.

### 1.3 Left sidebar
- 200 px wide by default, resizable by dragging its right edge, minimum 120 px.
- Header with two mode buttons: **Tabs** (default) and **Tools**.
- *Tabs* mode: the vertical tab list (§2).
- *Tools* mode: four buttons — Combine PDFs, Reorder Pages, Add Footer, Add
  Watermark (§9).

### 1.4 Contents panel (right)
- Shown only when the active document has an outline (bookmarks); hidden
  otherwise. 260 px by default, resizable from its left edge, minimum 120 px.
  Header "Contents".
- A tree: each row has a chevron (▶ collapsed / ▼ expanded, blank for leaves)
  and the title ("(untitled)" if empty). All nodes start collapsed. Clicking
  the chevron toggles; clicking the row scrolls the viewer to that entry's
  page and updates the page number. Entries follow their pages if pages are
  reordered; entries whose page was removed are not shown.

### 1.5 Viewer area
- Fills the space between the sidebar and the contents panel.
- With no tab: centred text "No file open. Press **Ctrl+O** to open a PDF."
- Pages are stacked vertically, 12 px apart, 20 px above the first and below
  the last, each centred horizontally, white, with a soft drop shadow, on the
  theme background.
- Slim overlay scrollbars (10 px, rounded thumb, minimum thumb length 30 px),
  vertical at the right edge and horizontal at the bottom, each shown only
  when the content overflows in that direction. Clicking the track jumps
  there; dragging the thumb scrolls proportionally; the thumb brightens on
  hover and drag.

### 1.6 Theme and scale
- Themes: Light, Dark, System Default (follows Windows and changes live).
  Persisted. Applies to every window at once.
- Colour tokens (dark / light): background `#1e1e1e` / `#ffffff`; bars
  `#252526` / `#f3f3f3`; tab and card `#2d2d2d` / `#ececec`; border `#3c3c3c` /
  `#d9d9d9`; text `#cccccc` / `#1e1e1e`; dim text `#8a8a8a` / `#6e6e6e`; accent
  `#007acc` (both); input background `#2a2a2a` / `#ffffff`; row hover `#353535`
  / `#e4e4e4`; error text `#f08080` / `#b03030`. Font: system UI, 14 px.
- UI scaling 50–200 % scales all chrome (not the document zoom). Persisted.

### 1.7 Dialogs
- App-styled modal dialogs (rounded card, title, body, right-aligned buttons,
  primary button in accent colour) over a dimmed window. Escape = cancel
  button; Enter = default button.
- Message dialogs used throughout this spec take a title, message and button
  list and resolve to the button pressed.

---

## 2. Tabs

### 2.1 Tab list
- One row per open document: optional drag grip · file name · × close button.
  The row's tooltip is the full path. A leading `*` marks unsaved changes.
- The active tab is filled with the accent colour. A tab whose document is
  still loading shows its name dim. An unavailable tab (2.6) is dim italic.
- Click activates. × closes (2.4). Drag a tab up or down to reorder.
- A document with no file on disk yet (a combined document) has a name but no
  path; it shows no grip.

### 2.2 Tab context menu (right-click)
Close · Save · Save As… · Print · — · Copy · Open in Explorer · — · Close
Other Tabs.
- *Copy* puts the **file** on the clipboard (pasteable into Explorer or an
  email). *Open in Explorer* opens the containing folder with the file
  selected. Both are disabled when the tab has no file on disk or has unsaved
  changes.
- *Close Other Tabs* requests close on every other tab, each with its own
  unsaved-changes prompt where needed.

### 2.3 Opening documents
- File ▸ Open shows the system dialog (title "Open PDF", filter PDF, multiple
  selection). All chosen files appear as tabs at once; the last chosen becomes
  active and loads first, then the rest in order.
- Other ways in: a path or URL on the command line; a second launch forwarded
  to the running app; Explorer "Open with"/double-click; the browser extension
  (§12); dropping PDF files from Explorer onto the window.
- **Switch to Already-Open Tab** (default on): opening a document that is
  already open *and unmodified* — matched by file path, or by source URL for
  web documents — activates the existing tab instead of opening a duplicate.
- A new tab opens at **fit width**, scrolled to the top.
- A file that cannot be opened when the user explicitly asked for it: message
  `Could not open "<name>": <reason>` and no tab remains. Password-protected
  files are not supported; the reason says so.

### 2.4 Closing
- Closing a clean tab closes it immediately. The neighbour that takes its place
  in the list (else the one before) becomes active; with none left the empty
  state shows.
- Closing a tab with unsaved changes: dialog "Unsaved Changes" —
  `"<name>" has unsaved changes.` — buttons Cancel · Discard · Save (or
  "Save As…" for a tab with no file). Save closes the tab only if the save
  completes.
- Closing a window with unsaved tabs: same dialog — one tab:
  `"<name>" has unsaved changes.`; several: `<n> files have unsaved changes.` —
  buttons Cancel · Discard All · Save All. Save All saves each in turn and
  aborts the close if any save is cancelled or fails.
- **Reopen Tab** (Ctrl+Shift+T) reopens the most recently closed file-backed
  tab, from a per-window stack of the last 20. If that file is already open it
  is activated instead; if it is gone: `Could not reopen "<name>": file not
  found.`

### 2.5 Tabs and windows
- Dragging a tab onto another Reamlet window's tab list moves it there, with
  its unsaved changes, view position and undo history intact. The target
  window comes to the front as the drag enters it.
- Dragging a tab out and dropping it anywhere that is not a tab list opens a
  new window containing that tab — unless it is the window's only tab, in
  which case nothing happens.
- A window whose last tab was moved away closes.

### 2.6 Unavailable tabs
- A restored tab whose file is missing or unreadable stays in the list, greyed,
  and its viewer area shows the reason — "File not found" or "This file could
  not be opened" — with the path beneath.
- Each time such a tab is activated the app tries the file again (a network
  drive may have reconnected) and loads it if it is now readable.
- Unavailable tabs are skipped by Find, Combine, Print and all view commands.

### 2.7 Dragging the file out
- A file-backed tab shows a six-dot grip on hover. Dragging the grip more than
  6 px starts a native file drag: the file can be dropped into Explorer,
  Outlook, a browser upload box and so on (copy).
- When the tab has unsaved changes the grip is faint and its tooltip reads
  "Drag file (save first for latest annotations)"; the drag still offers the
  file as it is on disk. Otherwise the tooltip is "Drag file to another app".

---

## 3. Viewing

### 3.1 Scrolling
- Mouse wheel scrolls vertically, animated; Shift+wheel horizontally;
  precision touchpads scroll 1:1 in both axes with inertia.
- Keys (when no text field has focus): ↑/↓ line, PgUp/PgDn and
  Space/Shift+Space page, Home/End document start/end, ←/→ horizontal.
- **Pan tool** (P): the cursor is a grab hand; dragging moves the view.
- The page number box always shows the page with the most area on screen.

### 3.2 Zoom
- Range 0.25–5.0. Zoom in/out buttons and Ctrl+= / Ctrl+− step by 0.1.
- Ctrl+wheel (and touchpad pinch) zooms continuously, anchored on the point
  under the cursor: that point stays put on screen. Button and key zoom anchor
  on the viewport centre.
- Zooming is immediate and continuous: existing page imagery scales with the
  gesture and is replaced by sharp imagery as it becomes available, with no
  blank frames, flashes or jumps.
- **Fit width** (Ctrl+0, View ▸ Fit Width): the first page's displayed width
  fills the viewer width less a gutter of 1 % of the screen width on each
  side. **Fit page**: the page in view fits entirely — the smaller of fit
  width and (viewer height − 32 px) ÷ page height. **Fit height** (View menu):
  the height rule alone.
- The **Fit button** toggles: when the view is already at fit width (within
  0.011) it shows the fit-page icon, tooltip "Fit page", and applies fit page;
  otherwise it shows the fit-width icon, tooltip "Fit width (Ctrl+0)", and
  applies fit width. The icon tracks window resizes.
- Ctrl+R re-renders the current view from scratch.

### 3.3 Rotation
- Rotate button: every page turns 90° clockwise. Shift+click: only the page in
  view. Rotation accumulates (0/90/180/270) on top of the file's own page
  rotation.
- Rotation counts as an unsaved change and is written to the file on save.
- Annotations made in the app turn with their page; text boxes stay anchored to
  their spot on the page but their text always reads upright on screen.

### 3.4 Page navigation
- ‹ and › go to the previous/next page; typing a number in the box and
  pressing Enter goes there (clamped to 1…N). Navigation scrolls smoothly so
  the page's top is at the top of the view.
- With no document the box reads 1 and "/ 1".

### 3.5 Hide annotations
- A window-wide viewing aid. When on, every tab in the window is drawn without
  annotations: neither the ones made in this session nor the ones stored in
  the file. Interactive form fields still show. Tooltip flips between "Hide
  annotations" and "Show annotations".
- Saving and printing ignore it. Choosing any annotating tool turns it off, so
  nothing is ever drawn unseen.

---

## 4. Text selection

- With the Select tool, dragging over page text selects it (translucent blue).
  Selection follows reading order and can span pages. Double-click selects a
  word, triple-click a line. Ctrl+C copies the selected text. Clicking empty
  space clears it.
- Right-clicking the page opens the **page context menu**: Cut and Paste
  (annotations — shown only when applicable, §6.6) · — · Copy (selected text)
  · Highlight · Find.
  - *Highlight* highlights the selected text in the current colour; with no
    selection it switches to the Highlight tool.
  - *Find* opens the find bar pre-filled with the selected text.

---

## 5. Find

- Ctrl+F or the Find button opens a bar at the top right of the viewer (needs
  an available document): text field ("Find…"), counter, previous ⌃, next ⌄,
  scope toggle **Doc | All**, mode toggles **\*?** (wildcard) and **~**
  (fuzzy), close ✕. The field is focused with its text selected; if it already
  holds text the search runs again.
- Typing searches after a 150 ms pause. Enter = next, Shift+Enter = previous,
  Escape = close. Closing clears all highlights.
- **Matching** is case-insensitive over Unicode-NFKC-normalised text.
  - *Exact* (no mode lit): literal substring; non-overlapping matches.
  - *Wildcard*: `*` matches any run of characters, `?` exactly one; everything
    else literal.
  - *Fuzzy*: a window of text matches if its Levenshtein distance to the query
    is ≤ t, where t = 0 for queries shorter than 3 characters, else
    max(1, ⌊length ÷ 5⌋); window lengths from length − t to length + t are
    tried, shortest first, non-overlapping.
  - Clicking a lit mode button returns to exact. Only one mode is lit.
- Searched text: the page's own text, and the text of text-box annotations
  stored in the file. A match in page text is highlighted exactly over its
  glyphs; a match in a text-box annotation highlights the whole box.
- **Highlights**: all matches in the active document in translucent amber
  (`rgba(255,200,0,0.35)`); the current one in stronger orange
  (`rgba(255,140,0,0.6)`) with a 2 px outline. They track zoom and rotation.
- **Doc scope**: counter "i of n", or "No results" (field outlined in the error
  colour). The first current match is the first on or after the page in view;
  the view scrolls to centre it. Navigation wraps.
- **All scope**: every available tab is searched, the active one first. A
  dropdown under the bar lists each document with matches — name and "1 match"
  / "n matches" — with the active one marked. Clicking a row activates that
  tab and jumps to its first match. Counter: "n in doc". Next/previous move
  within the active document.
- Switching tabs while the bar is open shows that tab's matches from the same
  search.
- Results stay correct when the document changes (page reorder, save).

---

## 6. Annotations

Annotations are made on top of the page, are editable until saved, and on save
become standard PDF annotations any viewer shows (§8, and `03` §6).

### 6.1 Tools and keys
Select (Esc) · Draw (D) · Highlight (H) · Text (T) · Line (L) · Rectangle (R)
· Ellipse (O) · Arrow (A) · Eraser (E) · Pan (P). Letter keys work when no text
field has focus. Changing tool clears the annotation selection. Cursors: arrow
for Select, crosshair for Draw and shapes, I-beam for Highlight and Text, cell
for Eraser, grab/grabbing for Pan. While a drawing tool is active, form fields
do not react to the mouse.

### 6.2 Style controls
- **Colour**: a popup of 20 named swatches in four rows of five —
  Red `#ff3333`, Coral `#ff6644`, Orange `#ff8c00`, Amber `#ffb300`,
  Yellow `#f5c518`; Lime `#aacc00`, Green `#33bb55`, Teal `#00cc88`,
  Cyan `#00bbbb`, Sky `#0099cc`; Blue `#3388ff`, Dark Blue `#0055cc`,
  Indigo `#6644cc`, Purple `#cc44ff`, Pink `#ff44aa`; Brown `#884400`,
  Black `#111111`, Dark Gray `#555555`, Gray `#aaaaaa`, White `#ffffff`.
  Default Red. The button shows the current colour; the popup marks it.
- **Fill**: the same swatches preceded by "No fill" (default). Applies to
  rectangles, ellipses and text boxes.
- **Thickness**: 1–20 **screen pixels at the current zoom**; stored in points
  (pixels ÷ zoom), so a stroke keeps its size on the page afterwards.
- With annotations selected, the three controls show the selection's values
  (colour of the first selected; fill of the first fillable; thickness of the
  first stroked, converted back to pixels and clamped 1–20) and changing one
  restyles the selection. Each annotation takes only what applies to it: all
  have a colour; rectangles, ellipses and text have a fill; pen strokes, lines,
  arrows, rectangles and ellipses have a thickness. Dragging the thickness
  slider restyles live and counts as **one** undo step on release.
- With nothing selected they set what the next annotation is drawn with.
  Settings are per tab.

### 6.3 Drawing tools
- **Draw**: press, drag, release for a freehand stroke with round caps and
  joins. A stroke belongs to the page it started on and ends the moment the
  pointer leaves that page. A stroke needs at least two points.
- **Line, Arrow, Rectangle, Ellipse**: press at one corner/end, drag, release.
  A dashed preview follows the pointer. Shift constrains: rectangle → square,
  ellipse → circle, line/arrow → multiples of 45°. Drags smaller than 2 px in
  both axes create nothing. Rectangles and ellipses take the current fill.
  - Arrow head: a filled triangle at the end point, length
    max(10 pt, 4 × thickness), half-angle 30°. The shaft stops at the middle
    of the head's base so the tip stays sharp. An arrow shorter than its head
    is head only.
- **Highlight**:
  - Dragging across page text selects it; on release the selection becomes one
    highlight annotation made of a rectangle per line run, each trimmed
    vertically to the text height (about 1.25 × font size, at most 90 % of the
    line box) and centred on the line.
  - Starting the drag where there is no text draws a freehand highlighter
    stroke 20 screen px wide (stored as 20 ÷ zoom points). It needs more than
    three points.
  - Highlights are drawn at 35 % opacity in the current colour. A freehand
    stroke never darkens where it crosses itself.
- **Eraser**: click or drag; every annotation the pointer touches is removed
  whole. One drag is one undo step.

### 6.4 Text boxes
- With the Text tool, clicking empty page opens an editable box at that point:
  160 pt wide, one line tall, dashed grey outline, caret in the text colour.
  Clicking an existing text box (Text tool) or double-clicking it (Select
  tool) reopens it for editing with the caret at the end.
- Text wraps at the box width; Enter adds a line; the box grows and shrinks in
  height to fit. Only the width can be dragged (right edge), never below one
  character of the current size.
- Clicking elsewhere commits. Escape cancels: a new box vanishes, an edited
  one returns to how it was. Committing empty text creates nothing (and
  removes an edited box).
- **Text bar** — a small floating bar just above the box (below it when there
  is no room above, and kept inside the page horizontally): − size + · **B** ·
  U · text colour · fill colour · delete.
  - Sizes step through 8 9 10 11 12 14 16 18 20 24 28 32 36 48 60 72 96; a size
    not in the list steps to the next listed size in that direction; the ends
    hold. The bar shows the current size.
  - Using the bar never commits or closes the box being edited.
  - Delete discards the box being typed, or deletes the selected text boxes.
- The bar also appears when text boxes are among the selection (Select tool),
  positioned against the first selected text box; changes apply to every
  selected text box as one undo step. It hides during a drag.
- The last style used (size, bold, underline, colour, fill) is the style of the
  next new box. Defaults: 14 pt, regular, no underline, `#111111`, no fill.
- **Layout rules** (identical on screen and in the saved file, at every zoom):
  line pitch = size + 2 pt; baseline of line *i* (from 0) is
  *i* × (size + 2) + size ÷ 2 + 2 below the anchor; block height =
  max(1, lines) × (size + 2); underline is a rule size ÷ 12 thick (at least one
  device pixel on screen), its top 2 pt below the baseline, as wide as the
  line; fill covers the box width × block height. Wrapping is greedy by words
  on spaces; typed newlines are hard breaks; a word wider than the box is
  split at the last character that fits; a box too narrow for one character
  lets it overflow. No kerning. The typeface is Liberation Sans (regular and
  bold) on screen and in the file.

### 6.5 Selecting and moving (Select tool)
- Click an annotation to select it alone. Ctrl+click or Shift+click toggles
  one in or out of the selection. Shift+drag from empty page draws a selection
  box (dashed blue outline, faint blue fill); on release everything on that
  page whose bounds it touches is **added** to the selection. A plain click on
  empty page clears the annotation selection; a plain drag there selects text.
- Hit testing picks the topmost (most recently placed) annotation within about
  6 screen px of its stroke or box; text boxes have a 4 px margin.
- Selected annotations show a dashed `#4488ff` outline 5 px outside their
  bounds.
- Dragging a selected annotation moves the whole selection together; a move of
  more than 3 px is one undo step. Delete removes the selection. Escape clears
  it.

### 6.6 Cut, copy, paste
- Ctrl+X / Ctrl+C / Ctrl+V act on the annotation selection (Ctrl+C falls back
  to copying text when no annotation is selected). The clipboard is private to
  the app and shared by all its tabs and windows.
- Paste puts the copies on the page under the pointer: the first item lands
  with its anchor at the pointer (a text box's anchor is its top-left; anything
  else its centre) and the rest keep their positions relative to it. With no
  pointer over a page they are pasted on their original page, offset by 3 % of
  the page size. The pasted items become the selection.
- Page context menu: Cut appears when something cuttable is selected, Paste
  when the clipboard is not empty.

### 6.7 Order
Annotations stack in the order they were made; later ones cover earlier ones,
whatever their types. Saved files keep that order and place new annotations
above any already in the file.

---

## 7. Undo and redo

- Ctrl+Z undoes; Ctrl+Y or Ctrl+Shift+Z redoes; toolbar buttons do the same.
  Per tab. At least 100 steps.
- Every committed change is one step: adding, erasing (per drag), moving,
  restyling, editing text, cut, paste, delete, rotate, reorder/remove pages,
  footer, watermark.
- Undo and redo are instant, keep the scroll position, and work across a save
  (undoing past a save restores the document as it was before it).
- The unsaved marker follows history: undoing back to the last saved state
  clears the `*`; moving away from it sets it again.
- While a text field has focus, Ctrl+Z/Y/X/C/V belong to the field.

---

## 8. Saving

- **Save** (Ctrl+S) on a file-backed tab asks "Replace "<name>"?" — Replace ·
  Cancel — then writes the file. On a tab with no file it behaves as Save As.
- **Save As…** (Ctrl+Shift+S) shows the system save dialog (title "Save As",
  filter PDF), defaulting to the current path, or for a combined document to
  `combined.pdf` in the first source document's folder, else to
  `document.pdf` in the user's Downloads folder. After a successful Save As the
  tab is that new file.
- A save writes: annotations (as standard PDF annotations, `03` §6), page
  rotations, form field values, page order, footers and watermarks.
- A save never leaves a half-written file: a failure leaves the original
  untouched and reports `Save failed: <reason>`.
- After a save the tab is clean; zoom and scroll are unchanged; nothing
  flickers. Annotations just saved are now part of the document: they are
  drawn as the file's own annotations and are no longer selectable or
  editable.
- Text in saved annotations may use any character Liberation Sans covers
  (Latin, Greek, Cyrillic, common maths and arrow symbols). A character it
  lacks never prevents a save; the rest of the text is kept.

---

## 9. Document tools (sidebar ▸ Tools)

All four apply to the active tab, mark it unsaved, are undoable, and keep any
existing annotations in place.

### 9.1 Combine PDFs
- Needs at least two available tabs, else: "Open at least 2 PDF files to
  combine."
- Dialog "Combine PDFs" — hint "Click documents to add them in order. Click
  again to remove." — lists every available tab by name. Clicking a row adds
  it to the sequence and shows its position number as a badge; clicking again
  removes it and renumbers. Buttons Cancel · Combine. Fewer than two chosen:
  "Select at least 2 documents."
- Result: a new tab named "Combined.pdf", unsaved, with no file path,
  containing the pages of the chosen documents in sequence **as they currently
  appear**, unsaved annotations and rotations included. The source tabs are
  untouched.

### 9.2 Reorder Pages
- Dialog "Reorder Pages" — hint "Drag thumbnails to reorder, or use the arrows.
  Click × to remove a page." — a wrapping grid of page thumbnails, each
  labelled "Page n" (renumbered live) with ← → × buttons. Thumbnails appear
  progressively; the dialog is usable while they load.
- Drag a thumbnail onto another to move it there (before it when moving
  earlier, after it when moving later). Arrows move one place and keep the
  thumbnail scrolled into view. Click selects (highlight). × removes the page.
- Apply with no pages left: "Cannot remove all pages." Apply with no change
  does nothing. Otherwise the document takes the new order.

### 9.3 Add Footer
- Dialog "Add Footer" — hint "Embedded permanently on every page." Three
  columns, Left / Center / Right, each a choice of None · Date · Page number ·
  Page / Total · Custom… (Custom reveals a text field). Defaults: None, Page
  number, None. Font size 10 pt (4–72). A live preview shows a miniature page
  with the footer text for page 1.
- Result on every page: black text at the chosen size; baseline 20 pt above
  the bottom of the visible page; left text starts 40 pt from the left edge,
  centre text is centred, right text ends 40 pt from the right edge. "Date" is
  today's date in the system's short format, fixed at the moment of applying.
  Page numbers follow the page order at save time.
- All three None: nothing happens.

### 9.4 Add Watermark
- Dialog "Add Watermark" — hint "Embedded permanently into the PDF." Fields:
  Text (multi-line, placeholder "e.g. DRAFT / CONFIDENTIAL"), Font size 72 pt
  (8–400), Opacity 30 % (5–100, slider with read-out), Angle 45° (0–360).
  Live preview of a page ("Preview" stands in for empty text).
- Result on every page: each non-empty trimmed line, mid-grey (50 %), regular
  weight, at the chosen opacity, rotated counter-clockwise by the angle about
  the centre of the visible page; lines are centred and spaced 1.3 × size
  apart, first line uppermost.
- Empty text: nothing happens.

Footers and watermarks are positioned against the **visible** page (the crop
box clipped to the media box), not the raw page origin, and are part of the
page content once saved (not annotations: Hide annotations does not hide
them).

---

## 10. Forms

- Interactive form fields are live: single- and multi-line text fields,
  check boxes, radio buttons, drop-downs and list boxes. Push buttons and
  signature fields are shown but inert.
- Click a text field to type in it (Tab / Shift+Tab move between fields); click
  a check box or radio button to toggle; click a drop-down to choose.
- Values survive zoom, rotation and tab switches, count as unsaved changes, and
  are written on save so that other viewers show them.

---

## 11. Printing

### 11.1 Starting
Ctrl+P, the Print button, File ▸ Print or the tab menu opens the **Print
window** for that tab (a separate window, 960 × 700, minimum 600 × 400, titled
"Print"). What is printed is the document as it currently stands, unsaved
changes included; nothing needs saving first.

### 11.2 Print window
Left panel:
- **Printer** — all installed printers; the system default is pre-selected
  unless a printer rule applies (11.4). "No printers found" disables Print.
- **Printer Preferences** — opens that printer driver's own preferences dialog,
  modal to the Print window. What is chosen there (tray, media type, quality…)
  applies to prints from this Print window only: it is remembered per printer
  while the window is open and is **never** saved as the printer's defaults.
- **Copies** 1–99 and **Collate**.
- **Pages** — empty means all. Comma-separated numbers and ranges (`1-3, 7`;
  an en dash also works); out-of-range parts are ignored. If nothing valid
  remains: "No pages match this range." and no print.
- **Scale** — Fit to page (default) · 100 % · 75 % · 50 % · 25 %.
- **Orientation** — Portrait · Landscape; starts as Landscape when the first
  page is wider than tall.
- **Colour** — Colour · Greyscale (the preview turns grey too).
- **More settings**: **Pages per sheet** 1 · 2 · 4 · 6 · 9 · 16 (grids of
  1, 2, 2, 3, 3, 4 columns); **Two-sided** None · Long edge · Short edge;
  **Booklet** — hint "Arranges pages for folding into a booklet. Uses two pages
  per sheet. Prints all pages regardless of the Pages field." Ticking Booklet
  sets pages-per-sheet to 2 and locks it, and sets two-sided to Short edge;
  unticking restores 1 and None.
- **Print** · **Close**, and a status line ("Loading…", "n pages",
  "Printing…", `Print failed: <reason>`).

Right: a scrolling preview of the sheets exactly as they will print, with a
− 100 % + zoom control (steps 25, 33, 50, 67, 75, 90, 100, 110, 125, 150, 175,
200, 250, 300 %; Ctrl+wheel steps too). It opens fitted to the width. The
preview updates as settings change and never blocks the controls.

### 11.3 Layout rules
- The sheet is the size of the document's **first page**, turned to the chosen
  orientation. Each page is scaled to fit its slot and centred, shown the way
  the viewer shows it (its rotation applied, only its visible box).
- N-up fills slots left to right, top to bottom; unused slots on the last
  sheet are pale grey, labelled "Blank". Every slot has a faint border.
- Booklet (saddle stitch): pages are padded with blanks to a multiple of four.
  For sheet *k* (from 0) of *T* total slots: front = [T − 2k, 2k + 1], back =
  [2k + 2, T − 2k − 1] (left, right). Sheets are two pages wide, always
  landscape.
- Everything a viewer shows is printed: annotations (with their appearance)
  and filled-in form values; annotations flagged hidden or not-for-print are
  left out. Fine detail (barcodes, small type) must be reproduced at the
  printer's own resolution.
- The job tells the printer the sheet size, copies, collation, colour mode and
  duplex mode, combined with anything set in Printer Preferences. Landscape
  sheets are sent correctly oriented without relying on the driver to guess.
- On success the Print window closes. On failure it stays open with the reason
  and Print re-enabled.

### 11.4 Printer by page size (File ▸ Settings…)
- Dialog "Settings", section "Printer by page size" — "When you print, Reamlet
  selects the printer set here for the document's page size. Pages count as
  the same size whichever way up they are, and within 3 mm."
- A list of rules, each: size shown as `101.6 × 152.4 mm (4 × 6 in)` (mm to
  0.1, inches to 0.01, trailing zeros dropped) · a printer drop-down · ×
  remove. A rule whose printer is no longer installed keeps it, labelled
  "(not installed)". Empty list: "No rules yet. Documents print on whichever
  printer is selected in the print window."
- "Add the page you're viewing": shows the size of the page in view (or "Open
  a document to use its page size."), a printer drop-down, Add.
- "Add another size": width × height fields, unit mm | in, printer, Add; Enter
  in a field adds. A decimal comma is accepted. Errors: "Enter a width and a
  height." · "Each side must be between 10 and 5000 mm." (or "…0.4 and 196
  inches.") · "Choose a printer."
- Adding a rule for a size that already has one replaces it. Sizes are stored
  short side first, rounded to 0.1 mm; at most 100 rules.
- Rules are saved only by **Save**; Cancel or Escape discards the edits.
- **Matching** when the Print window opens: the first page's size is compared
  with every rule, either way up; a rule matches if both sides are within
  3 mm; the nearest match wins. If its printer is installed and the user has
  not already picked a printer in this Print window, it is selected.
  (So a 4 × 6 in label and a 100 × 150 mm label are the same rule; A6,
  105 × 148 mm, is not.)

---

## 12. Opening from the web and the browser extension

- Given an `https://` address, Reamlet downloads the PDF and opens it as a tab
  that remembers its source address. The tab appears at once, in a loading
  state, while the download runs.
- Download rules: HTTPS only (plain HTTP is refused: "Only HTTPS URLs are
  supported"); up to 5 redirects, never to non-HTTPS; non-2xx is an error
  ("HTTP 404"); the file must begin with `%PDF-` ("Downloaded file is not a
  valid PDF"). The system's proxy settings and certificate store are used.
- The file is kept under the name the server gave it (`Content-Disposition`
  `filename*`, then `filename`), else the last segment of the URL path, made
  safe for Windows (no path, reserved characters → `_`, no trailing dots or
  spaces, reserved device names prefixed `_`, `.pdf` enforced, ≤ 200
  characters, "download.pdf" when nothing is left). A taken name gets
  " (2)", " (3)", ….
- Downloads live in the app's own Downloads folder (`03` §1). A downloaded
  file no open tab or saved session needs is deleted once it is a day old;
  the sweep runs at start-up and hourly.
- **Failures** are gathered for one second and reported in a single dialog:
  one failure — title "Reamlet — Could not open URL", the reason; several —
  title "Reamlet — Could not open n URLs", each distinct reason with its count
  ("HTTP 404 (×3)"), most frequent first, at most five lines then "…and n
  other reasons".
- **Flood protection** (web addresses only; local files are never limited): at
  most 20 web opens in any 30 seconds. Once one is refused, all are refused
  until 30 seconds pass with no requests at all. Refused requests do not raise
  the window. When the flood ends, one warning: title "Reamlet — Too many PDFs
  from the web at once"; "Reamlet opened the first 20 PDFs from the web and
  skipped n more that arrived straight after."; detail "If you did not ask for
  these, the Reamlet browser extension may be reopening old downloads. Turn it
  off from its toolbar popup until it is updated."
- **Browser extension** (Chrome, Edge, Brave, Vivaldi, Opera, Opera GX): a
  small helper program installed with Reamlet receives requests from the
  extension and hands them to Reamlet (`03` §4). The extension can send a web
  address, a local file path, or the PDF's bytes with a file name, and can ask
  for the tab to open in the background.
- **Extension ID…** (File menu): a dialog with one field — hint "Paste the
  extension ID from edge://extensions or chrome://extensions." — pre-filled
  with the current ID; Save stores it so the extension is allowed to talk to
  the helper. The ID survives reinstalling and updating Reamlet. The field has
  a Cut/Copy/Paste context menu.

---

## 13. Sessions

- **Restore Tabs After a Crash** (default on): if Reamlet ended without the
  user closing it — crash, power loss, Windows restart or log-off — the next
  start reopens the windows and tabs it had, with the same tab order and
  active tab.
- **Keep Tabs Between Sessions** (default off): the same, after an ordinary
  close as well.
- Only file-backed tabs are remembered (with their web source address, if
  any). Closing one window of several forgets that window's tabs. Closing the
  last window ends the run and, unless Keep Tabs is on, forgets everything.
- On restore the tabs appear at once; the active tab's document loads first.
  Missing files become unavailable tabs (2.6). A document given on the command
  line at the same time opens as an extra, active tab in the first window.
- The session is saved shortly after every change to the tab list (within half
  a second) and immediately when Windows announces a shutdown or log-off; a
  power cut mid-write never corrupts it. Turning both settings off deletes the
  saved session at once.

---

## 14. Single instance and command line

- One Reamlet process runs per user. Launching it again hands the request to
  the running one and exits at once.
- `Reamlet.exe [target] [--background]` — *target* is the first argument that
  is an `http(s)://` address or an existing path ending `.pdf`.
  - Running already: the target opens as a tab in the first window, which is
    restored if minimised and brought to the front — unless `--background`,
    which opens the tab without raising or focusing anything.
  - Not running: start, restore the session if due, open the target.
    `--background` shows the window without taking focus.
- Files opened from Explorer (double-click, Open with, a multi-selection —
  which launches once per file) therefore all gather as tabs in one window.

---

## 15. Text fields and spelling

- Text boxes on the page are spell-checked in the user's Windows language(s),
  with misspellings underlined.
- Right-clicking in any editable text shows: up to five spelling suggestions
  for a misspelled word under the pointer (clicking one replaces the word as
  an undoable edit) · Add to Dictionary · — · Cut · Copy · Paste (each enabled
  only when it applies).
- All text fields support the usual editing keys, selection, IME input and
  clipboard.

---

## 16. Installation and system integration

- **Installer**: per-user, no administrator rights; installs to
  `%LOCALAPPDATA%\Programs\Reamlet`; desktop and Start-menu shortcuts; final
  page offers "Launch Reamlet" and an unticked "Set Reamlet as the default PDF
  viewer". Uninstall closes any running Reamlet and removes everything it
  registered.
- **Portable build**: runs from any folder with no installation; its browser
  helper can be registered and unregistered from the app itself.
- Reamlet registers as a program that can open `.pdf` (appears in "Open with"
  and Windows' default-apps list). Opening a PDF from Explorer uses §14.
- Licence: GPL-3.0-or-later. Bundled fonts: Liberation Sans (SIL OFL 1.1).

---

## 17. Deliberate changes from the current product

These are places where this spec intentionally differs from how Reamlet
behaves today, because the new design makes the better behaviour natural. The
owner should veto any they disagree with before the relevant stage starts.

| # | Change | Stage |
|---|---|---|
| 1 | Printing prints the document as it stands; no forced save first, and never-saved documents can print. | S11 |
| 2 | Unsaved annotations survive page reorder, footer, watermark, combining, and moving a tab to another window (today they are discarded or need a prompt). | S10 S12 |
| 3 | Combine no longer asks what to do about unsaved changes in the sources; it uses them as shown. | S10 |
| 4 | There are no "sleeping" tabs: no wake-up spinner; background tabs are simply cheap. | S04 |
| 5 | "Save Copy…" is named "Save As…" everywhere (its behaviour was always Save As). | S08 |
| 6 | Context-menu Highlight highlights the selected text (today it only switches tool). | S07 |
| 7 | Every annotation type can be cut, copied and pasted (today only text and shapes). | S07 |
| 8 | Filling a form field marks the tab unsaved; radio buttons and list boxes work. | S09 |
| 9 | Find highlights exact glyph boxes and can match across line breaks. | S05 |
| 10 | Undo keeps at least 100 steps (today 20) and never reloads the document. | S06 |
| 11 | Saves are atomic. | S08 |
| 12 | UI scaling is remembered. | S03 |
| 13 | PDFs can be dropped onto the window to open them. | S04 |
| 14 | The window appears before a web download finishes. | S13 |
| 15 | "Developer Tools" and "Reload App" are gone; a diagnostics overlay replaces them (`04` §2). | S14 |
| 16 | Windows 11 snap-layout flyout works on the maximise button. | S03 |
| 17 | Printer preferences never touch the printer's saved defaults, even transiently. | S11 |
| 18 | The watermark preview and the result use the same (regular) weight. | S10 |
| 19 | Keyboard scrolling keys and Tab-between-fields are specified explicitly. | S04 S09 |
