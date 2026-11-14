import { describe, expect, it } from 'vitest';
import tuningJson from '../src/data/tuning.json';
import { DOCTRINES, doctrineOf, pickResearch } from '../src/sim/ai';
import { goldPerSecond, sciencePerSecond } from '../src/sim/economy';
import { growthFactor, sprawlFactor } from '../src/sim/growth';
import { damageCell, maxHealthAt, towerMaxHealth } from '../src/sim/health';
import { refreshLinks } from '../src/sim/link';
import { RESEARCH, defaultMods, isIncomeOption, nextThreshold, openTier, researchOption, rollOffer } from '../src/sim/research';
import { applyCommand, step } from '../src/sim/sim';
import { addColony, createEmptyState, createGame, refreshAround } from '../src/sim/state';
import { Kind, UnitType, type GameState, type SimEvent, type Tuning } from '../src/sim/types';

const tuning = tuningJson as Tuning;
const calm: Tuning = structuredClone(tuning);
calm.growth.localEdgeRatePerSecond = 0;

const W = 30;
const at = (x: number, y: number) => y * W + x;

function board(): GameState {
  const s = createEmptyState(W, 10, 21, 'local');
  addColony(s, at(3, 4), calm);
  addColony(s, at(24, 4), calm);
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
    if (kind === Kind.Crossbow || kind === Kind.Barracks || kind === Kind.Kennel || kind === Kind.Camp) s.military.push(c);
  }
  s.hp[c] = maxHealthAt(s, calm, c);
  s.vigor[c] = 1;
  refreshAround(s, c);
  s.navDirty = true;
  return c;
}

function run(s: GameState, ticks: number, t: Tuning = calm): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) step(s, t, events);
  return events;
}

/** Put a specific option on offer and take it. */
function take(s: GameState, owner: number, id: string): void {
  const colony = s.colonies[owner - 1];
  colony.offer = [id];
  colony.pendingDraws = Math.max(1, colony.pendingDraws);
  expect(applyCommand(s, calm, { type: 'research', owner, choice: 0 }, [])).toBe(true);
}

describe('the research pool', () => {
  it('is mostly new buildings, with a handful of general modifiers', () => {
    const mods = defaultMods() as unknown as Record<string, number>;
    const ids = new Set(RESEARCH.map((o) => o.id));
    expect(ids.size).toBe(RESEARCH.length);
    for (const o of RESEARCH) {
      expect([1, 2, 3]).toContain(o.tier);
      expect(['building', 'modifier']).toContain(o.kind);
      if (o.kind === 'building') {
        expect(o.unlock).toBeDefined();
        expect(o.effects).toHaveLength(0);
      } else {
        expect(o.effects.length).toBeGreaterThan(0);
        for (const e of o.effects) expect(mods[e.mod], e.mod).not.toBeUndefined();
      }
    }
    const buildings = RESEARCH.filter((o) => o.kind === 'building').length;
    const modifiers = RESEARCH.filter((o) => o.kind === 'modifier').length;
    expect(buildings).toBeGreaterThan(modifiers);
  });

  it('every modifier is general: it never names a single unit, tower or building type', () => {
    const specific = /hound|shield|warrior|archer|spear|knight|catapult|monk|sapper|giant|crossbow|ballista|flame|frost|lightning|cannon|obelisk|bell|shrine|farm|mine|fisher|market|bank|librar|observ|academ|bastion/i;
    for (const o of RESEARCH.filter((r) => r.kind === 'modifier')) {
      expect(o.text, o.id).not.toMatch(specific);
      expect(o.text, o.id).toMatch(/^(All|Every|Your Center Tower|New buildings)/);
    }
  });
});

describe('earning draws', () => {
  it('banks a draw each time science passes a threshold, and thresholds rise', () => {
    const s = board();
    const colony = s.colonies[0];
    const first = nextThreshold(calm, colony);
    expect(first).toBe(calm.research.baseCost);
    colony.science = first - 1;
    run(s, 1);
    expect(colony.pendingDraws).toBe(0);
    expect(colony.offer).toBeNull();

    colony.science = first;
    run(s, 1);
    expect(colony.pendingDraws).toBe(1);
    expect(colony.offer).toHaveLength(calm.research.offerSize);
    expect(colony.science).toBeLessThan(1);
    expect(nextThreshold(calm, colony)).toBeGreaterThan(first);
  });

  it('the simulation banks extra draws behind the current offer (the interface is what pauses)', () => {
    const s = board();
    const colony = s.colonies[0];
    colony.science = 1000;
    run(s, 1);
    const waiting = colony.offer;
    expect(colony.pendingDraws).toBeGreaterThan(2);
    run(s, 300);
    expect(colony.offer).toEqual(waiting);
    const pending = colony.pendingDraws;
    expect(applyCommand(s, calm, { type: 'research', owner: 1, choice: 0 }, [])).toBe(true);
    expect(colony.pendingDraws).toBe(pending - 1);
    // The next choice is laid out at once, so the player can keep choosing while paused.
    expect(colony.offer).toHaveLength(calm.research.offerSize);
    expect(colony.offer).not.toEqual(waiting);
  });

  it('refuses a choice that is not on offer', () => {
    const s = board();
    expect(applyCommand(s, calm, { type: 'research', owner: 1, choice: 0 }, [])).toBe(false);
    s.colonies[0].science = 50;
    run(s, 1);
    // (Choice 2, just past the two options, is the growth choice: 3 is nothing.)
    expect(applyCommand(s, calm, { type: 'research', owner: 1, choice: 3 }, [])).toBe(false);
    expect(applyCommand(s, calm, { type: 'research', owner: 1, choice: -1 }, [])).toBe(false);
  });
});

describe('what a draw offers', () => {
  it('two different options, from the open tiers, never one already taken', () => {
    expect(calm.research.offerSize).toBe(2);
    const s = board();
    const colony = s.colonies[0];
    for (let round = 0; round < 200; round++) {
      const offer = rollOffer(s, calm, colony);
      expect(offer).toHaveLength(2);
      expect(new Set(offer).size).toBe(2);
      for (const id of offer) {
        expect(researchOption(id).tier).toBeLessThanOrEqual(openTier(calm, colony));
        expect(colony.picks).not.toContain(id);
      }
      if (round % 12 === 0) colony.picks.push(offer[0]);
    }
    expect(openTier(calm, colony)).toBe(3);
  });

  it('new buildings most of the time; general modifiers only rarely', () => {
    const s = board();
    const colony = s.colonies[0];
    let modifiers = 0;
    let total = 0;
    for (let i = 0; i < 3000; i++) {
      for (const id of rollOffer(s, calm, colony)) {
        total++;
        if (researchOption(id).kind === 'modifier') modifiers++;
      }
    }
    const share = modifiers / total;
    expect(share).toBeGreaterThan(calm.research.modifierChance * 0.6);
    expect(share).toBeLessThan(calm.research.modifierChance * 1.4);
  });

  it('once every building is unlocked, only modifiers are left to offer', () => {
    const s = board();
    const colony = s.colonies[0];
    for (const o of RESEARCH) if (o.kind === 'building') colony.picks.push(o.id);
    for (let i = 0; i < 50; i++) for (const id of rollOffer(s, calm, colony)) expect(researchOption(id).kind).toBe('modifier');
  });

  it('is not a ladder: every building of the ages reached can come up from the very first discovery', () => {
    const s = board();
    const colony = s.colonies[0];
    expect(openTier(calm, colony)).toBe(3);
    const seen = new Set<string>();
    for (let i = 0; i < 3000; i++) for (const id of rollOffer(s, calm, colony)) seen.add(id);
    // In the Medieval age: every medieval building, and nothing from a later age.
    for (const o of RESEARCH) if (o.kind === 'building' && !o.auto) expect(seen.has(o.id), o.id).toBe((o.age ?? 1) === 1);
    // In the Modern age: everything (except Anti-Air, which nobody researches: it comes with the first aircraft).
    colony.age = 4;
    for (let i = 0; i < 4000; i++) for (const id of rollOffer(s, calm, colony)) seen.add(id);
    for (const o of RESEARCH) if (o.kind === 'building') expect(seen.has(o.id), o.id).toBe(!o.auto);
  });

  it('enough discoveries open the next age, with a breakthrough from that age; each colony at its own pace', () => {
    const s = createGame({ seed: 8, model: 'local', colonies: 4, tuning, bots: [2, 3, 4] });
    const player = s.colonies[0];
    const events: SimEvent[] = [];
    // One discovery short of the Gunpowder age, then one more.
    const medieval = RESEARCH.filter((o) => o.kind === 'building' && (o.age ?? 1) === 1).map((o) => o.id);
    player.picks.push(...medieval.slice(0, calm.ages[1].discoveries - 1));
    player.offer = [medieval[calm.ages[1].discoveries - 1]];
    player.pendingDraws = 1;
    expect(applyCommand(s, tuning, { type: 'research', owner: 1, choice: 0 }, events)).toBe(true);
    expect(events.some((e) => e.type === 'age' && e.owner === 1 && e.age === 2)).toBe(true);
    expect(player.age).toBe(2);
    expect(s.colonies[1].age).toBe(1); // the others have not got there yet
    step(s, tuning, events);
    expect(player.offer).not.toBeNull();
    for (const id of player.offer!) expect(researchOption(id).age).toBe(2);
  });

  it('nobody can build anti-air until someone builds an airfield; then everyone can', () => {
    const s = createGame({ seed: 8, model: 'local', colonies: 4, tuning, bots: [2, 3, 4] });
    for (const c of s.colonies) expect(c.unlocked.includes(Kind.AABattery)).toBe(false);
    s.colonies[2].counts[Kind.Airfield] = 1;
    const events: SimEvent[] = [];
    step(s, tuning, events);
    expect(events.some((e) => e.type === 'airborne' && e.owner === 3)).toBe(true);
    for (const c of s.colonies) expect(c.unlocked.includes(Kind.AABattery)).toBe(true);
  });

  it('untouched squares and towers mend themselves; ones under attack do not', () => {
    const s = createGame({ seed: 8, model: 'local', colonies: 4, tuning });
    for (let i = 0; i < 600; i++) step(s, tuning, []);
    const colony = s.colonies[0];
    let house = -1;
    for (let c = 0; c < s.kind.length && house < 0; c++) if (s.owner[c] === 1 && s.kind[c] === Kind.House) house = c;
    s.hp[house] = 5;
    s.lastHit[house] = s.tick;
    colony.towerHp = 800;
    for (const c of colony.towerCells) s.lastHit[c] = s.tick;
    // Not yet: they were just hit.
    for (let i = 0; i < Math.round(calm.combat.regenDelaySeconds * calm.tickRate) - 5; i++) step(s, tuning, []);
    expect(s.hp[house]).toBe(5);
    // A few seconds later they mend.
    for (let i = 0; i < 60; i++) step(s, tuning, []);
    expect(s.hp[house]).toBeGreaterThan(5);
    expect(colony.towerHp).toBeGreaterThan(800);
  });

  it('can still gate options by picks taken, if tiers are switched on in the tuning', () => {
    const tiered: Tuning = structuredClone(calm);
    tiered.research.tier2Picks = 3;
    tiered.research.tier3Picks = 7;
    const s = board();
    const colony = s.colonies[0];
    expect(openTier(tiered, colony)).toBe(1);
    for (let i = 0; i < 3; i++) colony.picks.push(`x${i}`);
    expect(openTier(tiered, colony)).toBe(2);
    while (colony.picks.length < 7) colony.picks.push(`y${colony.picks.length}`);
    expect(openTier(tiered, colony)).toBe(3);
  });

  it('money and science options come up less often than the rest', () => {
    const s = board();
    const colony = s.colonies[0];
    const buildings = RESEARCH.filter((o) => o.kind === 'building');
    const incomeShare = buildings.filter(isIncomeOption).length / buildings.length;
    let income = 0;
    let total = 0;
    for (let i = 0; i < 4000; i++) {
      for (const id of rollOffer(s, calm, colony)) {
        const o = researchOption(id);
        if (o.kind !== 'building') continue;
        total++;
        if (isIncomeOption(o)) income++;
      }
    }
    // Without the weighting they would come up at their share of the pool; they come up far less.
    expect(income / total).toBeLessThan(incomeShare * 0.6);
    expect(income).toBeGreaterThan(0);
  });

  it('a re-roll costs gold and brings new options', () => {
    const s = board();
    const colony = s.colonies[0];
    colony.science = calm.research.baseCost;
    run(s, 1);
    const before = colony.offer;
    colony.gold = calm.research.rerollCost - 1;
    expect(applyCommand(s, calm, { type: 'reroll', owner: 1 }, [])).toBe(false);
    colony.gold = calm.research.rerollCost + 5;
    let changed = false;
    for (let i = 0; i < 5 && !changed; i++) {
      colony.gold = calm.research.rerollCost + 5;
      expect(applyCommand(s, calm, { type: 'reroll', owner: 1 }, [])).toBe(true);
      expect(colony.gold).toBeCloseTo(5, 6);
      changed = JSON.stringify(colony.offer) !== JSON.stringify(before);
    }
    expect(changed).toBe(true);
    expect(colony.offer).toHaveLength(calm.research.offerSize);
    expect(colony.pendingDraws).toBe(1);
  });
});

describe('modifiers', () => {
  it('Masonry strengthens every building and wall, standing ones included, but not houses', () => {
    const s = board();
    const wall = place(s, 8, 2, 1, Kind.Wall);
    const tower = place(s, 9, 2, 1, Kind.Crossbow);
    const house = place(s, 10, 2, 1, Kind.House);
    s.hp[house] = calm.health.house;
    take(s, 1, 'masonry');
    expect(maxHealthAt(s, calm, wall)).toBeCloseTo(calm.health.wall * 1.25, 6);
    expect(s.hp[wall]).toBeCloseTo(calm.health.wall * 1.25, 4);
    expect(s.hp[tower]).toBeCloseTo(calm.health.crossbow * 1.25, 4);
    expect(s.hp[house]).toBe(calm.health.house);
    // The enemy's walls are untouched.
    const theirs = place(s, 20, 2, 2, Kind.Wall);
    expect(maxHealthAt(s, calm, theirs)).toBe(calm.health.wall);
  });

  it('Citadel raises the tower that already stands', () => {
    const s = board();
    take(s, 1, 'citadel');
    expect(towerMaxHealth(calm, s.colonies[0])).toBe(calm.health.tower * 1.5);
    expect(s.colonies[0].towerHp).toBe(calm.health.tower * 1.5);
  });

  it('Conscription: every army building keeps one more unit alive', () => {
    const s = board();
    place(s, 6, 4, 1, Kind.Camp);
    s.military.push(at(6, 4));
    take(s, 1, 'conscription');
    const def = calm.units.warrior;
    run(s, Math.round(((def.cap + 3) * def.spawnSeconds + 6) * calm.tickRate));
    expect(s.units.length).toBe(def.cap + 1);
  });

  it('Chainmail: every unit type gets more health', () => {
    const s = board();
    place(s, 6, 4, 1, Kind.Camp);
    s.military.push(at(6, 4));
    take(s, 1, 'chainmail');
    run(s, Math.round((calm.units.warrior.spawnSeconds + 6) * calm.tickRate));
    expect(s.units[0].hp).toBeCloseTo(calm.units.warrior.hp * 1.2, 4);
  });

  it('Engineering: every tower reaches one square further, a crossbow tower included', () => {
    const shotsAt = (withResearch: boolean) => {
      const s = board();
      place(s, 10, 4, 1, Kind.Crossbow);
      if (withResearch) take(s, 1, 'engineering');
      // Just beyond the normal range, inside the extended one. Its own yard keeps it in place.
      const x = 10.5 + calm.defence.crossbow.range + 0.5;
      place(s, Math.floor(x), 4, 2, Kind.Kennel);
      s.military.push(at(Math.floor(x), 4));
      s.units.push({ id: s.nextUnitId++, owner: 2, type: UnitType.Hound, x, y: 4.5, hp: 1000, home: -1, cooldown: 0, facing: 1 });
      return run(s, 40).filter((e) => e.type === 'shot' && e.owner === 1).length;
    };
    expect(shotsAt(false)).toBe(0);
    expect(shotsAt(true)).toBeGreaterThan(0);
  });

  it('Battering Rams: every unit hits buildings harder', () => {
    const ticksToBreak = (withResearch: boolean) => {
      const s = board();
      if (withResearch) take(s, 1, 'rams');
      const wall = place(s, 12, 4, 2, Kind.Wall);
      for (let y = 0; y < 10; y++) if (y !== 4) place(s, 12, y, 2, Kind.Wall);
      s.units.push({ id: s.nextUnitId++, owner: 1, type: UnitType.Warrior, x: 11.5, y: 4.5, hp: 1000, home: -1, cooldown: 0, facing: 1 });
      applyCommand(s, calm, { type: 'order', owner: 1, target: 2 }, []);
      let ticks = 0;
      while (s.kind[wall] === Kind.Wall && ticks < 3000) {
        step(s, calm, []);
        ticks++;
      }
      return ticks;
    };
    expect(ticksToBreak(true)).toBeLessThan(ticksToBreak(false) * 0.8);
  });

  it('Forced March: every unit type moves faster', () => {
    const distance = (type: number, withResearch: boolean) => {
      const s = board();
      if (withResearch) take(s, 2, 'march');
      const u = { id: s.nextUnitId++, owner: 2, type, x: 20.5, y: 4.5, hp: 1000, home: -1, cooldown: 0, facing: 1 };
      s.units.push(u);
      s.navDirty = true;
      s.colonies[1].order = 1;
      run(s, 20);
      return 20.5 - u.x;
    };
    for (const type of [UnitType.Warrior, UnitType.Hound]) {
      expect(distance(type, true)).toBeGreaterThan(distance(type, false) * 1.05);
    }
  });

  it('Trade Routes and Scribes scale all gold and all science', () => {
    const s = board();
    const colony = s.colonies[0];
    for (let x = 6; x < 12; x++) place(s, x, 8, 1, Kind.House);
    place(s, 6, 1, 1, Kind.Research);
    run(s, 1);
    const gold = goldPerSecond(colony, calm);
    const science = sciencePerSecond(colony, calm);
    take(s, 1, 'trade');
    take(s, 1, 'scribes');
    run(s, 1);
    expect(goldPerSecond(colony, calm)).toBeCloseTo(gold * 1.1, 9);
    expect(sciencePerSecond(colony, calm)).toBeCloseTo(science * 1.15, 9);
  });

  it('Architects halve the build-up time', () => {
    const s = board();
    s.colonies[0].gold = 1000;
    take(s, 1, 'architects');
    const cell = place(s, 8, 2, 1, Kind.House);
    applyCommand(s, calm, { type: 'convert', owner: 1, cell, to: Kind.Crossbow }, []);
    const half = Math.round((calm.combat.buildSeconds * calm.tickRate) / 2);
    expect(s.readyTick[cell] - s.tick).toBe(half);
    run(s, half + 1);
    expect(s.hp[cell]).toBeCloseTo(calm.health.crossbow, 1);
  });
});

describe('the AI researches too (D19)', () => {
  it('takes a new building over a modifier', () => {
    expect(pickResearch(['march', 'ballista'])).toBe(1);
    expect(pickResearch(['ballista', 'march'])).toBe(0);
    expect(pickResearch(['march'])).toBe(0);
  });

  it('every rival follows its own playstyle, and that steers what it researches', () => {
    const s = createGame({ seed: 5, model: 'local', colonies: 4, tuning, bots: [2, 3, 4] });
    expect(s.colonies[0].doctrine).toBe(-1); // the player has none
    const styles = [2, 3, 4].map((id) => s.colonies[id - 1].doctrine);
    expect(new Set(styles).size).toBe(3);
    for (const d of styles) expect(DOCTRINES[d]).toBeDefined();

    const colony = s.colonies[1];
    const by = (name: string) => DOCTRINES.findIndex((d) => d.name === name);
    colony.doctrine = by('Raiders');
    expect(pickResearch(['ballista', 'kennel'], colony)).toBe(1);
    colony.doctrine = by('Fortress');
    expect(pickResearch(['ballista', 'kennel'], colony)).toBe(0);
    colony.doctrine = by('Siege');
    expect(pickResearch(['market', 'spearhall'], colony)).toBe(1);
    colony.doctrine = by('Merchant');
    expect(pickResearch(['market', 'spearhall'], colony)).toBe(0);
    // A doctrine's favourite modifier can beat an ordinary building.
    colony.doctrine = by('Horde');
    expect(pickResearch(['ballista', 'conscription'], colony)).toBe(1);
    expect(doctrineOf(s.colonies[0]).name).toBe('Balanced');
  });

  it('harder rivals earn more; the player never gets the bonus', () => {
    for (const level of [0, 1, 2]) {
      const s = createGame({ seed: 5, model: 'local', colonies: 4, tuning, bots: [2, 3, 4], aiLevel: level });
      expect(s.colonies[0].mods.gold).toBe(1);
      expect(s.colonies[1].mods.gold).toBeCloseTo(tuning.ai.levelIncome[level]);
      expect(s.colonies[1].mods.science).toBeCloseTo(tuning.ai.levelIncome[level]);
    }
  });

  it('in a real match rivals research, mostly unlocking new buildings, and build them', () => {
    const s = createGame({ seed: 2026, model: 'local', colonies: 4, tuning, bots: [2, 3, 4], aiAttacks: false });
    for (let i = 0; i < 9000; i++) step(s, tuning, []);
    for (const id of [2, 3, 4]) {
      const colony = s.colonies[id - 1];
      expect(colony.counts[Kind.Research]).toBeGreaterThan(0);
      expect(colony.picks.length).toBeGreaterThanOrEqual(4);
      expect(new Set(colony.picks).size).toBe(colony.picks.length);
      expect(colony.offer).toBeNull(); // it never sits on an offer
      const buildings = colony.picks.filter((p) => researchOption(p).kind === 'building').length;
      expect(buildings).toBeGreaterThan(colony.picks.length / 2);
      expect(colony.unlocked.some((k) => colony.counts[k] > 0)).toBe(true);
    }
    // The player chose nothing (Anti-Air, which everyone learns in the Modern age, aside).
    expect(s.colonies[0].picks.filter((p) => p !== 'aa').length).toBe(0);
  }, 300000);
});

describe('cut-off squares go dormant (D5)', () => {
  /** The player's tower with a street of houses leading east to a far district. */
  function street(): { s: GameState; link: number; far: number[] } {
    const s = board();
    for (let x = 5; x <= 9; x++) place(s, x, 4, 1, Kind.House);
    const far = [place(s, 10, 4, 1, Kind.House), place(s, 11, 4, 1, Kind.Farm), place(s, 12, 4, 1, Kind.Farm), place(s, 11, 5, 1, Kind.Research)];
    s.colonies[0].farmLinks = 2;
    return { s, link: at(7, 4), far };
  }

  it('destroying the link makes the far district dormant: no income, no science', () => {
    const { s, link, far } = street();
    const colony = s.colonies[0];
    const gold = goldPerSecond(colony, calm);
    const science = sciencePerSecond(colony, calm);
    damageCell(s, calm, link, 9999, []);
    refreshLinks(s);
    for (const c of far) expect(s.cutOff[c]).toBe(1);
    expect(s.cutOff[at(5, 4)]).toBe(0);
    // Cut off: houses at x=8,9,10 and everything beyond.
    expect(colony.dormant.cells).toBe(6);
    expect(colony.dormant.houses).toBe(3);
    expect(colony.dormant.farms).toBe(2);
    expect(sciencePerSecond(colony, calm)).toBe(0);
    expect(science).toBeGreaterThan(0);
    const e = calm.economy;
    // Left earning: the tower and the two houses still joined to it.
    expect(goldPerSecond(colony, calm)).toBeCloseTo(e.towerGoldPerSecond + 2 * e.houseGoldPerSecond, 9);
    expect(goldPerSecond(colony, calm)).toBeLessThan(gold);
  });

  it('a dormant district does not grow and its barracks raises nobody', () => {
    const { s, link } = street();
    place(s, 12, 5, 1, Kind.Barracks);
    damageCell(s, tuning, link, 9999, []);
    const events: SimEvent[] = [];
    // Growth is on here: anything that grows must touch the connected part.
    for (let i = 0; i < 180; i++) step(s, tuning, events);
    for (const e of events) {
      if (e.type !== 'grow' || e.owner !== 1) continue;
      expect(e.cell % W).toBeLessThan(9);
    }
    expect(s.units.length).toBe(0);
  });

  it('reconnecting wakes it up again', () => {
    const { s, link, far } = street();
    const colony = s.colonies[0];
    const before = goldPerSecond(colony, calm);
    damageCell(s, calm, link, 9999, []);
    refreshLinks(s);
    expect(colony.dormant.cells).toBeGreaterThan(0);
    // The rubble clears and a house fills the gap (placed by hand here; growth is off).
    s.kind[link] = Kind.Empty;
    place(s, 7, 4, 1, Kind.House);
    colony.linkDirty = true;
    refreshLinks(s);
    expect(colony.dormant.cells).toBe(0);
    for (const c of far) expect(s.cutOff[c]).toBe(0);
    expect(goldPerSecond(colony, calm)).toBeCloseTo(before, 9);
  });

  it('with growth on, the city heals the gap by itself once the rubble clears', () => {
    const { s, link } = street();
    const colony = s.colonies[0];
    damageCell(s, tuning, link, 9999, []);
    run(s, 10, tuning);
    expect(colony.dormant.cells).toBeGreaterThan(0);
    run(s, 9000, tuning);
    expect(s.owner[link]).toBe(1);
    expect(colony.dormant.cells).toBe(0);
  });

  it('dormant defences still fire', () => {
    const { s, link } = street();
    place(s, 12, 3, 1, Kind.Crossbow);
    damageCell(s, calm, link, 9999, []);
    place(s, 14, 3, 2, Kind.Kennel);
    s.units.push({ id: s.nextUnitId++, owner: 2, type: UnitType.Hound, x: 14.5, y: 3.5, hp: 1000, home: -1, cooldown: 0, facing: 1 });
    const events = run(s, 40);
    expect(s.cutOff[at(12, 3)]).toBe(1);
    expect(events.some((e) => e.type === 'shot' && e.owner === 1)).toBe(true);
  });
});

describe('sprawl', () => {
  it('a colony grows at half speed at the sprawl size, and far slower beyond it', () => {
    const s = board();
    const colony = s.colonies[0];
    const g = calm.growth;
    colony.houses = Math.round(g.sprawlSize * 0.55); // well below the sprawl size: barely slowed
    expect(sprawlFactor(colony, calm)).toBeGreaterThan(0.8);
    colony.houses = g.sprawlSize - 4;
    expect(sprawlFactor(colony, calm)).toBeCloseTo(0.5, 9);
    colony.houses = 2 * g.sprawlSize;
    expect(sprawlFactor(colony, calm)).toBeLessThan(0.1);
  });

  it('in a real match the cities level off instead of filling the map', () => {
    const s = createGame({ seed: 2026, model: 'local', colonies: 4, tuning, bots: [2, 3, 4], aiAttacks: false });
    for (let i = 0; i < 15000; i++) step(s, tuning, []);
    for (const colony of s.colonies) expect(colony.houses + colony.buildings).toBeLessThan(calm.growth.sprawlSize * 3);
  }, 300000);
});

describe('comeback bonus (D25)', () => {
  // Sprawl is switched off here so the comeback bonus can be measured on its own.
  const noSprawl: Tuning = structuredClone(calm);
  noSprawl.growth.sprawlSize = Infinity;

  it('small colonies grow faster, fading out at the size limit', () => {
    const calm = noSprawl;
    const s = board();
    const colony = s.colonies[0];
    const g = calm.growth;
    // Just the tower: nearly the full bonus.
    expect(growthFactor(colony, calm)).toBeCloseTo(1 + g.comebackBonus * (1 - 4 / g.comebackSize), 9);
    colony.houses = g.comebackSize / 2 - 4;
    expect(growthFactor(colony, calm)).toBeCloseTo(1 + g.comebackBonus / 2, 9);
    colony.houses = g.comebackSize;
    expect(growthFactor(colony, calm)).toBe(1);
    colony.houses = 5000;
    expect(growthFactor(colony, calm)).toBe(1);
  });
});
