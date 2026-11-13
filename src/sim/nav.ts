// Pathfinding. Each colony's units share a few "flow fields": for every cell, the time it
// takes to reach the goal from there. A unit simply steps to the neighbour with the lowest time.
//
// D11: a unit walks freely over its own colony's squares (walls included) and over empty
// ground and rubble. Another colony's square is solid. Rather than treating solid squares as
// impassable, the field charges the time needed to destroy them, so "go around the wall" and
// "break through the wall" are compared by the same search.

import { isAttacking, isProducer, towerRange } from './catalog';
import { healthAt, isActive } from './health';
import { cellAt, step } from './topo';
import { Kind, Terrain, TOWER_SIZE, type GameState, type Tuning, type UnitTuning } from './types';

/** Could a unit of this colony stand on this cell right now? */
export function passableFor(s: GameState, c: number, owner: number): boolean {
  if (s.terrain[c] === Terrain.Water) return false;
  const o = s.owner[c];
  return o === 0 || o === owner;
}

/** Is this cell a square of some other colony, which must be destroyed to get through? */
export function solidFor(s: GameState, c: number, owner: number): boolean {
  const o = s.owner[c];
  return o !== 0 && o !== owner;
}

export function terrainSpeed(s: GameState, t: Tuning, c: number): number {
  const terrain = s.terrain[c];
  if (terrain === Terrain.Forest) return t.combat.forestSpeed;
  if (terrain === Terrain.Mountain) return t.combat.mountainSpeed;
  return 1;
}

// A small binary heap of (time, cell) pairs.
class Heap {
  private time: Float32Array;
  private cell: Int32Array;
  size = 0;

  constructor(capacity: number) {
    this.time = new Float32Array(capacity);
    this.cell = new Int32Array(capacity);
  }

  push(time: number, cell: number): void {
    if (this.size === this.time.length) {
      const moreTime = new Float32Array(this.size * 2);
      const moreCell = new Int32Array(this.size * 2);
      moreTime.set(this.time);
      moreCell.set(this.cell);
      this.time = moreTime;
      this.cell = moreCell;
    }
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.time[parent] <= time) break;
      this.time[i] = this.time[parent];
      this.cell[i] = this.cell[parent];
      i = parent;
    }
    this.time[i] = time;
    this.cell[i] = cell;
  }

  /** Removes the smallest entry and returns its cell; its time is left in `lastTime`. */
  lastTime = 0;
  pop(): number {
    const topCell = this.cell[0];
    this.lastTime = this.time[0];
    const n = --this.size;
    const time = this.time[n];
    const cell = this.cell[n];
    if (n > 0) {
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= n) break;
        if (child + 1 < n && this.time[child + 1] < this.time[child]) child++;
        if (this.time[child] >= time) break;
        this.time[i] = this.time[child];
        this.cell[i] = this.cell[child];
        i = child;
      }
      this.time[i] = time;
      this.cell[i] = cell;
    }
    return topCell;
  }
}

export interface FieldOptions {
  owner: number;
  unit: UnitTuning;
  /** Squares of this colony are broken through at normal cost; others cost more. 0 = break nothing. */
  target: number;
}

/**
 * Time-to-goal for every cell, by Dijkstra outward from the goals.
 * Cells from which the goal cannot be reached keep Infinity.
 */
export function computeField(s: GameState, t: Tuning, goals: number[], o: FieldOptions): Float32Array {
  const n = s.kind.length;
  const field = new Float32Array(n).fill(Infinity);
  const isGoal = new Uint8Array(n);
  const heap = new Heap(n);
  for (const g of goals) {
    if (isGoal[g]) continue;
    isGoal[g] = 1;
    field[g] = 0;
    heap.push(0, g);
  }
  const dps = (o.unit.damage / o.unit.cooldownSeconds) * t.combat.breachGroup;

  /** Time for a unit standing next to `c` to end up standing on it. */
  const enterCost = (c: number): number => {
    if (isGoal[c]) return 0.01;
    let cost = 1 / (o.unit.speed * terrainSpeed(s, t, c));
    const owner = s.owner[c];
    if (owner !== 0 && owner !== o.owner) {
      if (o.target === 0) return Infinity;
      const penalty = owner === o.target ? 1 : t.combat.thirdPartyPenalty;
      cost += (healthAt(s, c) / dps) * penalty;
    }
    return cost;
  };

  while (heap.size > 0) {
    const u = heap.pop();
    const du = heap.lastTime;
    if (du > field[u]) continue;
    const cost = enterCost(u);
    if (cost === Infinity) continue;
    // The field stores 32-bit floats: round here too, or the stale-entry check above
    // would compare a 64-bit time against its own rounded copy and reject it.
    const next = Math.fround(du + cost);
    for (let dir = 0; dir < 4; dir++) {
      const v = step(s, u, dir);
      if (v < 0) continue;
      // Nobody can ever stand in water, so no path may pass through it.
      if (s.terrain[v] === Terrain.Water) continue;
      if (next < field[v]) {
        field[v] = next;
        heap.push(next, v);
      }
    }
  }
  return field;
}

/** Cells a colony's defences can currently shoot at: around its tower and its finished crossbow towers. */
export function defendedCells(s: GameState, t: Tuning, owner: number): Uint8Array {
  const covered = new Uint8Array(s.kind.length);
  const colony = s.colonies[owner - 1];
  if (!colony.alive) return covered;
  const w = s.width;
  const mark = (cx: number, cy: number, range: number) => {
    const r = Math.ceil(range);
    const x0 = Math.floor(cx);
    const y0 = Math.floor(cy);
    for (let y = y0 - r; y <= y0 + r; y++) {
      for (let x = x0 - r; x <= x0 + r; x++) {
        const c = cellAt(s, x, y);
        if (c >= 0 && Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= range) covered[c] = 1;
      }
    }
  };
  mark((colony.tower % w) + TOWER_SIZE / 2, ((colony.tower / w) | 0) + TOWER_SIZE / 2, t.defence.tower.range);
  for (const c of s.military) {
    if (s.owner[c] !== owner || !isAttacking(s.kind[c]) || !isActive(s, c)) continue;
    mark((c % w) + 0.5, ((c / w) | 0) + 0.5, towerRange(t, colony, s.kind[c]));
  }
  return covered;
}

/** D14: the houses hounds go for: the target's houses that no defence can reach, if there are any. */
export function raidGoals(s: GameState, t: Tuning, target: number): number[] {
  const covered = defendedCells(s, t, target);
  const exposed: number[] = [];
  const all: number[] = [];
  for (let c = 0; c < s.kind.length; c++) {
    if (s.owner[c] !== target || s.kind[c] !== Kind.House) continue;
    all.push(c);
    if (!covered[c]) exposed.push(c);
  }
  return exposed.length > 0 ? exposed : all;
}

const HOME_REFRESH_TICKS = 50;

/** Rebuild every colony's fields if the map changed, at most once per interval. */
export function refreshNav(s: GameState, t: Tuning): void {
  if (!s.navDirty || s.tick - s.navTick < t.combat.navIntervalTicks) return;
  s.navDirty = false;
  s.navTick = s.tick;

  const hasUnits = new Uint8Array(s.colonies.length + 1);
  for (const u of s.units) hasUnits[u.owner] = 1;

  for (const colony of s.colonies) {
    if (!colony.alive || !hasUnits[colony.id]) {
      colony.nav = { tower: null, raid: null, home: null };
      continue;
    }
    // Home: this colony's own barracks and yards, or its tower if it has none left.
    // The way home runs through a colony's own land, which rarely changes in a way that
    // matters, so this field is refreshed far less often than the attack fields.
    if (!colony.nav.home || s.tick - (colony.nav.homeTick ?? -1000000) >= HOME_REFRESH_TICKS) {
      const homes = s.military.filter((c) => s.owner[c] === colony.id && isProducer(s.kind[c]));
      colony.nav.home = computeField(s, t, homes.length > 0 ? homes : colony.towerCells, {
        owner: colony.id,
        unit: t.units.shield,
        target: 0,
      });
      colony.nav.homeTick = s.tick;
    }

    const target = colony.order > 0 ? s.colonies[colony.order - 1] : null;
    if (!target || !target.alive) {
      colony.nav.tower = null;
      colony.nav.raid = null;
      continue;
    }
    colony.nav.tower = computeField(s, t, target.towerCells, { owner: colony.id, unit: t.units.shield, target: target.id });
    const houses = raidGoals(s, t, target.id);
    colony.nav.raid =
      houses.length > 0 ? computeField(s, t, houses, { owner: colony.id, unit: t.units.hound, target: target.id }) : null;
  }
}

export { unitTuning } from './catalog';
