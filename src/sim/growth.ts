// Natural expansion. Two models share one "grow into this cell" rule.

import { unlockTuning } from './catalog';
import { isActive } from './health';
import { nextFloat, nextInt } from './rng';
import { deltaX, deltaY, step } from './topo';
import { colonySize, isGrowable, refreshAround } from './state';
import { Kind, Terrain, type Colony, type GameState, type SimEvent, type Tuning } from './types';

function growInto(s: GameState, cell: number, owner: number, t: Tuning, events: SimEvent[]): void {
  // D20: growing onto forest clears it.
  const clearedForest = s.terrain[cell] === Terrain.Forest;
  if (clearedForest) s.terrain[cell] = Terrain.Grass;
  s.kind[cell] = Kind.House;
  s.owner[cell] = owner;
  s.hp[cell] = t.health.house;
  s.readyTick[cell] = 0;
  s.cutOff[cell] = 0;
  // A new square is solid to every other colony, so paths may have changed.
  s.navDirty = true;
  s.vigor[cell] = t.growth.vigorMin + (t.growth.vigorMax - t.growth.vigorMin) * nextFloat(s);
  const colony = s.colonies[owner - 1];
  colony.houses++;
  // Clearing forest is slow, but the timber is worth something.
  if (clearedForest) colony.gold += t.economy.lumberGold;
  // A landmark: Ancient Ruins give a free discovery, Treasure a lump of gold.
  const feature = s.feature[cell];
  if (feature !== 0) {
    s.feature[cell] = 0;
    let gold = 0;
    if (feature === 1) colony.pendingDraws++;
    else {
      gold = t.map.treasureGold;
      colony.gold += gold;
    }
    events.push({ type: 'landmark', cell, owner, feature, gold });
  }
  // A new square may join a cut-off district back to the tower.
  if (colony.dormant.cells > 0) colony.linkDirty = true;
  refreshAround(s, cell);
  events.push({ type: 'grow', cell, owner, clearedForest });
}

/** A square grows onto forest more slowly than onto open ground: the trees must be cleared first. */
function terrainMultiplier(s: GameState, cell: number, t: Tuning): number {
  return s.terrain[cell] === Terrain.Forest ? t.growth.forestMultiplier : 1;
}

/**
 * Sprawl: the bigger a colony already is, the slower it grows. At `sprawlSize` squares it grows
 * at half speed, and it keeps slowing from there, so a huge city cannot snowball into unlimited
 * gold and science.
 */
export function sprawlFactor(colony: Colony, t: Tuning): number {
  return 1 / (1 + Math.pow(colonySize(colony) / t.growth.sprawlSize, t.growth.sprawlPower));
}

/**
 * Everything that scales a whole colony's growth: research, sprawl, and the comeback bonus
 * (D25), which helps a colony below a fixed size and fades out as it reaches that size.
 */
export function growthFactor(colony: Colony, t: Tuning): number {
  const size = colonySize(colony);
  const comeback = size < t.growth.comebackSize ? 1 + t.growth.comebackBonus * (1 - size / t.growth.comebackSize) : 1;
  return comeback * sprawlFactor(colony, t);
}

/**
 * Local growth (confirmed, D1): every edge square rolls independently for each empty
 * orthogonal neighbour. Interior squares and converted buildings contribute nothing.
 */
function stepLocal(s: GameState, t: Tuning, events: SimEvent[]): void {
  const perTick = t.growth.localEdgeRatePerSecond / t.tickRate;
  const w = s.width;
  const plazas = plazasByOwner(s);
  const plaza = unlockTuning(t, Kind.Plaza);
  const reach = plaza?.radius ?? 0;
  const boost = plaza?.boost ?? 1;
  for (const colony of s.colonies) {
    if (!colony.alive) continue;
    const factor = perTick * growthFactor(colony, t);
    const mine = plazas.get(colony.id);
    // Snapshot: squares born this tick wait until the next one.
    const sources = colony.edge.slice();
    for (const src of sources) {
      // D5: squares cut off from the tower do not grow.
      if (s.edgePos[src] === -1 || s.cutOff[src]) continue;
      const x = src % w;
      const y = (src / w) | 0;
      // A Plaza nearby speeds up growth there: the player's way to steer the city.
      let base = factor * s.vigor[src];
      if (mine) {
        for (const p of mine) {
          if (Math.abs(deltaX(s, x, p % w)) <= reach && Math.abs(deltaY(s, y, (p / w) | 0)) <= reach) {
            base *= boost;
            break;
          }
        }
      }
      for (let d = 0; d < 4; d++) {
        const n = step(s, src, d);
        if (n >= 0) tryGrow(s, n, colony, base, t, events);
      }
    }
  }
}

/** Finished, connected Plazas of every colony. */
function plazasByOwner(s: GameState): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (const c of s.military) {
    if (s.kind[c] !== Kind.Plaza || !isActive(s, c) || s.cutOff[c]) continue;
    const owner = s.owner[c];
    const list = out.get(owner);
    if (list) list.push(c);
    else out.set(owner, [c]);
  }
  return out;
}

function tryGrow(s: GameState, cell: number, colony: Colony, base: number, t: Tuning, events: SimEvent[]): void {
  if (!isGrowable(s, cell)) return;
  if (nextFloat(s) < base * terrainMultiplier(s, cell, t)) growInto(s, cell, colony.id, t, events);
}

/**
 * Colony-wide pressure (comparison only): every house feeds a shared pool that is spent
 * at random edge squares. Growth compounds with colony size.
 */
function stepPressure(s: GameState, t: Tuning, events: SimEvent[]): void {
  const options: number[] = [];
  for (const colony of s.colonies) {
    if (!colony.alive) continue;
    colony.pool += ((colony.houses + t.growth.pressureTowerWeight) * t.growth.pressureRatePerSecond * growthFactor(colony, t)) / t.tickRate;
    let guard = 0;
    while (colony.pool >= 1 && colony.edge.length > 0 && guard++ < 64) {
      const src = colony.edge[nextInt(s, colony.edge.length)];
      if (s.cutOff[src]) continue;
      options.length = 0;
      for (let d = 0; d < 4; d++) {
        const n = step(s, src, d);
        if (n >= 0 && isGrowable(s, n)) options.push(n);
      }
      if (options.length === 0) break;
      let total = 0;
      for (const o of options) total += terrainMultiplier(s, o, t);
      let roll = nextFloat(s) * total;
      let chosen = options[options.length - 1];
      for (const o of options) {
        roll -= terrainMultiplier(s, o, t);
        if (roll < 0) {
          chosen = o;
          break;
        }
      }
      colony.pool -= 1 / terrainMultiplier(s, chosen, t);
      growInto(s, chosen, colony.id, t, events);
    }
    // A boxed-in colony must not bank unlimited growth.
    if (colony.edge.length === 0 && colony.pool > 1) colony.pool = 1;
  }
}

export function stepGrowth(s: GameState, t: Tuning, events: SimEvent[]): void {
  if (s.model === 'local') stepLocal(s, t, events);
  else stepPressure(s, t, events);
}
