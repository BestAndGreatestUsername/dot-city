// Units: production, movement and fighting. Everything here is automatic (the GDD's "automated
// at the tactical level"); the player only chooses the colony-wide order (D12).
// The towers that shoot at units live in towers.ts.
//
// Every unit changes the battle in its own way, with a strength and a weakness:
//   Warrior   the mob: hits harder for every warrior fighting beside it
//   Shield    the escort: enemy towers shoot it first, and it shrugs off half of every tower shot;
//             it hits weakly
//   Hound     the raider: fast, bites only houses, and loots gold from every house it destroys;
//             useless in a fight
//   Archer    the defender: shoots enemy units from range and hits them hard; nearly harmless to
//             buildings
//   Spearman  the line-breaker: every few seconds (and whenever struck) hurls a spear that
//             pierces every building in a straight line; poor against other units
//   Knight    the hunter: spots enemy units from far off and rides them down, the first strike
//             after a gallop three times as hard; poor against buildings
//   Catapult  the artillery: lobs boulders at buildings from beyond crossbow range; never fights
//   Monk      the healer: never fights; heals the army around it
//   Sapper    the demolisher: runs at the enemy's squares and blows them up, itself included
//   Giant     the juggernaut: its stomp hits every enemy around it and crushes the squares too
//   Bearer    the standard bearer: never fights; every friend near its banner hits harder and
//             moves faster

import { isAttacking, isProducer, PRODUCES, unitMaxHp, unitTuning, unlockTuning } from './catalog';
import { buildingTuning } from './economy';
import { damageCell, healthAt, isActive } from './health';
import { passableFor, solidFor, terrainSpeed } from './nav';
import { buildBlocks, forEachNearby, type Blocks } from './spatial';
import { cellAt, cellOfPoint, deltaX, deltaY, dist, step as neighbour, wrapPoint } from './topo';
import { Kind, Terrain, UnitType, type Colony, type GameState, type SimEvent, type Tuning, type Unit, type UnitTuning } from './types';

/** D13: every finished army building keeps a fixed number of units alive, for free. */
export function stepProduction(s: GameState, t: Tuning): void {
  if (s.military.length === 0) return;
  const living = new Map<number, number>();
  for (const u of s.units) if (u.home >= 0) living.set(u.home, (living.get(u.home) ?? 0) + 1);

  // Finished Factories, by owner: army buildings near one raise their units faster.
  const factories = new Map<number, number[]>();
  for (const c of s.military) {
    if (s.kind[c] !== Kind.Factory || !isActive(s, c) || s.cutOff[c]) continue;
    const list = factories.get(s.owner[c]);
    if (list) list.push(c);
    else factories.set(s.owner[c], [c]);
  }
  const factory = unlockTuning(t, Kind.Factory);
  const w = s.width;
  for (const c of s.military) {
    const kind = s.kind[c];
    if (!isProducer(kind) || !isActive(s, c)) continue;
    const type = PRODUCES[kind];
    const def = unitTuning(t, type);
    // D5: a barracks cut off from the tower raises nobody.
    if (s.cutOff[c]) continue;
    const colony = s.colonies[s.owner[c] - 1];
    const mods = colony.mods;
    const cap = def.cap + mods.armySize;
    if ((living.get(c) ?? 0) >= cap) {
      s.timer[c] = 0;
      continue;
    }
    let rate = 1;
    for (const f of factories.get(s.owner[c]) ?? []) {
      const reach = factory?.radius ?? 0;
      if (Math.abs(deltaX(s, c % w, f % w)) <= reach && Math.abs(deltaY(s, (c / w) | 0, (f / w) | 0)) <= reach) {
        rate = 1 + (factory?.boost ?? 0);
        break;
      }
    }
    s.timer[c] += rate / t.tickRate;
    if (s.timer[c] < def.spawnSeconds * mods.spawnTime) continue;
    s.timer[c] = 0;
    const hp = unitMaxHp(t, colony, type);
    // Every field is set from the start, in the same order, so all units share one object
    // shape. (Adding fields later, unit by unit, makes every loop over units slower and slower.)
    s.units.push({
      id: s.nextUnitId++,
      owner: colony.id,
      type,
      x: (c % s.width) + 0.5,
      y: ((c / s.width) | 0) + 0.5,
      hp,
      home: c,
      cooldown: 0,
      facing: 1,
      noChaseUntil: 0,
      slowUntil: 0,
      slowFactor: 1,
      lastHp: hp,
      spearReady: 0,
      charge: 0,
      vx: 0,
      vy: 0,
      target: -1,
    });
    // A colony's first unit needs its fields built.
    if (!colony.nav.home) s.navDirty = true;
  }
}

function isSlowed(s: GameState, u: Unit): boolean {
  return (u.slowUntil ?? 0) > s.tick;
}

/**
 * Move a unit toward a point, never leaving the map and never entering a cell it may not stand on.
 * If the straight step is blocked (a corner of water or of an enemy square), the unit slides
 * along whichever axis is free. Returns true only when the straight step itself was possible.
 */
function moveToward(s: GameState, t: Tuning, u: Unit, tx: number, ty: number, speed: number, push?: [number, number]): boolean {
  let dx = deltaX(s, u.x, tx);
  let dy = deltaY(s, u.y, ty);
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-6) return true;
  // Steering: the direction to the target, nudged away from crowding friends, and blended with
  // the current heading so units curve round corners instead of snapping between directions.
  let hx = dx / dist;
  let hy = dy / dist;
  if (push) {
    hx += push[0];
    hy += push[1];
  }
  if (u.vx !== undefined && u.vy !== undefined && dist > 0.35) {
    hx = u.vx * 0.45 + hx * 0.55;
    hy = (u.vy ?? 0) * 0.45 + hy * 0.55;
  }
  const len = Math.hypot(hx, hy) || 1;
  hx /= len;
  hy /= len;
  u.vx = hx;
  u.vy = hy;
  dx = hx * dist;
  dy = hy * dist;
  // Knights build up a charge while they move.
  u.charge = (u.charge ?? 0) + 1;
  const here = cellOfPoint(s, u.x, u.y);
  const mods = s.colonies[u.owner - 1].mods;
  const ground = mods.roads > 0 ? 1 : terrainSpeed(s, t, here);
  // Frost Towers chill: a slowed unit moves at a fraction of its speed.
  const chill = isSlowed(s, u) ? (u.slowFactor ?? 1) : 1;
  const stepLength = Math.min(dist, (speed * mods.unitSpeed * ground * chill) / t.tickRate);
  // The next position, looped back onto the map (or held inside its edges).
  const next = { x: u.x + (dx / dist) * stepLength, y: u.y + (dy / dist) * stepLength };
  wrapPoint(s, next);
  const nx = next.x;
  const ny = next.y;
  const open = (x: number, y: number) => {
    const there = cellOfPoint(s, x, y);
    return there === here || (there >= 0 && passableFor(s, there, u.owner));
  };
  if (Math.abs(dx) > 0.01) u.facing = dx > 0 ? 1 : -1;
  if (open(nx, ny)) {
    u.x = nx;
    u.y = ny;
    return true;
  }
  // Blocked diagonally: slide along the axis with more ground to cover first.
  const slideX = Math.abs(nx - u.x) > 1e-4 && open(nx, u.y);
  const slideY = Math.abs(ny - u.y) > 1e-4 && open(u.x, ny);
  if (slideX && (!slideY || Math.abs(dx) >= Math.abs(dy))) u.x = nx;
  else if (slideY) u.y = ny;
  return false;
}

/** Push away from friends standing too close, so a group spreads into a crowd instead of a queue. */
function separation(s: GameState, blocks: Blocks, u: Unit): [number, number] {
  const reach = 0.8;
  let px = 0;
  let py = 0;
  forEachNearby(blocks, u.x, u.y, reach, (o) => {
    if (o === u || o.owner !== u.owner || o.hp <= 0) return;
    const dx = deltaX(s, o.x, u.x);
    const dy = deltaY(s, o.y, u.y);
    const d = Math.hypot(dx, dy);
    if (d >= reach) return;
    if (d < 1e-4) {
      // Exactly on top of each other: split along a direction fixed by the unit's id.
      const a = (u.id * 2.399) % (Math.PI * 2);
      px += Math.cos(a) * 0.5;
      py += Math.sin(a) * 0.5;
      return;
    }
    const f = (reach - d) / reach;
    px += (dx / d) * f;
    py += (dy / d) * f;
  });
  return [px * 0.9, py * 0.9];
}

/** Can a unit walk in a straight line between two points? */
function clearLine(s: GameState, x0: number, y0: number, x1: number, y1: number, owner: number): boolean {
  const dx = deltaX(s, x0, x1);
  const dy = deltaY(s, y0, y1);
  const steps = Math.ceil(Math.hypot(dx, dy) / 0.25);
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    const c = cellOfPoint(s, x0 + dx * k, y0 + dy * k);
    if (c < 0 || !passableFor(s, c, owner)) return false;
  }
  return true;
}

/**
 * Look ahead along the flow field: follow it downhill (diagonals allowed) for a few cells, as far
 * as the unit can see in a straight line, and aim there. Units then cut corners and walk
 * diagonals instead of tracing the grid.
 */
function lookahead(s: GameState, field: Float32Array, start: number, u: Unit, steps: number): number {
  const w = s.width;
  let cur = start;
  let aim = start;
  for (let k = 0; k < steps; k++) {
    const x = cur % w;
    const y = (cur / w) | 0;
    let next = -1;
    let best = field[cur];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const n = cellAt(s, x + dx, y + dy);
        if (n < 0 || field[n] >= best || !passableFor(s, n, u.owner)) continue;
        // A diagonal step needs both of the squares it slips between to be open.
        if (dx !== 0 && dy !== 0 && (!passableFor(s, cellAt(s, x + dx, y), u.owner) || !passableFor(s, cellAt(s, x, y + dy), u.owner))) continue;
        best = field[n];
        next = n;
      }
    }
    if (next < 0) break;
    if (!clearLine(s, u.x, u.y, (next % w) + 0.5, ((next / w) | 0) + 0.5, u.owner)) break;
    aim = next;
    cur = next;
  }
  return aim;
}

/** How long a unit ignores chases after one was blocked. */
const CHASE_PAUSE_TICKS = 40;

/** Units that go out of their way to trample farms: the fighters, not the specialists. */
const FARM_WRECKERS: number[] = [UnitType.Warrior, UnitType.Shield, UnitType.Hound, UnitType.Spearman, UnitType.Knight, UnitType.Giant, UnitType.Tank];

/** A small fixed offset per unit, so a group spreads out inside a cell instead of stacking. */
function offsetX(u: Unit): number {
  return (((u.id * 37) % 7) - 3) / 10;
}

function offsetY(u: Unit): number {
  return (((u.id * 53) % 7) - 3) / 10;
}

/** Knights: a strike after a long enough gallop is multiplied. Every strike resets the charge. */
function strikeMultiplier(t: Tuning, u: Unit, def: UnitTuning): number {
  let mult = 1;
  if (u.type === UnitType.Knight && (u.charge ?? 0) >= (def.chargeSeconds ?? Infinity) * t.tickRate) mult = def.chargeMultiplier ?? 1;
  u.charge = 0;
  return mult;
}

/** Distance from a point to a line segment. */
function segmentDistance(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  const k = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2));
  return Math.hypot(px - (x0 + k * dx), py - (y0 + k * dy));
}

/**
 * The nearest enemy square within range: towers that shoot first, then anything of `only` (if
 * given). With `kindOnly`, only squares of that kind count.
 */
function nearestEnemySquare(s: GameState, u: Unit, range: number, only: number, prefer: (kind: number) => boolean, kindOnly = -1): number {
  const r = Math.ceil(range);
  const cx = Math.floor(u.x);
  const cy = Math.floor(u.y);
  let best = -1;
  let bestScore = Infinity;
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      const c = cellAt(s, x, y);
      if (c < 0) continue;
      const owner = s.owner[c];
      if (owner === 0 || owner === u.owner || (only > 0 && owner !== only)) continue;
      if (kindOnly >= 0 && s.kind[c] !== kindOnly) continue;
      const d = Math.hypot(x + 0.5 - u.x, y + 0.5 - u.y);
      if (d > range) continue;
      const score = d - (prefer(s.kind[c]) ? 100 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
  }
  return best;
}

/**
 * Spearman: hurl a spear in a straight line through every enemy square, up to its range. It is
 * made for buildings: it aims at the enemy's squares (towers first), carries on through
 * everything behind them, and only grazes the units it passes.
 * Returns false if there was nothing to throw at.
 */
function throwSpear(s: GameState, t: Tuning, u: Unit, def: UnitTuning, colony: Colony, blocks: Blocks, events: SimEvent[], squaresOnly: boolean): boolean {
  const range = def.spearRange ?? 0;
  const damage = (def.spearDamage ?? 0) * colony.mods.unitDamage;
  // Aim at the target colony's squares (any enemy's while holding), shooting towers first;
  // with no square in reach, at the nearest enemy unit.
  let ax = 0;
  let ay = 0;
  const c = nearestEnemySquare(s, u, range, colony.order, (k) => isAttacking(k) || k === Kind.Tower);
  if (c >= 0) {
    ax = u.x + deltaX(s, u.x, (c % s.width) + 0.5);
    ay = u.y + deltaY(s, u.y, ((c / s.width) | 0) + 0.5);
  } else if (squaresOnly) {
    return false;
  } else {
    let nearest = range;
    let aimed = false;
    forEachNearby(blocks, u.x, u.y, range, (o) => {
      if (o.owner === u.owner || o.hp <= 0) return;
      const d = dist(s, u.x, u.y, o.x, o.y);
      if (d <= nearest) {
        nearest = d;
        ax = u.x + deltaX(s, u.x, o.x);
        ay = u.y + deltaY(s, u.y, o.y);
        aimed = true;
      }
    });
    if (!aimed) return false;
  }
  const len = Math.hypot(ax - u.x, ay - u.y) || 1;
  const ex = u.x + ((ax - u.x) / len) * range;
  const ey = u.y + ((ay - u.y) / len) * range;

  const graze = damage * (def.spearVsUnits ?? 1);
  forEachNearby(blocks, (u.x + ex) / 2, (u.y + ey) / 2, range, (o) => {
    if (o.owner === u.owner || o.hp <= 0) return;
    // The target's position as seen from the thrower, the short way round.
    const ox = u.x + deltaX(s, u.x, o.x);
    const oy = u.y + deltaY(s, u.y, o.y);
    if (segmentDistance(ox, oy, u.x, u.y, ex, ey) <= 0.6) o.hp -= graze;
  });
  const struck = new Set<number>();
  for (let k = 0.5; k <= range; k += 0.25) {
    const c = cellOfPoint(s, u.x + ((ex - u.x) * k) / range, u.y + ((ey - u.y) * k) / range);
    if (c < 0) break;
    if (struck.has(c)) continue;
    struck.add(c);
    const owner = s.owner[c];
    if (owner !== 0 && owner !== u.owner) damageCell(s, t, c, damage * colony.mods.siege, events);
  }
  events.push({ type: 'shot', x0: u.x, y0: u.y, x1: ex, y1: ey, owner: u.owner, style: 'spear' });
  u.spearReady = s.tick + Math.round((def.spearCooldownSeconds ?? 1) * t.tickRate);
  u.facing = ex > u.x ? 1 : -1;
  return true;
}

/** Standard Bearer: is one of this unit's colony's banners close enough to inspire it? */
function underBanner(s: GameState, t: Tuning, blocks: Blocks, u: Unit): boolean {
  const aura = unitTuning(t, UnitType.Bearer).aura ?? 0;
  let found = false;
  forEachNearby(blocks, u.x, u.y, aura, (o) => {
    if (!found && o !== u && o.owner === u.owner && o.type === UnitType.Bearer && o.hp > 0 && dist(s, u.x, u.y, o.x, o.y) <= aura) found = true;
  });
  return found;
}

/** Warrior: every other warrior of the same colony fighting close by adds to its strikes. */
function rallyMultiplier(s: GameState, blocks: Blocks, u: Unit, def: UnitTuning): number {
  if (!def.rally) return 1;
  let friends = 0;
  forEachNearby(blocks, u.x, u.y, 2, (o) => {
    if (o !== u && o.owner === u.owner && o.type === u.type && o.hp > 0 && dist(s, u.x, u.y, o.x, o.y) <= 2) friends++;
  });
  return 1 + Math.min(def.rallyCap ?? Infinity, friends * def.rally);
}

/**
 * Damage a square, and report whether that destroyed a house (hounds loot those). Giants crush
 * every enemy square around the one they strike.
 */
function strikeSquare(s: GameState, t: Tuning, u: Unit, def: UnitTuning, colony: Colony, c: number, damage: number, events: SimEvent[]): void {
  const wasHouse = s.kind[c] === Kind.House;
  const victim = s.owner[c];
  // Thorn Walls cut whoever strikes them.
  if (s.kind[c] === Kind.Thorns) {
    u.hp -= unlockTuning(t, Kind.Thorns)?.thorns ?? 0;
    events.push({ type: 'thorns', x: u.x, y: u.y, owner: victim });
  }
  const x = (c % s.width) + 0.5;
  const y = ((c / s.width) | 0) + 0.5;
  if (def.crush) {
    blastSquares(s, t, u.owner, x, y, def.splash ?? 1, damage, events);
  } else {
    damageCell(s, t, c, damage, events);
  }
  if (def.plunder && wasHouse && s.owner[c] !== victim) {
    const gold = def.plunder;
    colony.gold += gold;
    events.push({ type: 'loot', x, y, owner: u.owner, gold });
  }
}

/** Damage every enemy square within a radius of a point (catapult boulders, sapper charges). */
export function blastSquares(s: GameState, t: Tuning, owner: number, x: number, y: number, radius: number, damage: number, events: SimEvent[]): void {
  const r = Math.ceil(radius);
  for (let cy = Math.floor(y) - r; cy <= Math.floor(y) + r; cy++) {
    for (let cx = Math.floor(x) - r; cx <= Math.floor(x) + r; cx++) {
      const c = cellAt(s, cx, cy);
      if (c < 0) continue;
      const o = s.owner[c];
      if (o === 0 || o === owner) continue;
      const d = Math.hypot(cx + 0.5 - x, cy + 0.5 - y);
      if (d > radius) continue;
      // Full damage at the centre, half at the rim.
      damageCell(s, t, c, damage * (1 - (0.5 * d) / radius), events);
    }
  }
}

export function stepUnits(s: GameState, t: Tuning, events: SimEvent[]): void {
  if (s.units.length === 0) return;
  const w = s.width;

  // Units are bucketed into coarse blocks so "who is near me" only looks at a few lists.
  const blocks = buildBlocks(s);

  // How many units are already working on each enemy square this tick. A square only needs
  // so many attackers; the rest of a group picks other squares instead of piling on.
  const claims = new Map<number, number>();
  const isFree = (c: number, damage: number) => (claims.get(c) ?? 0) < Math.max(1, Math.ceil(healthAt(s, c) / (damage * 5)));
  const claim = (c: number) => claims.set(c, (claims.get(c) ?? 0) + 1);

  // Intruders: enemy ground units standing on or right beside each colony's land. A colony on
  // Hold sends its units after them, wherever on its land they are.
  const intruders = new Map<number, Unit[]>();
  for (const v of s.units) {
    if (v.hp <= 0 || unitTuning(t, v.type).flies) continue;
    const here = cellOfPoint(s, v.x, v.y);
    if (here < 0) continue;
    let marked = 0;
    for (let d = -1; d < 4; d++) {
      const n = d < 0 ? here : neighbour(s, here, d);
      if (n < 0) continue;
      const o = s.owner[n];
      if (o === 0 || o === v.owner || (marked & (1 << o)) !== 0) continue;
      marked |= 1 << o;
      const list = intruders.get(o);
      if (list) list.push(v);
      else intruders.set(o, [v]);
    }
  }

  for (const u of s.units) {
    if (u.hp <= 0) continue;
    const def = unitTuning(t, u.type);
    const colony = s.colonies[u.owner - 1];
    const cooldownTicks = Math.round(def.cooldownSeconds * t.tickRate);

    // Aircraft fly straight over everything and are not part of the ground battle.
    if (def.flies) {
      if (u.cooldown > 0) u.cooldown--;
      stepBomber(s, t, u, def, colony, cooldownTicks, events);
      continue;
    }

    // Spearman: struck since last tick, spear ready? Throw it. On the attack he also throws one
    // every few seconds at the enemy's buildings, carving a line through them.
    if (u.type === UnitType.Spearman) {
      if (s.tick >= (u.spearReady ?? 0)) {
        const struck = u.lastHp !== undefined && u.hp < u.lastHp;
        if (struck) throwSpear(s, t, u, def, colony, blocks, events, false);
        else if (colony.order > 0 && throwSpear(s, t, u, def, colony, blocks, events, true)) {
          u.spearReady = s.tick + Math.round((def.throwSeconds ?? def.spearCooldownSeconds ?? 1) * t.tickRate);
        }
      }
      u.lastHp = u.hp;
    }
    // A chilled unit also strikes at half speed: its cooldown runs down every other tick.
    if (u.cooldown > 0 && !(isSlowed(s, u) && s.tick % 2 === 1)) u.cooldown--;

    // (Only colonies that have a Banner Hall can have a banner nearby: skip the search otherwise.)
    const banner = u.type !== UnitType.Bearer && colony.counts[Kind.BannerHall] > 0 && underBanner(s, t, blocks, u);
    const bearer = unitTuning(t, UnitType.Bearer);
    const baseDamage = def.damage * colony.mods.unitDamage * rallyMultiplier(s, blocks, u, def) * (banner ? 1 + (bearer.auraDamage ?? 0) : 1);
    const speed = def.speed * (banner ? 1 + (bearer.auraSpeed ?? 0) : 1);
    const siege = (def.siege ?? 1) * colony.mods.siege;
    const vsUnits = def.vsUnits ?? 1;
    const cx = Math.floor(u.x);
    const cy = Math.floor(u.y);
    const cell = cy * w + cx;

    // Monk: heal the army around it. It never fights.
    if (u.type === UnitType.Monk && u.cooldown === 0) {
      let healed = false;
      forEachNearby(blocks, u.x, u.y, def.range ?? 0, (o) => {
        if (o.owner !== u.owner || dist(s, u.x, u.y, o.x, o.y) > (def.range ?? 0)) return;
        const full = unitMaxHp(t, colony, o.type);
        if (o.hp < full) {
          o.hp = Math.min(full, o.hp + (def.heal ?? 0));
          healed = true;
        }
      });
      if (healed) events.push({ type: 'blast', x: u.x, y: u.y, radius: def.range ?? 0, style: 'heal' });
      u.cooldown = cooldownTicks;
    }

    // 1. Any enemy unit close by takes priority over the order. Catapults, monks and sappers
    // have other work: they ignore enemy units and carry on. So do hounds on a raid: they dodge
    // fights and go for the houses.
    const fights =
      u.type !== UnitType.Catapult &&
      u.type !== UnitType.Artillery &&
      u.type !== UnitType.Monk &&
      u.type !== UnitType.Sapper &&
      u.type !== UnitType.Bearer &&
      !(u.type === UnitType.Hound && colony.order > 0);
    if (fights) {
      let foe: Unit | null = null;
      // Units on Hold are defenders: they notice intruders from further away. Archers see as far
      // as they shoot; knights hunt from further still.
      let foeDist = Math.max(colony.order > 0 ? t.combat.aggroRange : t.combat.holdAggroRange, def.range ?? 0, def.hunt ?? 0);
      forEachNearby(
        blocks,
        u.x,
        u.y,
        foeDist,
        (other) => {
          if (other.owner === u.owner || other.hp <= 0 || unitTuning(t, other.type).flies) return;
          const d = dist(s, u.x, u.y, other.x, other.y);
          if (d < foeDist) {
            foeDist = d;
            foe = other;
          }
        },
        u.owner,
      );
      // (The closure above hides the assignment from the type checker.)
      const enemy = foe as Unit | null;
      if (enemy) {
        const reach = def.shoots ? (def.range ?? 0) : t.combat.meleeRange;
        if (foeDist <= reach) {
          if (u.cooldown === 0) {
            const foeDef = unitTuning(t, enemy.type);
            // Musketeers pierce armour, and hit heavy units (full health of 60 or more) far harder.
            const heavy = def.antiHeavy && unitMaxHp(t, s.colonies[enemy.owner - 1], enemy.type) >= 60 ? def.antiHeavy : 1;
            const armor = def.antiHeavy ? 1 : (foeDef.armor ?? 1);
            const damage = baseDamage * strikeMultiplier(t, u, def) * vsUnits * heavy * armor;
            if (u.type === UnitType.Tank) {
              // A tank shell bursts: everyone near the target is hit (through their own armour).
              const splash = def.splash ?? 1;
              forEachNearby(blocks, enemy.x, enemy.y, splash, (o) => {
                if (o.owner === u.owner || unitTuning(t, o.type).flies || dist(s, enemy.x, enemy.y, o.x, o.y) > splash) return;
                o.hp -= baseDamage * vsUnits * (unitTuning(t, o.type).armor ?? 1);
              });
              events.push({ type: 'shot', x0: u.x, y0: u.y, x1: enemy.x, y1: enemy.y, owner: u.owner, style: 'cannon' });
              events.push({ type: 'blast', x: enemy.x, y: enemy.y, radius: splash, style: 'cannon' });
            } else if (u.type === UnitType.Giant) {
              // Stomp: everyone around the giant feels it, and so do the squares it stands among.
              forEachNearby(blocks, u.x, u.y, def.splash ?? 1, (o) => {
                if (o.owner !== u.owner && dist(s, u.x, u.y, o.x, o.y) <= (def.splash ?? 1)) o.hp -= damage;
              });
              if (def.crush) blastSquares(s, t, u.owner, u.x, u.y, def.splash ?? 1, baseDamage * siege * 0.5, events);
              events.push({ type: 'blast', x: u.x, y: u.y, radius: def.splash ?? 1, style: 'cannon' });
            } else if (u.type !== UnitType.Tank) {
              enemy.hp -= damage;
            }
            if (!def.shoots) {
              events.push({ type: 'strike', id: u.id, x: u.x, y: u.y, tx: enemy.x, ty: enemy.y, owner: u.owner, heavy: damage > def.damage * 1.5 || u.type === UnitType.Giant });
            }
            if (u.type === UnitType.Archer) events.push({ type: 'shot', x0: u.x, y0: u.y, x1: enemy.x, y1: enemy.y, owner: u.owner, style: 'arrow' });
            if (u.type === UnitType.Musketeer) events.push({ type: 'shot', x0: u.x, y0: u.y, x1: enemy.x, y1: enemy.y, owner: u.owner, style: 'bolt' });
            u.cooldown = cooldownTicks;
          }
          const toward = deltaX(s, u.x, enemy.x);
          if (Math.abs(toward) > 0.01) u.facing = toward > 0 ? 1 : -1;
          continue;
        }
        // Chase it, unless a chase was blocked a moment ago. If water or an enemy square is in
        // the way, give up for a few seconds and carry on with the order: otherwise two units
        // on opposite sides of a lake would press against its edge forever.
        if (s.tick >= (u.noChaseUntil ?? 0)) {
          if (moveToward(s, t, u, enemy.x, enemy.y, speed, separation(s, blocks, u))) continue;
          u.noChaseUntil = s.tick + CHASE_PAUSE_TICKS;
          continue;
        }
      }
      // On Hold: defend the land. Any intruder on or beside our squares, within reach, is hunted down.
      if (!enemy && colony.order === 0 && s.tick >= (u.noChaseUntil ?? 0)) {
        let target: Unit | null = null;
        let nearest = t.combat.defendRange;
        for (const v of intruders.get(u.owner) ?? []) {
          if (v.hp <= 0) continue;
          const d = dist(s, u.x, u.y, v.x, v.y);
          if (d < nearest) {
            nearest = d;
            target = v;
          }
        }
        if (target) {
          if (moveToward(s, t, u, target.x, target.y, speed, separation(s, blocks, u))) continue;
          u.noChaseUntil = s.tick + CHASE_PAUSE_TICKS;
        }
      }
    }

    // 2. Otherwise follow the colony's order.
    const attacking = colony.order > 0;

    // Catapult: anything of the target colony within range gets a boulder, shooting towers first.
    // Artillery outranges every tower and shells nothing but towers.
    if ((u.type === UnitType.Catapult || u.type === UnitType.Artillery) && attacking) {
      let c = nearestEnemySquare(s, u, def.range ?? 0, colony.order, (k) => isAttacking(k) || k === Kind.Tower);
      if (c >= 0 && def.towersOnly && !(isAttacking(s.kind[c]) || s.kind[c] === Kind.Tower)) c = -1;
      if (c >= 0) {
        if (u.cooldown === 0) {
          const tx = u.x + deltaX(s, u.x, (c % w) + 0.5);
          const ty = u.y + deltaY(s, u.y, ((c / w) | 0) + 0.5);
          blastSquares(s, t, u.owner, tx, ty, def.splash ?? 1, baseDamage * siege, events);
          events.push({ type: 'shot', x0: u.x, y0: u.y, x1: tx, y1: ty, owner: u.owner, style: u.type === UnitType.Artillery ? 'cannon' : 'rock' });
          events.push({ type: 'blast', x: tx, y: ty, radius: def.splash ?? 1, style: 'cannon' });
          u.cooldown = cooldownTicks;
          u.facing = tx > u.x ? 1 : -1;
        }
        continue;
      }
    }

    // Farms are fragile and feed the enemy: on the attack, fighters go a little out of their way
    // to trample any farm of the target close by. A farm they cannot reach is given up for a while.
    if (attacking && FARM_WRECKERS.includes(u.type) && s.tick >= (u.noChaseUntil ?? 0)) {
      const farm = nearestEnemySquare(s, u, t.combat.farmDetour, colony.order, () => false, Kind.Farm);
      if (farm >= 0) {
        const fx = farm % w;
        const fy = (farm / w) | 0;
        const touching = Math.abs(deltaX(s, cx, fx)) <= 1 && Math.abs(deltaY(s, cy, fy)) <= 1;
        if (touching) {
          claim(farm);
          if (u.cooldown === 0) {
            strikeSquare(s, t, u, def, colony, farm, baseDamage * siege, events);
            events.push({ type: 'strike', id: u.id, x: u.x, y: u.y, tx: fx + 0.5, ty: fy + 0.5, owner: u.owner, heavy: false });
            u.cooldown = cooldownTicks;
          }
          const toward = deltaX(s, u.x, fx + 0.5);
          if (Math.abs(toward) > 0.01) u.facing = toward > 0 ? 1 : -1;
          continue;
        }
        if (moveToward(s, t, u, fx + 0.5, fy + 0.5, speed, separation(s, blocks, u))) continue;
        u.noChaseUntil = s.tick + CHASE_PAUSE_TICKS;
      }
    }

    const field = attacking
      ? u.type === UnitType.Hound && colony.nav.raid
        ? colony.nav.raid
        : u.type === UnitType.Sapper && colony.nav.rock
          ? colony.nav.rock
          : colony.nav.tower
      : colony.nav.home;
    if (!field) continue;
    const here = field[cell];
    if (here === Infinity) continue;
    // On Hold, a unit that has reached its barracks stays put, drifting apart from its friends.
    if (!attacking && here < 1.5 / def.speed) {
      const [px, py] = separation(s, blocks, u);
      const nx = u.x + px * 0.04;
      const ny = u.y + py * 0.04;
      const there = { x: nx, y: ny };
      wrapPoint(s, there);
      const c = cellOfPoint(s, there.x, there.y);
      if (c >= 0 && passableFor(s, c, u.owner)) {
        u.x = there.x;
        u.y = there.y;
      }
      continue;
    }

    let best = -1;
    let bestTime = here;
    for (let dir = 0; dir < 4; dir++) {
      const n = neighbour(s, cell, dir);
      if (n < 0) continue;
      // Units on Hold never start a fight with a building.
      if (!attacking && !passableFor(s, n, u.owner)) continue;
      if (field[n] < bestTime) {
        bestTime = field[n];
        best = n;
      }
    }
    if (best < 0) continue;

    // Sapper: the moment it reaches the enemy's squares, it lights the fuse.
    if (u.type === UnitType.Sapper) {
      const touching = [0, 1, 2, 3].map((d) => neighbour(s, cell, d)).find((n) => n >= 0 && s.owner[n] === colony.order);
      // A mountain in the way: blast it into open ground.
      if (attacking && touching === undefined && s.terrain[best] === Terrain.Mountain) {
        const radius = def.splash ?? 1;
        const bx = (best % w) + 0.5;
        const by = ((best / w) | 0) + 0.5;
        for (let dy = -Math.ceil(radius); dy <= Math.ceil(radius); dy++) {
          for (let dx = -Math.ceil(radius); dx <= Math.ceil(radius); dx++) {
            const c = cellAt(s, Math.floor(bx) + dx, Math.floor(by) + dy);
            if (c < 0 || s.terrain[c] !== Terrain.Mountain || Math.hypot(dx, dy) > radius) continue;
            s.terrain[c] = Terrain.Grass;
            events.push({ type: 'terrain', cell: c });
          }
        }
        s.navDirty = true;
        events.push({ type: 'blast', x: bx, y: by, radius, style: 'cannon' });
        u.hp = 0;
        continue;
      }
      const at = touching ?? (solidFor(s, best, u.owner) ? best : -1);
      if (attacking && at >= 0) {
        // The charge goes off against the square it reached.
        const radius = def.splash ?? 1;
        const bx = (at % w) + 0.5;
        const by = ((at / w) | 0) + 0.5;
        blastSquares(s, t, u.owner, bx, by, radius, baseDamage * siege, events);
        forEachNearby(blocks, bx, by, radius, (o) => {
          if (o.owner !== u.owner && dist(s, bx, by, o.x, o.y) <= radius) o.hp -= baseDamage / 3;
        });
        events.push({ type: 'blast', x: bx, y: by, radius, style: 'cannon' });
        u.hp = 0;
        continue;
      }
    }
    // Catapults, monks and standard bearers never break squares themselves: they wait for the way to open.
    if ((u.type === UnitType.Catapult || u.type === UnitType.Artillery || u.type === UnitType.Monk || u.type === UnitType.Bearer) && solidFor(s, best, u.owner)) continue;

    // Hounds are raiders (D14): the raid field marks the houses worth raiding with time 0.
    // A hound attacks any such house beside it that still needs attackers, wherever it stands.
    const raiding = attacking && field === colony.nav.raid;
    const wanted = (c: number) => s.owner[c] === colony.order && field[c] === 0 && isFree(c, baseDamage);
    let target = -1;
    if (raiding) {
      for (const n of [0, 1, 2, 3].map((d) => neighbour(s, cell, d))) {
        if (n < 0) continue;
        if (wanted(n)) {
          target = n;
          break;
        }
      }
      if (target < 0) {
        // None beside it: head for the nearest house that still needs attackers. Houses that
        // already have enough hounds on them are skipped, so a pack fans out instead of piling up.
        const step = spreadStep(s, u, cell, 8, wanted);
        if (step >= 0) {
          moveToward(s, t, u, (step % w) + 0.5 + offsetX(u), ((step / w) | 0) + 0.5 + offsetY(u), speed, separation(s, blocks, u));
          continue;
        }
      }
    }

    if (target < 0 && solidFor(s, best, u.owner)) {
      // D11: an enemy square is in the way. Break it — unless enough units are on it already.
      if (isFree(best, baseDamage)) target = best;
      if (target < 0 && !raiding) {
        // Widen the breach: another square of the target beside them that needs hands.
        let targetTime = Infinity;
        for (const n of [0, 1, 2, 3].map((d) => neighbour(s, cell, d))) {
          if (n < 0) continue;
          if (s.owner[n] !== colony.order || !isFree(n, baseDamage)) continue;
          if (field[n] < targetTime) {
            targetTime = field[n];
            target = n;
          }
        }
      }
      // Nowhere better to go: help with the square in front after all. A raiding hound waits
      // instead, so a pack never piles more hounds onto one house than it needs.
      if (target < 0 && raiding) continue;
      if (target < 0) target = best;
    }

    if (target >= 0) {
      claim(target);
      if (u.cooldown === 0) {
        const mult = strikeMultiplier(t, u, def);
        strikeSquare(s, t, u, def, colony, target, baseDamage * siege * mult, events);
        events.push({ type: 'strike', id: u.id, x: u.x, y: u.y, tx: (target % w) + 0.5, ty: ((target / w) | 0) + 0.5, owner: u.owner, heavy: mult > 1 || u.type === UnitType.Giant });
        u.cooldown = cooldownTicks;
      }
      const toward = deltaX(s, u.x, (target % w) + 0.5);
      if (Math.abs(toward) > 0.01) u.facing = toward > 0 ? 1 : -1;
      continue;
    }
    // Aim as far along the path as the unit can see, and steer there.
    const aim = lookahead(s, field, cell, u, 4);
    const goal = aim === cell ? best : aim;
    moveToward(s, t, u, (goal % w) + 0.5 + offsetX(u) * 0.6, ((goal / w) | 0) + 0.5 + offsetY(u) * 0.6, speed, separation(s, blocks, u));
  }
}

/**
 * Breadth-first search over ground this unit can walk on, looking for a place to stand next to
 * a wanted square (a house worth raiding that still needs attackers). Returns the first cell to step to,
 * or -1 if there is none within `depth` steps.
 */
function spreadStep(s: GameState, u: Unit, start: number, depth: number, wanted: (c: number) => boolean): number {
  const seen = new Set<number>([start]);
  // Each entry: the cell, and the first step that led towards it.
  let frontier: Array<[number, number]> = [[start, -1]];
  for (let d = 0; d < depth && frontier.length > 0; d++) {
    const next: Array<[number, number]> = [];
    for (const [c, first] of frontier) {
      for (let dir = 0; dir < 4; dir++) {
        const n = neighbour(s, c, dir);
        if (n < 0 || seen.has(n) || !passableFor(s, n, u.owner)) continue;
        seen.add(n);
        const step = first < 0 ? n : first;
        // Is there work beside this cell?
        for (let side = 0; side < 4; side++) {
          const m = neighbour(s, n, side);
          if (m >= 0 && wanted(m)) return step;
        }
        next.push([n, step]);
      }
    }
    frontier = next;
  }
  return -1;
}

/**
 * Bomber: on the attack it flies straight to the most valuable building of the target colony
 * (never the tower while anything else stands), bombs it, and flies home to rearm. On Hold it
 * waits over its airfield. It crosses walls, water and mountains alike.
 */
function stepBomber(s: GameState, t: Tuning, u: Unit, def: UnitTuning, colony: Colony, cooldownTicks: number, events: SimEvent[]): void {
  const w = s.width;
  const fly = (tx: number, ty: number): number => {
    const dx = deltaX(s, u.x, tx);
    const dy = deltaY(s, u.y, ty);
    const d = Math.hypot(dx, dy);
    const stepLength = Math.min(d, (def.speed * colony.mods.unitSpeed) / t.tickRate);
    if (d > 1e-6) {
      u.x += (dx / d) * stepLength;
      u.y += (dy / d) * stepLength;
      wrapPoint(s, u);
      if (Math.abs(dx) > 0.01) u.facing = dx > 0 ? 1 : -1;
    }
    return d - stepLength;
  };
  const homeX = u.home >= 0 ? (u.home % w) + 0.5 : (colony.tower % w) + 1;
  const homeY = u.home >= 0 ? ((u.home / w) | 0) + 0.5 : ((colony.tower / w) | 0) + 1;
  const victim = colony.order > 0 ? s.colonies[colony.order - 1] : null;
  if (!victim || !victim.alive || u.cooldown > 0) {
    u.target = -1;
    fly(homeX, homeY);
    return;
  }
  // A target that is gone (or no longer the enemy's) is chosen again.
  if (u.target === undefined || u.target < 0 || s.owner[u.target] !== victim.id) u.target = mostValuableBuilding(s, t, victim.id);
  if (u.target < 0) return;
  const tx = (u.target % w) + 0.5;
  const ty = ((u.target / w) | 0) + 0.5;
  if (fly(tx, ty) > 0.05) return;
  const radius = def.splash ?? 1;
  blastSquares(s, t, u.owner, tx, ty, radius, def.damage * colony.mods.unitDamage * colony.mods.siege, events);
  events.push({ type: 'blast', x: tx, y: ty, radius, style: 'cannon' });
  u.cooldown = cooldownTicks;
  u.target = -1;
}

/** The most valuable building of a colony: the dearest one; the Center Tower only when nothing else is left. */
export function mostValuableBuilding(s: GameState, t: Tuning, owner: number): number {
  let best = -1;
  let bestValue = -1;
  for (let c = 0; c < s.kind.length; c++) {
    if (s.owner[c] !== owner) continue;
    const kind = s.kind[c];
    if (kind === Kind.House || kind === Kind.Farm) continue;
    const value = kind === Kind.Tower ? 0 : (buildingTuning(t, kind)?.cost ?? 0);
    if (value > bestValue) {
      bestValue = value;
      best = c;
    }
  }
  return best;
}

/** Drop every unit that died this tick. */
export function removeDeadUnits(s: GameState, events: SimEvent[]): void {
  let keep = 0;
  for (const u of s.units) {
    if (u.hp <= 0) {
      events.push({ type: 'unitDied', x: u.x, y: u.y, owner: u.owner, unitType: u.type });
      continue;
    }
    s.units[keep++] = u;
  }
  s.units.length = keep;
}
