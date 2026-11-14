// Game state construction and the helpers every rule relies on.

import { generateMap, mapSize, mapTypeFor, type MapType } from './mapgen';
import { step } from './topo';
import { defaultMods } from './research';
import { DOCTRINE_COUNT, Kind, KIND_COUNT, Terrain, TOWER_SIZE, type Colony, type GameState, type GrowthModel, type Tuning } from './types';
import { setupMode, type GameMode } from './modes';

export interface GameOptions {
  seed: number;
  model: GrowthModel;
  /** How many colonies grow on the map (1 = the player alone). */
  colonies: number;
  tuning: Tuning;
  /** Colony ids run by the AI. */
  bots?: number[];
  /** Set false to keep AI colonies from attacking (they still build and defend). */
  aiAttacks?: boolean;
  /** Rival difficulty: 0 easy, 1 normal (default), 2 hard, 3 brutal, 4 nightmare. */
  aiLevel?: number;
  /** The game mode (default Conquest). */
  mode?: GameMode;
  /** Which kind of map: continent, highlands, rivers, lakes or endless (the looping one). By default one of the first four, picked from the seed. */
  mapType?: MapType;
}

export function createEmptyState(width: number, height: number, seed: number, model: GrowthModel): GameState {
  const n = width * height;
  return {
    width,
    height,
    wrap: false,
    mapType: 'custom',
    feature: new Uint8Array(n),
    seed,
    tick: 0,
    rng: seed >>> 0,
    model,
    terrain: new Uint8Array(n),
    owner: new Uint8Array(n),
    kind: new Uint8Array(n),
    hp: new Float32Array(n),
    readyTick: new Int32Array(n),
    timer: new Float32Array(n),
    vigor: new Float32Array(n),
    edgePos: new Int32Array(n).fill(-1),
    pending: [],
    inPending: new Uint8Array(n),
    cutOff: new Uint8Array(n),
    military: [],
    lock: new Int32Array(n),
    heat: new Float32Array(n),
    units: [],
    nextUnitId: 1,
    navDirty: true,
    navTick: -1000000,
    bots: [],
    aiAttacks: true,
    aiLevel: 1,
    airborne: false,
    lastHit: new Int32Array(n).fill(-1000000),
    strikes: [],
    mode: 'conquest',
    crown: -1,
    crownHolder: 0,
    winner: 0,
    colonies: [],
  };
}

/** `towerCell` is the top-left cell of the 2x2 Center Tower; all four cells must be on the map. */
export function addColony(s: GameState, towerCell: number, t: Tuning): Colony {
  const towerCells: number[] = [];
  for (let dy = 0; dy < TOWER_SIZE; dy++) {
    for (let dx = 0; dx < TOWER_SIZE; dx++) towerCells.push(towerCell + dy * s.width + dx);
  }
  const colony: Colony = {
    id: s.colonies.length + 1,
    alive: true,
    tower: towerCell,
    towerCells,
    towerHp: t.health.tower,
    towerReload: 0,
    houses: 0,
    buildings: 0,
    counts: new Array<number>(KIND_COUNT).fill(0),
    gold: t.economy.startGold,
    science: 0,
    farmLinks: 0,
    order: 0,
    launchStrength: 0,
    doctrine: -1,
    flavour: '',
    grudge: 0,
    grudgeUntil: 0,
    mods: defaultMods(),
    picks: [],
    drawsEarned: 0,
    pendingDraws: 0,
    offer: null,
    ageOffer: 0,
    boosts: 0,
    crownTicks: 0,
    age: 1,
    unlocked: [],
    bonusGold: 0,
    terrainHouses: 0,
    bonusScience: 0,
    linkDirty: false,
    dormant: { cells: 0, houses: 0, farms: 0, farmLinks: 0, research: 0 },
    pool: 0,
    edge: [],
    nav: { tower: null, raid: null, home: null },
  };
  s.colonies.push(colony);
  for (const c of towerCells) {
    s.kind[c] = Kind.Tower;
    s.owner[c] = colony.id;
    s.vigor[c] = t.growth.towerVigor;
  }
  for (const c of towerCells) refreshAround(s, c);
  s.navDirty = true;
  return colony;
}

export function createGame(o: GameOptions): GameState {
  const { tuning } = o;
  const type = o.mapType ?? mapTypeFor(o.seed);
  const wrap = type === 'endless';
  // More colonies need more room.
  const size = mapSize(tuning, o.colonies);
  const map = generateMap(o.seed, tuning, o.colonies, size, wrap, type);
  const s = createEmptyState(size, size, o.seed, o.model);
  s.wrap = wrap;
  s.mapType = type;
  s.terrain.set(map.terrain);
  s.feature.set(map.features);
  map.towers.forEach((tower, i) => {
    const colony = addColony(s, tower, tuning);
    colony.flavour = map.flavours[i] ?? '';
  });
  s.bots = (o.bots ?? []).filter((id) => id >= 1 && id <= s.colonies.length);
  s.aiAttacks = o.aiAttacks ?? true;
  s.aiLevel = o.aiLevel ?? 1;
  // Each rival follows its own playstyle, all different while there are enough to go round,
  // and harder rivals run a richer economy.
  // (Worked out from the seed, not drawn from the random generator, so adding rivals never
  // changes how the map plays out.) Stepping by 2 through 5 styles never repeats one.
  s.bots.forEach((id, i) => {
    const colony = s.colonies[id - 1];
    colony.doctrine = ((s.seed >>> 3) + i * 2) % DOCTRINE_COUNT;
    const boost = tuning.ai.levelIncome[s.aiLevel] ?? 1;
    colony.mods.gold *= boost;
    colony.mods.science *= boost;
    colony.gold += tuning.ai.levelStartGold[s.aiLevel] ?? 0;
  });
  setupMode(s, tuning, o.mode ?? 'conquest');
  return s;
}

/** Every cell the colony occupies: houses, buildings and the tower's four cells. */
export function colonySize(c: Colony): number {
  return c.alive ? c.houses + c.buildings + c.towerCells.length : 0;
}

/** Empty, unowned, and on terrain a square may stand on (D21: mountains and water are closed). */
export function isGrowable(s: GameState, c: number): boolean {
  return s.kind[c] === Kind.Empty && (s.terrain[c] === Terrain.Grass || s.terrain[c] === Terrain.Forest);
}

/** D2: adjacency is the four orthogonal neighbours, everywhere. */
export function hasGrowableNeighbour(s: GameState, c: number): boolean {
  for (let d = 0; d < 4; d++) {
    const n = step(s, c, d);
    if (n >= 0 && isGrowable(s, n)) return true;
  }
  return false;
}

/** D8: how many farms of the given colony touch this cell (orthogonally)? */
export function ownFarmNeighbours(s: GameState, c: number, owner: number): number {
  let total = 0;
  for (let d = 0; d < 4; d++) {
    const n = step(s, c, d);
    if (n >= 0 && s.kind[n] === Kind.Farm && s.owner[n] === owner) total++;
  }
  return total;
}

/** D1: only houses and the Center Tower grow. Converted buildings never do. */
export function isSource(s: GameState, c: number): boolean {
  const k = s.kind[c];
  return k === Kind.Tower || k === Kind.House;
}

/** Take a cell out of its colony's edge list. Must run before the cell changes owner. */
export function removeEdge(s: GameState, c: number): void {
  const pos = s.edgePos[c];
  if (pos === -1) return;
  const list = s.colonies[s.owner[c] - 1].edge;
  const last = list.pop() as number;
  if (last !== c) {
    list[pos] = last;
    s.edgePos[last] = pos;
  }
  s.edgePos[c] = -1;
}

/** Bring one cell's membership of its colony's edge list up to date. */
export function refreshEdge(s: GameState, c: number): void {
  const o = s.owner[c];
  const should = o !== 0 && isSource(s, c) && hasGrowableNeighbour(s, c);
  const pos = s.edgePos[c];
  if (should && pos === -1) {
    const list = s.colonies[o - 1].edge;
    s.edgePos[c] = list.length;
    list.push(c);
  } else if (!should && pos !== -1) {
    removeEdge(s, c);
  }
}

/** A cell changed: it and its four neighbours may have gained or lost edge status. */
export function refreshAround(s: GameState, c: number): void {
  refreshEdge(s, c);
  for (let d = 0; d < 4; d++) {
    const n = step(s, c, d);
    if (n >= 0) refreshEdge(s, n);
  }
}

/** Track a cell that changes with time (a building under construction, or rubble). */
export function addPending(s: GameState, c: number): void {
  if (s.inPending[c]) return;
  s.inPending[c] = 1;
  s.pending.push(c);
}

/** Order-sensitive digest of everything that matters, for determinism tests. */
export function hashState(s: GameState): number {
  let h = 0x811c9dc5;
  const mix = (v: number) => {
    h ^= v & 0xff;
    h = Math.imul(h, 0x01000193);
  };
  const mix32 = (v: number) => {
    mix(v);
    mix(v >>> 8);
    mix(v >>> 16);
    mix(v >>> 24);
  };
  for (let c = 0; c < s.kind.length; c++) {
    mix(s.terrain[c]);
    mix(s.owner[c]);
    mix(s.kind[c]);
    mix(Math.floor(s.hp[c]));
  }
  mix32(s.tick);
  mix32(s.rng);
  for (const colony of s.colonies) {
    mix32(Math.floor(colony.gold * 100));
    mix32(Math.floor(colony.science * 100));
    mix32(colony.farmLinks);
    mix32(Math.floor(colony.towerHp));
    mix(colony.order);
    mix(colony.alive ? 1 : 0);
    mix32(colony.picks.length);
    mix32(colony.unlocked.length);
    mix32(colony.pendingDraws);
    mix32(colony.dormant.cells);
  }
  mix32(s.units.length);
  for (const u of s.units) {
    mix32(u.id);
    mix32(Math.floor(u.x * 1000));
    mix32(Math.floor(u.y * 1000));
    mix32(Math.floor(u.hp * 10));
  }
  return h >>> 0;
}
