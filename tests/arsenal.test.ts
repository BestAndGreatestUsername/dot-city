// The buildings research unlocks: towers, money and science buildings, and the army.

import { describe, expect, it } from 'vitest';
import tuningJson from '../src/data/tuning.json';
import { CATALOG_KEY, isLocked, PRODUCERS, PRODUCES, UNLOCK_KEY, unitTuning } from '../src/sim/catalog';
import { buildingYield, goldPerSecond, sciencePerSecond } from '../src/sim/economy';
import { damageCell, maxHealthAt } from '../src/sim/health';
import { nextThreshold, RESEARCH } from '../src/sim/research';
import { applyCommand, step } from '../src/sim/sim';
import { addColony, createEmptyState, createGame, refreshAround } from '../src/sim/state';
import { stepDefences } from '../src/sim/towers';
import { Kind, Terrain, UnitType, type GameState, type SimEvent, type Tuning, type Unit } from '../src/sim/types';

const tuning = tuningJson as Tuning;
const calm: Tuning = structuredClone(tuning);
calm.growth.localEdgeRatePerSecond = 0;

const W = 40;
const H = 12;
const at = (x: number, y: number) => y * W + x;

/** Player's tower at the far left, enemy's at the far right: the middle is out of both towers' reach. */
function board(): GameState {
  const s = createEmptyState(W, H, 33, 'local');
  addColony(s, at(1, 5), calm);
  addColony(s, at(37, 5), calm);
  return s;
}

function place(s: GameState, x: number, y: number, owner: number, kind: number): number {
  const c = at(x, y);
  const colony = s.colonies[owner - 1];
  s.kind[c] = kind;
  s.owner[c] = owner;
  if (kind === Kind.House) colony.houses++;
  else {
    colony.buildings++;
    colony.counts[kind]++;
    if (!colony.unlocked.includes(kind)) colony.unlocked.push(kind);
    if (PRODUCERS.includes(kind) || kind >= Kind.Ballista || kind === Kind.Crossbow) s.military.push(c);
  }
  s.hp[c] = maxHealthAt(s, calm, c);
  s.vigor[c] = 1;
  refreshAround(s, c);
  s.navDirty = true;
  return c;
}

function unit(s: GameState, owner: number, type: number, x: number, y: number, hp?: number): Unit {
  const u: Unit = { id: s.nextUnitId++, owner, type, x, y, hp: hp ?? unitTuning(calm, type).hp, home: -1, cooldown: 0, facing: 1 };
  s.units.push(u);
  s.navDirty = true;
  return u;
}

/** Run only the towers, for `ticks` ticks: units stand still, so damage is easy to measure. */
function defend(s: GameState, ticks: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    stepDefences(s, calm, events);
    s.tick++;
  }
  return events;
}

function run(s: GameState, ticks: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) step(s, calm, events);
  return events;
}

describe('the catalog', () => {
  it('every unlockable building has tuning, a research option, and a price', () => {
    for (const [kind, key] of Object.entries(UNLOCK_KEY)) {
      const option = RESEARCH.find((o) => o.unlock === key);
      expect(option, key).toBeDefined();
      if (Number(kind) !== Kind.Barracks && Number(kind) !== Kind.Kennel) expect(calm.unlockables[key], key).toBeDefined();
    }
    for (const key of Object.values(CATALOG_KEY)) expect(calm.unlockables[key].cost, key).toBeGreaterThan(0);
    // Every army building raises a unit type that has tuning.
    for (const kind of PRODUCERS) expect(unitTuning(calm, PRODUCES[kind]).hp).toBeGreaterThan(0);
    // There are lots of them: at least 8 towers and 10 unit types.
    expect(PRODUCERS.length).toBeGreaterThanOrEqual(10);
  });

  it('a colony starts with the Warrior Camp but not the Shield Barracks, Hound Yard or anything researched', () => {
    const s = board();
    const colony = s.colonies[0];
    expect(isLocked(colony, Kind.Camp)).toBe(false);
    expect(isLocked(colony, Kind.Crossbow)).toBe(false);
    for (const kind of Object.keys(UNLOCK_KEY).map(Number)) expect(isLocked(colony, kind)).toBe(true);
  });

  it('farms are free and fragile; alone a farm earns less than a house, in a full block twice as much', () => {
    const s = board();
    const colony = s.colonies[0];
    colony.gold = 0;
    const cell = place(s, 10, 5, 1, Kind.House);
    expect(applyCommand(s, calm, { type: 'convert', owner: 1, cell, to: Kind.Farm }, [])).toBe(true);
    expect(colony.gold).toBe(0);
    expect(calm.health.farm).toBeLessThan(calm.health.house);
    const e = calm.economy;
    expect(e.farmGoldPerSecond).toBeLessThan(e.houseGoldPerSecond);
    expect(e.farmGoldPerSecond + 4 * e.farmNeighbourBonus).toBeCloseTo(2 * e.houseGoldPerSecond);
  });

  it('units on the attack go a little out of their way to trample enemy farms, but not far', () => {
    const s = board();
    s.colonies[0].order = 2;
    const near = place(s, 16, 7, 2, Kind.Farm); // two squares off the road
    const far = place(s, 16, 11, 2, Kind.Farm); // well off it
    unit(s, 1, UnitType.Warrior, 14.5, 5.5);
    run(s, 60);
    expect(s.kind[near]).not.toBe(Kind.Farm);
    expect(s.kind[far]).toBe(Kind.Farm);
  });

  it('a locked building cannot be built; taking its research unlocks it', () => {
    const s = board();
    const colony = s.colonies[0];
    colony.gold = 1000;
    const cell = place(s, 10, 5, 1, Kind.House);
    expect(applyCommand(s, calm, { type: 'convert', owner: 1, cell, to: Kind.Cannon }, [])).toBe(false);
    colony.offer = ['cannon'];
    colony.pendingDraws = 1;
    expect(applyCommand(s, calm, { type: 'research', owner: 1, choice: 0 }, [])).toBe(true);
    expect(isLocked(colony, Kind.Cannon)).toBe(false);
    expect(applyCommand(s, calm, { type: 'convert', owner: 1, cell, to: Kind.Cannon }, [])).toBe(true);
    expect(colony.gold).toBe(1000 - calm.unlockables.cannon.cost);
  });

});

describe('towers', () => {
  it('the Ballista outranges the Crossbow and picks the toughest target', () => {
    const s = board();
    place(s, 10, 5, 1, Kind.Ballista);
    const weak = unit(s, 2, UnitType.Hound, 16.5, 5.5, 10);
    const tough = unit(s, 2, UnitType.Knight, 17.5, 5.5, 500); // 7 squares away: beyond any crossbow
    const events = defend(s, 5);
    expect(events.some((e) => e.type === 'shot' && e.style === 'ballista')).toBe(true);
    expect(tough.hp).toBe(500 - calm.unlockables.ballista.damage!);
    expect(weak.hp).toBe(10);
  });

  it('the Flame Tower scorches every enemy near it at once, and nobody further out', () => {
    const s = board();
    place(s, 15, 5, 1, Kind.Flame);
    const near = [unit(s, 2, UnitType.Warrior, 16.5, 5.5, 100), unit(s, 2, UnitType.Warrior, 14.5, 6.5, 100), unit(s, 2, UnitType.Hound, 15.5, 7.2, 100)];
    const far = unit(s, 2, UnitType.Warrior, 19.5, 5.5, 100);
    defend(s, 1);
    for (const u of near) expect(u.hp).toBe(100 - calm.unlockables.flame.damage!);
    expect(far.hp).toBe(100);
  });

  it('the Frost Tower slows enemies down', () => {
    const march = (frost: boolean) => {
      const s = board();
      if (frost) place(s, 18, 3, 1, Kind.Frost);
      // An enemy warrior walking west along row 5 on an attack order.
      const u = unit(s, 2, UnitType.Warrior, 22.5, 5.5);
      s.colonies[1].order = 1;
      run(s, 40);
      return 22.5 - u.x;
    };
    const free = march(false);
    const chilled = march(true);
    expect(free).toBeGreaterThan(3);
    expect(chilled).toBeLessThan(free * 0.8);
  });

  it('the Lightning Tower strikes one enemy and leaps on to others', () => {
    const s = board();
    place(s, 12, 5, 1, Kind.Lightning);
    const line = [15, 17, 19, 21].map((x) => unit(s, 2, UnitType.Warrior, x + 0.5, 5.5, 100));
    const events = defend(s, 1);
    expect(events.filter((e) => e.type === 'shot' && e.style === 'lightning').length).toBe(4);
    for (const u of line) expect(u.hp).toBeLessThan(100);
    // Each leap is weaker than the one before.
    expect(line[0].hp).toBeLessThan(line[3].hp);
  });

  it('the Cannon Tower blasts everyone near where the shell lands', () => {
    const s = board();
    place(s, 12, 5, 1, Kind.Cannon);
    const clump = [unit(s, 2, UnitType.Warrior, 17.5, 5.5, 100), unit(s, 2, UnitType.Warrior, 18.3, 5.9, 100), unit(s, 2, UnitType.Warrior, 17.9, 6.6, 100)];
    const apart = unit(s, 2, UnitType.Warrior, 17.5, 9.5, 100);
    const events = defend(s, 1);
    for (const u of clump) expect(u.hp).toBe(100 - calm.unlockables.cannon.damage!);
    expect(apart.hp).toBe(100);
    expect(events.some((e) => e.type === 'blast' && e.style === 'cannon')).toBe(true);
  });

  it('the Obelisk beam burns hotter the longer it holds one target', () => {
    const s = board();
    place(s, 12, 5, 1, Kind.Obelisk);
    const u = unit(s, 2, UnitType.Giant, 16.5, 5.5, 100000);
    defend(s, 10);
    const firstSecond = 100000 - u.hp;
    const before = u.hp;
    defend(s, 40);
    defend(s, 10);
    const later = before - u.hp;
    expect(firstSecond).toBeGreaterThan(0);
    // Average over seconds 2-6 far above the first second's.
    expect(later / 5).toBeGreaterThan(firstSecond * 4);
  });

  it('the Bell Tower makes nearby towers reload faster', () => {
    const shots = (bell: boolean) => {
      const s = board();
      place(s, 12, 5, 1, Kind.Crossbow);
      if (bell) place(s, 12, 6, 1, Kind.Bell);
      unit(s, 2, UnitType.Giant, 15.5, 5.5, 100000);
      return defend(s, 100).filter((e) => e.type === 'shot').length;
    };
    expect(shots(true)).toBeGreaterThan(shots(false) * 1.4);
  });

  it('the Shrine heals its own squares, tower and units, never above full, and never the enemy', () => {
    const s = board();
    place(s, 12, 5, 1, Kind.Shrine);
    const wall = place(s, 13, 5, 1, Kind.Wall);
    s.hp[wall] = 50;
    const friend = unit(s, 1, UnitType.Warrior, 12.5, 6.5, 10);
    const foe = unit(s, 2, UnitType.Warrior, 11.5, 6.5, 10);
    defend(s, 100);
    expect(s.hp[wall]).toBeGreaterThan(50);
    expect(s.hp[wall]).toBeLessThanOrEqual(calm.health.wall);
    expect(friend.hp).toBe(unitTuning(calm, UnitType.Warrior).hp);
    expect(foe.hp).toBe(10);
  });
});

describe('money and science buildings', () => {
  it('a mine earns more beside mountains, a fishery beside water', () => {
    const s = board();
    const cell = at(10, 5);
    const bare = buildingYield(s, calm, cell, 1, Kind.Mine).gold;
    for (const [x, y] of [[9, 4], [10, 4], [11, 4]]) s.terrain[at(x, y)] = Terrain.Mountain;
    const rocky = buildingYield(s, calm, cell, 1, Kind.Mine).gold;
    expect(rocky).toBeCloseTo(bare + 3 * calm.unlockables.mine.per!, 9);
    expect(buildingYield(s, calm, cell, 1, Kind.Fishery).gold).toBe(calm.unlockables.fishery.gold);
    for (const [x, y] of [[9, 6], [10, 6]]) s.terrain[at(x, y)] = Terrain.Water;
    expect(buildingYield(s, calm, cell, 1, Kind.Fishery).gold).toBeCloseTo(calm.unlockables.fishery.gold! + 2 * calm.unlockables.fishery.per!, 9);
  });

  it('a market earns from the houses around it', () => {
    const s = board();
    for (let x = 8; x <= 12; x++) for (let y = 3; y <= 7; y++) if (!(x === 10 && y === 5)) place(s, x, y, 1, Kind.House);
    expect(buildingYield(s, calm, at(10, 5), 1, Kind.Market).gold).toBeCloseTo(24 * calm.unlockables.market.per!, 9);
  });

  it('a bank pays interest on saved gold, up to its cap', () => {
    const s = board();
    const colony = s.colonies[0];
    colony.gold = 100;
    expect(buildingYield(s, calm, at(10, 5), 1, Kind.Bank).gold).toBeCloseTo(100 * calm.unlockables.bank.rate!, 9);
    colony.gold = 1e6;
    expect(buildingYield(s, calm, at(10, 5), 1, Kind.Bank).gold).toBe(calm.unlockables.bank.cap);
  });

  it('libraries make more science in a cluster of science buildings', () => {
    const s = board();
    const alone = buildingYield(s, calm, at(10, 5), 1, Kind.Library).science;
    place(s, 9, 5, 1, Kind.Research);
    place(s, 11, 5, 1, Kind.Library);
    expect(buildingYield(s, calm, at(10, 5), 1, Kind.Library).science).toBeCloseTo(alone + 2 * calm.unlockables.library.per!, 9);
  });

  it('standing buildings feed the colony income, but not while under construction or cut off', () => {
    const s = board();
    const colony = s.colonies[0];
    for (let x = 3; x <= 9; x++) place(s, x, 5, 1, Kind.House);
    const academy = place(s, 10, 5, 1, Kind.Academy);
    const science = () => {
      run(s, 1);
      return sciencePerSecond(colony, calm);
    };
    expect(science()).toBeCloseTo(calm.unlockables.academy.science!, 9);
    s.readyTick[academy] = s.tick + 100; // as if still being built
    expect(science()).toBe(0);
    s.readyTick[academy] = 0;
    damageCell(s, calm, at(6, 5), 9999, []); // cut the street
    expect(science()).toBe(0);
    expect(goldPerSecond(colony, calm)).toBeGreaterThan(0);
  });
});

describe('the army', () => {
  it('every army building raises its own unit type', () => {
    for (const kind of PRODUCERS) {
      const s = board();
      place(s, 5, 5, 1, kind);
      const def = unitTuning(calm, PRODUCES[kind]);
      run(s, Math.round((calm.combat.buildSeconds + def.spawnSeconds + 1) * calm.tickRate));
      expect(s.units.length, String(kind)).toBe(1);
      expect(s.units[0].type).toBe(PRODUCES[kind]);
    }
  });

  it('archers shoot enemy units from range', () => {
    const s = board();
    place(s, 15, 5, 1, Kind.Archery); // keeps the archer at home on Hold
    const archer = unit(s, 1, UnitType.Archer, 15.5, 5.5);
    const foe = unit(s, 2, UnitType.Warrior, 18.8, 5.5, 1000);
    s.colonies[1].order = 0;
    const events = run(s, 20);
    expect(foe.hp).toBeLessThan(1000);
    expect(events.some((e) => e.type === 'shot' && e.style === 'arrow')).toBe(true);
    expect(Math.abs(archer.x - 15.5)).toBeLessThan(1.5);
  });

  it('a spearman who is struck hurls a spear through every building in a line; units are only grazed', () => {
    const s = board();
    const spear = unit(s, 1, UnitType.Spearman, 14.5, 5.5);
    place(s, 14, 6, 1, Kind.SpearHall);
    const line = [16.5, 17.5].map((x) => unit(s, 2, UnitType.Warrior, x, 5.5, 1000));
    const walls = [18, 19, 20].map((x) => place(s, x, 5, 2, Kind.Wall));
    run(s, 1);
    spear.hp -= 5; // struck
    const events = run(s, 1);
    const def = unitTuning(calm, UnitType.Spearman);
    for (const wall of walls) expect(s.hp[wall]).toBeLessThanOrEqual(calm.health.wall - def.spearDamage!);
    // The units it passes take only a share of it.
    for (const u of line) {
      expect(u.hp).toBeLessThan(1000);
      expect(u.hp).toBeGreaterThanOrEqual(1000 - def.spearDamage! * def.spearVsUnits! - 1e-6);
    }
    expect(events.some((e) => e.type === 'shot' && e.style === 'spear')).toBe(true);
    // The spear needs time to come back.
    spear.hp -= 5;
    const again = run(s, 2).filter((e) => e.type === 'shot' && e.style === 'spear').length;
    expect(again).toBe(0);
  });

  it("a knight's first strike after a gallop hits several times as hard", () => {
    const s = board();
    const knight = unit(s, 1, UnitType.Knight, 10.5, 5.5);
    const foe = unit(s, 2, UnitType.Giant, 18.5, 5.5, 10000);
    // The knight rides out on an attack order, meets the giant on the way, and charges it.
    s.colonies[0].order = 2;
    for (let i = 0; i < 120 && foe.hp === 10000; i++) {
      step(s, calm, []);
      foe.x = 18.5;
      foe.y = 5.5;
    }
    const def = unitTuning(calm, UnitType.Knight);
    // (A giant's hide is armour: it takes only part of the blow.)
    expect(10000 - foe.hp).toBeCloseTo(def.damage * def.chargeMultiplier! * (unitTuning(calm, UnitType.Giant).armor ?? 1));
    expect(knight.charge).toBe(0);
  });

  it('a catapult lobs boulders at buildings from beyond crossbow range', () => {
    const s = board();
    const cat = unit(s, 1, UnitType.Catapult, 20.5, 5.5);
    const tower = place(s, 26, 5, 2, Kind.Crossbow);
    s.colonies[0].order = 2;
    const events = run(s, 40);
    expect(s.hp[tower]).toBeLessThan(calm.health.crossbow);
    expect(events.some((e) => e.type === 'shot' && e.style === 'rock')).toBe(true);
    // It stayed put to shoot, out of the crossbow's reach.
    expect(26.5 - cat.x).toBeGreaterThan(calm.defence.crossbow.range);
  });

  it('a monk heals the army around it and never fights', () => {
    const s = board();
    place(s, 12, 5, 1, Kind.Monastery);
    unit(s, 1, UnitType.Monk, 12.5, 5.5);
    // A wounded monk of its own, and an enemy monk beside them: none of them fights.
    const hurt = unit(s, 1, UnitType.Monk, 13.5, 5.5, 5);
    const foe = unit(s, 2, UnitType.Monk, 12.5, 6.3, 1000);
    run(s, 30);
    expect(hurt.hp).toBeGreaterThan(5);
    expect(foe.hp).toBe(1000);
  });

  it('a sapper blows up the squares it reaches, and itself', () => {
    const s = board();
    const sapper = unit(s, 1, UnitType.Sapper, 20.5, 5.5);
    for (let y = 0; y < H; y++) place(s, 24, y, 2, Kind.Wall);
    s.colonies[0].order = 2;
    const events: SimEvent[] = [];
    for (let i = 0; i < 100 && s.units.includes(sapper); i++) step(s, calm, events);
    expect(s.units.includes(sapper)).toBe(false);
    expect(events.some((e) => e.type === 'blast')).toBe(true);
    const hurt = Array.from({ length: H }, (_, y) => at(24, y)).filter((c) => s.kind[c] !== Kind.Wall || s.hp[c] < calm.health.wall);
    expect(hurt.length).toBeGreaterThanOrEqual(2);
  });

  it("a giant's stomp hits every enemy around it", () => {
    const s = board();
    place(s, 15, 5, 1, Kind.GiantLair);
    unit(s, 1, UnitType.Giant, 15.5, 5.5);
    const ring = [unit(s, 2, UnitType.Warrior, 16.2, 5.5, 1000), unit(s, 2, UnitType.Warrior, 15.5, 6.3, 1000), unit(s, 2, UnitType.Warrior, 14.8, 5.2, 1000)];
    run(s, 3);
    const damage = unitTuning(calm, UnitType.Giant).damage;
    for (const u of ring) expect(u.hp).toBeLessThanOrEqual(1000 - damage);
  });
});

describe('plazas, thorn walls and banners', () => {
  it('a Plaza makes the city grow much faster around it', () => {
    const grown = (withPlaza: boolean) => {
      let total = 0;
      for (let seed = 1; seed <= 6; seed++) {
        const s = createEmptyState(W, H, seed, 'local');
        addColony(s, at(1, 5), tuning);
        const own = s.colonies[0];
        for (let x = 3; x <= 8; x++) for (let y = 4; y <= 7; y++) place(s, x, y, 1, Kind.House);
        if (withPlaza) {
          own.unlocked.push(Kind.Plaza);
          const c = place(s, 7, 5, 1, Kind.Plaza);
          s.military.push(c);
        }
        const before = own.houses;
        for (let i = 0; i < 300; i++) step(s, tuning, []);
        total += own.houses - before;
      }
      return total;
    };
    const plain = grown(false);
    const boosted = grown(true);
    expect(boosted).toBeGreaterThan(plain * 1.5);
  });

  it('a Thorn Wall cuts every unit that strikes it', () => {
    const s = board();
    s.colonies[0].order = 2;
    for (let y = 0; y < H; y++) place(s, 20, y, 2, Kind.Thorns);
    const w = unit(s, 1, UnitType.Warrior, 18.5, 5.5, 1000);
    const events = run(s, 60);
    expect(events.some((e) => e.type === 'thorns')).toBe(true);
    expect(w.hp).toBeLessThanOrEqual(1000 - calm.unlockables.thorns.thorns!);
  });

  it('units near a Standard Bearer hit harder and move faster; the bearer itself never fights', () => {
    const strike = (withBanner: boolean) => {
      const s = board();
      const foe = unit(s, 2, UnitType.Monk, 15.5, 5.5, 10000);
      unit(s, 1, UnitType.Shield, 14.8, 5.5);
      if (withBanner) {
        s.colonies[0].counts[Kind.BannerHall] = 1;
        unit(s, 1, UnitType.Bearer, 14.5, 6.2);
      }
      run(s, 1);
      return 10000 - foe.hp;
    };
    const plain = strike(false);
    const inspired = strike(true);
    const bearer = unitTuning(calm, UnitType.Bearer);
    expect(inspired).toBeCloseTo(plain * (1 + bearer.auraDamage!));

    const walk = (withBanner: boolean) => {
      const s = board();
      s.colonies[0].order = 2;
      const u = unit(s, 1, UnitType.Shield, 8.5, 5.5);
      if (withBanner) {
        s.colonies[0].counts[Kind.BannerHall] = 1;
        const b = unit(s, 1, UnitType.Bearer, 8.5, 6.2);
        // Keep the bearer at the shield's side.
        for (let i = 0; i < 30; i++) {
          step(s, calm, []);
          b.x = u.x;
          b.y = u.y + 0.7;
        }
      } else {
        for (let i = 0; i < 30; i++) step(s, calm, []);
      }
      return u.x - 8.5;
    };
    expect(walk(true)).toBeGreaterThan(walk(false) * 1.1);

    // The bearer never strikes.
    const s = board();
    const foe = unit(s, 2, UnitType.Warrior, 15.5, 5.5, 1000);
    unit(s, 1, UnitType.Bearer, 15.0, 5.5);
    run(s, 20);
    expect(foe.hp).toBe(1000);
  });
});

describe('the later ages: every new thing has its own job', () => {
  it('musketeers punch through heavy armour; machine guns barely scratch it', () => {
    const shot = (shooter: number, target: number) => {
      const s = board();
      const foe = unit(s, 2, target, 18.5, 5.5, 10000);
      unit(s, 1, shooter, 15.5, 5.5);
      run(s, 1);
      return 10000 - foe.hp;
    };
    const musket = unitTuning(calm, UnitType.Musketeer);
    expect(shot(UnitType.Musketeer, UnitType.Tank)).toBeCloseTo(musket.damage * musket.antiHeavy!);
    expect(shot(UnitType.Musketeer, UnitType.Warrior)).toBeCloseTo(musket.damage);

    const s = board();
    place(s, 15, 5, 1, Kind.MachineGun);
    const tank = unit(s, 2, UnitType.Tank, 18.5, 5.5, 1000);
    const swarm = unit(s, 2, UnitType.Warrior, 18.5, 2.5, 1000);
    defend(s, 20);
    // Shield-like taunting aside, the warrior takes full damage and the tank a fraction.
    const mg = calm.unlockables.mgnest;
    expect(1000 - swarm.hp + (1000 - tank.hp)).toBeGreaterThan(0);
    expect(1000 - tank.hp).toBeLessThanOrEqual(10 * (mg.damage ?? 0) * (unitTuning(calm, UnitType.Tank).armor ?? 1) + 1e-6);
  });

  it('bombers fly over walls to the most valuable building; only anti-air (and Center Towers) shoot them', () => {
    const s = board();
    s.colonies[0].order = 2;
    for (let y = 0; y < H; y++) place(s, 22, y, 2, Kind.Wall);
    for (let y = 0; y < H; y++) place(s, 23, y, 2, Kind.Crossbow);
    const prize = place(s, 30, 5, 2, Kind.Cannon);
    const bomber = unit(s, 1, UnitType.Bomber, 18.5, 5.5);
    bomber.target = -1;
    const events = run(s, 80);
    expect(bomber.hp).toBe(unitTuning(calm, UnitType.Bomber).hp); // crossbows cannot touch it
    expect(s.kind[prize] !== Kind.Cannon || s.hp[prize] < calm.unlockables.cannon.health).toBe(true);
    expect(events.some((e) => e.type === 'blast')).toBe(true);

    const s2 = board();
    place(s2, 15, 5, 1, Kind.AABattery);
    const plane = unit(s2, 2, UnitType.Bomber, 18.5, 5.5, 1000);
    const walker = unit(s2, 2, UnitType.Warrior, 17.5, 5.5, 1000);
    defend(s2, 15);
    expect(plane.hp).toBeLessThan(1000);
    expect(walker.hp).toBe(1000);
  });

  it('artillery outranges every tower and shells only towers', () => {
    const s = board();
    s.colonies[0].order = 2;
    const tower = place(s, 26, 5, 2, Kind.Ballista);
    const house = place(s, 20, 5, 2, Kind.House);
    unit(s, 1, UnitType.Artillery, 17.5, 5.5);
    run(s, 60);
    expect(s.hp[tower]).toBeLessThan(calm.unlockables.ballista.health);
    expect(s.hp[house]).toBe(calm.health.house);
    expect(unitTuning(calm, UnitType.Artillery).range!).toBeGreaterThan(calm.unlockables.ballista.range!);
  });

  it('factories speed up army buildings; printing presses cheapen discoveries; power plants boost money buildings', () => {
    const raised = (withFactory: boolean) => {
      const s = board();
      place(s, 10, 5, 1, Kind.Camp);
      if (withFactory) place(s, 11, 5, 1, Kind.Factory);
      run(s, Math.round((calm.combat.buildSeconds + unitTuning(calm, UnitType.Warrior).spawnSeconds * 0.75) * calm.tickRate));
      return s.units.length;
    };
    expect(raised(true)).toBeGreaterThan(raised(false));

    const s = board();
    const colony = s.colonies[0];
    const before = nextThreshold(calm, colony);
    place(s, 12, 5, 1, Kind.PrintingPress);
    expect(nextThreshold(calm, colony)).toBeLessThan(before);

    const gold = (withPlant: boolean) => {
      const b = board();
      b.terrain[at(14, 4)] = Terrain.Mountain;
      b.terrain[at(14, 6)] = Terrain.Mountain;
      place(b, 14, 5, 1, Kind.Mine);
      if (withPlant) place(b, 15, 5, 1, Kind.PowerPlant);
      run(b, Math.round((calm.combat.buildSeconds + 1) * calm.tickRate));
      return b.colonies[0].bonusGold;
    };
    expect(gold(true)).toBeCloseTo(gold(false) * (1 + (calm.unlockables.power.boost ?? 0)));
  });

  it('a missile silo strikes a random building of the colony your army attacks, anywhere on the map', () => {
    const s = board();
    s.colonies[0].order = 2;
    place(s, 3, 9, 1, Kind.MissileSilo);
    place(s, 34, 2, 2, Kind.Cannon);
    const events: SimEvent[] = [];
    for (let i = 0; i < 200 && !events.some((e) => e.type === 'launch'); i++) step(s, calm, events);
    const launch = events.find((e) => e.type === 'launch');
    expect(launch).toBeDefined();
    // It is in the air for a while, aimed at one of the target colony's buildings (never the tower)...
    expect(s.strikes.length).toBe(1);
    const strike = s.strikes[0];
    expect(s.kind[at(Math.floor(strike.x), Math.floor(strike.y))]).toBe(Kind.Cannon);
    const hp = s.hp[at(34, 2)];
    // ...and only does its damage when it lands.
    const later = run(s, Math.round((calm.unlockables.silo.flightSeconds ?? 2) * calm.tickRate) + 1);
    expect(s.strikes.length).toBe(0);
    expect(later.some((e) => e.type === 'blast')).toBe(true);
    expect(s.kind[at(34, 2)] !== Kind.Cannon || s.hp[at(34, 2)] < hp).toBe(true);
  });

  it('a nuke flattens a whole district, armies included, but only scratches the Center Tower', () => {
    const s = board();
    s.colonies[0].order = 2;
    place(s, 3, 9, 1, Kind.NukeSilo);
    place(s, 30, 2, 2, Kind.Cannon);
    place(s, 31, 3, 2, Kind.Crossbow);
    const tower = s.colonies[1].towerHp;
    const events = run(s, Math.round((calm.combat.buildSeconds + 1 + (calm.unlockables.nuke.flightSeconds ?? 3)) * calm.tickRate) + 2);
    expect(events.some((e) => e.type === 'nuke')).toBe(true);
    expect(s.kind[at(30, 2)]).not.toBe(Kind.Cannon);
    expect(s.colonies[1].alive).toBe(true);
    expect(s.colonies[1].towerHp).toBeGreaterThan(tower * 0.5);
  });

  it('a hex tower turns a light enemy to its side', () => {
    const s = board();
    place(s, 6, 6, 1, Kind.Hex);
    run(s, Math.round((calm.combat.buildSeconds + 0.5) * calm.tickRate));
    const victim = unit(s, 2, UnitType.Warrior, 8.5, 6.5);
    const events = defend(s, 2);
    expect(events.some((e) => e.type === 'charm')).toBe(true);
    expect(victim.owner).toBe(1);
  });

  it('a marksman shoots the healer behind the line first; a railgun pierces the whole line', () => {
    const s = board();
    place(s, 6, 6, 1, Kind.Marksman);
    run(s, Math.round((calm.combat.buildSeconds + 0.5) * calm.tickRate));
    const front = unit(s, 2, UnitType.Warrior, 9.5, 6.5);
    const monk = unit(s, 2, UnitType.Monk, 12.5, 6.5);
    defend(s, 2);
    expect(monk.hp).toBeLessThan(unitTuning(calm, UnitType.Monk).hp);
    expect(front.hp).toBe(unitTuning(calm, UnitType.Warrior).hp);

    const r = board();
    place(r, 6, 6, 1, Kind.Railgun);
    run(r, Math.round((calm.combat.buildSeconds + 0.5) * calm.tickRate));
    const line = [9.5, 11.5, 13.5].map((x) => unit(r, 2, UnitType.Giant, x, 6.5));
    defend(r, 2);
    for (const g of line) expect(g.hp).toBeLessThan(unitTuning(calm, UnitType.Giant).hp);
  });

  it('towers cannot see an assassin until it is right beside them', () => {
    const s = board();
    place(s, 6, 6, 1, Kind.Crossbow);
    run(s, Math.round((calm.combat.buildSeconds + 0.5) * calm.tickRate));
    const sneak = unit(s, 2, UnitType.Assassin, 9.5, 6.5);
    sneak.cooldown = 1000;
    s.colonies[1].order = 0;
    const full = sneak.hp;
    defend(s, 3);
    expect(sneak.hp).toBe(full);
  });

  it('new money and science buildings earn what they say', () => {
    const s = board();
    s.terrain[at(5, 7)] = Terrain.Forest;
    s.terrain[at(6, 7)] = Terrain.Forest;
    const mill = place(s, 5, 6, 1, Kind.LumberMill);
    const spec = calm.unlockables.lumbermill;
    expect(buildingYield(s, calm, mill, 1, Kind.LumberMill).gold).toBeCloseTo((spec.gold ?? 0) + 2 * (spec.per ?? 0));
    const spies = place(s, 8, 8, 1, Kind.SpyDen);
    expect(buildingYield(s, calm, spies, 1, Kind.SpyDen).science).toBeCloseTo(calm.unlockables.spyden.per ?? 0);
    s.colonies[0].gold = 0;
    const alchemist = place(s, 9, 9, 1, Kind.Alchemist);
    expect(buildingYield(s, calm, alchemist, 1, Kind.Alchemist).science).toBe(0);
    s.colonies[0].gold = 100;
    expect(buildingYield(s, calm, alchemist, 1, Kind.Alchemist).science).toBeGreaterThan(0);
    expect(buildingYield(s, calm, alchemist, 1, Kind.Alchemist).gold).toBeLessThan(0);
  });
});

describe('every unit has its own role', () => {
  it('each has a clear strength and a clear weakness', () => {
    const u = (type: number) => unitTuning(calm, type);
    expect(u(UnitType.Archer).siege!).toBeLessThan(0.5); // archers: hopeless against buildings...
    expect(u(UnitType.Archer).vsUnits!).toBeGreaterThan(1); // ...deadly against units
    expect(u(UnitType.Spearman).vsUnits!).toBeLessThan(0.5); // spearmen: poor fighters...
    expect(u(UnitType.Knight).siege!).toBeLessThan(0.5); // knights: poor at buildings...
    expect(u(UnitType.Shield).vsUnits!).toBeLessThan(1); // shields: weak hitters
    expect(u(UnitType.Hound).vsUnits!).toBeLessThan(1); // hounds: useless in a fight
  });

  it('warriors hit harder together', () => {
    const lone = board();
    // The foe is a monk: it never strikes back, so nobody dies before striking.
    const foe1 = unit(lone, 2, UnitType.Monk, 15.5, 5.5, 10000);
    unit(lone, 1, UnitType.Warrior, 14.8, 5.5);
    run(lone, 1);
    const alone = 10000 - foe1.hp;

    const mob = board();
    const foe2 = unit(mob, 2, UnitType.Monk, 15.5, 5.5, 10000);
    for (const [x, y] of [[14.8, 5.5], [16.2, 5.5], [15.5, 4.8], [15.5, 6.2]]) unit(mob, 1, UnitType.Warrior, x, y);
    run(mob, 1);
    const together = 10000 - foe2.hp;
    expect(alone).toBeCloseTo(unitTuning(calm, UnitType.Warrior).damage);
    expect(together).toBeGreaterThan(4 * alone * 1.2);
  });

  it('towers shoot shields first, and shields shrug off half the damage', () => {
    const s = board();
    place(s, 15, 5, 1, Kind.Crossbow);
    const near = unit(s, 2, UnitType.Warrior, 16.5, 5.5, 1000);
    const shield = unit(s, 2, UnitType.Shield, 19.5, 5.5, 1000); // further away, still in range
    defend(s, 1);
    expect(near.hp).toBe(1000);
    expect(shield.hp).toBeCloseTo(1000 - calm.defence.crossbow.damage * unitTuning(calm, UnitType.Shield).towerArmor!);
  });

  it('hounds on a raid ignore fights, and loot gold from every house they destroy', () => {
    const s = board();
    s.colonies[0].order = 2;
    s.colonies[0].gold = 0;
    const house = place(s, 20, 5, 2, Kind.House);
    s.hp[house] = 1;
    const guard = unit(s, 2, UnitType.Warrior, 19.5, 6.3, 1000);
    unit(s, 1, UnitType.Hound, 19.5, 5.5);
    const events: SimEvent[] = [];
    for (let i = 0; i < 60 && s.owner[house] === 2; i++) {
      for (const u of s.units) if (u.owner === 2) u.cooldown = 99; // keep the guard from biting back
      step(s, calm, events);
    }
    expect(s.owner[house]).not.toBe(2);
    expect(events.some((e) => e.type === 'loot')).toBe(true);
    expect(s.colonies[0].gold).toBeGreaterThanOrEqual(unitTuning(calm, UnitType.Hound).plunder!);
    expect(guard.hp).toBe(1000);
  });

  it('spearmen on the attack throw spears that carve a line through buildings, unprovoked', () => {
    const s = board();
    s.colonies[0].order = 2;
    const row = [18, 19, 20, 21].map((x) => place(s, x, 5, 2, Kind.Wall));
    unit(s, 1, UnitType.Spearman, 16.5, 5.5);
    const events = run(s, 30);
    expect(events.some((e) => e.type === 'shot' && e.style === 'spear')).toBe(true);
    // Every wall in the line took a spear, not just the first.
    for (const c of row) expect(s.hp[c]).toBeLessThanOrEqual(calm.health.wall - unitTuning(calm, UnitType.Spearman).spearDamage!);
  });

  it('knights hunt enemy units from much further than others notice them', () => {
    const sees = (type: number) => {
      const s = board();
      s.colonies[0].order = 2;
      // An enemy 5 squares off to the side of the road to the enemy tower.
      const foe = unit(s, 2, UnitType.Giant, 12.5, 10.5, 10000);
      const u = unit(s, 1, type, 12.5, 5.5);
      for (let i = 0; i < 10; i++) {
        step(s, calm, []);
        foe.x = 12.5;
        foe.y = 10.5;
      }
      return u.y; // moved towards the foe?
    };
    expect(sees(UnitType.Knight)).toBeGreaterThan(6.5);
    expect(sees(UnitType.Warrior)).toBeLessThan(6);
  });

  it("a giant's stomp crushes the enemy squares around it too", () => {
    const s = board();
    place(s, 15, 3, 1, Kind.GiantLair);
    unit(s, 1, UnitType.Giant, 15.5, 5.5);
    unit(s, 2, UnitType.Warrior, 16.2, 5.5, 1000);
    const houses = [place(s, 15, 6, 2, Kind.House), place(s, 14, 5, 2, Kind.House)];
    run(s, 3);
    for (const c of houses) expect(s.owner[c] !== 2 || s.hp[c] < calm.health.house).toBe(true);
  });
});

describe('the AI uses its research', () => {
  it('in a long match rivals specialise: a handful of discoveries each, and they build what they unlock', () => {
    const s = createGame({ seed: 77, model: 'local', colonies: 4, tuning, bots: [2, 3, 4], aiAttacks: false });
    for (let i = 0; i < 12000; i++) step(s, tuning, []);
    for (const colony of s.colonies.slice(1)) {
      // A few discoveries, not the whole catalogue: each colony is its own mix.
      expect(colony.unlocked.length).toBeGreaterThanOrEqual(2);
      expect(colony.unlocked.length).toBeLessThanOrEqual(12);
      expect(colony.unlocked.some((k) => colony.counts[k] > 0)).toBe(true);
    }
    // Between them, the rivals field new army buildings and new towers.
    const all = (kinds: number[]) => s.colonies.slice(1).reduce((n, c) => n + kinds.reduce((m, k) => m + c.counts[k], 0), 0);
    expect(all(PRODUCERS.filter((k) => k !== Kind.Camp)) + all([Kind.Ballista, Kind.Flame, Kind.Frost, Kind.Lightning, Kind.Cannon, Kind.Obelisk, Kind.MachineGun])).toBeGreaterThan(0);
    // It never builds what it has not unlocked.
    for (const colony of s.colonies.slice(1)) {
      for (const kind of Object.keys(UNLOCK_KEY).map(Number)) if (colony.counts[kind] > 0) expect(isLocked(colony, kind)).toBe(false);
    }
  }, 300000);
});
