// Reamlet — a saved arrow keeps its arrowhead: it carries its own appearance,
// drawn from the same geometry the canvas overlay uses.
// SPDX-License-Identifier: GPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';

import { embedAnnotations } from '../out/renderer/saver.js';
import { arrowGeometry, arrowHeadLength } from '../out/renderer/arrow-geometry.js';
import {
  makePdf, fakeViewer, oracle, readAnnotations, readAnnotationPaths, FONT_FILES,
} from './helpers/pdf-fixtures.mjs';

const GEOMETRIES = [
  { name: 'letter',          media: [0, 0, 612, 792] },
  { name: 'wide custom',     media: [0, 0, 1224, 792] },
  { name: 'offset MediaBox', media: [20, 30, 632, 822] },
  { name: 'inset CropBox',   media: [0, 0, 612, 792], crop: [50, 60, 562, 732] },
];
const ROTATIONS = [0, 90, 180, 270];
const EPS = 0.02;

const dist = ([ax, ay], [bx, by]) => Math.hypot(bx - ax, by - ay);

function assertPoint(actual, expected, label) {
  assert.ok(dist(actual, expected) <= EPS,
    `${label}: got [${actual.map(n => n.toFixed(3))}], want [${expected.map(n => n.toFixed(3))}]`);
}

function arrow(overrides = {}) {
  return { type: 'arrow', pageNum: 1, x1: 0.2, y1: 0.3, x2: 0.7, y2: 0.6,
           color: '#3388ff', thickness: 3, fillColor: null, ...overrides };
}

async function save(src, annotations) {
  return embedAnnotations(src, annotations, await fakeViewer(src), FONT_FILES);
}

// ── The geometry both sides draw from ────────────────────────

test('the shaft stops at the middle of the head\'s base', () => {
  const { shaftEnd, head } = arrowGeometry([0, 0], [100, 0], 20);
  assertPoint(head[0], [100, 0], 'tip');
  assertPoint(shaftEnd, [100 - 20 * Math.cos(Math.PI / 6), 0], 'shaft end');
  assertPoint([(head[1][0] + head[2][0]) / 2, (head[1][1] + head[2][1]) / 2], shaftEnd, 'base midpoint');
});

test('both wings are one head length from the tip, either side of the shaft', () => {
  const { head: [tip, a, b] } = arrowGeometry([10, 10], [60, 90], 25);
  assert.ok(Math.abs(dist(tip, a) - 25) < 1e-9 && Math.abs(dist(tip, b) - 25) < 1e-9);
  const cross = (p) => (60 - 10) * (p[1] - 10) - (90 - 10) * (p[0] - 10);
  assert.ok(Math.sign(cross(a)) === -Math.sign(cross(b)), 'wings should sit on opposite sides');
});

test('an arrow shorter than its head has no shaft', () => {
  const { shaftEnd } = arrowGeometry([0, 0], [5, 0], 20);
  assertPoint(shaftEnd, [0, 0], 'shaft end');
});

test('the head grows with the stroke, but never below a minimum', () => {
  assert.equal(arrowHeadLength(1), 10);
  assert.equal(arrowHeadLength(5), 20);
});

// ── What lands in the saved file ─────────────────────────────

test('an arrow saves as a Line with a closed arrowhead and its own appearance', async () => {
  const src = await makePdf({ media: [0, 0, 612, 792] });
  const [saved] = await readAnnotations(await save(src, [arrow()]));
  assert.equal(saved.subtype, 'Line');
  assert.deepEqual(saved.lineEndings, ['None', 'ClosedArrow']);
  assert.ok(saved.hasAppearance, 'expected an /AP entry');
  saved.fillColor.forEach((c, i) => assert.ok(Math.abs(c - saved.color[i]) < 1e-6, 'head fill matches stroke'));
});

test('a plain line gets no arrowhead', async () => {
  const src = await makePdf({ media: [0, 0, 612, 792] });
  const [saved] = await readAnnotations(await save(src, [arrow({ type: 'line' })]));
  assert.equal(saved.lineEndings, null);
});

for (const geom of GEOMETRIES) {
  for (const rotate of ROTATIONS) {
    const label = `${geom.name} @ /Rotate ${rotate}`;

    test(`PDF.js draws the shaft and a filled head where the arrow was drawn — ${label}`, async () => {
      const src = await makePdf({ ...geom, rotate });
      const ann = arrow();
      const [rendered] = await readAnnotationPaths(await save(src, [ann]));
      assert.ok(rendered, 'PDF.js rendered no annotation');

      const { at } = await oracle(src, 1, rotate);
      const start = at(ann.x1, ann.y1), tip = at(ann.x2, ann.y2);

      const shaft = rendered.paths.find(p => p.painted === 'stroke');
      const head  = rendered.paths.find(p => p.painted === 'fill');
      assert.ok(shaft, 'no stroked shaft');
      assert.ok(head, 'no filled head — the arrow would render as a plain line');

      const expected = arrowGeometry(start, tip, arrowHeadLength(ann.thickness));
      assertPoint(shaft.points[0], start, `${label} shaft start`);
      assertPoint(shaft.points[1], expected.shaftEnd, `${label} shaft end`);
      assert.equal(head.points.length, 3);
      assert.ok(head.closed, 'head should be a closed triangle');
      assertPoint(head.points[0], tip, `${label} head tip`);
      assert.ok(Math.abs(dist(head.points[0], head.points[1]) - arrowHeadLength(ann.thickness)) < EPS,
        `${label} head length`);
    });

    test(`the whole arrow fits inside its /Rect, so nothing is clipped — ${label}`, async () => {
      const src = await makePdf({ ...geom, rotate });
      const ann = arrow({ thickness: 8 });
      const [{ rect, paths }] = await readAnnotationPaths(await save(src, [ann]));
      const [x0, y0, x1, y1] = [Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]),
                                Math.max(rect[0], rect[2]), Math.max(rect[1], rect[3])];
      for (const { points, painted } of paths) {
        // A stroke spreads half its width either side of the path.
        const margin = painted === 'stroke' ? ann.thickness / 2 : 0;
        for (const [x, y] of points) {
          assert.ok(x - margin >= x0 - EPS && x + margin <= x1 + EPS &&
                    y - margin >= y0 - EPS && y + margin <= y1 + EPS,
            `${label}: point [${x.toFixed(1)}, ${y.toFixed(1)}] (${painted}) outside rect [${rect.map(n => n.toFixed(1))}]`);
        }
      }
    });
  }
}

test('the head is the same size in points on any page, like the canvas at every zoom', async () => {
  const lengths = [];
  for (const media of [[0, 0, 612, 792], [0, 0, 144, 144], [0, 0, 1224, 792]]) {
    const src = await makePdf({ media });
    const [{ paths }] = await readAnnotationPaths(await save(src, [arrow({ thickness: 4 })]));
    const head = paths.find(p => p.painted === 'fill');
    lengths.push(dist(head.points[0], head.points[1]));
  }
  for (const len of lengths) assert.ok(Math.abs(len - arrowHeadLength(4)) < EPS, `head length ${len}`);
});
