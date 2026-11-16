# S07 — Annotations II: editing and text

**Depends on:** S06 (and S05 for the context menu and text highlighting).
**Read first:** spec §§4, 6.2, 6.4–6.6, 7; `02` §4.2–4.3.

## Goal
Everything you can do to an annotation after it exists, and text boxes.

## Deliverables
1. **Selection** (spec §6.5): click, Ctrl/Shift+click toggle, Shift+drag
   marquee (additive, bounds-intersection), clear on empty click and Escape,
   selection outlines, hit-testing tolerances in screen pixels converted to
   page units, coexistence with text selection (plain drag on empty page
   selects text).
2. **Move**: drag the selection as a group, live; > 3 px is one history entry;
   a click without movement adds none.
3. **Restyle**: style controls reflect and edit the selection (per-kind
   applicability; slider live with one entry on release).
4. **Delete** key; **cut/copy/paste** with the app-wide annotation clipboard,
   paste-at-pointer anchoring and off-page offset fallback, pasted items
   selected; Ctrl+C falls back to text copy.
5. **Page context menu** completed: Cut/Paste visibility rules, Highlight
   (selected text → highlight annotation, else switch tool).
6. **Text boxes** (spec §6.4):
   - On-screen text drawn from the core display list using embedded Liberation
     Sans, glyphs positioned by the core's advances (no toolkit shaping or
     kerning), crisp at every zoom.
   - In-place editor at the box position: caret, selection, IME, clipboard,
     Enter for new line, wrapping at the box width using the **same** wrap
     function as the committed layout, auto height, width drag handle with the
     one-character minimum, dashed outline, fill preview.
   - Create (Text tool click on empty page), re-edit (Text tool click or
     Select-tool double-click), commit on click-away, cancel on Escape with
     restore, empty-commit discards.
7. **Text bar**: floating, placed above/below and clamped to the page; size
   stepping, bold, underline, colour and fill popups, delete; never steals
   focus from the editor; also targets selected text boxes (all of them, one
   history entry); hidden during drags; sticky style for the next box.
8. Script commands: click, double-click, type-text, key.

## Acceptance
Automated:
- Selection semantics: single, toggle, marquee adds without removing, clear
  rules, topmost-first hit-testing, text-box 4 px margin.
- Group move keeps relative positions and is one history entry; undo returns
  every member exactly.
- Restyle: colour applies to all; fill only to rectangles, ellipses, text;
  thickness only to stroked kinds; controls show the selection's values and
  revert to the tool's when cleared; a slider drag of 30 events is one entry.
- Paste with the pointer over page 3 puts the first item's anchor at the
  pointer on page 3 and preserves offsets; with no pointer over a page, items
  land on their original page offset by 3 %; pasted items are selected; every
  annotation kind round-trips through the clipboard; clipboard works across
  tabs and windows.
- Text box: committed text equals typed text; wrapping in the editor and after
  commit are identical line-for-line for a paragraph fixture at three widths;
  widening the box re-wraps; Escape on a new box leaves nothing, on an edited
  box restores the original exactly; empty commit removes; the box's page-space
  width is unchanged by zoom.
- Text renders upright on pages displayed at 90/180/270 and its anchor stays
  at the same page location (golden).
- Layout numbers: baseline, pitch, block height, underline position and
  thickness match spec §6.4 (measured from the display list).
- Text bar: appears for an open editor and for selected text boxes, placed
  above unless there is no room, clamped horizontally; using it does not
  commit or blur the editor; size stepping from 14 → 16 → 18 and from 15 → 16;
  delete discards/removes; next new box inherits the last style.
- Typing D, H, T… inside a text box types letters and does not switch tools;
  Ctrl+Z inside the editor undoes typing, not the document.
- Non-Latin text (Greek, Cyrillic, maths symbols) displays; a character with no
  glyph does not break layout.
- Context menu: Cut only with a selection, Paste only with clipboard content;
  Highlight with selected text creates one highlight annotation matching the
  selection's trimmed rectangles.

## Out of scope
Spell-check in the editor (S14). Writing to PDF (S08).
