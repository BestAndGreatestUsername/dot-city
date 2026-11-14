import { describe, expect, it } from 'vitest';
import tuningJson from '../src/data/tuning.json';
import { costOf, countFarmLinks, farmYieldAt, goldPerSecond } from '../src/sim/economy';
import { generateMap } from '../src/sim/mapgen';
import { nextInt } from '../src/sim/rng';
import { applyCommand, step } from '../src/sim/sim';
import { addColony, colonySize, createEmptyState, createGame, hashState, isSource, refreshAround } from '../src/sim/state';
import { cellAt, cellDist, deltaX, dist, step as neighbour } from '../src/sim/topo';
import { Kind, Terrain, type GameState, type GrowthModel, type SimEvent, type Tuning } from '../src/sim/types';

const tuning = tuningJson as Tuning;

function run(s: GameState, ticks: number, events: SimEvent[] = []): SimEvent[] {
  for (let i = 0; i < ticks; i++) step(s, tuning, events);
  return events;
}

function newGame(seed: number, model: GrowthModel = 'local', colonies = 4): GameState {
  return createGame({ seed, model, colonies, tuning });
}

function convert(s: GameState, cell: number, to: number, owner = 1): boolean {
  return applyCommand(s, tuning, { type: 'convert', owner, cell, to }, []);
}

/** The four orthogonal neighbours; on a looping map they wrap round the edges. */
function orthogonal(s: GameState, c: number): number[] {
  return [0, 1, 2, 3].map((d) => neighbour(s, c, d)).filter((n) => n >= 0);
}

/** A small all-water board where nothing grows, with one colony whose tower sits at (3,3)-(4,4). */
function stillBoard(): GameState {
  const s = createEmptyState(10, 10, 5, 'local');
  s.terrain.fill(Terrain.Water);
  addColony(s, 3 * 10 + 3, tuning);
  return s;
}

function placeHouse(s: GameState, x: number, y: number, owner = 1): number {
  const c = y * s.width + x;
  s.kind[c] = Kind.House;
  s.owner[c] = owner;
  s.vigor[c] = 1;
  s.colonies[owner - 1].houses++;
  refreshAround(s, c);
  return c;
}

describe('determinism', () => {
  it('replays the same match from the same seed and commands', () => {
    const play = () => {
      const s = newGame(12345);
      const events: SimEvent[] = [];
      for (let i = 0; i < 1500; i++) {
        step(s, tuning, events);
        if (i % 100 === 99) {
          const mine = events.filter((e): e is Extract<SimEvent, { type: 'grow' }> => e.type === 'grow' && e.owner === 1);
          const last = mine[mine.length - 1];
          const to = [Kind.Wall, Kind.Farm, Kind.Research][(i / 100) % 3 | 0];
          if (last) applyCommand(s, tuning, { type: 'convert', owner: 1, cell: last.cell, to }, events);
        }
      }
      return hashState(s);
    };
    expect(play()).toBe(play());
  });

  it('gives different matches for different seeds', () => {
    const a = newGame(1);
    const b = newGame(2);
    run(a, 600);
    run(b, 600);
    expect(hashState(a)).not.toBe(hashState(b));
  });
});

describe.each<GrowthModel>(['local', 'pressure'])('growth (%s model)', (model) => {
  it('expands the colony over time', () => {
    const s = newGame(7, model);
    run(s, 3000);
    for (const colony of s.colonies) expect(colony.houses).toBeGreaterThan(20);
  });

  it('only grows next to an existing square of the same colony, never diagonally', () => {
    const s = newGame(99, model);
    for (let i = 0; i < 2000; i++) {
      const events: SimEvent[] = [];
      const before = Uint8Array.from(s.owner);
      const kindBefore = Uint8Array.from(s.kind);
      step(s, tuning, events);
      for (const e of events) {
        if (e.type !== 'grow') continue;
        const linked = orthogonal(s, e.cell).some(
          (n) => s.owner[n] === e.owner && (before[n] === e.owner || events.some((o) => o.type === 'grow' && o.cell === n)),
        );
        expect(linked).toBe(true);
        expect(kindBefore[e.cell]).toBe(Kind.Empty);
      }
    }
  });

  it('never builds on mountains or water, and clears forest it grows onto', () => {
    const s = newGame(2024, model);
    const original = Uint8Array.from(s.terrain);
    run(s, 4000);
    let clearedForest = 0;
    for (let c = 0; c < s.kind.length; c++) {
      if (s.owner[c] === 0) continue;
      expect(s.terrain[c]).toBe(Terrain.Grass);
      expect(original[c] === Terrain.Mountain || original[c] === Terrain.Water).toBe(false);
      if (original[c] === Terrain.Forest) clearedForest++;
    }
    expect(clearedForest).toBeGreaterThan(0);
  });

  it('keeps the edge lists exact: every listed square can grow, every other cannot', () => {
    const s = newGame(31337, model);
    run(s, 2500);
    const listed = new Set<number>();
    for (const colony of s.colonies) for (const c of colony.edge) listed.add(c);
    for (let c = 0; c < s.kind.length; c++) {
      const canGrow =
        s.owner[c] !== 0 &&
        isSource(s, c) &&
        orthogonal(s, c).some((n) => s.kind[n] === Kind.Empty && (s.terrain[n] === Terrain.Grass || s.terrain[n] === Terrain.Forest));
      expect(listed.has(c)).toBe(canGrow);
    }
  });
});

describe('center tower', () => {
  it('is a 2x2 structure whose four cells all belong to the colony', () => {
    const s = newGame(77);
    for (const colony of s.colonies) {
      expect(colony.towerCells.length).toBe(4);
      const [a, b, c, d] = colony.towerCells;
      expect(a).toBe(colony.tower);
      expect(b).toBe(a + 1);
      expect(c).toBe(a + s.width);
      expect(d).toBe(a + s.width + 1);
      for (const cell of colony.towerCells) {
        expect(s.kind[cell]).toBe(Kind.Tower);
        expect(s.owner[cell]).toBe(colony.id);
      }
      expect(colonySize(colony)).toBe(4);
    }
  });

  it('cannot be converted', () => {
    const s = newGame(8);
    s.colonies[0].gold = 1000;
    for (const cell of s.colonies[0].towerCells) expect(convert(s, cell, Kind.Wall)).toBe(false);
  });
});

describe('conversion', () => {
  it('is permanent and stops growth: a fully walled tower never expands', () => {
    const s = createEmptyState(10, 10, 5, 'local');
    const colony = addColony(s, 3 * 10 + 3, tuning);
    colony.gold = 1000;
    const ring = new Set<number>();
    for (const cell of colony.towerCells) for (const n of orthogonal(s, cell)) if (s.kind[n] === Kind.Empty) ring.add(n);
    expect(ring.size).toBe(8);
    for (const n of ring) {
      placeHouse(s, n % 10, (n / 10) | 0);
      expect(convert(s, n, Kind.Wall)).toBe(true);
    }
    expect(colony.edge.length).toBe(0);
    run(s, 5000);
    expect(colony.houses).toBe(0);
    expect(colony.buildings).toBe(8);
    expect(colony.counts[Kind.Wall]).toBe(8);
  });

  it('refuses empty land, another colony, an existing building and unknown building types', () => {
    const s = newGame(8);
    run(s, 1500);
    s.colonies[0].gold = 1000;
    const rival = s.owner.findIndex((o, c) => o === 2 && s.kind[c] === Kind.House);
    expect(convert(s, rival, Kind.Wall)).toBe(false);
    const empty = s.kind.findIndex((k) => k === Kind.Empty);
    expect(convert(s, empty, Kind.Wall)).toBe(false);
    const mine = s.owner.findIndex((o, c) => o === 1 && s.kind[c] === Kind.House);
    expect(convert(s, mine, Kind.Tower)).toBe(false);
    expect(convert(s, mine, Kind.House)).toBe(false);
    expect(convert(s, mine, Kind.Farm)).toBe(true);
    expect(convert(s, mine, Kind.Wall)).toBe(false);
    expect(s.kind[mine]).toBe(Kind.Farm);
  });

  it('a converted square is never a growth source', () => {
    const s = newGame(8);
    run(s, 1500);
    s.colonies[0].gold = 1000;
    for (const to of [Kind.Wall, Kind.Farm, Kind.Research]) {
      const edgeHouse = s.colonies[0].edge.find((c) => s.kind[c] === Kind.House) as number;
      expect(convert(s, edgeHouse, to)).toBe(true);
      expect(s.edgePos[edgeHouse]).toBe(-1);
      expect(s.colonies[0].edge.includes(edgeHouse)).toBe(false);
    }
  });
});

describe('economy', () => {
  it('pays the tower base income plus a flat amount per house', () => {
    const s = stillBoard();
    const colony = s.colonies[0];
    for (let x = 0; x < 6; x++) placeHouse(s, x, 8);
    const before = colony.gold;
    run(s, 100);
    // Houses touching a mountain or water earn a bonus on top.
    const expected = (tuning.economy.towerGoldPerSecond + (6 + tuning.economy.terrainHouseBonus * colony.terrainHouses) * tuning.economy.houseGoldPerSecond) * 10;
    expect(colony.gold - before).toBeCloseTo(expected, 6);
    expect(colony.houses).toBe(6);
  });

  it('charges the same flat price for every copy of a building', () => {
    const s = stillBoard();
    const colony = s.colonies[0];
    colony.gold = 1000;
    for (let x = 0; x < 5; x++) {
      const cell = placeHouse(s, x, 8);
      expect(costOf(s, tuning, 1, Kind.Farm)).toBe(tuning.buildings.farm.cost);
      expect(convert(s, cell, Kind.Farm)).toBe(true);
    }
    expect(colony.gold).toBe(1000 - 5 * tuning.buildings.farm.cost);
    for (const kind of [Kind.Wall, Kind.Research, Kind.Crossbow, Kind.Barracks, Kind.Kennel]) {
      const before = costOf(s, tuning, 1, kind);
      colony.counts[kind] += 10;
      expect(costOf(s, tuning, 1, kind)).toBe(before);
      colony.counts[kind] -= 10;
    }
  });

  it('refuses a conversion the colony cannot afford and changes nothing', () => {
    const s = stillBoard();
    const colony = s.colonies[0];
    const cell = placeHouse(s, 0, 8);
    colony.gold = costOf(s, tuning, 1, Kind.Research) - 1;
    const before = hashState(s);
    expect(convert(s, cell, Kind.Research)).toBe(false);
    expect(hashState(s)).toBe(before);
    expect(s.kind[cell]).toBe(Kind.House);
  });

  it('a farm earns gold itself and nothing extra for houses beside it', () => {
    const s = stillBoard();
    const colony = s.colonies[0];
    colony.gold = 1000;
    const [, farm] = [1, 2, 3].map((x) => placeHouse(s, x, 8));
    const before = goldPerSecond(colony, tuning);
    expect(convert(s, farm, Kind.Farm)).toBe(true);
    // One house became a farm: lose a house's income, gain a lone farm's.
    expect(goldPerSecond(colony, tuning)).toBeCloseTo(before - tuning.economy.houseGoldPerSecond + tuning.economy.farmGoldPerSecond, 9);
    expect(colony.farmLinks).toBe(0);
  });

  it('farms boost the farms touching them, so a block earns far more than scattered farms', () => {
    const e = tuning.economy;
    // Four farms in a 2x2 block: every farm touches two others.
    const block = stillBoard();
    block.colonies[0].gold = 1000;
    for (const [x, y] of [[1, 7], [2, 7], [1, 8], [2, 8]]) convert(block, placeHouse(block, x, y), Kind.Farm);
    expect(block.colonies[0].farmLinks).toBe(8);
    expect(block.colonies[0].farmLinks).toBe(countFarmLinks(block, 1));

    // Four farms that only touch diagonally or not at all.
    const scattered = stillBoard();
    scattered.colonies[0].gold = 1000;
    for (const [x, y] of [[1, 7], [2, 8], [6, 7], [8, 9]]) convert(scattered, placeHouse(scattered, x, y), Kind.Farm);
    expect(scattered.colonies[0].farmLinks).toBe(0);

    const blockIncome = goldPerSecond(block.colonies[0], tuning);
    const scatteredIncome = goldPerSecond(scattered.colonies[0], tuning);
    expect(blockIncome).toBeCloseTo(e.towerGoldPerSecond + 4 * e.farmGoldPerSecond + 8 * e.farmNeighbourBonus, 9);
    expect(scatteredIncome).toBeCloseTo(e.towerGoldPerSecond + 4 * e.farmGoldPerSecond, 9);
    expect(blockIncome).toBeGreaterThan(scatteredIncome);
  });

  it('reports what a new farm would add, counting the boost it gives its neighbours', () => {
    const s = stillBoard();
    const colony = s.colonies[0];
    colony.gold = 1000;
    convert(s, placeHouse(s, 1, 8), Kind.Farm);
    const next = placeHouse(s, 2, 8);
    const promised = farmYieldAt(s, tuning, next, 1);
    const before = goldPerSecond(colony, tuning);
    convert(s, next, Kind.Farm);
    // The house's own income is lost on top of what the farm brings.
    expect(goldPerSecond(colony, tuning) - before).toBeCloseTo(promised - tuning.economy.houseGoldPerSecond, 9);
  });

  it('research buildings accumulate science', () => {
    const s = stillBoard();
    const colony = s.colonies[0];
    colony.gold = 1000;
    convert(s, placeHouse(s, 0, 8), Kind.Research);
    convert(s, placeHouse(s, 1, 8), Kind.Research);
    run(s, 100);
    expect(colony.science).toBeCloseTo(2 * tuning.economy.researchSciencePerSecond * 10, 6);
  });

  it('keeps its running totals equal to a full recount through a long random match', () => {
    const s = newGame(4242);
    const dice = { rng: 99 };
    const kinds = [Kind.Wall, Kind.Farm, Kind.Farm, Kind.Research];
    for (let i = 0; i < 4000; i++) {
      step(s, tuning, []);
      if (i % 15 === 0) {
        for (const colony of s.colonies) {
          colony.gold = 1e6;
          const houses: number[] = [];
          for (let c = 0; c < s.kind.length; c++) if (s.owner[c] === colony.id && s.kind[c] === Kind.House) houses.push(c);
          if (houses.length > 3) convert(s, houses[nextInt(dice, houses.length)], kinds[nextInt(dice, kinds.length)], colony.id);
        }
      }
    }
    for (const colony of s.colonies) {
      let houses = 0;
      let buildings = 0;
      for (let c = 0; c < s.kind.length; c++) {
        if (s.owner[c] !== colony.id) continue;
        if (s.kind[c] === Kind.House) houses++;
        else if (s.kind[c] !== Kind.Tower) buildings++;
      }
      expect(colony.houses).toBe(houses);
      expect(colony.buildings).toBe(buildings);
      expect(colony.counts[Kind.Wall] + colony.counts[Kind.Farm] + colony.counts[Kind.Research]).toBe(buildings);
      expect(colony.farmLinks).toBe(countFarmLinks(s, colony.id));
      expect(colony.counts[Kind.Farm]).toBeGreaterThan(5);
    }
  });
});

describe('map generation', () => {
  it('places four 2x2 towers far apart on open ground', () => {
    for (const seed of [1, 2, 3, 42, 1000, 987654]) {
      const map = generateMap(seed, tuning, 4);
      const w = tuning.map.width;
      expect(map.towers.length).toBe(4);
      for (let i = 0; i < 4; i++) {
        const t = map.towers[i];
        for (const cell of [t, t + 1, t + w, t + w + 1]) expect(map.terrain[cell]).toBe(Terrain.Grass);
        for (let j = i + 1; j < 4; j++) {
          const ax = t % w;
          const ay = (t / w) | 0;
          const bx = map.towers[j] % w;
          const by = (map.towers[j] / w) | 0;
          expect(Math.hypot(ax - bx, ay - by)).toBeGreaterThanOrEqual(30);
        }
      }
    }
  });

  it('contains every terrain type in sensible amounts', () => {
    const map = generateMap(42, tuning, 4);
    const counts = [0, 0, 0, 0];
    for (const t of map.terrain) counts[t]++;
    const total = map.terrain.length;
    expect(counts[Terrain.Grass] / total).toBeGreaterThan(0.35);
    expect(counts[Terrain.Forest] / total).toBeGreaterThan(0.1);
    expect(counts[Terrain.Mountain] / total).toBeGreaterThan(0.03);
    expect(counts[Terrain.Water] / total).toBeGreaterThan(0.03);
  });
});

describe('maps', () => {
  it('every kind of map: all colonies can reach each other over open land, each has a flavour, and landmarks lie about', () => {
    for (const type of ['continent', 'highlands', 'rivers', 'lakes', 'endless'] as const) {
      for (const seed of [4, 9, 21, 33, 58]) {
        const s = createGame({ seed, model: 'local', colonies: 6, tuning, mapType: type });
        // Walk from the first tower over open land only: no mountains, no water.
        const seen = new Uint8Array(s.kind.length);
        const stack = [s.colonies[0].tower];
        seen[stack[0]] = 1;
        while (stack.length > 0) {
          const c = stack.pop() as number;
          for (let d = 0; d < 4; d++) {
            const n = neighbour(s, c, d);
            if (n < 0 || seen[n] || s.terrain[n] === Terrain.Water || s.terrain[n] === Terrain.Mountain) continue;
            seen[n] = 1;
            stack.push(n);
          }
        }
        for (const colony of s.colonies) expect(seen[colony.tower], `${type} ${seed}`).toBe(1);
        for (const colony of s.colonies) expect(['mountains', 'lake', 'forest', 'plains']).toContain(colony.flavour);
        const ruins = s.feature.filter((f) => f === 1).length;
        const treasure = s.feature.filter((f) => f === 2).length;
        expect(ruins).toBeGreaterThanOrEqual(6);
        expect(treasure).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('a city that grows onto Ancient Ruins gets a free discovery; onto Treasure, gold', () => {
    const s = createEmptyState(20, 20, 2, 'local');
    addColony(s, 9 * 20 + 9, tuning);
    const colony = s.colonies[0];
    // Every square next to the tower holds a landmark: whichever it grows onto first pays out.
    for (const c of [8 * 20 + 9, 8 * 20 + 10, 9 * 20 + 8, 10 * 20 + 8]) s.feature[c] = 1;
    for (const c of [11 * 20 + 9, 11 * 20 + 10, 9 * 20 + 11, 10 * 20 + 11]) s.feature[c] = 2;
    const gold = colony.gold;
    const events = run(s, 2000);
    const found = events.filter((e) => e.type === 'landmark');
    expect(found.length).toBeGreaterThan(0);
    const ruins = found.filter((e) => e.type === 'landmark' && e.feature === 1).length;
    const treasure = found.filter((e) => e.type === 'landmark' && e.feature === 2).length;
    expect(colony.drawsEarned + colony.pendingDraws + colony.picks.length).toBeGreaterThanOrEqual(ruins);
    expect(colony.gold - gold).toBeGreaterThanOrEqual(treasure * tuning.map.treasureGold);
    for (const e of found) if (e.type === 'landmark') expect(s.feature[e.cell]).toBe(0);
  });

  it('forest is slow to grow into but pays timber; mountains and water make houses richer', () => {
    expect(tuning.growth.forestMultiplier).toBeLessThan(1);
    expect(tuning.economy.lumberGold).toBeGreaterThan(0);
    const s = createEmptyState(20, 20, 2, 'local');
    addColony(s, 9 * 20 + 9, tuning);
    s.terrain[8 * 20 + 12] = Terrain.Mountain;
    placeHouse(s, 12, 9);
    run(s, 10);
    expect(s.colonies[0].terrainHouses).toBeGreaterThanOrEqual(1);
  });
});

describe('the map loops at its edges', () => {
  it('neighbours, offsets and distances wrap round on a looping map, and stop at the edge of a flat one', () => {
    const flat = createEmptyState(10, 8, 1, 'local');
    const loop = createEmptyState(10, 8, 1, 'local');
    loop.wrap = true;
    const corner = 0; // top-left
    expect(neighbour(flat, corner, 0)).toBe(-1);
    expect(neighbour(flat, corner, 3)).toBe(-1);
    expect(neighbour(loop, corner, 0)).toBe(7 * 10); // bottom-left
    expect(neighbour(loop, corner, 3)).toBe(9); // top-right
    expect(neighbour(loop, 79, 1)).toBe(70);
    expect(neighbour(loop, 79, 2)).toBe(9);
    expect(cellAt(loop, -1, -1)).toBe(79);
    expect(cellAt(flat, -1, 0)).toBe(-1);
    // The short way round: from x 9.5 to x 0.5 is one step right, not nine steps left.
    expect(deltaX(loop, 9.5, 0.5)).toBeCloseTo(1);
    expect(deltaX(flat, 9.5, 0.5)).toBeCloseTo(-9);
    expect(dist(loop, 0.5, 0.5, 9.5, 7.5)).toBeCloseTo(Math.SQRT2);
    expect(cellDist(loop, 0, 79)).toBeCloseTo(Math.SQRT2);
  });

  it('only the Endless World loops; the map grows with the number of colonies', () => {
    const four = createGame({ seed: 3, model: 'local', colonies: 4, tuning, mapType: 'endless' });
    const six = createGame({ seed: 3, model: 'local', colonies: 6, tuning });
    const eight = createGame({ seed: 3, model: 'local', colonies: 8, tuning });
    expect(four.wrap).toBe(true);
    for (const type of ['continent', 'highlands', 'rivers', 'lakes'] as const) expect(createGame({ seed: 3, model: 'local', colonies: 4, tuning, mapType: type }).wrap).toBe(false);
    expect(four.width).toBe(tuning.map.width);
    expect(six.width).toBeGreaterThan(four.width);
    expect(eight.width).toBeGreaterThan(six.width);
    for (const s of [four, six, eight]) expect(s.width % 16).toBe(0);
  });

  it('places any number of colonies on open land, well spread out', () => {
    for (const colonies of [2, 4, 6, 8]) {
      for (const seed of [1, 2, 3]) {
        const s = createGame({ seed, model: 'local', colonies, tuning });
        expect(s.colonies.length).toBe(colonies);
        let closest = Infinity;
        for (const a of s.colonies) {
          for (const c of a.towerCells) expect(s.terrain[c]).toBe(Terrain.Grass);
          for (const b of s.colonies) if (a !== b) closest = Math.min(closest, cellDist(s, a.tower, b.tower));
        }
        // Everyone gets room to grow before meeting a neighbour (a crowded continent of eight is the tightest).
        expect(closest).toBeGreaterThan(s.width / 7);
      }
    }
  });

  it('a city grows across the edge of the map and comes in at the other side', () => {
    const s = createEmptyState(32, 32, 5, 'local');
    s.wrap = true;
    addColony(s, 29 * 32 + 29, tuning); // tower in the bottom-right corner
    run(s, 3000);
    const own = (x: number, y: number) => s.owner[cellAt(s, x, y)] === 1;
    let wrapped = 0;
    for (let y = 0; y < 32; y++) if (own(0, y)) wrapped++;
    for (let x = 0; x < 32; x++) if (own(x, 0)) wrapped++;
    expect(wrapped).toBeGreaterThan(0);
  });

  it('units walk the short way round, across the edge', () => {
    const s = createEmptyState(40, 12, 7, 'local');
    s.wrap = true;
    addColony(s, 5 * 40 + 3, tuning); // own tower near the left edge
    addColony(s, 5 * 40 + 34, tuning); // enemy tower near the right edge: 7 squares away across it
    s.colonies[0].order = 2;
    const u = { id: s.nextUnitId++, owner: 1, type: 2, x: 2.5, y: 2.5, hp: 1000, home: -1, cooldown: 0, facing: 1 };
    s.units.push(u);
    s.navDirty = true;
    const start = dist(s, u.x, u.y, 35, 6);
    let crossed = false;
    for (let i = 0; i < 60; i++) {
      step(s, tuning, []);
      if (u.x > 30) crossed = true;
    }
    expect(crossed).toBe(true);
    expect(dist(s, u.x, u.y, 35, 6)).toBeLessThan(start);
  });
});
