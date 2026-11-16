# S09 — Forms

**Depends on:** S08.
**Read first:** spec §§10, 6.1 (last sentence), 3.5; `02` §§4.1, 11;
`03` §6 (form values).

## Goal
Fill in interactive PDF forms and save the values so any viewer shows them.

## Approach
Form values live in the document model (`form_values: field → value`), like
every other edit, so they are undo-safe across saves, survive tab moves and
never depend on engine state. The engine draws fields with their current
values; editing happens in a lightweight native control placed over the
focused field.

**Start with a one-day spike** recorded in `STATUS.md`: what the PDFium binding
exposes for (a) listing widgets with kind, rectangle, options, flags and
current value, (b) setting a value so the widget appearance is regenerated,
(c) rendering fields with pending values. Choose between:
- *A (preferred)*: push model values into the engine document via its form
  API whenever they change, let the engine regenerate appearances and render
  them; on save, obtain the bytes with values applied from the engine and feed
  those to the lopdf stage of `materialise`.
- *B (fallback)*: draw current values ourselves in the overlay over the field
  rectangle, and on save write `/V` plus a generated appearance stream with
  the pdfwrite text machinery.
Either way the result must satisfy the acceptance tests below.

## Deliverables
1. Field discovery per page (kind, rectangle, name, value, options, read-only,
   multi-line, max length, radio group) cached with the page.
2. **Interaction**: click a text field → in-place editor sized to the field
   (font size ≈ 65 % of field height, minimum 8 px; multi-line fields wrap);
   Enter commits single-line, click-away commits, Escape cancels; Tab /
   Shift+Tab move through fields in document order and scroll them into view.
   Check boxes and radio buttons toggle on click (radio groups exclusive).
   Drop-downs and list boxes open a popup list of the field's options.
   Push buttons and signature fields are inert. Read-only fields are inert.
3. Hover feedback on fields (cursor), focus ring on the active field.
4. Form fields ignore the mouse while a drawing tool is active.
5. A value change is a `Document` edit: marks dirty, one history entry per
   committed field.
6. Fields remain visible with Hide annotations on.
7. **Save**: values written so `/V` and the widget appearance agree (and
   `/AS` for check boxes and radios); fields sharing a name update together.

## Acceptance
Automated:
- The form fixture's fields are discovered with correct kinds, rectangles and
  initial values.
- Typing into a text field, ticking a box, choosing a radio and a drop-down
  option each change the model, set `*`, and render the new value at zoom 1
  and 2.5 and at rotation 90 (golden).
- Values persist across tab switch, zoom, rotate, and moving the tab's
  `Document` through undo/redo.
- After save and reopen: the engine reports the new values; rendering the
  saved file **in annotation-appearance-only mode** (no form-fill regeneration)
  shows them — proving appearances were written, not just `/V`; lopdf shows
  `/V` and `/AS` consistent.
- A second independent renderer check on at least one fixture (e.g. rasterise
  with the engine after stripping `/NeedAppearances`) to guard against "only
  looks right in our own viewer".
- Tab order visits fields in document order across pages.
- With the Draw tool active, clicking a field draws and does not focus it.
- A document with no form behaves exactly as before (no cost: field discovery
  only runs for pages that have widgets).
- Non-Latin text in a field saves and displays (or, if the field's own font
  cannot show it, falls back visibly rather than dropping the value).

## Out of scope
JavaScript actions, calculated fields, validation scripts, signatures,
XFA forms. Form interactivity in combined documents (their fields keep their
appearance but need not stay editable — record the behaviour chosen).
