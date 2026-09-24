// Reamlet — arrow geometry, shared by the canvas overlay and the saver.
//
// Lengths are in PDF points, like text-layout.ts: the canvas multiplies them
// by the viewer scale and the saver uses them as-is, so an arrowhead is the
// same size relative to the page at every zoom level and in the saved file.
//
// SPDX-License-Identifier: GPL-3.0-or-later

export type Point = [number, number];

/** Half the angle at an arrowhead's tip. */
const HEAD_HALF_ANGLE = Math.PI / 6;

/** Tip-to-wing length of the arrowhead on a shaft `thickness` points wide. */
export function arrowHeadLength(thickness: number): number {
  return Math.max(10, thickness * 4);
}

export interface ArrowGeometry {
  /**
   * Where the shaft stops: the middle of the head's base, so a round cap on the
   * shaft stays inside the head instead of blunting its tip. Equal to the start
   * point when the arrow is too short to have a shaft at all.
   */
  shaftEnd: Point;
  /** The filled head: tip first, then the two wing points. */
  head: [Point, Point, Point];
}

/**
 * Lay out an arrow from `start` to the tip at `end` with a head `headLength`
 * long. Works in any uniformly-scaled coordinate space, y-up or y-down, since
 * the head is symmetric about the shaft.
 */
export function arrowGeometry([x1, y1]: Point, [x2, y2]: Point, headLength: number): ArrowGeometry {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const wing = (side: 1 | -1): Point => [
    x2 - headLength * Math.cos(angle + side * HEAD_HALF_ANGLE),
    y2 - headLength * Math.sin(angle + side * HEAD_HALF_ANGLE),
  ];

  const shaftLength = Math.max(0, Math.hypot(x2 - x1, y2 - y1) - headLength * Math.cos(HEAD_HALF_ANGLE));
  return {
    shaftEnd: [x1 + shaftLength * Math.cos(angle), y1 + shaftLength * Math.sin(angle)],
    head: [[x2, y2], wing(-1), wing(1)],
  };
}
