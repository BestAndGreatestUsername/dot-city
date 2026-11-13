// The shape of the map. In a real game the map loops: walk off the right edge and you come
// back in on the left, walk off the top and you come back in at the bottom (a torus). Every
// neighbour, distance and position goes through these helpers, so the rules never see an edge.
//
// Small hand-built boards (tests) can switch the loop off: then the map has hard edges, and
// neighbours across an edge simply do not exist (-1).

import type { GameState } from './types';

/** One of the four orthogonal neighbours (0 up, 1 right, 2 down, 3 left), or -1 off a hard edge. */
export function step(s: GameState, c: number, dir: number): number {
  const w = s.width;
  const x = c % w;
  switch (dir) {
    case 0:
      return c >= w ? c - w : s.wrap ? c + (s.height - 1) * w : -1;
    case 1:
      return x < w - 1 ? c + 1 : s.wrap ? c - (w - 1) : -1;
    case 2:
      return c < (s.height - 1) * w ? c + w : s.wrap ? x : -1;
    default:
      return x > 0 ? c - 1 : s.wrap ? c + (w - 1) : -1;
  }
}

/** The cell at whole-number coordinates, wrapped onto the map; -1 off a hard edge. */
export function cellAt(s: GameState, x: number, y: number): number {
  const w = s.width;
  const h = s.height;
  if (s.wrap) {
    x %= w;
    if (x < 0) x += w;
    y %= h;
    if (y < 0) y += h;
  } else if (x < 0 || y < 0 || x >= w || y >= h) {
    return -1;
  }
  return y * w + x;
}

/** The cell a point (in cell units) stands in; -1 off a hard edge. */
export function cellOfPoint(s: GameState, x: number, y: number): number {
  return cellAt(s, Math.floor(x), Math.floor(y));
}

/** The cell `dx` across and `dy` down from cell `c`; -1 off a hard edge. */
export function offset(s: GameState, c: number, dx: number, dy: number): number {
  const w = s.width;
  return cellAt(s, (c % w) + dx, ((c / w) | 0) + dy);
}

/** Shortest signed difference `to - from` along an axis of length `size`. */
function delta(wrap: boolean, from: number, to: number, size: number): number {
  let d = to - from;
  if (!wrap) return d;
  d %= size;
  if (d > size / 2) d -= size;
  else if (d < -size / 2) d += size;
  return d;
}

export function deltaX(s: GameState, from: number, to: number): number {
  return delta(s.wrap, from, to, s.width);
}

export function deltaY(s: GameState, from: number, to: number): number {
  return delta(s.wrap, from, to, s.height);
}

/** Straight-line distance between two points, the short way round. */
export function dist(s: GameState, x0: number, y0: number, x1: number, y1: number): number {
  return Math.hypot(deltaX(s, x0, x1), deltaY(s, y0, y1));
}

/** Distance between the centres of two cells, the short way round. */
export function cellDist(s: GameState, a: number, b: number): number {
  const w = s.width;
  return dist(s, a % w, (a / w) | 0, b % w, (b / w) | 0);
}

/** Bring a point back onto the map (looping), or keep it inside the hard edges. */
export function wrapPoint(s: GameState, p: { x: number; y: number }): void {
  if (s.wrap) {
    if (p.x < 0 || p.x >= s.width) p.x = ((p.x % s.width) + s.width) % s.width;
    if (p.y < 0 || p.y >= s.height) p.y = ((p.y % s.height) + s.height) % s.height;
  } else {
    p.x = Math.min(s.width - 0.001, Math.max(0, p.x));
    p.y = Math.min(s.height - 0.001, Math.max(0, p.y));
  }
}
