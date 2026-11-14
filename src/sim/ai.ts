// The AI that runs rival colonies: what to build and research, and when and whom to attack.
//
// It plays by exactly the same rules and prices as the player and acts only through commands.
// Every few seconds it works out which part of its colony is furthest behind, picks the kind
// of building for it from what it has unlocked, and scores its own houses to find the best
// square:
//   - farms go in the interior and next to other farms, so they form blocks;
//   - mines and observatories go by mountains, fisheries by water, markets among houses;
//   - attacking towers go where they cover the most undefended squares, spaced apart,
//     in a mix of every kind it has unlocked;
//   - bell towers go among its towers, shrines among its buildings;
//   - army buildings go inside the defended area, on the side facing the nearest enemy,
//     in a mix of every kind it has unlocked;
//   - walls (bastions once it has them) close a ring around the Center Tower;
//   - science buildings go deep inside, near the tower; libraries cluster.
// It never converts so much that the colony stops earning: a set share stays houses.
//
// Each rival follows a playstyle (its doctrine): Fortress, Raiders, Siege, Horde or Merchant.
// The doctrine steers which research it goes for, which towers and army buildings it favours,
// how much it spends on each part of the colony, and when it attacks. Every style is a valid
// way to win; none is a step on a ladder.
//
// Its army gathers on Hold and attacks once it is ready, or sooner if it badly outnumbers the
// target. It prefers the leading colony, close and weakly defended colonies, colonies whose army
// is away, and whoever attacked it. It presses on against a tower that is about to fall, and
// falls back to regroup when beaten or when home is threatened. Under attack it builds its new
// towers on the side the enemy is coming from.

import { ATTACKING, ECONOMY, isAttacking, isLocked, isWall, PRODUCERS, PRODUCES, SCIENCE, towerRange, unitTuning, unlockTuning } from './catalog';
import { buildingTuning, buildingYield, canAfford, terrainAround } from './economy';
import { towerMaxHealth } from './health';
import { crownHolder } from './modes';
import { researchOption } from './research';
import { nextFloat, nextInt } from './rng';
import { colonySize, isGrowable, ownFarmNeighbours } from './state';
import { cellAt, deltaX, deltaY, dist, step } from './topo';
import { Kind, Terrain, TOWER_SIZE, UnitType, type Colony, type Command, type GameState, type Tuning } from './types';

/** Squares in the ring that walls in a 2x2 tower at distance 2. */
const KEEP_RING_CELLS = 20;

/** How the AI spreads its towers over the kinds it has unlocked. */
const DEFENCE_MIX: Record<number, number> = {
  [Kind.Crossbow]: 1,
  [Kind.Ballista]: 0.7,
  [Kind.Flame]: 0.6,
  [Kind.Frost]: 0.5,
  [Kind.Lightning]: 0.7,
  [Kind.Cannon]: 0.6,
  [Kind.Obelisk]: 0.5,
  [Kind.MachineGun]: 0.8,
  [Kind.Hex]: 0.4,
  [Kind.Marksman]: 0.6,
  [Kind.Railgun]: 0.6,
};

/** How the AI spreads its army over the buildings it has unlocked. */
const ARMY_MIX: Record<number, number> = {
  [Kind.Camp]: 1,
  [Kind.Barracks]: 1,
  [Kind.Kennel]: 0.6,
  [Kind.Archery]: 0.8,
  [Kind.SpearHall]: 0.7,
  [Kind.Stable]: 0.7,
  [Kind.Workshop]: 0.5,
  [Kind.Monastery]: 0.35,
  [Kind.PowderHouse]: 0.4,
  [Kind.GiantLair]: 0.3,
  [Kind.BannerHall]: 0.3,
  [Kind.MusketRange]: 0.8,
  [Kind.ArtilleryWorks]: 0.5,
  [Kind.TankFactory]: 0.7,
  [Kind.Airfield]: 0.4,
  [Kind.RamWorks]: 0.5,
  [Kind.Arcanum]: 0.6,
  [Kind.Guild]: 0.5,
  [Kind.Helipad]: 0.4,
};

const ECONOMY_MIX: Record<number, number> = { [Kind.Mine]: 1, [Kind.Fishery]: 1, [Kind.Market]: 0.7, [Kind.Bank]: 0.3, [Kind.LumberMill]: 1, [Kind.Granary]: 0.6, [Kind.Exchange]: 0.4 };
const SCIENCE_MIX: Record<number, number> = { [Kind.Library]: 1, [Kind.Observatory]: 0.6, [Kind.Academy]: 0.3, [Kind.PrintingPress]: 0.6, [Kind.Alchemist]: 0.4, [Kind.University]: 0.7, [Kind.SpyDen]: 0.5 };

/** An AI playstyle. */
export interface Doctrine {
  name: string;
  /** Research ids it goes for, and how much it wants each (others count 1). */
  research: Record<string, number>;
  /** Multipliers on the army and tower mixes, by Kind. */
  army: Record<number, number>;
  defence: Record<number, number>;
  /** Multipliers on how many towers, army buildings and money buildings it wants. */
  defenceScale: number;
  armyScale: number;
  economyScale: number;
  /** Seconds before its first attack, and how full its army must be before it sets out. */
  attackAfter: number;
  readyShare: number;
}

export const DOCTRINES: Doctrine[] = [
  {
    // Turtles behind towers and bastions, then rolls forward with shields, archers and catapults.
    name: 'Fortress',
    research: { ballista: 3, frost: 3, cannon: 3, bell: 3, bastion: 3, lightning: 2, obelisk: 2, shrine: 2, barracks: 2, archery: 2, workshop: 2, masonry: 3, engineering: 3, clockwork: 3, artillery: 3, citadel: 3, thorns: 3, mgnest: 3, aa: 3, musket: 2, marksman: 3, railgun: 3, radar: 3, hex: 2, concrete: 3, lodge: 3, ballistics: 3, satellites: 3, phalanx: 2 },
    army: { [Kind.Barracks]: 3, [Kind.Archery]: 3, [Kind.Workshop]: 2 },
    defence: { [Kind.Ballista]: 2, [Kind.Cannon]: 2, [Kind.Frost]: 1.5, [Kind.Flame]: 1.5, [Kind.Marksman]: 2, [Kind.Railgun]: 2 },
    defenceScale: 2.4,
    armyScale: 0.9,
    economyScale: 1,
    attackAfter: 360,
    readyShare: 0.85,
  },
  {
    // Fast and early: hounds loot the houses, knights ride down whoever defends them.
    name: 'Raiders',
    research: { kennel: 3, stable: 3, archery: 2, flame: 2, bannerhall: 2, airfield: 3, tankworks: 2, march: 3, whetstones: 3, drill: 3, roads: 3, guild: 3, helipad: 3, bloodoath: 3, medicine: 2, assembly: 2 },
    army: { [Kind.Kennel]: 3, [Kind.Stable]: 3, [Kind.Archery]: 1.5, [Kind.Airfield]: 2.5, [Kind.TankFactory]: 1.5, [Kind.Guild]: 3, [Kind.Helipad]: 2.5 },
    defence: { [Kind.Flame]: 2 },
    defenceScale: 0.8,
    armyScale: 1.3,
    economyScale: 1,
    attackAfter: 200,
    readyShare: 0.7,
  },
  {
    // Breaks cities apart: spears carve lines, catapults and sappers open walls, giants crush.
    name: 'Siege',
    research: { spearhall: 3, workshop: 3, powder: 3, lair: 3, barracks: 2, cannon: 2, rams: 3, conscription: 2, chainmail: 2, artworks: 3, tankworks: 3, silo: 3, ramworks: 3, nuke: 3, totalwar: 3, standing: 2 },
    army: { [Kind.SpearHall]: 3, [Kind.Workshop]: 2.5, [Kind.PowderHouse]: 2, [Kind.GiantLair]: 2, [Kind.Barracks]: 1.5, [Kind.ArtilleryWorks]: 2.5, [Kind.TankFactory]: 2, [Kind.RamWorks]: 3 },
    defence: { [Kind.Cannon]: 2 },
    defenceScale: 1,
    armyScale: 1.2,
    economyScale: 1,
    attackAfter: 300,
    readyShare: 0.8,
  },
  {
    // A sea of warriors with monks behind them, attacking again and again.
    name: 'Horde',
    research: { barracks: 2, spearhall: 2, monastery: 3, shrine: 2, bannerhall: 3, musket: 3, factory: 3, conscription: 3, drill: 3, chainmail: 3, whetstones: 3, arcanum: 3, hex: 2, standing: 3, medicine: 3, bloodoath: 2 },
    army: { [Kind.Camp]: 3, [Kind.Barracks]: 2, [Kind.Monastery]: 1.5, [Kind.BannerHall]: 2, [Kind.MusketRange]: 2, [Kind.Arcanum]: 2.5 },
    defence: { [Kind.Lightning]: 1.5 },
    defenceScale: 0.8,
    armyScale: 1.6,
    economyScale: 0.8,
    attackAfter: 240,
    readyShare: 0.65,
  },
  {
    // Gets rich first, then buys the expensive things: giants, knights, cannons.
    name: 'Merchant',
    research: { mine: 3, fishery: 3, market: 3, bank: 3, plaza: 3, power: 3, press: 3, silo: 2, library: 2, observatory: 2, academy: 2, lair: 2, cannon: 2, stable: 2, trade: 3, golden: 3, scribes: 2, lumbermill: 3, granary: 3, exchange: 3, alchemist: 2, university: 3, spyden: 2, nuke: 2, charters: 3, soil: 3, mercantilism: 3, automation: 3 },
    army: { [Kind.GiantLair]: 3, [Kind.Stable]: 2, [Kind.Workshop]: 2 },
    defence: { [Kind.Cannon]: 2, [Kind.Lightning]: 2 },
    defenceScale: 1.1,
    armyScale: 1,
    economyScale: 2.2,
    attackAfter: 480,
    readyShare: 0.9,
  },
];

/** A colony's doctrine; colonies without one (the player) get a balanced default. */
const BALANCED: Doctrine = { name: 'Balanced', research: {}, army: {}, defence: {}, defenceScale: 1, armyScale: 1, economyScale: 1, attackAfter: 300, readyShare: 0.8 };

export function doctrineOf(colony: Colony): Doctrine {
  return DOCTRINES[colony.doctrine] ?? BALANCED;
}

/** How much one unit counts when the AI weighs armies. */
const UNIT_WEIGHT: Record<number, number> = {
  [UnitType.Shield]: 3,
  [UnitType.Hound]: 1,
  [UnitType.Warrior]: 2,
  [UnitType.Archer]: 2,
  [UnitType.Spearman]: 3,
  [UnitType.Knight]: 4,
  [UnitType.Catapult]: 3,
  [UnitType.Monk]: 1,
  [UnitType.Sapper]: 2,
  [UnitType.Giant]: 10,
  [UnitType.Bearer]: 1,
  [UnitType.Musketeer]: 3,
  [UnitType.Artillery]: 4,
  [UnitType.Tank]: 8,
  [UnitType.Bomber]: 5,
  [UnitType.Ram]: 4,
  [UnitType.Mage]: 3,
  [UnitType.Assassin]: 3,
  [UnitType.Gunship]: 5,
};

interface View {
  s: GameState;
  t: Tuning;
  colony: Colony;
  /** Tower centre. */
  tx: number;
  ty: number;
  /** Centre of the nearest living enemy tower. */
  ex: number;
  ey: number;
  houses: number[];
  /** For each square: how many of the colony's towers (finished or not, the Center Tower included) reach it. */
  covered: Uint8Array;
}

/** Distance in squares (counting diagonals as 1) from a cell to the colony's 2x2 tower. */
function ringDistance(v: View, c: number): number {
  const w = v.s.width;
  const x = c % w;
  const y = (c / w) | 0;
  const ax = v.colony.tower % w;
  const ay = (v.colony.tower / w) | 0;
  // Offsets from the tower's top-left cell, the short way round.
  const ox = deltaX(v.s, ax, x);
  const oy = deltaY(v.s, ay, y);
  const dx = ox < 0 ? -ox : ox > TOWER_SIZE - 1 ? ox - (TOWER_SIZE - 1) : 0;
  const dy = oy < 0 ? -oy : oy > TOWER_SIZE - 1 ? oy - (TOWER_SIZE - 1) : 0;
  return Math.max(dx, dy);
}

function buildView(s: GameState, t: Tuning, colony: Colony): View {
  const w = s.width;
  const tx = (colony.tower % w) + TOWER_SIZE / 2;
  const ty = ((colony.tower / w) | 0) + TOWER_SIZE / 2;

  let ex = tx;
  let ey = ty;
  let nearest = Infinity;
  for (const other of s.colonies) {
    if (other.id === colony.id || !other.alive) continue;
    const ox = (other.tower % w) + TOWER_SIZE / 2;
    const oy = ((other.tower / w) | 0) + TOWER_SIZE / 2;
    const d = dist(s, tx, ty, ox, oy);
    if (d < nearest) {
      nearest = d;
      ex = ox;
      ey = oy;
    }
  }

  const houses: number[] = [];
  const covered = new Uint8Array(s.kind.length);
  const mark = (cx: number, cy: number, range: number) => {
    const r = Math.ceil(range);
    for (let y = Math.floor(cy) - r; y <= Math.floor(cy) + r; y++) {
      for (let x = Math.floor(cx) - r; x <= Math.floor(cx) + r; x++) {
        const c = cellAt(s, x, y);
        if (c >= 0 && covered[c] < 255 && Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= range) covered[c]++;
      }
    }
  };
  mark(tx, ty, t.defence.tower.range);
  for (let c = 0; c < s.kind.length; c++) {
    if (s.owner[c] !== colony.id) continue;
    if (s.kind[c] === Kind.House) houses.push(c);
    else if (isAttacking(s.kind[c])) mark((c % w) + 0.5, ((c / w) | 0) + 0.5, towerRange(t, colony, s.kind[c]));
  }
  return { s, t, colony, tx, ty, ex, ey, houses, covered };
}

/** An interior house has no empty neighbour: converting it costs no growth. */
function isInterior(v: View, c: number): boolean {
  return v.s.edgePos[c] === -1;
}

function distance(s: GameState, c: number, x: number, y: number): number {
  const w = s.width;
  return dist(s, x, y, (c % w) + 0.5, ((c / w) | 0) + 0.5);
}

/** A deterministic sample of the colony's houses, so scoring stays cheap in a huge city. */
function sample(v: View, most: number): number[] {
  const stride = Math.max(1, Math.ceil(v.houses.length / most));
  const out: number[] = [];
  for (let i = nextInt(v.s, stride); i < v.houses.length; i += stride) out.push(v.houses[i]);
  return out;
}

function bestFarmCell(v: View): number {
  const { s, colony } = v;
  const w = s.width;
  const id = colony.id;
  let best = -1;
  let bestScore = -Infinity;
  for (const c of v.houses) {
    if (!isInterior(v, c) || ringDistance(v, c) < 3) continue;
    const x = c % w;
    const y = (c / w) | 0;
    // Farms within two squares: keeps new farms close to the block even when not touching yet.
    let near = 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const n = cellAt(s, x + dx, y + dy);
        if (n < 0) continue;
        if (s.kind[n] === Kind.Farm && s.owner[n] === id) near++;
      }
    }
    // Room to keep growing the block: neighbours that are safe houses or farms already.
    let room = 0;
    for (const n of [0, 1, 2, 3].map((d) => step(s, c, d))) {
      if (n < 0 || n >= s.kind.length || s.owner[n] !== id) continue;
      if (s.kind[n] === Kind.Farm || (s.kind[n] === Kind.House && s.edgePos[n] === -1)) room++;
    }
    const score =
      10 * ownFarmNeighbours(s, c, id) + near + 0.5 * room - 0.15 * distance(s, c, v.tx, v.ty) + 0.05 * distance(s, c, v.ex, v.ey);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/** An attacking tower: where it covers the most squares nothing covers yet, not crowding another tower. */
function bestDefenceCell(v: View, range: number): number {
  const { s, colony } = v;
  const w = s.width;
  const id = colony.id;
  const r = Math.ceil(range);
  let best = -1;
  let bestScore = -Infinity;
  // Towers spread out first: no two closer than this. Once the city is covered, they thicken
  // the defence in layers, nearest the enemy first, so a big colony keeps getting stronger.
  const spacing = 1.5;
  for (const c of sample(v, 200)) {
    const x = c % w;
    const y = (c / w) | 0;
    let crowded = false;
    let cover = 0;
    for (let dy = -r; dy <= r && !crowded; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const n = cellAt(s, x + dx, y + dy);
        if (n < 0) continue;
        if (s.owner[n] !== id) continue;
        const d = Math.hypot(dx, dy);
        if (isAttacking(s.kind[n]) && d <= spacing) {
          crowded = true;
          break;
        }
        // Squares nobody covers yet count fully; each tower already covering one counts for less.
        if (d <= range) cover += 1 / (1 + 2 * v.covered[n]);
      }
    }
    if (crowded || cover < 1) continue;
    const score = cover - 0.25 * distance(s, c, v.ex, v.ey) - (isInterior(v, c) ? 0 : 6) - 4 * ownFarmNeighbours(s, c, id);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/** Bell Tower among the colony's towers; Shrine among its buildings. Never two of a kind side by side. */
function bestSupportCell(v: View, kind: number): number {
  const { s, t, colony } = v;
  const w = s.width;
  // Factories and Power Plants reach a square around them; towers by their range.
  const range = kind === Kind.Factory || kind === Kind.PowerPlant || kind === Kind.Radar ? (unlockTuning(t, kind)?.radius ?? 3) : towerRange(t, colony, kind);
  const r = Math.ceil(range);
  let best = -1;
  let bestScore = 1;
  for (const c of sample(v, 150)) {
    if (ringDistance(v, c) > 12) continue;
    const x = c % w;
    const y = (c / w) | 0;
    let score = 0;
    let crowded = false;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const n = cellAt(s, x + dx, y + dy);
        if (n < 0) continue;
        if (s.owner[n] !== colony.id || Math.hypot(dx, dy) > range) continue;
        const k = s.kind[n];
        if (k === kind) crowded = true;
        const serves =
          kind === Kind.Bell || kind === Kind.Radar ? isAttacking(k) : kind === Kind.Factory ? PRODUCERS.includes(k) : kind === Kind.PowerPlant ? ECONOMY.includes(k) : k !== Kind.House;
        if (serves) score++;
      }
    }
    if (!crowded && score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/** Army buildings: inside the defended area, as close to the enemy as that allows. */
function bestMilitaryCell(v: View): number {
  const { s, colony } = v;
  let best = -1;
  let bestScore = -Infinity;
  for (const c of v.houses) {
    if (!isInterior(v, c) || ringDistance(v, c) < 3) continue;
    const score = -0.5 * distance(s, c, v.ex, v.ey) + (v.covered[c] ? 3 : 0) - 4 * ownFarmNeighbours(s, c, colony.id);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/** Deep inside, near the tower: research buildings, banks and academies. */
function bestInnerCell(v: View): number {
  const { s, colony } = v;
  let best = -1;
  let bestScore = -Infinity;
  for (const c of v.houses) {
    if (!isInterior(v, c) || ringDistance(v, c) < 3) continue;
    const score = -distance(s, c, v.tx, v.ty) - 3 * ownFarmNeighbours(s, c, colony.id);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/** Money and science buildings that depend on where they stand: the house where they would yield most. */
function bestYieldCell(v: View, kind: number): number {
  const { s, t, colony } = v;
  const spec = unlockTuning(t, kind);
  if (!spec) return -1;
  // Only worth it with enough of what the building feeds on around it.
  const terrain = kind === Kind.Fishery ? Terrain.Water : kind === Kind.LumberMill ? Terrain.Forest : Terrain.Mountain;
  const needsTerrain = kind === Kind.Mine || kind === Kind.Fishery || kind === Kind.Observatory || kind === Kind.LumberMill;
  const least = kind === Kind.Observatory ? 1 : 2;
  let best = -1;
  let bestScore = -Infinity;
  for (const c of sample(v, 250)) {
    if (needsTerrain) {
      if (terrainAround(s, c, terrain) < least) continue;
    } else if (!isInterior(v, c) || ringDistance(v, c) < 3) {
      continue;
    }
    const y = buildingYield(s, t, c, colony.id, kind);
    const score = y.gold + 2 * y.science - 0.02 * ownFarmNeighbours(s, c, colony.id) - 0.0005 * distance(s, c, v.tx, v.ty);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  // A market among too few houses is not worth a square.
  if (kind === Kind.Market && best >= 0 && buildingYield(s, t, best, colony.id, kind).gold < (spec.per ?? 0) * 12) return -1;
  return best;
}

/** Plaza: the house with the most open land within its reach, away from other plazas. */
function bestPlazaCell(v: View): number {
  const { s, t, colony } = v;
  const w = s.width;
  const r = unlockTuning(t, Kind.Plaza)?.radius ?? 3;
  let best = -1;
  let bestScore = 4; // not worth it with only a few open squares around
  for (const c of sample(v, 200)) {
    const x = c % w;
    const y = (c / w) | 0;
    let open = 0;
    let crowded = false;
    for (let dy = -r; dy <= r && !crowded; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const n = cellAt(s, x + dx, y + dy);
        if (n < 0) continue;
        if (s.kind[n] === Kind.Plaza && s.owner[n] === colony.id) {
          crowded = true;
          break;
        }
        if (isGrowable(s, n)) open++;
      }
    }
    if (crowded) continue;
    const score = open - 3 * ownFarmNeighbours(s, c, colony.id);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/** The next square of the wall ring around the tower: preferably one that extends a wall already there. */
function bestWallCell(v: View, ring: number[]): number {
  const { s, colony } = v;
  let best = -1;
  let bestScore = -Infinity;
  for (const c of ring) {
    let joined = 0;
    for (const n of [0, 1, 2, 3].map((d) => step(s, c, d))) {
      if (n >= 0 && n < s.kind.length && isWall(s.kind[n]) && s.owner[n] === colony.id) joined++;
    }
    if (joined > bestScore) {
      bestScore = joined;
      best = c;
    }
  }
  return best;
}

function sumCounts(colony: Colony, kinds: number[]): number {
  let total = 0;
  for (const k of kinds) total += colony.counts[k];
  return total;
}

/** Unlocked kinds of a mix (weighted by the doctrine's taste), the one the colony is most short of first. */
function byShortage(t: Tuning, colony: Colony, mix: Record<number, number>, taste: Record<number, number> = {}, rich = 0): number[] {
  // A rich colony leans towards its most expensive (strongest) kinds: the late game is fought
  // with cannons and giants, not crossbows and warriors.
  const weight = (k: number) => mix[k] * (taste[k] ?? 1) * (1 + (rich * (buildingTuning(t, k)?.cost ?? 0)) / 40);
  return Object.keys(mix)
    .map(Number)
    .filter((k) => !isLocked(colony, k))
    .sort((a, b) => (colony.counts[a] + 1) / weight(a) - (colony.counts[b] + 1) / weight(b));
}

interface Slot {
  weight: number;
  want: number;
  have: number;
  /** Kinds to try, best first. */
  kinds: number[];
  place: (kind: number) => number;
}

/** Army buildings that crack fortified cities: catapults, sappers, giants, spearmen and shields. */
const SIEGE_KINDS = [Kind.Workshop, Kind.PowderHouse, Kind.GiantLair, Kind.SpearHall, Kind.Barracks, Kind.ArtilleryWorks, Kind.TankFactory, Kind.RamWorks];

/**
 * The doctrine's army taste, shifted towards siege when the colony it is likely to fight is
 * heavily fortified: there is no point sending warriors into fifty towers.
 */
function siegeTaste(s: GameState, t: Tuning, colony: Colony, taste: Record<number, number>): Record<number, number> {
  const target = colony.order > 0 ? s.colonies[colony.order - 1] : null;
  let towers = 0;
  if (target && target.alive) towers = sumCounts(target, ATTACKING);
  else for (const other of s.colonies) if (other.alive && other.id !== colony.id) towers = Math.max(towers, sumCounts(other, ATTACKING));
  const fortified = Math.min(3, towers / t.ai.fortifiedTowers);
  if (fortified < 1) return taste;
  const out: Record<number, number> = { ...taste };
  for (const k of SIEGE_KINDS) out[k] = (out[k] ?? 1) * (1 + fortified);
  return out;
}

function decide(s: GameState, t: Tuning, colony: Colony): Command | null {
  const a = t.ai;
  if (colony.houses < a.minHouses) return null;
  const v = buildView(s, t, colony);
  const size = colonySize(colony);
  const ring = v.houses.filter((c) => ringDistance(v, c) === 2);
  const style = doctrineOf(colony);
  // Gold piling up is wasted: a rich colony raises its sights for towers and army buildings.
  const surplus = 1 + Math.min(2, Math.max(0, (colony.gold - 200) / 300));

  // Enemy units near home. New towers go up on the side they are coming from.
  let threat = 0;
  let sx = 0;
  let sy = 0;
  for (const u of s.units) {
    if (u.owner !== colony.id && dist(s, v.tx, v.ty, u.x, u.y) < 14) {
      threat++;
      sx += deltaX(s, v.tx, u.x);
      sy += deltaY(s, v.ty, u.y);
    }
  }
  if (threat > 0) {
    v.ex = v.tx + sx / threat;
    v.ey = v.ty + sy / threat;
  }

  const defenceKinds = Object.keys(DEFENCE_MIX).map(Number);
  // Does any rival have aircraft (or the means to make them)?
  const enemyFlies = s.colonies.some((o) => o.alive && o.id !== colony.id && (o.counts[Kind.Airfield] > 0 || o.counts[Kind.Helipad] > 0));
  const defences = sumCounts(colony, defenceKinds);
  const unlockedEconomy = ECONOMY.filter((k) => !isLocked(colony, k));
  const unlockedScience = SCIENCE.filter((k) => !isLocked(colony, k));

  const slots: Slot[] = [
    { weight: 1, want: Math.floor(size * a.farmShare), have: colony.counts[Kind.Farm], kinds: [Kind.Farm], place: () => bestFarmCell(v) },
    {
      weight: 0.9,
      // Never more than a set number of towers (a little more for a Fortress): past that, spare
      // gold goes into the army, so a rich colony attacks instead of only turtling.
      want:
        Math.min(
          Math.round(a.maxCrossbows * Math.min(1.5, style.defenceScale)),
          Math.round(Math.min(a.maxCrossbows, a.baseCrossbows + Math.floor(size / a.squaresPerCrossbow)) * style.defenceScale * surplus),
        ) + (threat > 0 ? 4 : 0),
      have: defences,
      kinds: byShortage(t, colony, DEFENCE_MIX, style.defence, surplus - 1),
      place: (k) => bestDefenceCell(v, towerRange(t, colony, k)),
    },
    {
      weight: 0.85,
      // Spare gold grows the army too (towers are capped above), but never past the cap, so no
      // rival drowns the map in units.
      want: Math.min(
        // A rich colony may keep more army buildings than usual.
        Math.round((a.maxBarracks + a.maxKennels) * (1 + 0.5 * (surplus - 1))),
        Math.round(
          Math.max(size >= 30 ? 1 : 0, Math.floor(size / a.squaresPerBarracks) + Math.floor(size / a.squaresPerKennel)) *
            style.armyScale *
            surplus,
        ),
      ),
      have: sumCounts(colony, PRODUCERS),
      kinds: byShortage(t, colony, ARMY_MIX, siegeTaste(s, t, colony, style.army), surplus - 1),
      place: () => bestMilitaryCell(v),
    },
    {
      weight: 0.75,
      want: unlockedEconomy.length > 0 ? Math.min(14, Math.floor((size / 70) * style.economyScale)) : 0,
      have: sumCounts(colony, ECONOMY),
      kinds: byShortage(t, colony, ECONOMY_MIX).filter((k) => k !== Kind.Bank || colony.counts[Kind.Bank] < 3),
      place: (k) => (k === Kind.Bank ? bestInnerCell(v) : bestYieldCell(v, k)),
    },
    {
      weight: 0.55,
      want: unlockedScience.length > 0 ? Math.min(8, Math.floor(size / 90)) : 0,
      have: sumCounts(colony, SCIENCE),
      kinds: byShortage(t, colony, SCIENCE_MIX).filter((k) => k !== Kind.Academy || colony.counts[Kind.Academy] < 3),
      place: (k) => (k === Kind.Academy ? bestInnerCell(v) : bestYieldCell(v, k)),
    },
    {
      // Plazas where there is the most open land to grow into.
      weight: 0.5,
      want: isLocked(colony, Kind.Plaza) ? 0 : Math.min(4, 1 + Math.floor((size / 150) * style.economyScale)),
      have: colony.counts[Kind.Plaza],
      kinds: [Kind.Plaza],
      place: () => bestPlazaCell(v),
    },
    {
      // Anti-air only once some enemy has an airfield: then plenty of it.
      weight: 0.9,
      want: isLocked(colony, Kind.AABattery) || !enemyFlies ? 0 : Math.min(8, 2 + Math.floor(size / 120)),
      have: colony.counts[Kind.AABattery],
      kinds: [Kind.AABattery],
      place: (k) => bestDefenceCell(v, towerRange(t, colony, k)),
    },
    {
      weight: 0.6,
      want: isLocked(colony, Kind.MissileSilo) ? 0 : Math.min(3, 1 + Math.floor(size / 300)),
      have: colony.counts[Kind.MissileSilo],
      kinds: [Kind.MissileSilo],
      place: () => bestInnerCell(v),
    },
    {
      weight: 0.55,
      want: isLocked(colony, Kind.Factory) ? 0 : Math.floor(sumCounts(colony, PRODUCERS) / 6),
      have: colony.counts[Kind.Factory],
      kinds: [Kind.Factory],
      place: (k) => bestSupportCell(v, k),
    },
    {
      weight: 0.55,
      want: isLocked(colony, Kind.PowerPlant) ? 0 : Math.floor(sumCounts(colony, ECONOMY) / 4),
      have: colony.counts[Kind.PowerPlant],
      kinds: [Kind.PowerPlant],
      place: (k) => bestSupportCell(v, k),
    },
    {
      weight: 0.6,
      want: isLocked(colony, Kind.NukeSilo) ? 0 : 1 + Math.floor(size / 400),
      have: colony.counts[Kind.NukeSilo],
      kinds: [Kind.NukeSilo],
      place: () => bestInnerCell(v),
    },
    {
      weight: 0.45,
      want: isLocked(colony, Kind.Radar) ? 0 : Math.floor(defences / 6),
      have: colony.counts[Kind.Radar],
      kinds: [Kind.Radar],
      place: (k) => bestSupportCell(v, k),
    },
    {
      weight: 0.45,
      want: isLocked(colony, Kind.Bell) ? 0 : Math.floor(defences / 5),
      have: colony.counts[Kind.Bell],
      kinds: [Kind.Bell],
      place: (k) => bestSupportCell(v, k),
    },
    {
      weight: 0.45,
      want: isLocked(colony, Kind.Shrine) ? 0 : Math.floor(defences / 7),
      have: colony.counts[Kind.Shrine],
      kinds: [Kind.Shrine],
      place: (k) => bestSupportCell(v, k),
    },
    {
      // One research building early, so discoveries start coming; more as the colony grows.
      weight: colony.counts[Kind.Research] === 0 ? 0.95 : 0.5,
      want: Math.min(a.maxResearch, Math.max(size >= 25 ? 1 : 0, Math.floor(size / a.squaresPerResearch))),
      have: colony.counts[Kind.Research],
      kinds: [Kind.Research],
      place: () => bestInnerCell(v),
    },
  ];

  // Too few houses left: stop spending squares on anything but urgent defence.
  // A rich colony gives up more of its houses: their gold matters less than what it can buy.
  const stretched = colony.houses / size < a.minHouseShare - 0.075 * (surplus - 1);
  // The strongest wall it has; thorn walls go in alongside bastions once it has both.
  let wallKind: number = isLocked(colony, Kind.Bastion) ? Kind.Wall : Kind.Bastion;
  if (!isLocked(colony, Kind.Thorns) && (wallKind === Kind.Wall || colony.counts[Kind.Thorns] < colony.counts[Kind.Bastion])) wallKind = Kind.Thorns;
  const ranked: Array<{ need: number; kinds: number[]; place: (k: number) => number }> = slots.map((slot, i) => ({
    need: stretched && !(i === 1 && threat > 0) ? 0 : (slot.weight * (slot.want - slot.have)) / Math.max(1, slot.want),
    kinds: slot.kinds,
    place: slot.place,
  }));
  ranked.push({
    need: !stretched && size >= a.keepAtSize && ring.length > 0 ? 0.5 * Math.min(1, ring.length / KEEP_RING_CELLS + 0.3) : 0,
    kinds: [wallKind],
    place: () => bestWallCell(v, ring),
  });
  ranked.sort((p, q) => q.need - p.need);

  for (let i = 0; i < ranked.length; i++) {
    const { need, kinds, place } = ranked[i];
    if (need <= 0) break;
    for (let j = 0; j < kinds.length; j++) {
      const kind = kinds[j];
      if (!canAfford(s, t, colony.id, kind)) {
        // Save up for what matters most rather than spending on something minor.
        if (i === 0 && j === 0 && need >= 0.5) return null;
        continue;
      }
      const cell = place(kind);
      if (cell >= 0) return { type: 'convert', owner: colony.id, cell, to: kind };
    }
  }
  return null;
}

// ---------- research ----------

/**
 * The index of the option the AI takes: whatever its doctrine wants most; failing that, a new
 * building before a modifier.
 */
export function pickResearch(offer: string[], colony?: Colony): number {
  const taste = colony ? doctrineOf(colony).research : {};
  let best = 0;
  let bestScore = -Infinity;
  offer.forEach((id, i) => {
    const option = researchOption(id);
    // A doctrine's taste counts fully for buildings and half for modifiers: rivals still
    // mostly grow their arsenal, and take a favourite modifier over an ordinary building.
    // Anti-Air only turns up once someone flies: then it is wanted badly.
    const bonus = id === 'aa' ? 4 : (taste[id] ?? 1);
    const score = option.kind === 'modifier' ? 2 * (1 + (bonus - 1) / 2) : 3 * bonus;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

// ---------- the military order ----------

function armyStrength(s: GameState, owner: number): number {
  let total = 0;
  for (const u of s.units) if (u.owner === owner) total += UNIT_WEIGHT[u.type] ?? 1;
  return total;
}

/** How strong an army the colony's buildings can keep alive. */
function armyCapacity(t: Tuning, colony: Colony): number {
  let total = 0;
  for (const kind of PRODUCERS) {
    if (colony.counts[kind] === 0) continue;
    const type = PRODUCES[kind];
    total += colony.counts[kind] * (unitTuning(t, type).cap + colony.mods.armySize) * (UNIT_WEIGHT[type] ?? 1);
  }
  return total;
}

/** A rough measure of how hard a colony is to attack: its towers, its army, its tower's health. */
function defenceOf(s: GameState, t: Tuning, other: Colony): number {
  return 2 * sumCounts(other, ATTACKING) + armyStrength(s, other.id) + other.towerHp / (t.health.tower / 4);
}

function towerCentre(s: GameState, colony: Colony): [number, number] {
  return [(colony.tower % s.width) + TOWER_SIZE / 2, ((colony.tower / s.width) | 0) + TOWER_SIZE / 2];
}

/**
 * Who to attack (D26: no diplomacy; "alliances of convenience" are just several colonies
 * reaching the same conclusion). Higher is more tempting:
 *   - close by;
 *   - weakly defended (few towers, small army, damaged tower);
 *   - currently attacking this colony;
 *   - the leader: a colony much bigger than everyone else draws the others onto it;
 *   - its army is away attacking someone else, so its home is open;
 *   - not already being attacked by too many others.
 */
export function chooseTarget(s: GameState, t: Tuning, colony: Colony, aggressor: number, grudge = 0): number {
  // Last Stand: every rival hunts the human player, and nobody else.
  if (s.mode === 'laststand') {
    const human = s.colonies.find((c) => c.alive && !s.bots.includes(c.id));
    if (human) return human.id;
  }
  const holder = s.mode === 'crown' ? crownHolder(s) : 0;
  const [tx, ty] = towerCentre(s, colony);
  let best = 0;
  let bestScore = -Infinity;
  let total = 0;
  let alive = 0;
  for (const other of s.colonies) {
    if (!other.alive) continue;
    total += colonySize(other);
    alive++;
  }
  const average = total / Math.max(1, alive);
  for (const other of s.colonies) {
    if (other.id === colony.id || !other.alive) continue;
    const [ox, oy] = towerCentre(s, other);
    const far = dist(s, tx, ty, ox, oy);
    const defence = defenceOf(s, t, other);
    let others = 0;
    for (const third of s.colonies) if (third.id !== colony.id && third.alive && third.order === other.id) others++;
    const lead = Math.max(0, Math.min(1.5, colonySize(other) / Math.max(1, average) - 1));
    const away = other.order > 0 && other.order !== colony.id ? 0.8 : 0;
    const score =
      40 / (10 + far) + 6 / (4 + defence) + (other.id === aggressor ? 2 : 0) + (other.id === grudge ? 5 : 0) + 2 * lead + away - 0.3 * Math.max(0, others - 1) + 0.3 * nextFloat(s) + (other.id === holder ? 6 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = other.id;
    }
  }
  return best;
}

/**
 * D12 for the AI: gather on Hold until the army is nearly as big as its buildings allow,
 * attack, and fall back to regroup if the attack is beaten or home is in danger.
 */
export function militaryOrder(s: GameState, t: Tuning, colony: Colony): Command | null {
  const a = t.ai;
  const strength = armyStrength(s, colony.id);
  const [tx, ty] = towerCentre(s, colony);

  // Enemy units near home, and whose they mostly are.
  const near = new Map<number, number>();
  let threat = 0;
  for (const u of s.units) {
    if (u.owner === colony.id || dist(s, tx, ty, u.x, u.y) > 12) continue;
    threat++;
    near.set(u.owner, (near.get(u.owner) ?? 0) + 1);
  }
  let aggressor = 0;
  let most = 0;
  for (const [owner, count] of near) {
    if (count > most) {
      most = count;
      aggressor = owner;
    }
  }

  // Anyone who sends their army at us earns a grudge: we will usually answer them first.
  for (const other of s.colonies) {
    if (other.alive && other.id !== colony.id && other.order === colony.id) {
      colony.grudge = other.id;
      colony.grudgeUntil = s.tick + Math.round(a.grudgeSeconds * t.tickRate);
      if (aggressor === 0) aggressor = other.id;
    }
  }
  const grudge = colony.grudgeUntil > s.tick && s.colonies[colony.grudge - 1]?.alive ? colony.grudge : 0;

  const style = doctrineOf(colony);
  if (colony.order > 0) {
    const victim = s.colonies[colony.order - 1];
    // A tower about to fall is worth finishing, even with a battered army.
    const finishing = victim.alive && victim.towerHp < towerMaxHealth(t, victim) * 0.35 && strength >= a.attackMinStrength / 2;
    const beaten = strength < colony.launchStrength * a.retreatShare && !finishing;
    const needed = threat >= a.recallThreat;
    if (beaten || needed || !s.aiAttacks) return { type: 'order', owner: colony.id, target: 0 };
    return null;
  }

  // No fixed hour for war: after a short grace, a rival marches as soon as its army is ready.
  const grace = a.graceSeconds * (a.levelAttackDelay[s.aiLevel] ?? 1) * (s.mode === 'blitz' ? t.modes.blitzGrace : 1);
  if (!s.aiAttacks || s.tick < grace * t.tickRate) return null;
  // With intruders at the gates the army stays home.
  if (threat >= a.recallThreat) return null;
  if (strength < a.attackMinStrength) return null;
  const target = chooseTarget(s, t, colony, aggressor, grudge);
  if (target === 0) return null;
  // Set out once the army is ready, or at once if it badly outnumbers the target's defence.
  // Late in the game every playstyle stops waiting for a perfect army and keeps up the pressure.
  const lateGame = s.tick >= a.lateGameSeconds * t.tickRate;
  // Hitting back at an attacker needs less of a full army.
  const share = grudge === target ? Math.min(style.readyShare, 0.5) : lateGame ? Math.min(style.readyShare, 0.6) : style.readyShare;
  const ready = strength >= armyCapacity(t, colony) * share;
  const overwhelming = strength >= 2 * defenceOf(s, t, s.colonies[target - 1]);
  if (!ready && !overwhelming) return null;
  colony.launchStrength = strength;
  return { type: 'order', owner: colony.id, target };
}

export function aiCommands(s: GameState, t: Tuning): Command[] {
  const commands: Command[] = [];
  const interval = Math.max(1, Math.round(t.ai.intervalSeconds * t.tickRate));
  const orderInterval = Math.max(1, Math.round(t.ai.orderIntervalSeconds * t.tickRate));
  for (const id of s.bots) {
    const colony = s.colonies[id - 1];
    if (!colony.alive) continue;
    // D19: the AI drafts from the same pool by the same rules. It takes an offer as soon as it has one.
    if (colony.offer) commands.push({ type: 'research', owner: id, choice: pickResearch(colony.offer, colony) });
    if ((s.tick + id * 7) % interval === 0) {
      const command = decide(s, t, colony);
      if (command) commands.push(command);
    }
    if ((s.tick + id * 11) % orderInterval === 0) {
      const command = militaryOrder(s, t, colony);
      if (command) commands.push(command);
    }
  }
  return commands;
}
