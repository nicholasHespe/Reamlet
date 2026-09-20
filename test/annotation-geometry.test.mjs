// Reamlet — regression tests for annotation placement in saved PDFs.
//
// Every annotation is stored as a fraction of the page *as displayed*. Saving
// has to turn that back into a point in the page's own user space, which means
// honouring the displayed box's size AND its lower-left corner. Pages whose
// MediaBox does not start at the origin, or that carry an inset CropBox, are
// the cases that catch a transform which assumes (0, 0).
//
// SPDX-License-Identifier: GPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';

import { embedAnnotations } from '../out/renderer/saver.js';
import {
  makePdf, fakeViewer, oracle, readAnnotations, readDrawnText,
} from './helpers/pdf-fixtures.mjs';

// Page geometries under test. `box` is the region a viewer displays.
const GEOMETRIES = [
  { name: 'letter',            media: [0, 0, 612, 792] },
  { name: 'A4',                media: [0, 0, 595.28, 841.89] },
  { name: 'wide custom',       media: [0, 0, 1224, 792] },
  { name: 'narrow custom',     media: [0, 0, 200, 1000] },
  { name: 'tiny custom',       media: [0, 0, 144, 144] },
  { name: 'offset MediaBox',   media: [20, 30, 632, 822] },
  { name: 'inset CropBox',     media: [0, 0, 612, 792], crop: [50, 60, 562, 732] },
  { name: 'CropBox past edge', media: [0, 0, 612, 792], crop: [100, 100, 900, 900] },
  { name: 'inverted MediaBox', media: [0, 792, 612, 0] },
];

const ROTATIONS = [0, 90, 180, 270];

// Tolerance in PDF points. Coordinates are written out at full precision; this
// only absorbs floating-point noise, not a real offset.
const EPS = 0.02;

function assertPoint(actual, expected, label) {
  assert.ok(
    Math.abs(actual[0] - expected[0]) <= EPS && Math.abs(actual[1] - expected[1]) <= EPS,
    `${label}: got [${actual.map(n => n.toFixed(3))}], want [${expected.map(n => n.toFixed(3))}]`,
  );
}

async function save(bytes, annotations, userRotations) {
  const viewer = await fakeViewer(bytes, { userRotations });
  return embedAnnotations(bytes, annotations, viewer);
}

for (const geom of GEOMETRIES) {
  for (const rotate of ROTATIONS) {
    const label = `${geom.name} @ /Rotate ${rotate}`;

    test(`line endpoints land where they were drawn — ${label}`, async () => {
      const src = await makePdf({ ...geom, rotate });
      const ann = { type: 'line', pageNum: 1, x1: 0.2, y1: 0.3, x2: 0.8, y2: 0.65,
                    color: '#ff0000', thickness: 2 };
      const out = await save(src, [ann]);

      const { at } = await oracle(src, 1, rotate);
      const [saved] = await readAnnotations(out);
      assert.equal(saved.subtype, 'Line');
      assertPoint([saved.line[0], saved.line[1]], at(0.2, 0.3), `${label} start`);
      assertPoint([saved.line[2], saved.line[3]], at(0.8, 0.65), `${label} end`);
    });

    test(`a rectangle keeps its corners and its size — ${label}`, async () => {
      const src = await makePdf({ ...geom, rotate });
      const thickness = 3;
      const ann = { type: 'rect', pageNum: 1, x1: 0.25, y1: 0.25, x2: 0.75, y2: 0.75,
                    color: '#0000ff', thickness };
      const out = await save(src, [ann]);

      const { at } = await oracle(src, 1, rotate);
      const [c1, c2] = [at(0.25, 0.25), at(0.75, 0.75)];
      // The border is drawn inside /Rect, so the saved rect is grown by half a stroke.
      const pad = thickness / 2;
      const want = [
        Math.min(c1[0], c2[0]) - pad, Math.min(c1[1], c2[1]) - pad,
        Math.max(c1[0], c2[0]) + pad, Math.max(c1[1], c2[1]) + pad,
      ];
      const [saved] = await readAnnotations(out);
      assert.equal(saved.subtype, 'Square');
      assertPoint([saved.rect[0], saved.rect[1]], [want[0], want[1]], `${label} lower-left`);
      assertPoint([saved.rect[2], saved.rect[3]], [want[2], want[3]], `${label} upper-right`);
    });

    test(`ink points follow the stroke — ${label}`, async () => {
      const src = await makePdf({ ...geom, rotate });
      const points = [[0.1, 0.1], [0.5, 0.2], [0.9, 0.85]];
      const ann = { type: 'draw', pageNum: 1, points, color: '#00aa00', thickness: 2 };
      const out = await save(src, [ann]);

      const { at } = await oracle(src, 1, rotate);
      const [saved] = await readAnnotations(out);
      assert.equal(saved.subtype, 'Ink');
      const flat = saved.inkList[0];
      points.forEach(([nx, ny], i) => {
        assertPoint([flat[i * 2], flat[i * 2 + 1]], at(nx, ny), `${label} point ${i}`);
      });
    });

    test(`a highlight covers the span it was dragged over — ${label}`, async () => {
      const src = await makePdf({ ...geom, rotate });
      const rect = { x: 0.15, y: 0.4, width: 0.5, height: 0.05 };
      const ann = { type: 'highlight', pageNum: 1, rects: [rect], color: '#ffff00' };
      const out = await save(src, [ann]);

      const { at } = await oracle(src, 1, rotate);
      const corners = [
        at(rect.x, rect.y),
        at(rect.x + rect.width, rect.y),
        at(rect.x, rect.y + rect.height),
        at(rect.x + rect.width, rect.y + rect.height),
      ];
      const xs = corners.map(c => c[0]), ys = corners.map(c => c[1]);
      const want = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];

      const [saved] = await readAnnotations(out);
      assert.equal(saved.subtype, 'Highlight');
      assertPoint([saved.rect[0], saved.rect[1]], [want[0], want[1]], `${label} rect ll`);
      assertPoint([saved.rect[2], saved.rect[3]], [want[2], want[3]], `${label} rect ur`);
      // QuadPoints: BL, BR, TL, TR
      assertPoint([saved.quadPoints[0], saved.quadPoints[1]], [want[0], want[1]], `${label} quad BL`);
      assertPoint([saved.quadPoints[6], saved.quadPoints[7]], [want[2], want[3]], `${label} quad TR`);
    });

    test(`text sits on the baseline it was typed on — ${label}`, async () => {
      const src = await makePdf({ ...geom, rotate });
      const fontSize = 14;
      const ann = { type: 'text', pageNum: 1, x: 0.3, y: 0.2, text: 'Reamlet',
                    color: '#000000', fontSize, bold: false, underline: false };
      const out = await save(src, [ann]);

      const { at, displayHeight } = await oracle(src, 1, rotate);
      // textBaselineOffset(fontSize, 0) — kept in step with annotator.ts.
      const baseline = fontSize / 2 + 2;
      const want = at(0.3, 0.2 + baseline / displayHeight);

      const drawn = await readDrawnText(out);
      assert.equal(drawn.length, 1, `${label}: expected exactly one text run`);
      assert.equal(drawn[0].str, 'Reamlet');
      assertPoint([drawn[0].x, drawn[0].y], want, `${label} baseline origin`);
    });
  }
}

test('a user rotation applied in the viewer is honoured when saving', async () => {
  // The page's own /Rotate is 90 and the user turned it another 180 on screen,
  // so annotations were placed against a 270° display.
  const src = await makePdf({ media: [20, 30, 632, 822], rotate: 90 });
  const ann = { type: 'line', pageNum: 1, x1: 0.1, y1: 0.2, x2: 0.9, y2: 0.8,
                color: '#ff0000', thickness: 2 };
  const out = await save(src, [ann], { 1: 180 });

  const { at } = await oracle(src, 1, 270);
  const [saved] = await readAnnotations(out);
  assertPoint([saved.line[0], saved.line[1]], at(0.1, 0.2), 'user-rotated start');
  assertPoint([saved.line[2], saved.line[3]], at(0.9, 0.8), 'user-rotated end');
});

test('an annotation spanning the whole screen covers the whole visible page', async () => {
  // The clearest statement of the bug this guards: on a cropped page, a full-page
  // stroke used to be written against the MediaBox and ended up short and offset.
  const src = await makePdf({ media: [0, 0, 612, 792], crop: [50, 60, 562, 732] });
  const ann = { type: 'rect', pageNum: 1, x1: 0, y1: 0, x2: 1, y2: 1,
                color: '#ff0000', thickness: 0 };
  const out = await save(src, [ann]);

  const [saved] = await readAnnotations(out);
  assertPoint([saved.rect[0], saved.rect[1]], [50, 60], 'crop lower-left');
  assertPoint([saved.rect[2], saved.rect[3]], [562, 732], 'crop upper-right');
});

test('annotations on different pages use their own page geometry', async () => {
  // A document whose pages differ in size must not reuse page 1's box.
  const doc = await makePdf({ media: [0, 0, 612, 792] });
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.load(doc);
  pdf.addPage([1224, 396]);
  const src = await pdf.save();

  const out = await save(src, [
    { type: 'line', pageNum: 1, x1: 0, y1: 0, x2: 1, y2: 1, color: '#ff0000', thickness: 1 },
    { type: 'line', pageNum: 2, x1: 0, y1: 0, x2: 1, y2: 1, color: '#ff0000', thickness: 1 },
  ]);

  const p1 = await readAnnotations(out, 0);
  const p2 = await readAnnotations(out, 1);
  assertPoint([p1[0].line[2], p1[0].line[3]], [612, 0], 'page 1 far corner');
  assertPoint([p2[0].line[2], p2[0].line[3]], [1224, 0], 'page 2 far corner');
});
