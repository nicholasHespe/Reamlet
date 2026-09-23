// Reamlet — save logic
// Embeds in-memory annotations into PDF bytes using pdf-lib.
// SPDX-License-Identifier: GPL-3.0-or-later

// @ts-expect-error — pdf-lib is imported via direct path for Electron's file:// ESM loader
import * as _pdfLib from '../../node_modules/pdf-lib/dist/pdf-lib.esm.js';
// @ts-expect-error — fontkit's UMD build, imported by path for the same reason; see `fontkit` below
import * as _fontkitModule from '../../node_modules/@pdf-lib/fontkit/dist/fontkit.umd.min.js';
import type * as PDFLibNS from 'pdf-lib';
import type { Annotation, DrawAnnotation, HighlightAnnotation, TextAnnotation, ShapeAnnotation } from './types.js';
import type { PDFViewer } from './viewer.js';
import type { FontFiles } from './fonts.js';
import { toPdfCoords, displaySize, type PageBox } from './page-box.js';
import { arrowGeometry, arrowHeadLength, type Point } from './arrow-geometry.js';
import { HIGHLIGHT_OPACITY } from './annotation-style.js';
import {
  TEXT_LINE_GAP, textBaselineOffset, textUnderlineThickness, textBlockHeight, wrapText,
} from './text-layout.js';

// Cast the direct-path runtime import to the pdf-lib type surface
const {
  PDFDocument, PDFHexString, PDFString, degrees, rgb,
  pushGraphicsState, popGraphicsState, setGraphicsState, setStrokingRgbColor, setFillingRgbColor,
  setLineWidth, setLineCap, setLineJoin, LineCapStyle, LineJoinStyle,
  moveTo, lineTo, appendBezierCurve, closePath, stroke, fill, fillAndStroke,
  drawRectangle, drawText,
} = _pdfLib as unknown as typeof PDFLibNS;

type PDFDoc  = import('pdf-lib').PDFDocument;
type PDFPage = import('pdf-lib').PDFPage;
type PDFFont = import('pdf-lib').PDFFont;
type PDFOperator = import('pdf-lib').PDFOperator;
type Fontkit = Parameters<PDFDoc['registerFontkit']>[0];
type LiteralObject = NonNullable<Parameters<PDFDoc['context']['formXObject']>[1]>;

// The ES build of fontkit imports 'pako' by bare name, which Electron's file://
// loader cannot resolve, so the self-contained UMD build is used instead. Under
// Node it loads as CommonJS and arrives as the default export; as a browser
// module it exports nothing and registers `globalThis.fontkit` instead.
const fontkit: Fontkit =
  (_fontkitModule as { default?: Fontkit }).default ?? (globalThis as { fontkit?: Fontkit }).fontkit!;

/** The faces a document's text annotations use, each embedded once and shared; null if unused. */
interface TextFonts { regular: PDFFont | null; bold: PDFFont | null }

/** Embed one face as a subset, so the saved file carries only the glyphs drawn with it. */
function embedFace(pdfDoc: PDFDoc, bytes: Uint8Array): Promise<PDFFont> {
  pdfDoc.registerFontkit(fontkit);
  return pdfDoc.embedFont(bytes, { subset: true });
}

/**
 * Embed annotations into a PDF and return the modified bytes.
 * Also writes any user-applied page rotations into the PDF's /Rotate entry.
 */
export async function embedAnnotations(
  pdfBytes: Uint8Array, annotations: Annotation[], viewer: PDFViewer, fontFiles: FontFiles,
): Promise<Uint8Array> {
  const pdfDoc: PDFDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });

  // Write any form field values the user has edited
  const fieldValues = viewer?.fieldValues;
  if (fieldValues && Object.keys(fieldValues).length > 0) {
    try {
      const form = pdfDoc.getForm();
      for (const [name, value] of Object.entries(fieldValues)) {
        try {
          form.getTextField(name).setText(value == null ? '' : String(value));
          continue;
        } catch { /* ignore */ }
        try {
          const cb = form.getCheckBox(name);
          if (value) { cb.check(); } else { cb.uncheck(); }
          continue;
        } catch { /* ignore */ }
        try {
          const dd = form.getDropdown(name);
          if (value) dd.select(String(value));
        } catch { /* ignore */ }
      }
    } catch { /* PDF has no AcroForm — ignore */ }
  }

  // Only the faces some text actually uses are embedded, so documents without
  // text are left alone.
  const textAnns = annotations.filter((a): a is TextAnnotation => a.type === 'text');
  const textFonts: TextFonts = {
    regular: textAnns.some(a => !a.bold) ? await embedFace(pdfDoc, fontFiles.regular) : null,
    bold:    textAnns.some(a =>  a.bold) ? await embedFace(pdfDoc, fontFiles.bold)    : null,
  };

  for (let pageIdx = 0; pageIdx < pdfDoc.getPageCount(); pageIdx++) {
    const pageNum = pageIdx + 1;
    const pdfPage: PDFPage = pdfDoc.getPage(pageIdx);

    // Write user rotation into the PDF page's /Rotate entry
    const userRot = viewer.pageRotations?.[pageNum] || 0;
    if (userRot !== 0) {
      const existingRot = pdfPage.getRotation().angle;
      pdfPage.setRotation(degrees((existingRot + userRot) % 360));
    }

    const pageAnns = annotations.filter(a => a.pageNum === pageNum);
    if (pageAnns.length === 0) continue;

    const box      = await viewer.getPageBox(pageNum);
    const totalRot = viewer.getTotalRotation(pageNum);

    const toPdf: ToPdf = (nx, ny) => toPdfCoords(nx, ny, box, totalRot);
    for (const ann of pageAnns) {
      _writeAnnotation(pdfPage, _annotationSpec(ann, toPdf, box, totalRot, textFonts));
    }
  }

  return pdfDoc.save();
}

// ── Coordinate helpers ───────────────────────────────────────

/**
 * The visible box of a pdf-lib page — the CropBox clipped to the MediaBox, with
 * either box's corners normalised in case they were written the other way round.
 */
function visibleBox(page: PDFPage): PageBox {
  const norm = (b: { x: number; y: number; width: number; height: number }) => ({
    x0: Math.min(b.x, b.x + b.width),
    y0: Math.min(b.y, b.y + b.height),
    x1: Math.max(b.x, b.x + b.width),
    y1: Math.max(b.y, b.y + b.height),
  });
  const media = norm(page.getMediaBox());
  const crop  = norm(page.getCropBox());
  const x0 = Math.max(media.x0, crop.x0), x1 = Math.min(media.x1, crop.x1);
  const y0 = Math.max(media.y0, crop.y0), y1 = Math.min(media.y1, crop.y1);
  // An empty intersection means the boxes disagree beyond repair; the MediaBox
  // is the one the spec guarantees, so fall back to it rather than to nothing.
  if (x1 <= x0 || y1 <= y0) {
    return { x: media.x0, y: media.y0, width: media.x1 - media.x0, height: media.y1 - media.y0 };
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return { r, g, b };
}

/** Normalised display coords → a point in PDF user space, for one page. */
type ToPdf = (nx: number, ny: number) => Point;

type Rect = [number, number, number, number];

/** The axis-aligned box around `points`, grown by `pad` on every side. */
function _bounds(points: Point[], pad = 0): Rect {
  const xs = points.map(([x]) => x), ys = points.map(([, y]) => y);
  return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
}

/** The PDF-space box spanning two corners given in display coords. */
function _pdfRect(toPdf: ToPdf, nx0: number, ny0: number, nx1: number, ny1: number): Rect {
  return _bounds([toPdf(nx0, ny0), toPdf(nx1, ny1)]);
}

// ── Annotation writers ───────────────────────────────────────
//
// Every annotation is written as a native PDF annotation with its own
// appearance stream, drawing exactly what the canvas overlay drew rather than
// leaving each viewer to improvise one. Viewers paint annotations above the
// page content in /Annots order, so writing them in the order they were placed
// keeps the stacking the user saw on screen.

/** One annotation, ready to be added to a page. */
interface AnnotationSpec {
  subtype: string;
  /** [x0, y0, x1, y1] in page space. Also the appearance's BBox. */
  rect: Rect;
  /** Operators drawing the annotation, in page space. */
  appearance: PDFOperator[];
  /** Fonts and graphics states the appearance refers to. */
  resources?: LiteralObject;
  /** Entries specific to the subtype. */
  entries: LiteralObject;
}

function _annotationSpec(ann: Annotation, toPdf: ToPdf, box: PageBox, rot: number, fonts: TextFonts): AnnotationSpec {
  switch (ann.type) {
    case 'draw':
    case 'freeHighlight': return _inkSpec(ann, toPdf);
    case 'highlight':     return _highlightSpec(ann, toPdf);
    case 'text':          return _textSpec(ann, toPdf, box, rot, (ann.bold ? fonts.bold : fonts.regular)!);
    case 'line':          return _lineSpec(ann, toPdf);
    case 'arrow':         return _arrowSpec(ann, toPdf);
    case 'rect':          return _squareSpec(ann, toPdf);
    case 'oval':          return _circleSpec(ann, toPdf);
  }
}

/** Add the annotation, with its appearance, on top of everything already on the page. */
function _writeAnnotation(pdfPage: PDFPage, spec: AnnotationSpec): void {
  const context    = pdfPage.doc.context;
  const appearance = context.register(context.formXObject(spec.appearance, {
    // With the BBox equal to /Rect and an identity matrix, the appearance is
    // drawn in page space exactly as written.
    BBox:      spec.rect,
    Resources: spec.resources ?? {},
  }));
  const annot = context.register(context.obj({
    Type:    'Annot',
    Subtype: spec.subtype,
    Rect:    spec.rect,
    F:       4, // Print
    ...spec.entries,
    AP:      { N: appearance },
  }));
  pdfPage.node.addAnnot(annot);
}

const OPACITY_GS = 'GS0';

/** Resources for an appearance painted at `opacity`, or none when it is opaque. */
function _opacityResources(opacity: number): LiteralObject | undefined {
  if (opacity >= 1) return undefined;
  return { ExtGState: { [OPACITY_GS]: { Type: 'ExtGState', CA: opacity, ca: opacity } } };
}

interface Paint {
  stroke?: { r: number; g: number; b: number };
  fill?: { r: number; g: number; b: number };
  /** Stroke width; strokes get the canvas's round caps and joins. */
  lineWidth?: number;
  /** Needs the graphics state from _opacityResources(). */
  opacity?: number;
}

/** Wrap path operators in the colour and stroke settings they are painted with. */
function _painted(paint: Paint, ops: PDFOperator[]): PDFOperator[] {
  const { stroke: sc, fill: fc, lineWidth, opacity = 1 } = paint;
  return [
    pushGraphicsState(),
    ...(opacity < 1 ? [setGraphicsState(OPACITY_GS)] : []),
    ...(sc ? [setStrokingRgbColor(sc.r, sc.g, sc.b)] : []),
    ...(fc ? [setFillingRgbColor(fc.r, fc.g, fc.b)] : []),
    ...(lineWidth !== undefined
      ? [setLineWidth(lineWidth), setLineCap(LineCapStyle.Round), setLineJoin(LineJoinStyle.Round)]
      : []),
    ...ops,
    popGraphicsState(),
  ];
}

function _rectPath([x0, y0, x1, y1]: Rect): PDFOperator[] {
  return [moveTo(x0, y0), lineTo(x1, y0), lineTo(x1, y1), lineTo(x0, y1), closePath()];
}

const _rgbArray = ({ r, g, b }: { r: number; g: number; b: number }) => [r, g, b];

function _inkSpec(ann: DrawAnnotation, toPdf: ToPdf): AnnotationSpec {
  const color   = hexToRgb01(ann.color);
  const opacity = ann.type === 'freeHighlight' ? HIGHLIGHT_OPACITY : 1;
  const points  = ann.points.map(([nx, ny]) => toPdf(nx, ny));
  const [first, ...rest] = points;
  return {
    subtype:    'Ink',
    rect:       _bounds(points, ann.thickness),
    appearance: _painted({ stroke: color, lineWidth: ann.thickness, opacity }, [
      moveTo(...first), ...rest.map(p => lineTo(...p)), stroke(),
    ]),
    resources:  _opacityResources(opacity),
    entries: {
      InkList: [points.flat()],
      BS:      { W: ann.thickness },
      C:       _rgbArray(color),
      ...(opacity < 1 ? { CA: opacity } : {}),
    },
  };
}

function _highlightSpec(ann: HighlightAnnotation, toPdf: ToPdf): AnnotationSpec {
  const color = hexToRgb01(ann.color);
  // Each rect is filled on its own, as the canvas does, so overlaps darken alike.
  const boxes = ann.rects.map(r => _pdfRect(toPdf, r.x, r.y, r.x + r.width, r.y + r.height));
  return {
    subtype:    'Highlight',
    rect:       _bounds(boxes.flatMap(([x0, y0, x1, y1]): Point[] => [[x0, y0], [x1, y1]])),
    appearance: _painted({ fill: color, opacity: HIGHLIGHT_OPACITY },
                         boxes.flatMap(b => [..._rectPath(b), fill()])),
    resources:  _opacityResources(HIGHLIGHT_OPACITY),
    entries: {
      // BL, BR, TL, TR for each highlighted span.
      QuadPoints: boxes.flatMap(([x0, y0, x1, y1]) => [x0, y0, x1, y0, x0, y1, x1, y1]),
      C:          _rgbArray(color),
      CA:         HIGHLIGHT_OPACITY,
    },
  };
}

/** Resource name the text appearance uses for its font. */
const TEXT_FONT_RESOURCE = 'F0';

/**
 * A FreeText annotation whose appearance draws each line at exactly the
 * baseline the canvas overlay used, wrapped to the same box width (see
 * text-layout.ts). /Contents keeps the text for viewers that list or edit it.
 */
function _textSpec(ann: TextAnnotation, toPdf: ToPdf, box: PageBox, rot: number, font: PDFFont): AnnotationSpec {
  const { r, g, b } = hexToRgb01(ann.color);
  const color   = rgb(r, g, b);
  const size    = ann.fontSize;
  const display = displaySize(box, rot);
  const width   = ann.width * display.width;
  // A page displayed with /Rotate R turns its content R° clockwise, so text and
  // its boxes are turned R° counter-clockwise to come out upright.
  const upright = { rotate: degrees(rot), xSkew: degrees(0), ySkew: degrees(0) };

  const lines       = wrapText(ann.text, width, (s) => font.widthOfTextAtSize(s, size));
  const blockHeight = textBlockHeight(lines.length, size);
  // The point on the box's left edge `down` points below its top.
  const leftEdge = (down: number) => toPdf(ann.x, ann.y + down / display.height);

  const ops: PDFOperator[] = [];
  if (ann.fillColor) {
    const fc = hexToRgb01(ann.fillColor);
    const [x, y] = leftEdge(blockHeight);
    ops.push(...drawRectangle({
      x, y, width, height: blockHeight, borderWidth: 0,
      color: rgb(fc.r, fc.g, fc.b), borderColor: undefined, ...upright,
    }));
  }
  lines.forEach((line, i) => {
    if (!line) return;
    const baseline = textBaselineOffset(size, i);
    const [x, y] = leftEdge(baseline);
    ops.push(...drawText(font.encodeText(line), { x, y, size, font: TEXT_FONT_RESOURCE, color, ...upright }));

    if (ann.underline) {
      const thickness = textUnderlineThickness(size);
      const [ux, uy] = leftEdge(baseline + TEXT_LINE_GAP + thickness);
      ops.push(...drawRectangle({
        x: ux, y: uy, width: font.widthOfTextAtSize(line, size), height: thickness,
        borderWidth: 0, color, borderColor: undefined, ...upright,
      }));
    }
  });

  // The first line's ascenders rise above the box's top edge, so the /Rect is
  // grown by half an em all round and /RD records the box inside it.
  const pad = size / 2;
  const [x0, y0, x1, y1] = _pdfRect(toPdf, ann.x, ann.y, ann.x + ann.width, ann.y + blockHeight / display.height);
  return {
    subtype:    'FreeText',
    rect:       [x0 - pad, y0 - pad, x1 + pad, y1 + pad],
    appearance: ops,
    resources:  { Font: { [TEXT_FONT_RESOURCE]: font.ref } },
    entries: {
      Contents: PDFHexString.fromText(ann.text),
      DA:       PDFString.of(`/Helv ${size} Tf ${r} ${g} ${b} rg`),
      RD:       [pad, pad, pad, pad],
      BS:       { W: 0 },
      ...(ann.fillColor ? { C: _rgbArray(hexToRgb01(ann.fillColor)) } : {}),
    },
  };
}

function _lineSpec(ann: ShapeAnnotation, toPdf: ToPdf): AnnotationSpec {
  const color = hexToRgb01(ann.color);
  const start = toPdf(ann.x1, ann.y1);
  const end   = toPdf(ann.x2, ann.y2);
  return {
    subtype:    'Line',
    rect:       _bounds([start, end], ann.thickness),
    appearance: _painted({ stroke: color, lineWidth: ann.thickness }, [
      moveTo(...start), lineTo(...end), stroke(),
    ]),
    entries: {
      L:  [...start, ...end],
      BS: { W: ann.thickness },
      C:  _rgbArray(color),
    },
  };
}

/**
 * A Line ending in a filled arrowhead, laid out by arrow-geometry.ts like the
 * canvas's. /LE and /IC describe the same arrow for viewers that redraw it;
 * viewers that build a Line's appearance from /L alone, PDF.js among them,
 * would otherwise leave the head off.
 */
function _arrowSpec(ann: ShapeAnnotation, toPdf: ToPdf): AnnotationSpec {
  const color = hexToRgb01(ann.color);
  const start = toPdf(ann.x1, ann.y1);
  const tip   = toPdf(ann.x2, ann.y2);
  const { shaftEnd, head } = arrowGeometry(start, tip, arrowHeadLength(ann.thickness));
  return {
    subtype:    'Line',
    rect:       _bounds([start, shaftEnd, ...head], ann.thickness),
    appearance: _painted({ stroke: color, fill: color, lineWidth: ann.thickness }, [
      moveTo(...start), lineTo(...shaftEnd), stroke(),
      moveTo(...head[0]), lineTo(...head[1]), lineTo(...head[2]), closePath(), fill(),
    ]),
    entries: {
      L:  [...start, ...tip],
      LE: ['None', 'ClosedArrow'],
      BS: { W: ann.thickness },
      C:  _rgbArray(color),
      IC: _rgbArray(color),
    },
  };
}

function _squareSpec(ann: ShapeAnnotation, toPdf: ToPdf): AnnotationSpec {
  return _closedShapeSpec(ann, toPdf, 'Square', _rectPath);
}

function _circleSpec(ann: ShapeAnnotation, toPdf: ToPdf): AnnotationSpec {
  return _closedShapeSpec(ann, toPdf, 'Circle', _ellipsePath);
}

/** Control-point distance, as a fraction of the radius, for a quarter ellipse drawn as one Bézier curve. */
const KAPPA = 4 * (Math.SQRT2 - 1) / 3;

/** The ellipse inscribed in `box`, as four Bézier curves. */
function _ellipsePath([x0, y0, x1, y1]: Rect): PDFOperator[] {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const ox = (x1 - x0) / 2 * KAPPA, oy = (y1 - y0) / 2 * KAPPA;
  return [
    moveTo(x0, cy),
    appendBezierCurve(x0, cy - oy, cx - ox, y0, cx, y0),
    appendBezierCurve(cx + ox, y0, x1, cy - oy, x1, cy),
    appendBezierCurve(x1, cy + oy, cx + ox, y1, cx, y1),
    appendBezierCurve(cx - ox, y1, x0, cy + oy, x0, cy),
    closePath(),
  ];
}

/** Rectangles and ovals. Their stroke is centred on the outline, so /Rect is grown by half of it. */
function _closedShapeSpec(
  ann: ShapeAnnotation, toPdf: ToPdf, subtype: 'Square' | 'Circle', outline: (shape: Rect) => PDFOperator[],
): AnnotationSpec {
  const color = hexToRgb01(ann.color);
  const fc    = ann.fillColor ? hexToRgb01(ann.fillColor) : undefined;
  const shape = _pdfRect(toPdf, ann.x1, ann.y1, ann.x2, ann.y2);
  const pad   = ann.thickness / 2;
  return {
    subtype,
    rect:       [shape[0] - pad, shape[1] - pad, shape[2] + pad, shape[3] + pad],
    appearance: _painted({ stroke: color, fill: fc, lineWidth: ann.thickness }, [
      ...outline(shape), fc ? fillAndStroke() : stroke(),
    ]),
    entries: {
      BS: { W: ann.thickness },
      C:  _rgbArray(color),
      ...(fc ? { IC: _rgbArray(fc) } : {}),
    },
  };
}

// ── Footer ───────────────────────────────────────────────────

export interface FooterConfig {
  left:     string;
  center:   string;
  right:    string;
  fontSize: number;
}

/**
 * Draw a 3-column footer on every page and return the modified bytes.
 * Tokens {page} and {total} are replaced with the current page number and total.
 */
export async function embedFooter(pdfBytes: Uint8Array, config: FooterConfig, fontFiles: FontFiles): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const font   = await embedFace(pdfDoc, fontFiles.regular);
  const total  = pdfDoc.getPageCount();
  const black  = rgb(0, 0, 0);
  const margin = 40;
  const yPos   = 20;

  for (let i = 0; i < total; i++) {
    const page    = pdfDoc.getPage(i);
    const box     = visibleBox(page);
    const baseY   = box.y + yPos;
    const resolve = (t: string) =>
      t.replace(/\{page\}/g, String(i + 1)).replace(/\{total\}/g, String(total));

    const l = resolve(config.left);
    const c = resolve(config.center);
    const r = resolve(config.right);

    if (l) {
      page.drawText(l, { x: box.x + margin, y: baseY, size: config.fontSize, font, color: black });
    }
    if (c) {
      const tw = font.widthOfTextAtSize(c, config.fontSize);
      page.drawText(c, { x: box.x + (box.width - tw) / 2, y: baseY, size: config.fontSize, font, color: black });
    }
    if (r) {
      const tw = font.widthOfTextAtSize(r, config.fontSize);
      page.drawText(r, { x: box.x + box.width - margin - tw, y: baseY, size: config.fontSize, font, color: black });
    }
  }

  return pdfDoc.save();
}

// ── Watermark ────────────────────────────────────────────────

export interface WatermarkConfig {
  text:     string;
  fontSize: number;
  opacity:  number;  // 0.0–1.0
  angle:    number;  // degrees
}

/**
 * Draw a centred, rotated text watermark on every page and return the modified bytes.
 */
export async function embedWatermark(pdfBytes: Uint8Array, config: WatermarkConfig, fontFiles: FontFiles): Promise<Uint8Array> {
  const pdfDoc     = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const font       = await embedFace(pdfDoc, fontFiles.regular);
  const grey       = rgb(0.5, 0.5, 0.5);
  const angleRad   = (config.angle * Math.PI) / 180;
  const lines      = config.text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const lineHeight = config.fontSize * 1.3;

  for (let i = 0; i < pdfDoc.getPageCount(); i++) {
    const page = pdfDoc.getPage(i);
    const box  = visibleBox(page);

    lines.forEach((line, li) => {
      const textWidth  = font.widthOfTextAtSize(line, config.fontSize);
      // Perpendicular offset (CCW 90° from text direction) to space lines.
      // Positive perpOffset moves toward the visual top of the page; line 0 is topmost.
      const perpOffset = ((lines.length - 1) / 2 - li) * lineHeight;

      // Centre each line at page centre then offset perpendicularly
      const x = box.x + box.width / 2
        - (textWidth / 2)        * Math.cos(angleRad)
        + (config.fontSize / 2)  * Math.sin(angleRad)
        - perpOffset             * Math.sin(angleRad);
      const y = box.y + box.height / 2
        - (textWidth / 2)        * Math.sin(angleRad)
        - (config.fontSize / 2)  * Math.cos(angleRad)
        + perpOffset             * Math.cos(angleRad);

      page.drawText(line, {
        x,
        y,
        size:    config.fontSize,
        font,
        color:   grey,
        opacity: config.opacity,
        rotate:  degrees(config.angle),
      });
    });
  }

  return pdfDoc.save();
}
