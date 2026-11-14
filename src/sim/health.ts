// Health, damage, destruction, rubble, build-up time and defeat (D4, D9, D16).

import { acts, unitMaxHp, unlockTuning } from './catalog';
import { addPending, ownFarmNeighbours, refreshAround, removeEdge } from './state';
import { Kind, type Colony, type GameState, type SimEvent, type Tuning } from './types';

export function maxHealth(t: Tuning, kind: number): number {
  switch (kind) {
    case Kind.Tower:
      return t.health.tower;
    case Kind.House:
      return t.health.house;
    case Kind.Wall:
      return t.health.wall;
    case Kind.Farm:
      return t.health.farm;
    case Kind.Research:
      return t.health.research;
    case Kind.Crossbow:
      return t.health.crossbow;
    case Kind.Barracks:
      return t.health.barracks;
    case Kind.Kennel:
      return t.health.kennel;
    default:
      return unlockTuning(t, kind)?.health ?? 0;
  }
}

/** Full health of the Center Tower of this colony, with its research. */
export function towerMaxHealth(t: Tuning, colony: Colony): number {
  return t.health.tower * colony.mods.towerHealth;
}

/** Full health of whatever stands on a cell, with its owner's research. */
export function maxHealthAt(s: GameState, t: Tuning, c: number): number {
  const owner = s.owner[c];
  const kind = s.kind[c];
  if (owner === 0) return 0;
  const colony = s.colonies[owner - 1];
  if (kind === Kind.Tower) return towerMaxHealth(t, colony);
  // Masonry strengthens every building and wall alike; houses are left as they are.
  if (kind !== Kind.House) return maxHealth(t, kind) * colony.mods.structureHealth;
  return maxHealth(t, kind);
}

/** Current health of whatever stands on a cell. The four tower cells share one pool. */
export function healthAt(s: GameState, c: number): number {
  if (s.kind[c] === Kind.Tower) return s.colonies[s.owner[c] - 1].towerHp;
  return s.hp[c];
}

/** D9: a building does nothing until its build-up time has passed. */
export function isActive(s: GameState, c: number): boolean {
  return s.tick >= s.readyTick[c];
}

/** Buildings that act every tick and are kept in the state's per-tick list. */
export function isMilitary(kind: number): boolean {
  return acts(kind);
}

/** D4: turn one owned square into rubble and settle every count that depended on it. */
export function destroyCell(s: GameState, t: Tuning, c: number, events: SimEvent[]): void {
  const owner = s.owner[c];
  const kind = s.kind[c];
  if (owner === 0 || kind === Kind.Tower) return;
  const colony = s.colonies[owner - 1];

  removeEdge(s, c);
  if (kind === Kind.House) {
    colony.houses--;
  } else {
    colony.buildings--;
    colony.counts[kind]--;
  }

  s.kind[c] = Kind.Rubble;
  s.owner[c] = 0;
  s.hp[c] = 0;
  s.lock[c] = 0;
  s.heat[c] = 0;
  s.timer[c] = 0;
  s.readyTick[c] = s.tick + Math.round(t.combat.rubbleSeconds * t.tickRate);
  s.cutOff[c] = 0;
  // Losing a square may cut others off from the tower (D5).
  colony.linkDirty = true;
  addPending(s, c);

  // A lost farm takes its links with it: one for itself and one for the neighbour, per neighbour.
  if (kind === Kind.Farm) colony.farmLinks -= 2 * ownFarmNeighbours(s, c, owner);
  if (isMilitary(kind)) {
    s.military = s.military.filter((m) => m !== c);
    // Where "home" is may have changed: rebuild that field at the next refresh.
    colony.nav.home = null;
    // Its units fight on, but nothing replaces them any more.
    for (const u of s.units) if (u.home === c) u.home = -1;
  }

  refreshAround(s, c);
  s.navDirty = true;
  events.push({ type: 'destroy', cell: c, owner, kind });
}

/**
 * Regeneration: once a square has gone untouched for a few seconds, it mends, a share of its full health each second. Houses, walls, towers and every
 * building alike; the Center Tower more slowly. (Worked out once a second.)
 */
export function stepRegen(s: GameState, t: Tuning): void {
  if (s.tick % t.tickRate !== 0) return;
  const quiet = s.tick - Math.round(t.combat.regenDelaySeconds * t.tickRate);
  for (let c = 0; c < s.kind.length; c++) {
    const owner = s.owner[c];
    if (owner === 0 || s.lastHit[c] > quiet || s.tick < s.readyTick[c]) continue;
    const kind = s.kind[c];
    if (kind === Kind.Tower) continue;
    const full = maxHealthAt(s, t, c);
    if (s.hp[c] < full) s.hp[c] = Math.min(full, s.hp[c] + full * t.combat.regenPerSecond * s.colonies[owner - 1].mods.regen);
  }
  for (const colony of s.colonies) {
    if (!colony.alive) continue;
    if (colony.towerCells.some((c) => s.lastHit[c] > quiet)) continue;
    const full = towerMaxHealth(t, colony);
    if (colony.towerHp < full) colony.towerHp = Math.min(full, colony.towerHp + full * t.combat.towerRegenPerSecond * colony.mods.regen);
  }
  // Field Medicine: units heal a little every second.
  for (const u of s.units) {
    if (u.hp <= 0) continue;
    const colony = s.colonies[u.owner - 1];
    if (colony.mods.unitRegen <= 0) continue;
    const full = unitMaxHp(t, colony, u.type);
    if (u.hp < full) u.hp = Math.min(full, u.hp + colony.mods.unitRegen);
  }
}

/** D16: the tower has fallen. Units die and every square becomes rubble that clears later. */
export function defeatColony(s: GameState, t: Tuning, colony: Colony, events: SimEvent[]): void {
  if (!colony.alive) return;
  colony.alive = false;
  colony.towerHp = 0;
  colony.order = 0;
  colony.launchStrength = 0;
  const clearAt = s.tick + Math.round(t.combat.defeatRubbleSeconds * t.tickRate);
  for (let c = 0; c < s.kind.length; c++) {
    if (s.owner[c] !== colony.id) continue;
    s.edgePos[c] = -1;
    s.cutOff[c] = 0;
    s.kind[c] = Kind.Rubble;
    s.owner[c] = 0;
    s.hp[c] = 0;
    s.timer[c] = 0;
    s.readyTick[c] = clearAt;
    addPending(s, c);
  }
  colony.edge.length = 0;
  colony.houses = 0;
  colony.buildings = 0;
  colony.farmLinks = 0;
  colony.linkDirty = true;
  colony.offer = null;
  colony.pendingDraws = 0;
  colony.counts.fill(0);
  colony.nav = { tower: null, raid: null, home: null };
  s.military = s.military.filter((m) => s.kind[m] !== Kind.Rubble);

  for (const u of s.units) {
    if (u.owner !== colony.id || u.hp <= 0) continue;
    u.hp = 0;
  }
  // Whoever was attacking it plunders its treasury, shared between them, and stands down.
  const victors = s.colonies.filter((other) => other.alive && other.order === colony.id);
  const plunder = Math.floor(colony.gold * t.combat.plunderShare);
  for (const other of victors) {
    other.gold += plunder / victors.length;
    other.order = 0;
  }
  colony.gold = 0;
  s.navDirty = true;
  events.push({ type: 'defeat', owner: colony.id, by: victors.map((v) => v.id), plunder: victors.length > 0 ? plunder : 0 });
}

/** Hurt whatever stands on a cell. Returns true if the cell was destroyed. */
export function damageCell(s: GameState, t: Tuning, c: number, amount: number, events: SimEvent[]): boolean {
  const owner = s.owner[c];
  if (owner === 0) return false;
  events.push({ type: 'hit', cell: c });
  s.lastHit[c] = s.tick;
  if (s.kind[c] === Kind.Tower) {
    const colony = s.colonies[owner - 1];
    colony.towerHp -= amount;
    if (colony.towerHp <= 0) {
      defeatColony(s, t, colony, events);
      return true;
    }
    return false;
  }
  s.hp[c] -= amount;
  if (s.hp[c] <= 0) {
    destroyCell(s, t, c, events);
    return true;
  }
  return false;
}

/** Advance everything that changes with time: construction finishes, rubble clears. */
export function stepStructures(s: GameState, t: Tuning, events: SimEvent[]): void {
  if (s.pending.length === 0) return;
  const buildTicks = Math.max(1, Math.round(t.combat.buildSeconds * t.tickRate));
  let keep = 0;
  for (const c of s.pending) {
    const kind = s.kind[c];
    if (kind === Kind.Rubble) {
      if (s.tick >= s.readyTick[c]) {
        // The ground is free again: anyone adjacent may grow into it.
        s.kind[c] = Kind.Empty;
        s.inPending[c] = 0;
        refreshAround(s, c);
        s.navDirty = true;
        events.push({ type: 'clear', cell: c });
        continue;
      }
    } else if (kind > Kind.House) {
      const full = maxHealthAt(s, t, c);
      if (s.tick >= s.readyTick[c]) {
        s.inPending[c] = 0;
        continue;
      }
      // D9: health climbs from the starting share to full over the build-up time.
      const ticks = Math.max(1, buildTicks * s.colonies[s.owner[c] - 1].mods.buildTime);
      s.hp[c] = Math.min(full, s.hp[c] + (full * (1 - t.combat.buildStartHealth)) / ticks);
    } else {
      s.inPending[c] = 0;
      continue;
    }
    s.pending[keep++] = c;
  }
  s.pending.length = keep;
}
