// Gold, science and building prices (D7, D8), and what money and science buildings yield.

import { ECONOMY, isLocked, SCIENCE, unlockTuning } from './catalog';
import { isActive } from './health';
import { ownFarmNeighbours } from './state';
import { deltaX, deltaY, offset, step } from './topo';
import { Kind, Terrain, type BuildingTuning, type Colony, type GameState, type Tuning } from './types';

/** Tuning entry for a building kind, or null if the kind cannot be built by conversion. */
export function buildingTuning(t: Tuning, kind: number): BuildingTuning | null {
  if (kind === Kind.Wall) return t.buildings.wall;
  if (kind === Kind.Farm) return t.buildings.farm;
  if (kind === Kind.Research) return t.buildings.research;
  if (kind === Kind.Crossbow) return t.buildings.crossbow;
  if (kind === Kind.Barracks) return t.buildings.barracks;
  if (kind === Kind.Kennel) return t.buildings.kennel;
  const unlock = unlockTuning(t, kind);
  return unlock ? { cost: unlock.cost, costStep: 0 } : null;
}

/** The price of one more copy. Prices are flat while every costStep in the tuning is 0. */
export function costOf(s: GameState, t: Tuning, owner: number, kind: number): number {
  const def = buildingTuning(t, kind);
  if (!def) return Infinity;
  const colony = s.colonies[owner - 1];
  return Math.ceil((def.cost + def.costStep * colony.counts[kind]) * colony.mods.cost);
}

/** Affordable, and (for buildings research unlocks) already unlocked. */
export function canAfford(s: GameState, t: Tuning, owner: number, kind: number): boolean {
  const colony = s.colonies[owner - 1];
  return !isLocked(colony, kind) && colony.gold >= costOf(s, t, owner, kind);
}

/**
 * D8 (revised): a farm earns gold itself, and earns more for every farm of the same colony
 * touching it. Squares cut off from the tower earn nothing (D5). Research can scale each part.
 * Money buildings add their yield on top (worked out each tick in refreshYields).
 */
export function goldPerSecond(c: Colony, t: Tuning): number {
  const e = t.economy;
  const m = c.mods;
  const d = c.dormant;
  return (
    (e.towerGoldPerSecond +
      e.houseGoldPerSecond * m.houseGold * (c.houses - d.houses + e.terrainHouseBonus * c.terrainHouses) +
      e.farmGoldPerSecond * (c.counts[Kind.Farm] - d.farms) +
      e.farmNeighbourBonus * (c.farmLinks - d.farmLinks)) *
      m.gold +
    c.bonusGold
  );
}

export function sciencePerSecond(c: Colony, t: Tuning): number {
  return (c.counts[Kind.Research] - c.dormant.research) * t.economy.researchSciencePerSecond * c.mods.science + c.bonusScience;
}

/** Gold per second a new farm on this cell would add: its own yield plus what it gives its neighbours. */
export function farmYieldAt(s: GameState, t: Tuning, cell: number, owner: number): number {
  const m = s.colonies[owner - 1].mods;
  return (t.economy.farmGoldPerSecond + 2 * ownFarmNeighbours(s, cell, owner) * t.economy.farmNeighbourBonus) * m.gold;
}

/** Full recount of farm links; the simulation keeps this incrementally and tests compare the two. */
export function countFarmLinks(s: GameState, owner: number): number {
  let total = 0;
  for (let c = 0; c < s.kind.length; c++) {
    if (s.owner[c] === owner && s.kind[c] === Kind.Farm) total += ownFarmNeighbours(s, c, owner);
  }
  return total;
}

/** How many of the 8 cells around this one have the given terrain. */
export function terrainAround(s: GameState, cell: number, terrain: number): number {
  let total = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const n = offset(s, cell, dx, dy);
      if (n >= 0 && s.terrain[n] === terrain) total++;
    }
  }
  return total;
}

/** The colony's own houses within `radius` squares (a square area), not counting this cell. */
function housesAround(s: GameState, cell: number, owner: number, radius: number): number {
  let total = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx === 0 && dy === 0) continue;
      const n = offset(s, cell, dx, dy);
      if (n >= 0 && s.owner[n] === owner && s.kind[n] === Kind.House) total++;
    }
  }
  return total;
}

/** The colony's own squares of one kind within `radius` squares (a square area), not counting this cell. */
function kindAround(s: GameState, cell: number, owner: number, radius: number, kind: number): number {
  let total = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx === 0 && dy === 0) continue;
      const n = offset(s, cell, dx, dy);
      if (n >= 0 && s.owner[n] === owner && s.kind[n] === kind) total++;
    }
  }
  return total;
}

function isScienceBuilding(kind: number): boolean {
  return kind === Kind.Research || SCIENCE.includes(kind);
}

/** Science buildings of the colony touching this cell (orthogonally): libraries feed on them. */
function scienceNeighbours(s: GameState, cell: number, owner: number): number {
  let total = 0;
  for (let d = 0; d < 4; d++) {
    const n = step(s, cell, d);
    if (n >= 0 && s.owner[n] === owner && isScienceBuilding(s.kind[n])) total++;
  }
  return total;
}

/**
 * What a money or science building of this kind yields standing on this cell, per second.
 * Used for buildings that stand, and to preview a building before it is placed.
 *   Mine         gold, more for every mountain around it
 *   Fishery      gold, more for every water square around it
 *   Market       gold for every house of yours nearby
 *   Bank         interest on the gold you have saved, up to a cap
 *   Library      science, more for every science building touching it
 *   Observatory  science, more for every mountain around it
 *   Academy      a lot of science, wherever it stands
 */
export function buildingYield(s: GameState, t: Tuning, cell: number, owner: number, kind: number): { gold: number; science: number } {
  const raw = rawYield(s, t, cell, owner, kind);
  const m = s.colonies[owner - 1].mods;
  // Research modifiers scale all gold and all science.
  return { gold: raw.gold * m.gold, science: raw.science * m.science };
}

function rawYield(s: GameState, t: Tuning, cell: number, owner: number, kind: number): { gold: number; science: number } {
  const spec = unlockTuning(t, kind);
  const colony = s.colonies[owner - 1];
  if (!spec) return { gold: 0, science: 0 };
  const per = spec.per ?? 0;
  switch (kind) {
    case Kind.Mine:
      return { gold: ((spec.gold ?? 0) + per * terrainAround(s, cell, Terrain.Mountain)), science: 0 };
    case Kind.Fishery:
      return { gold: (spec.gold ?? 0) + per * terrainAround(s, cell, Terrain.Water), science: 0 };
    case Kind.Market:
      return { gold: per * housesAround(s, cell, owner, spec.radius ?? 1), science: 0 };
    case Kind.Bank:
      return { gold: Math.min(spec.cap ?? 0, colony.gold * (spec.rate ?? 0)), science: 0 };
    case Kind.Library:
      return { gold: 0, science: (spec.science ?? 0) + per * scienceNeighbours(s, cell, owner) };
    case Kind.Observatory:
      return { gold: 0, science: (spec.science ?? 0) + per * terrainAround(s, cell, Terrain.Mountain) };
    case Kind.Academy:
      return { gold: 0, science: spec.science ?? 0 };
    case Kind.LumberMill:
      return { gold: (spec.gold ?? 0) + per * terrainAround(s, cell, Terrain.Forest), science: 0 };
    case Kind.Granary:
      return { gold: per * kindAround(s, cell, owner, spec.radius ?? 1, Kind.Farm), science: 0 };
    case Kind.Exchange: {
      // Every money building you own, anywhere (other exchanges excluded).
      let money = 0;
      for (const k of ECONOMY) if (k !== Kind.Exchange) money += colony.counts[k];
      return { gold: per * money, science: 0 };
    }
    case Kind.Alchemist:
      // Burns gold into science, but only while there is gold to burn.
      return colony.gold > (spec.upkeep ?? 0) ? { gold: -(spec.upkeep ?? 0), science: spec.science ?? 0 } : { gold: 0, science: 0 };
    case Kind.University:
      return { gold: 0, science: per * housesAround(s, cell, owner, spec.radius ?? 1) };
    case Kind.SpyDen: {
      let rivals = 0;
      for (const other of s.colonies) if (other.alive && other.id !== owner) rivals++;
      return { gold: 0, science: per * rivals };
    }
    default:
      return { gold: 0, science: 0 };
  }
}

/** Add up what every finished, connected money and science building yields this tick. */
export function refreshYields(s: GameState, t: Tuning): void {
  for (const colony of s.colonies) {
    colony.bonusGold = 0;
    colony.bonusScience = 0;
  }
  // Finished, connected Power Plants by owner: money buildings near one earn more.
  const plants = new Map<number, number[]>();
  for (const c of s.military) {
    if (s.kind[c] !== Kind.PowerPlant || !isActive(s, c) || s.cutOff[c]) continue;
    const list = plants.get(s.owner[c]);
    if (list) list.push(c);
    else plants.set(s.owner[c], [c]);
  }
  const plant = unlockTuning(t, Kind.PowerPlant);
  const w = s.width;
  for (const c of s.military) {
    const kind = s.kind[c];
    if (!ECONOMY.includes(kind) && !SCIENCE.includes(kind)) continue;
    // Still being built, or cut off from the tower (D5): it yields nothing.
    if (!isActive(s, c) || s.cutOff[c]) continue;
    const owner = s.owner[c];
    const colony = s.colonies[owner - 1];
    if (!colony.alive) continue;
    const y = buildingYield(s, t, c, owner, kind);
    if (y.gold > 0) {
      const reach = plant?.radius ?? 0;
      for (const p of plants.get(owner) ?? []) {
        if (Math.abs(deltaX(s, c % w, p % w)) <= reach && Math.abs(deltaY(s, (c / w) | 0, (p / w) | 0)) <= reach) {
          y.gold *= 1 + (plant?.boost ?? 0);
          break;
        }
      }
    }
    colony.bonusGold += y.gold;
    colony.bonusScience += y.science;
  }
}

/**
 * Houses touching a mountain (a quarry) or water (a fishing village) earn extra. Counted once a
 * second: houses change slowly.
 */
export function countTerrainHouses(s: GameState): void {
  for (const colony of s.colonies) colony.terrainHouses = 0;
  for (let c = 0; c < s.kind.length; c++) {
    if (s.kind[c] !== Kind.House || s.cutOff[c]) continue;
    for (let d = 0; d < 4; d++) {
      const n = step(s, c, d);
      if (n >= 0 && (s.terrain[n] === Terrain.Mountain || s.terrain[n] === Terrain.Water)) {
        s.colonies[s.owner[c] - 1].terrainHouses++;
        break;
      }
    }
  }
}

export function stepEconomy(s: GameState, t: Tuning): void {
  if (s.tick % t.tickRate === 0) countTerrainHouses(s);
  refreshYields(s, t);
  for (const colony of s.colonies) {
    if (!colony.alive) continue;
    colony.gold += goldPerSecond(colony, t) / t.tickRate;
    colony.science += sciencePerSecond(colony, t) / t.tickRate;
  }
}
