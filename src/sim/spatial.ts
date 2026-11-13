// Units bucketed into coarse blocks, so "who is near this point" only looks at a few lists.

import type { GameState, Unit } from './types';

/** Side of a bucket, in cells. Small enough that a crowd at home is split over many lists. */
const BLOCK = 4;

export interface Blocks {
  across: number;
  down: number;
  /** The map loops: blocks past one edge continue at the other. */
  wrap: boolean;
  lists: Map<number, Unit[]>;
  /** Per block: one bit for every colony with a unit in it. */
  owners: Map<number, number>;
}

export function buildBlocks(s: GameState): Blocks {
  const across = Math.ceil(s.width / BLOCK);
  const lists = new Map<number, Unit[]>();
  const owners = new Map<number, number>();
  for (const u of s.units) {
    const key = Math.floor(u.y / BLOCK) * across + Math.floor(u.x / BLOCK);
    const list = lists.get(key);
    if (list) list.push(u);
    else lists.set(key, [u]);
    owners.set(key, (owners.get(key) ?? 0) | (1 << u.owner));
  }
  return { across, down: Math.ceil(s.height / BLOCK), wrap: s.wrap, lists, owners };
}

/**
 * Visit every unit in the blocks that a circle of the given radius can touch. With `enemiesOf`
 * set, blocks holding nothing but that colony's own units are skipped: a looking-for-enemies
 * scan then costs nothing inside a friendly crowd.
 */
export function forEachNearby(b: Blocks, x: number, y: number, radius: number, visit: (u: Unit) => void, enemiesOf = 0): void {
  let x0 = Math.floor((x - radius) / BLOCK);
  let x1 = Math.floor((x + radius) / BLOCK);
  let y0 = Math.floor((y - radius) / BLOCK);
  let y1 = Math.floor((y + radius) / BLOCK);
  if (b.wrap) {
    // Past an edge, the blocks continue at the other side; never visit one block twice.
    if (x1 - x0 >= b.across) x1 = x0 + b.across - 1;
    if (y1 - y0 >= b.down) y1 = y0 + b.down - 1;
  } else {
    x0 = Math.max(0, x0);
    x1 = Math.min(b.across - 1, x1);
    y0 = Math.max(0, y0);
    y1 = Math.min(b.down - 1, y1);
  }
  const own = enemiesOf > 0 ? 1 << enemiesOf : -1;
  for (let ry = y0; ry <= y1; ry++) {
    const by = b.wrap ? ((ry % b.down) + b.down) % b.down : ry;
    for (let rx = x0; rx <= x1; rx++) {
      const bx = b.wrap ? ((rx % b.across) + b.across) % b.across : rx;
      const key = by * b.across + bx;
      if (b.owners.get(key) === own) continue;
      const list = b.lists.get(key);
      if (list) for (const u of list) visit(u);
    }
  }
}
