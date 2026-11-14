import { describe, expect, it } from 'vitest';
import tuningJson from '../src/data/tuning.json';
import { chooseTarget, doctrineOf, militaryOrder } from '../src/sim/ai';
import { PRODUCERS } from '../src/sim/catalog';
import { countFarmLinks } from '../src/sim/economy';
import { damageCell, isActive, maxHealth } from '../src/sim/health';
import { passableFor, raidGoals, solidFor } from '../src/sim/nav';
import { applyCommand, step } from '../src/sim/sim';
import { addColony, createEmptyState, createGame, hashState, isGrowable, refreshAround } from '../src/sim/state';
import { Kind, Terrain, UnitType, type GameState, type SimEvent, type Tuning, type Unit } from '../src/sim/types';

const tuning = tuningJson as Tuning;

/** Same rules, but nothing grows, so a test board stays exactly as it was laid out. */
const calm: Tuning = structuredClone(tuning);
calm.growth.localEdgeRatePerSecond = 0;

const W = 30;
const H = 10;
const at = (x: number, y: number) => y * W + x;

/** A grass board with the player's tower on the left and an enemy tower on the right. */
function arena(): GameState {
  const s = createEmptyState(W, H, 11, 'local');
  addColony(s, at(3, 4), calm);
  addColony(s, at(24, 4), calm);
  return s;
}

function run(s: GameState, ticks: number, t: Tuning = calm): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) step(s, t, events);
  return events;
}

function placeHouse(s: GameState, x: number, y: number, owner: number): number {
  const c = at(x, y);
  s.kind[c] = Kind.House;
  s.owner[c] = owner;
  s.hp[c] = calm.health.house;
  s.vigor[c] = 1;
  s.colonies[owner - 1].houses++;
  refreshAround(s, c);
  s.navDirty = true;
  return c;
}

/** A finished building, placed directly. */
function placeBuilding(s: GameState, x: number, y: number, owner: number, kind: number): number {
  const c = at(x, y);
  const colony = s.colonies[owner - 1];
  s.kind[c] = kind;
  s.owner[c] = owner;
  s.hp[c] = maxHealth(calm, kind);
  s.readyTick[c] = 0;
  colony.buildings++;
  colony.counts[kind]++;
  if (kind === Kind.Crossbow || kind === Kind.Barracks || kind === Kind.Kennel) s.military.push(c);
  refreshAround(s, c);
  s.navDirty = true;
  return c;
}

function spawn(s: GameState, owner: number, type: number, x: number, y: number): Unit {
  const def = type === UnitType.Hound ? calm.units.hound : calm.units.shield;
  const unit: Unit = { id: s.nextUnitId++, owner, type, x, y, hp: def.hp, home: -1, cooldown: 0, facing: 1 };
  s.units.push(unit);
  s.navDirty = true;
  return unit;
}

function order(s: GameState, owner: number, target: number): boolean {
  return applyCommand(s, calm, { type: 'order', owner, target }, []);
}

/** Three finished barracks for the player; waits on Hold until all twelve shield units exist. */
function armyOfTwelve(s: GameState): void {
  placeBuilding(s, 6, 3, 1, Kind.Barracks);
  placeBuilding(s, 6, 4, 1, Kind.Barracks);
  placeBuilding(s, 6, 5, 1, Kind.Barracks);
  for (let i = 0; i < 3000 && s.units.length < 12; i++) step(s, calm, []);
  expect(s.units.length).toBe(12);
}

function ticksToDefeat(s: GameState, limit: number): number {
  for (let i = 0; i < limit; i++) {
    step(s, calm, []);
    if (!s.colonies[1].alive) return i + 1;
  }
  return Infinity;
}

describe('build-up time (D9)', () => {
  it('a new building starts weak, strengthens over time and is inactive until finished', () => {
    const s = arena();
    s.colonies[0].gold = 1000;
    const cell = placeHouse(s, 8, 2, 1);
    expect(applyCommand(s, calm, { type: 'convert', owner: 1, cell, to: Kind.Crossbow }, [])).toBe(true);
    const full = calm.health.crossbow;
    expect(s.hp[cell]).toBeCloseTo(full * calm.combat.buildStartHealth, 4);
    expect(isActive(s, cell)).toBe(false);
    run(s, 25);
    expect(s.hp[cell]).toBeGreaterThan(full * 0.5);
    expect(s.hp[cell]).toBeLessThan(full);
    expect(isActive(s, cell)).toBe(false);
    run(s, 26);
    expect(s.hp[cell]).toBeCloseTo(full, 2);
    expect(isActive(s, cell)).toBe(true);
  });

  it('an unfinished crossbow tower does not shoot', () => {
    const s = arena();
    s.colonies[1].gold = 1000;
    const cell = placeHouse(s, 20, 1, 2);
    applyCommand(s, calm, { type: 'convert', owner: 2, cell, to: Kind.Crossbow }, []);
    // A yard of the player's right beside it, so the hound on Hold stays put within range.
    placeBuilding(s, 18, 1, 1, Kind.Kennel);
    const hound = spawn(s, 1, UnitType.Hound, 18.5, 1.5);
    const early = run(s, 30);
    expect(early.some((e) => e.type === 'shot')).toBe(false);
    expect(hound.hp).toBe(calm.units.hound.hp);
    const later = run(s, 60);
    expect(later.some((e) => e.type === 'shot')).toBe(true);
  });
});

describe('unit production (D13)', () => {
  it('a barracks keeps exactly its cap of units alive and replaces losses for free', () => {
    const s = arena();
    const colony = s.colonies[0];
    colony.gold = 1000;
    const cell = placeHouse(s, 6, 4, 1);
    // The Shield Barracks has to be researched first.
    expect(applyCommand(s, calm, { type: 'convert', owner: 1, cell, to: Kind.Barracks }, [])).toBe(false);
    colony.unlocked.push(Kind.Barracks);
    expect(applyCommand(s, calm, { type: 'convert', owner: 1, cell, to: Kind.Barracks }, [])).toBe(true);
    const goldAfterBuying = colony.gold;
    run(s, 40);
    expect(s.units.length).toBe(0); // still under construction
    const cap = calm.units.shield.cap;
    run(s, Math.round((calm.combat.buildSeconds + cap * calm.units.shield.spawnSeconds + 5) * calm.tickRate));
    expect(s.units.length).toBe(cap);
    run(s, 600);
    expect(s.units.length).toBe(cap);
    // Units cost nothing: gold only went up from income.
    expect(colony.gold).toBeGreaterThan(goldAfterBuying);

    s.units[0].hp = 0;
    run(s, 1);
    expect(s.units.length).toBe(cap - 1);
    run(s, Math.round((calm.units.shield.spawnSeconds + 1) * calm.tickRate));
    expect(s.units.length).toBe(cap);
    expect(s.units.every((u) => u.type === UnitType.Shield && u.home === cell)).toBe(true);
  });

  it('a hound yard produces hounds', () => {
    const s = arena();
    placeBuilding(s, 6, 4, 1, Kind.Kennel);
    run(s, Math.round((calm.units.hound.cap * calm.units.hound.spawnSeconds + 5) * calm.tickRate));
    expect(s.units.length).toBe(calm.units.hound.cap);
    expect(s.units.every((u) => u.type === UnitType.Hound)).toBe(true);
  });
});

describe('the military order (D12)', () => {
  it('accepts Hold or a living enemy, and nothing else', () => {
    const s = arena();
    expect(order(s, 1, 1)).toBe(false); // itself
    expect(order(s, 1, 7)).toBe(false); // nobody
    expect(order(s, 1, 0)).toBe(false); // already holding
    expect(order(s, 1, 2)).toBe(true);
    expect(s.colonies[0].order).toBe(2);
    expect(order(s, 1, 2)).toBe(false); // no change
    expect(order(s, 1, 0)).toBe(true);
  });

  it('units on Hold gather at their barracks and never attack buildings', () => {
    const s = arena();
    placeBuilding(s, 6, 4, 1, Kind.Barracks);
    placeHouse(s, 15, 4, 2);
    const unit = spawn(s, 1, UnitType.Shield, 14.5, 4.5);
    const events = run(s, 400);
    expect(Math.hypot(unit.x - 6.5, unit.y - 4.5)).toBeLessThan(2.5);
    expect(events.some((e) => e.type === 'hit' || e.type === 'destroy')).toBe(false);
  });
});

describe('movement through squares (D11)', () => {
  it('own squares are open, walls included; enemy squares are solid', () => {
    const s = arena();
    const mine = placeBuilding(s, 10, 4, 1, Kind.Wall);
    const theirs = placeBuilding(s, 12, 4, 2, Kind.Wall);
    expect(passableFor(s, mine, 1)).toBe(true);
    expect(solidFor(s, mine, 1)).toBe(false);
    expect(passableFor(s, theirs, 1)).toBe(false);
    expect(solidFor(s, theirs, 1)).toBe(true);
    expect(passableFor(s, at(11, 4), 1)).toBe(true); // empty ground
  });

  it('a unit walks home straight through its own wall line', () => {
    const s = arena();
    placeBuilding(s, 6, 4, 1, Kind.Barracks);
    for (let y = 0; y < H; y++) placeBuilding(s, 10, y, 1, Kind.Wall);
    const unit = spawn(s, 1, UnitType.Shield, 16.5, 4.5);
    run(s, 300);
    expect(unit.x).toBeLessThan(9);
  });

  it('an enemy wall line across the whole map has to be broken to get through', () => {
    const s = arena();
    for (let y = 0; y < H; y++) placeBuilding(s, 15, y, 2, Kind.Wall);
    const unit = spawn(s, 1, UnitType.Shield, 10.5, 4.5);
    order(s, 1, 2);
    const events = run(s, 100);
    expect(unit.x).toBeLessThan(15); // still on the near side
    expect(events.some((e) => e.type === 'hit' && e.cell % W === 15)).toBe(true);
  });
});

describe('attacking (D11, D14, D15)', () => {
  it('twelve shield units destroy an undefended tower, and the colony falls with it', () => {
    const s = arena();
    const enemyHouse = placeHouse(s, 26, 6, 2);
    armyOfTwelve(s);
    order(s, 1, 2);
    const events: SimEvent[] = [];
    for (let i = 0; i < 4000 && s.colonies[1].alive; i++) step(s, calm, events);

    const enemy = s.colonies[1];
    expect(enemy.alive).toBe(false);
    expect(events.some((e) => e.type === 'defeat' && e.owner === 2)).toBe(true);
    expect(events.some((e) => e.type === 'shot' && e.owner === 2)).toBe(true); // the tower fought back
    // D16: every square of the fallen colony is rubble, and the attackers stand down.
    for (const cell of [...enemy.towerCells, enemyHouse]) {
      expect(s.kind[cell]).toBe(Kind.Rubble);
      expect(s.owner[cell]).toBe(0);
    }
    expect(s.colonies[0].order).toBe(0);
    expect(order(s, 1, 2)).toBe(false);

    // The rubble clears and the land is open again.
    run(s, Math.round(calm.combat.defeatRubbleSeconds * calm.tickRate) + 2);
    expect(s.kind[enemyHouse]).toBe(Kind.Empty);
    expect(isGrowable(s, enemyHouse)).toBe(true);
  });

  it('walls around the tower measurably slow the same attack down', () => {
    const open = arena();
    armyOfTwelve(open);
    order(open, 1, 2);
    const openTicks = ticksToDefeat(open, 6000);

    const walled = arena();
    for (const cell of walled.colonies[1].towerCells) {
      for (const n of [cell - W, cell + 1, cell + W, cell - 1]) {
        if (walled.kind[n] === Kind.Empty) placeBuilding(walled, n % W, (n / W) | 0, 2, Kind.Wall);
      }
    }
    armyOfTwelve(walled);
    order(walled, 1, 2);
    const walledTicks = ticksToDefeat(walled, 6000);

    expect(openTicks).toBeLessThan(Infinity);
    expect(walledTicks).toBeGreaterThan(openTicks + 15);
  });

  it('crossbow towers measurably slow the same attack down', () => {
    const open = arena();
    armyOfTwelve(open);
    order(open, 1, 2);
    const openTicks = ticksToDefeat(open, 6000);

    const guarded = arena();
    for (const [x, y] of [[22, 3], [22, 6], [27, 3], [27, 6]]) placeBuilding(guarded, x, y, 2, Kind.Crossbow);
    armyOfTwelve(guarded);
    order(guarded, 1, 2);
    const guardedTicks = ticksToDefeat(guarded, 6000);

    expect(guardedTicks).toBeGreaterThan(openTicks + 15);
  });

  it('the Center Tower stops a rush of six hounds by itself', () => {
    const s = arena();
    for (let i = 0; i < 6; i++) spawn(s, 1, UnitType.Hound, 18.5, 2.5 + i * 0.8);
    order(s, 1, 2);
    run(s, 600);
    expect(s.units.length).toBe(0);
    expect(s.colonies[1].alive).toBe(true);
    expect(s.colonies[1].towerHp).toBeGreaterThan(calm.health.tower * 0.5);
  });

  it('hounds go for houses the defences cannot reach', () => {
    const s = arena();
    const guarded = placeHouse(s, 23, 4, 2); // right beside the tower
    const exposed = placeHouse(s, 16, 8, 2); // far outside its range
    expect(raidGoals(s, calm, 2)).toEqual([exposed]);
    spawn(s, 1, UnitType.Hound, 10.5, 4.5);
    order(s, 1, 2);
    for (let i = 0; i < 600 && s.kind[exposed] === Kind.House; i++) step(s, calm, []);
    expect(s.kind[exposed]).toBe(Kind.Rubble);
    expect(s.kind[guarded]).toBe(Kind.House);
  });

  it('units fight enemy units that come near', () => {
    const s = arena();
    const shield = spawn(s, 1, UnitType.Shield, 12.5, 4.5);
    spawn(s, 2, UnitType.Hound, 14.5, 4.5);
    const events = run(s, 200);
    expect(events.some((e) => e.type === 'unitDied' && e.owner === 2)).toBe(true);
    expect(s.units).toEqual([shield]);
    expect(shield.hp).toBeLessThan(calm.units.shield.hp);
  });
});

describe('units do not get stuck', () => {
  it('enemies on opposite sides of water do not stand and stare: each carries on with its order', () => {
    const s = arena();
    // A lake two squares wide between them, open ground above and below it.
    for (let y = 2; y <= 7; y++) for (const x of [14, 15]) s.terrain[at(x, y)] = Terrain.Water;
    placeBuilding(s, 6, 4, 1, Kind.Barracks);
    const mine = spawn(s, 1, UnitType.Shield, 13.5, 4.5);
    const theirs = spawn(s, 2, UnitType.Shield, 16.5, 4.5);
    order(s, 2, 1);
    const start = theirs.x;
    run(s, 150);
    // The attacker went around the lake instead of pressing against it.
    expect(Math.hypot(theirs.x - start, theirs.y - 4.5)).toBeGreaterThan(2);
    // The defender headed home instead of pressing against it.
    expect(mine.x).toBeLessThan(12);
  });

  it('a unit slides around the corner of an enemy square to reach an enemy unit', () => {
    const s = arena();
    placeBuilding(s, 12, 4, 2, Kind.Wall);
    // The foe is diagonally across the wall's corner.
    const hunter = spawn(s, 1, UnitType.Shield, 11.5, 4.5);
    const prey = spawn(s, 2, UnitType.Hound, 12.6, 5.6);
    prey.hp = 1000; // keeps it alive and in place long enough to be reached
    const before = Math.hypot(prey.x - hunter.x, prey.y - hunter.y);
    for (let i = 0; i < 40; i++) {
      step(s, calm, []);
      prey.x = 12.6;
      prey.y = 5.6;
    }
    expect(Math.hypot(prey.x - hunter.x, prey.y - hunter.y)).toBeLessThan(Math.min(before, calm.combat.meleeRange + 0.1));
  });
});

describe('destruction and rubble (D4)', () => {
  it('a destroyed square becomes rubble that nothing can grow on, then clears', () => {
    const s = arena();
    const cell = placeHouse(s, 5, 4, 1);
    const events: SimEvent[] = [];
    expect(damageCell(s, calm, cell, 5, events)).toBe(false);
    expect(s.kind[cell]).toBe(Kind.House);
    expect(damageCell(s, calm, cell, 500, events)).toBe(true);
    expect(s.kind[cell]).toBe(Kind.Rubble);
    expect(s.owner[cell]).toBe(0);
    expect(s.colonies[0].houses).toBe(0);
    expect(isGrowable(s, cell)).toBe(false);
    expect(passableFor(s, cell, 2)).toBe(true);

    const waiting = run(s, Math.round(calm.combat.rubbleSeconds * calm.tickRate) - 2);
    expect(s.kind[cell]).toBe(Kind.Rubble);
    expect(waiting.some((e) => e.type === 'clear')).toBe(false);
    const after = run(s, 4);
    expect(s.kind[cell]).toBe(Kind.Empty);
    expect(after.some((e) => e.type === 'clear' && e.cell === cell)).toBe(true);
    expect(isGrowable(s, cell)).toBe(true);
  });

  it('with growth on, the city grows back over cleared rubble but not before', () => {
    const s = arena();
    const cell = at(5, 4); // touches the player's tower
    placeHouse(s, 5, 4, 1);
    damageCell(s, tuning, cell, 500, []);
    const rubbleTicks = Math.round(tuning.combat.rubbleSeconds * tuning.tickRate);
    for (let i = 0; i < rubbleTicks - 1; i++) {
      step(s, tuning, []);
      expect(s.kind[cell]).toBe(Kind.Rubble);
    }
    run(s, 6000, tuning);
    expect(s.kind[cell]).toBe(Kind.House);
    expect(s.owner[cell]).toBe(1);
  });

  it('keeps the farm links right when a farm in a block is destroyed', () => {
    const s = arena();
    const colony = s.colonies[0];
    // A row of three farms: the middle one links to both ends.
    placeBuilding(s, 9, 2, 1, Kind.Farm);
    const middle = placeBuilding(s, 10, 2, 1, Kind.Farm);
    placeBuilding(s, 11, 2, 1, Kind.Farm);
    colony.farmLinks = countFarmLinks(s, 1);
    expect(colony.farmLinks).toBe(4);

    damageCell(s, calm, middle, 500, []);
    expect(colony.farmLinks).toBe(0); // the two ends no longer touch anything
    expect(colony.farmLinks).toBe(countFarmLinks(s, 1));
    expect(colony.counts[Kind.Farm]).toBe(2);
    expect(colony.buildings).toBe(2);
  });

  it('a barracks that is destroyed stops replacing its units, which fight on', () => {
    const s = arena();
    const cell = placeBuilding(s, 6, 4, 1, Kind.Barracks);
    run(s, Math.round((calm.units.shield.cap * calm.units.shield.spawnSeconds + 5) * calm.tickRate));
    expect(s.units.length).toBe(calm.units.shield.cap);
    damageCell(s, calm, cell, 5000, []);
    expect(s.military.length).toBe(0);
    expect(s.units.every((u) => u.home === -1)).toBe(true);
    s.units[0].hp = 0;
    run(s, 400);
    expect(s.units.length).toBe(calm.units.shield.cap - 1);
  });
});

describe('attackers spread out', () => {
  it('a pack of hounds raids several houses at once instead of piling onto one', () => {
    const s = arena();
    // A row of exposed enemy houses far from the tower.
    const houses = [10, 11, 12, 13, 14, 15].map((x) => placeHouse(s, x, 8, 2));
    for (let i = 0; i < 6; i++) spawn(s, 1, UnitType.Hound, 9.5 + i * 0.1, 6.5);
    order(s, 1, 2);
    const events: SimEvent[] = [];
    const struck = new Set<number>();
    for (let i = 0; i < 400 && !events.some((e) => e.type === 'destroy'); i++) {
      step(s, calm, events);
      for (const e of events) if (e.type === 'hit') struck.add(e.cell);
    }
    // Before the first house fell, at least three different houses were under attack.
    expect(struck.size).toBeGreaterThanOrEqual(3);
    for (const cell of struck) expect(houses).toContain(cell);
  });

  it('never puts more hounds on a house than it needs', () => {
    const s = arena();
    const houses = [10, 11, 12, 13, 14, 15].map((x) => placeHouse(s, x, 8, 2));
    for (let i = 0; i < 6; i++) spawn(s, 1, UnitType.Hound, 9.5 + i * 0.1, 6.5);
    order(s, 1, 2);
    // A house (20 health) needs two hounds (2 damage a bite): count bites per house per tick.
    // (Once the houses are gone the pack moves on to the tower, which is big enough for everyone.)
    let worst = 0;
    for (let i = 0; i < 300; i++) {
      const events: SimEvent[] = [];
      step(s, calm, events);
      const perCell = new Map<number, number>();
      for (const e of events) if (e.type === 'hit' && houses.includes(e.cell)) perCell.set(e.cell, (perCell.get(e.cell) ?? 0) + 1);
      for (const n of perCell.values()) worst = Math.max(worst, n);
    }
    expect(worst).toBeLessThanOrEqual(2);
  });

  it('shield units still mass on the tower itself', () => {
    const s = arena();
    armyOfTwelve(s);
    order(s, 1, 2);
    // Every shield unit that reaches the tower joins in: count how many different ones strike it.
    const tower = s.colonies[1].towerCells;
    const strikers = new Set<number>();
    for (let i = 0; i < 4000 && s.colonies[1].alive; i++) {
      const events: SimEvent[] = [];
      step(s, calm, events);
      for (const e of events) {
        if (e.type === 'strike' && tower.includes(Math.floor(e.ty) * W + Math.floor(e.tx))) strikers.add(e.id);
      }
    }
    expect(s.colonies[1].alive).toBe(false);
    expect(strikers.size).toBeGreaterThanOrEqual(6);
  });
});

describe('the builder AI', () => {
  const play = (seed: number) => {
    // Attacks are off here so these tests look at building alone.
    const s = createGame({ seed, model: 'local', colonies: 4, tuning, bots: [2, 3, 4], aiAttacks: false });
    for (let i = 0; i < 7200; i++) step(s, tuning, []);
    return s;
  };

  it('builds an economy of grouped farms, defences and an army, and keeps most squares as houses', () => {
    const s = play(2026);
    for (const id of [2, 3, 4]) {
      const colony = s.colonies[id - 1];
      const farms = colony.counts[Kind.Farm];
      expect(farms).toBeGreaterThanOrEqual(10);
      // Grouped: on average every farm touches at least two other farms.
      expect(colony.farmLinks / farms).toBeGreaterThanOrEqual(2);
      expect(colony.counts[Kind.Crossbow]).toBeGreaterThanOrEqual(3);
      expect(PRODUCERS.reduce((n, k) => n + colony.counts[k], 0)).toBeGreaterThanOrEqual(1);
      expect(colony.counts[Kind.Wall] + colony.counts[Kind.Bastion]).toBeGreaterThanOrEqual(8);
      expect(colony.houses / (colony.houses + colony.buildings)).toBeGreaterThanOrEqual(tuning.ai.minHouseShare - 0.05);
      expect(s.units.some((u) => u.owner === id)).toBe(true);
      expect(colony.order).toBe(0); // attacks are switched off in this test
    }
    expect(s.colonies[0].buildings).toBe(0); // the player's colony is never touched
  }, 300000);

  it('converts interior houses for its economy, so it does not choke its own growth', () => {
    const withAi = play(77);
    const without = createGame({ seed: 77, model: 'local', colonies: 4, tuning });
    for (let i = 0; i < 7200; i++) step(without, tuning, []);
    for (const id of [2, 3, 4]) {
      const a = withAi.colonies[id - 1];
      const b = without.colonies[id - 1];
      // Total squares stay close to what the colony reaches when it converts nothing at all.
      expect(a.houses + a.buildings).toBeGreaterThan((b.houses + b.buildings) * 0.8);
    }
  }, 300000);

  it('pays for everything: it never goes into debt', () => {
    const s = createGame({ seed: 9, model: 'local', colonies: 4, tuning, bots: [2, 3, 4] });
    for (let i = 0; i < 4000; i++) {
      step(s, tuning, []);
      for (const colony of s.colonies) expect(colony.gold).toBeGreaterThanOrEqual(0);
    }
  }, 300000);
});

describe('stone, hold and grudges', () => {
  it('mountains stop ground units, but a sapper blasts a way through', () => {
    const s = arena();
    const rock = 6 * W + 20;
    s.terrain[rock] = Terrain.Mountain;
    expect(passableFor(s, rock, 1)).toBe(false);
    // A wall of rock across the whole arena between the sapper and the enemy.
    for (let y = 0; y < s.height; y++) s.terrain[y * W + 20] = Terrain.Mountain;
    s.colonies[0].order = 2;
    spawn(s, 1, UnitType.Sapper, 18.5, 6.5);
    const events: SimEvent[] = [];
    for (let i = 0; i < 200; i++) step(s, calm, events);
    expect(events.some((e) => e.type === 'terrain')).toBe(true);
    let open = 0;
    for (let y = 0; y < s.height; y++) if (s.terrain[y * W + 20] !== Terrain.Mountain) open++;
    expect(open).toBeGreaterThan(0);
  });

  it('on Hold, units go out to fight intruders anywhere on their land', () => {
    const s = arena();
    // A row of houses far from the barracks, and an intruder chewing on it.
    for (let x = 4; x < 16; x++) placeHouse(s, x, 8, 1);
    const defender = spawn(s, 1, UnitType.Warrior, 4.5, 2.5);
    const intruder = spawn(s, 2, UnitType.Warrior, 15.5, 7.5);
    intruder.hp = 1000;
    s.colonies[0].order = 0;
    const start = Math.hypot(defender.x - 15.5, defender.y - 7.5);
    for (let i = 0; i < 40; i++) {
      step(s, calm, []);
      // The intruder stays put, chewing on the houses.
      intruder.x = 15.5;
      intruder.y = 7.5;
    }
    expect(Math.hypot(defender.x - 15.5, defender.y - 7.5)).toBeLessThan(start - 2);
  });

  it('on Hold, units also go out to meet enemies closing in, a few squares off their land', () => {
    const s = arena();
    for (let x = 4; x < 16; x++) placeHouse(s, x, 8, 1);
    const defender = spawn(s, 1, UnitType.Warrior, 4.5, 2.5);
    // Three squares from the nearest house, and nowhere near the defender.
    const lurker = spawn(s, 2, UnitType.Warrior, 18.5, 5.5);
    lurker.hp = 1000;
    s.colonies[0].order = 0;
    const start = Math.hypot(defender.x - 18.5, defender.y - 5.5);
    for (let i = 0; i < 40; i++) {
      step(s, calm, []);
      lurker.x = 18.5;
      lurker.y = 5.5;
    }
    expect(Math.hypot(defender.x - 18.5, defender.y - 5.5)).toBeLessThan(start - 2);
  });

  it('rivals hit back at whoever is attacking them', () => {
    const s = createGame({ seed: 12, model: 'local', colonies: 5, tuning, bots: [2, 3, 4, 5] });
    const rival = s.colonies[1];
    // Colony 4 is attacking our rival: the rival should pick it as its target.
    s.colonies[3].order = rival.id;
    s.tick = 2000;
    militaryOrder(s, calm, rival);
    expect(rival.grudge).toBe(4);
    expect(chooseTarget(s, calm, rival, 0, rival.grudge)).toBe(4);
  });

  it('a discovery card can be traded for faster city growth instead', () => {
    const s = createGame({ seed: 12, model: 'local', colonies: 2, tuning });
    const colony = s.colonies[0];
    colony.offer = ['ballista', 'flame'];
    colony.pendingDraws = 1;
    expect(applyCommand(s, calm, { type: 'research', owner: 1, choice: 2 }, [])).toBe(true);
    expect(colony.mods.growth).toBeCloseTo(1 + calm.research.growthChoice);
    expect(colony.picks.length).toBe(0); // not a discovery: no step towards the next age
    expect(colony.offer).toBeNull();
  });
});

describe('plunder', () => {
  it("whoever takes a tower shares half its colony's gold; bystanders get nothing", () => {
    const s = createEmptyState(40, 12, 3, 'local');
    addColony(s, 5 * 40 + 2, calm);
    addColony(s, 5 * 40 + 20, calm);
    addColony(s, 5 * 40 + 36, calm);
    const [a, victim, c] = s.colonies;
    a.gold = 0;
    c.gold = 0;
    victim.gold = 400;
    // Only the first colony is attacking the victim.
    a.order = victim.id;
    const events: SimEvent[] = [];
    damageCell(s, calm, victim.tower, victim.towerHp + 1, events);
    const defeat = events.find((e) => e.type === 'defeat');
    expect(defeat).toMatchObject({ owner: victim.id, by: [a.id], plunder: 400 * calm.combat.plunderShare });
    expect(a.gold).toBeCloseTo(400 * calm.combat.plunderShare);
    expect(c.gold).toBe(0);
    expect(victim.gold).toBe(0);
    expect(a.order).toBe(0);
  });
});

describe('the AI at war', () => {
  /** A real match where the player does nothing. Returns every order the AI gave, with its tick. */
  const war = (seed: number, ticks: number, aiAttacks = true) => {
    const s = createGame({ seed, model: 'local', colonies: 4, tuning, bots: [2, 3, 4], aiAttacks });
    const orders: Array<{ tick: number; owner: number; target: number }> = [];
    let hits = 0;
    for (let i = 0; i < ticks; i++) {
      const events: SimEvent[] = [];
      step(s, tuning, events);
      for (const e of events) {
        if (e.type === 'order') orders.push({ tick: s.tick, owner: e.owner, target: e.target });
        else if (e.type === 'hit') hits++;
      }
    }
    return { s, orders, hits };
  };

  it('gathers an army first, then attacks, and real fighting follows', () => {
    const { s, orders, hits } = war(2026, 9000);
    const attacks = orders.filter((o) => o.target !== 0);
    expect(attacks.length).toBeGreaterThan(0);
    // Never before the short grace period is over; after it, whenever an army is ready.
    for (const o of attacks) expect(o.tick).toBeGreaterThanOrEqual(tuning.ai.graceSeconds * tuning.ai.levelAttackDelay[s.aiLevel] * tuning.tickRate);
    void doctrineOf;
    // Nobody attacks themselves or a colony that does not exist.
    for (const o of attacks) {
      expect(o.target).not.toBe(o.owner);
      expect(o.target).toBeGreaterThanOrEqual(1);
      expect(o.target).toBeLessThanOrEqual(4);
    }
    expect(hits).toBeGreaterThan(50);
  }, 300000);

  it('never attacks when attacks are switched off', () => {
    const { orders, hits } = war(2026, 6000, false);
    expect(orders.length).toBe(0);
    expect(hits).toBe(0);
  }, 300000);

  it('retreats to regroup once most of the army it set out with is gone', () => {
    const s = arena();
    s.bots = [2];
    const colony = s.colonies[1];
    placeBuilding(s, 22, 2, 2, Kind.Barracks);
    colony.order = 1;
    colony.launchStrength = 30;
    spawn(s, 2, UnitType.Shield, 20.5, 2.5); // strength 3 of the 30 it launched with
    expect(militaryOrder(s, calm, colony)).toEqual({ type: 'order', owner: 2, target: 0 });
    // With most of its army intact it presses on.
    for (let i = 0; i < 6; i++) spawn(s, 2, UnitType.Shield, 20.5, 2.5);
    expect(militaryOrder(s, calm, colony)).toBeNull();
  });

  it('calls its army home when enemy units mass near its tower', () => {
    const s = arena();
    const colony = s.colonies[1];
    colony.order = 1;
    colony.launchStrength = 9;
    for (let i = 0; i < 3; i++) spawn(s, 2, UnitType.Shield, 12.5, 4.5);
    expect(militaryOrder(s, calm, colony)).toBeNull();
    for (let i = 0; i < calm.ai.recallThreat; i++) spawn(s, 1, UnitType.Hound, 22.5, 6.5);
    expect(militaryOrder(s, calm, colony)).toEqual({ type: 'order', owner: 2, target: 0 });
  });

  it('waits on Hold until its army is nearly as big as its buildings allow', () => {
    const s = arena();
    const colony = s.colonies[1];
    s.tick = doctrineOf(colony).attackAfter * calm.ai.levelAttackDelay[s.aiLevel] * calm.tickRate + 1;
    // The target has some towers, so a half-built army does not outnumber it.
    placeBuilding(s, 4, 2, 1, Kind.Crossbow);
    placeBuilding(s, 4, 7, 1, Kind.Crossbow);
    placeBuilding(s, 22, 2, 2, Kind.Barracks);
    placeBuilding(s, 22, 7, 2, Kind.Barracks); // room for 8 shield units = strength 24
    for (let i = 0; i < 4; i++) spawn(s, 2, UnitType.Shield, 22.5, 2.5);
    expect(militaryOrder(s, calm, colony)).toBeNull(); // 12 of 24: not ready
    for (let i = 0; i < 3; i++) spawn(s, 2, UnitType.Shield, 22.5, 7.5);
    expect(militaryOrder(s, calm, colony)).toEqual({ type: 'order', owner: 2, target: 1 }); // 21 of 24
    expect(colony.launchStrength).toBe(21);
  });

  it('sets out early against a target it badly outnumbers', () => {
    const s = arena();
    const colony = s.colonies[1];
    s.tick = doctrineOf(colony).attackAfter * calm.ai.levelAttackDelay[s.aiLevel] * calm.tickRate + 1;
    placeBuilding(s, 22, 2, 2, Kind.Barracks);
    placeBuilding(s, 22, 7, 2, Kind.Barracks);
    // 15 of 24, short of ready, but the target has no towers and no army at all.
    for (let i = 0; i < 5; i++) spawn(s, 2, UnitType.Shield, 22.5, 2.5);
    expect(militaryOrder(s, calm, colony)).toEqual({ type: 'order', owner: 2, target: 1 });
  });

  it('prefers a weakly defended neighbour, and turns on whoever is attacking it', () => {
    // Three colonies in a row: 2 sits in the middle, the same distance from 1 and 3.
    const s = createEmptyState(40, 10, 3, 'local');
    addColony(s, at(4, 4), calm);
    addColony(s, at(19, 4), calm);
    addColony(s, at(34, 4), calm);
    const fortify = (x: number, y: number, owner: number) => {
      const c = y * 40 + x;
      s.kind[c] = Kind.Crossbow;
      s.owner[c] = owner;
      s.colonies[owner - 1].counts[Kind.Crossbow]++;
    };
    for (let i = 0; i < 6; i++) fortify(30 + i, 1, 3);
    // Colony 3 is fortified, colony 1 is not: pick 1, whatever the dice say.
    for (let roll = 0; roll < 20; roll++) expect(chooseTarget(s, calm, s.colonies[1], 0)).toBe(1);
    // But if colony 3 is the one attacking, strike back at 3.
    for (let roll = 0; roll < 20; roll++) expect(chooseTarget(s, calm, s.colonies[1], 3)).toBe(3);
  });
});

describe('determinism with combat', () => {
  it('replays a whole war identically', () => {
    const play = () => {
      const s = createGame({ seed: 555, model: 'local', colonies: 4, tuning, bots: [2, 3, 4] });
      const events: SimEvent[] = [];
      for (let i = 0; i < 5000; i++) {
        step(s, tuning, events);
        if (i === 900 || i === 1300 || i === 1700) {
          s.colonies[0].gold += 300;
          const house = s.owner.findIndex((o, c) => o === 1 && s.kind[c] === Kind.House);
          applyCommand(s, tuning, { type: 'convert', owner: 1, cell: house, to: Kind.Camp }, events);
        }
        if (i === 2600) applyCommand(s, tuning, { type: 'order', owner: 1, target: 2 }, events);
      }
      return { hash: hashState(s), hits: events.filter((e) => e.type === 'hit').length, units: s.units.length };
    };
    const a = play();
    const b = play();
    expect(a).toEqual(b);
    expect(a.hits).toBeGreaterThan(0); // the war actually happened
  }, 300000);
});
