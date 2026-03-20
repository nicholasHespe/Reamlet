# PDFox — Application Specification

## Overview

A lightweight, standalone PDF viewer for Windows focused on speed and productivity. No bloat, no cloud, no accounts. Does one thing well.

## Stack

- **Runtime:** Electron (Chromium rendering engine)
- **PDF Rendering:** PDF.js (Mozilla) — handles rendering and native text selection
- **Annotation layer:** HTML5 canvas overlay, kept fully separate from the PDF during the session
- **Annotation persistence:** `pdf-lib` — embeds annotations into the PDF spec on save only
- **Distribution:** Single portable `.exe`, no installer required

## Annotation Architecture

Annotations are kept separate from the PDF at all times during editing. On save, they are embedded via `pdf-lib` using native PDF annotation types:

- **Highlights** → embedded as PDF highlight annotations (text selection preserved)
- **Freehand drawing** → embedded as PDF ink annotations (vector paths)
- **Text boxes** → embedded as PDF free-text annotations

PDF.js exposes the viewport transform, allowing canvas coordinates to be mapped accurately to PDF page coordinates at save time. `pdf-lib` is unmaintained since 2021 but remains the standard for in-browser PDF manipulation — acceptable for a personal tool; monitor for a maintained fork if issues arise.

## Core Requirements

### Viewing

- Tabbed interface — multiple PDFs open simultaneously
- Smooth scroll and zoom (pinch, ctrl+scroll, +/- keys)
- Full text selection and copy
- Fast document open — near-instant once app is running

### Annotations

- Freehand drawing with mouse (coloured pens, adjustable thickness)
- Text boxes (click to place, type, move)
- Highlighting (select text, apply colour)
- All annotations embedded back into the PDF on save
- Save: `Ctrl+S` overwrites original — `Ctrl+Shift+S` saves a copy

### Non-Goals

- No cloud sync
- No account/login
- No format support beyond PDF
- No OCR, no form filling, no signatures, no page manipulation

## Platform

- MVP is Windows-first
- 
- Portable `.exe` — no installation, runs from any folder

## Principles

- Small codebase — avoid abstractions until needed
- No telemetry
- Keyboard shortcuts for all common actions
