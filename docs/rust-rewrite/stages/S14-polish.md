# S14 — Polish

**Depends on:** S07, S12 (best done after S09–S11 too).
**Read first:** spec §§1, 15, 17; `04` §§1–2.

## Goal
The remaining pieces that make it feel finished, and a full pass of the spec
looking for gaps.

## Deliverables
1. **Spell-check** (spec §15) using the Windows spell-checking service for the
   user's languages: misspelling underlines in page text boxes (checked off the
   UI thread, debounced); context menu in editable text with up to five
   suggestions, Add to Dictionary, Cut/Copy/Paste with correct enablement;
   replacing a word is an undoable edit in the field. The service is created
   lazily on first use — never at start-up.
2. **Text-field completeness** everywhere (find field, page box, dialogs, text
   boxes, form fields): selection, word navigation, clipboard, IME
   composition, right-click menu.
3. **Keyboard completeness**: every shortcut in the spec; focus order and
   visible focus in dialogs; Escape/Enter conventions; menu keyboard
   navigation (Alt, arrows, Enter, Escape); nothing fires while typing in a
   field that should not.
4. **Accessibility**: accessible names and roles for chrome controls via the
   toolkit's accessibility layer; the document's page text exposed for the
   page in view if the toolkit allows (record what was achievable).
5. **Diagnostics overlay** (Ctrl+Shift+F12) as `04` §2, and a "copy
   diagnostics" action (version, engine version, GPU backend, settings sans
   personal paths).
6. **Robustness pass**: very large pages, 5 000-page documents, zero-page and
   damaged files, files deleted or replaced while open, read-only folders,
   long paths (> 260 characters), non-ASCII paths, network paths, monitor
   changes and DPI changes mid-session, GPU device loss (recreate textures,
   no crash), sleep/resume.
7. **Low-memory behaviour**: tile budget adapts to available memory; an
   allocation failure in a tile render degrades to the base image, not a
   crash.
8. **Spec audit**: walk `01-product-spec.md` section by section against the
   build; every bullet is ticked in an audit table committed to `STATUS.md`,
   gaps fixed or listed with the owner's decision. Walk §17 and confirm each
   deliberate change behaves as described.
9. **Visual pass** against spec §1 tokens and sizes in both themes at 100 %,
   150 % and 200 % scale and on a high-DPI display; consistent icon set (the
   toolbar icons are simple stroked line icons, 20 px, 2 px stroke).

## Acceptance
Automated:
- With a fake spell service: a misspelled word is underlined; the context menu
  lists ≤ 5 suggestions; choosing one replaces the word and one undo restores
  it; Add to Dictionary removes the underline; no spell service is created
  until a text field is first focused (start-up perf unchanged).
- IME composition test via synthetic composition events commits the composed
  text in a text box and in the find field.
- Shortcut table test: each shortcut triggers its command; none triggers while
  a text field has focus except the ones the spec allows.
- Robustness fixtures: a 5 000-page document opens within the launch budget
  and scrolls within frame budget; a 5 × 5 m page at zoom 5 stays within the
  tile budget; replacing the file on disk while open does not disturb the tab
  until the next save, which still succeeds (atomic replace).
- Simulated texture loss recreates content without user action.
- Snapshot images of every dialog in both themes.
- All budgets in `04` §1 green in one consolidated run recorded in `STATUS.md`.

Manual (owner): the audit table reviewed; a session of real use with no
defects found that contradict the spec.

## Out of scope
New features. Anything found that is not in the spec is recorded, not built.
