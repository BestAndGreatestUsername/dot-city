// Every tower, and how it fights (D14, D15). The Crossbow Tower and Center Tower exist from the
// start; research unlocks the rest:
//
//   Ballista   very long range, slow, huge bolts at the toughest enemy in range
//   Flame      short range, scorches every enemy near it at once
//   Bell       does not shoot: towers near it reload faster
//   Frost      chills every enemy in range: slower to move and to strike
//   Lightning  a bolt that jumps from enemy to enemy, weakening with each jump
//   Shrine     does not shoot: heals its own squares and units nearby
//   Cannon     long range shells that blast everyone near where they land
//   Obelisk    a beam that locks on and burns hotter the longer it holds
//   Hex        bewitches a light enemy unit: it fights for you from then on
//   Marksman   long range, armour-piercing; picks off the back line first
//   Railgun    a slug through every enemy in a straight line
//   Radar      does not shoot: towers near it reach further
//   Silos      missiles (and, rarely, nukes) at the colony you attack, anywhere on the map
//
// Towers do nothing while under construction (D9). Cut-off towers keep firing (D5).

import { isProducer, towerRange, unitMaxHp, unitTuning, unlockTuning } from './catalog';
import { damageCell, isActive, maxHealthAt, towerMaxHealth } from './health';
import { buildBlocks, forEachNearby, type Blocks } from './spatial';
import { cellAt, deltaX, deltaY, dist } from './topo';
import { nextInt } from './rng';
import { blastSquares } from './units';
import { Kind, TOWER_SIZE, UnitType, type Colony, type GameState, type SimEvent, type Tuning, type Unit } from './types';

/** Reload multiplier from the colony's finished Bell Towers that reach this point (they do not stack). */
function bellFactor(s: GameState, t: Tuning, owner: number, x: number, y: number): number {
  const colony = s.colonies[owner - 1];
  if (colony.counts[Kind.Bell] === 0) return 1;
  const spec = unlockTuning(t, Kind.Bell);
  if (!spec) return 1;
  const range = towerRange(t, colony, Kind.Bell);
  const w = s.width;
  for (const c of s.military) {
    if (s.kind[c] !== Kind.Bell || s.owner[c] !== owner || !isActive(s, c)) continue;
    if (dist(s, x, y, (c % w) + 0.5, ((c / w) | 0) + 0.5) <= range) return spec.boost ?? 1;
  }
  return 1;
}

/** Extra reach from the colony's finished Radars whose square area covers this point (they do not stack). */
export function radarBonus(s: GameState, t: Tuning, owner: number, x: number, y: number): number {
  const colony = s.colonies[owner - 1];
  if (!colony || colony.counts[Kind.Radar] === 0) return 0;
  const spec = unlockTuning(t, Kind.Radar);
  if (!spec) return 0;
  const reach = spec.radius ?? 0;
  const w = s.width;
  for (const c of s.military) {
    if (s.kind[c] !== Kind.Radar || s.owner[c] !== owner || !isActive(s, c)) continue;
    if (Math.abs(deltaX(s, Math.floor(x), c % w)) <= reach && Math.abs(deltaY(s, Math.floor(y), (c / w) | 0)) <= reach) return spec.boost ?? 0;
  }
  return 0;
}

/** Distance from a point to a line segment. */
function segmentDistance(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  const k = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2));
  return Math.hypot(px - (x0 + k * dx), py - (y0 + k * dy));
}

/** Back-line units a Marksman picks off first. */
const BACK_LINE: number[] = [UnitType.Monk, UnitType.Bearer, UnitType.Sapper, UnitType.Catapult, UnitType.Artillery, UnitType.Mage];

/**
 * A silo's target: a random building (not a house, not the Center Tower) of the colony its
 * army is attacking, or else of the nearest rival. -1 when there is none.
 */
function siloTarget(s: GameState, colony: Colony, x: number, y: number): { victim: Colony; cell: number } | null {
  const w = s.width;
  let enemy = colony.order > 0 && s.colonies[colony.order - 1].alive ? s.colonies[colony.order - 1] : null;
  if (!enemy) {
    let far = Infinity;
    for (const other of s.colonies) {
      if (!other.alive || other.id === colony.id) continue;
      const d = dist(s, x, y, (other.tower % w) + 1, ((other.tower / w) | 0) + 1);
      if (d < far) {
        far = d;
        enemy = other;
      }
    }
  }
  if (!enemy) return null;
  const targets: number[] = [];
  for (let k = 0; k < s.kind.length; k++) if (s.owner[k] === enemy.id && s.kind[k] !== Kind.House && s.kind[k] !== Kind.Tower) targets.push(k);
  if (targets.length === 0) return null;
  return { victim: enemy, cell: targets[nextInt(s, targets.length)] };
}

/**
 * Warheads land: a missile blasts the squares around it; a nuke flattens a whole district and
 * everyone in it. The Center Tower takes a nuke's blast once (not once for each of its squares).
 */
function stepStrikes(s: GameState, t: Tuning, events: SimEvent[]): void {
  if (s.strikes.length === 0) return;
  let keep = 0;
  for (const strike of s.strikes) {
    if (s.tick < strike.land) {
      s.strikes[keep++] = strike;
      continue;
    }
    if (!strike.nuke) {
      blastSquares(s, t, strike.owner, strike.x, strike.y, strike.radius, strike.damage, events);
      events.push({ type: 'blast', x: strike.x, y: strike.y, radius: strike.radius, style: 'cannon' });
      continue;
    }
    const r = Math.ceil(strike.radius);
    const towersHit = new Set<number>();
    for (let cy = Math.floor(strike.y) - r; cy <= Math.floor(strike.y) + r; cy++) {
      for (let cx = Math.floor(strike.x) - r; cx <= Math.floor(strike.x) + r; cx++) {
        const c = cellAt(s, cx, cy);
        if (c < 0) continue;
        const o = s.owner[c];
        if (o === 0 || o === strike.owner) continue;
        const d = Math.hypot(cx + 0.5 - strike.x, cy + 0.5 - strike.y);
        if (d > strike.radius) continue;
        const damage = strike.damage * (1 - (0.5 * d) / strike.radius);
        if (s.kind[c] === Kind.Tower) {
          if (towersHit.has(o)) continue;
          towersHit.add(o);
          damageCell(s, t, c, damage * 0.3, events);
          continue;
        }
        damageCell(s, t, c, damage, events);
      }
    }
    for (const u of s.units) {
      if (u.owner === strike.owner || u.hp <= 0) continue;
      if (dist(s, strike.x, strike.y, u.x, u.y) <= strike.radius) u.hp -= strike.damage * 0.25;
    }
    events.push({ type: 'blast', x: strike.x, y: strike.y, radius: strike.radius, style: 'nuke' });
    events.push({ type: 'nuke', owner: strike.owner, victim: strike.victim, x: strike.x, y: strike.y });
  }
  s.strikes.length = keep;
}

export function stepDefences(s: GameState, t: Tuning, events: SimEvent[]): void {
  const dt = 1 / t.tickRate;
  const w = s.width;
  stepStrikes(s, t, events);
  const blocks: Blocks | null = s.units.length > 0 ? buildBlocks(s) : null;

  /**
   * Enemy units in range. Towers see only ground units, AA Batteries only aircraft, Center
   * Towers both.
   */
  const enemiesIn = (x: number, y: number, owner: number, range: number, visit: (u: Unit, d: number) => void, air: 'ground' | 'air' | 'both' = 'ground') => {
    if (!blocks) return;
    forEachNearby(
      blocks,
      x,
      y,
      range,
      (u) => {
        if (u.owner === owner || u.hp <= 0) return;
        const def = unitTuning(t, u.type);
        const flies = def.flies === true;
        if ((air === 'ground' && flies) || (air === 'air' && !flies)) return;
        const d = dist(s, x, y, u.x, u.y);
        // Assassins: towers only see them up close. (Healing your own, owner 0, sees everyone.)
        if (owner !== 0 && def.stealth !== undefined && d > def.stealth) return;
        if (d <= range) visit(u, d);
      },
      owner,
    );
  };
  /** The nearest enemy in range; shield units draw the fire, so any shield in range comes first. */
  const nearest = (x: number, y: number, owner: number, range: number, air: 'ground' | 'air' | 'both' = 'ground'): Unit | null => {
    let found: Unit | null = null;
    let best = Infinity;
    enemiesIn(
      x,
      y,
      owner,
      range,
      (u, d) => {
        const score = d - (unitTuning(t, u.type).towerArmor !== undefined ? 1000 : 0);
        if (score < best) {
          best = score;
          found = u;
        }
      },
      air,
    );
    return found;
  };
  /** The enemy with the most health left: the one worth a huge bolt. */
  const toughest = (x: number, y: number, owner: number, range: number): Unit | null => {
    let found: Unit | null = null;
    let best = -Infinity;
    enemiesIn(x, y, owner, range, (u, d) => {
      const score = u.hp - d * 0.01;
      if (score > best) {
        best = score;
        found = u;
      }
    });
    return found;
  };

  for (const c of s.military) {
    const kind = s.kind[c];
    if (isProducer(kind) || kind === Kind.Bell || !isActive(s, c)) continue;
    const spec = unlockTuning(t, kind);
    if (kind !== Kind.Crossbow && !spec) continue; // money and science buildings
    const owner = s.owner[c];
    const colony = s.colonies[owner - 1];
    const m = colony.mods;
    const x = (c % w) + 0.5;
    const y = ((c / w) | 0) + 0.5;
    const range = towerRange(t, colony, kind) + radarBonus(s, t, owner, x, y);

    if (kind === Kind.Obelisk) {
      fireObelisk(s, t, c, owner, x, y, range, enemiesIn, toughest);
      continue;
    }
    // Reloading. A tower fires on the very tick its reload runs out, so a 1-second reload
    // means one shot every 10 ticks, not 11.
    if (s.timer[c] > 0) {
      s.timer[c] -= dt;
      if (s.timer[c] > 1e-6) continue;
    }
    // Shrines and missile silos work with or without enemies about; everything else needs a target.
    if (!blocks && kind !== Kind.Shrine && kind !== Kind.MissileSilo && kind !== Kind.NukeSilo) continue;

    let reload = 0;
    switch (kind) {
      case Kind.Crossbow: {
        const target = nearest(x, y, owner, range);
        if (!target) break;
        hurt(t, target, t.defence.crossbow.damage * m.towerDamage);
        events.push({ type: 'shot', x0: x, y0: y, x1: target.x, y1: target.y, owner, style: 'bolt' });
        reload = t.defence.crossbow.cooldownSeconds;
        break;
      }
      case Kind.Ballista: {
        const target = toughest(x, y, owner, range);
        if (!target || !spec) break;
        // A ballista bolt goes straight through armour.
        hurt(t, target, (spec.damage ?? 0) * m.towerDamage, true);
        events.push({ type: 'shot', x0: x, y0: y, x1: target.x, y1: target.y, owner, style: 'ballista' });
        reload = spec.cooldownSeconds ?? 1;
        break;
      }
      case Kind.Flame: {
        if (!spec) break;
        let hit = 0;
        const damage = (spec.damage ?? 0) * m.towerDamage;
        enemiesIn(x, y, owner, range, (u) => {
          hurt(t, u, damage);
          hit++;
        });
        if (hit === 0) break;
        events.push({ type: 'blast', x, y, radius: range, style: 'fire' });
        reload = spec.cooldownSeconds ?? 1;
        break;
      }
      case Kind.Frost: {
        if (!spec) break;
        let hit = 0;
        const factor = spec.slow ?? 1;
        const until = s.tick + Math.round((spec.slowSeconds ?? 1) * t.tickRate);
        enemiesIn(x, y, owner, range, (u) => {
          hurt(t, u, spec.damage ?? 0);
          // Overlapping frost does not stack: the strongest chill applies.
          const stillCold = (u.slowUntil ?? 0) > s.tick;
          u.slowFactor = stillCold ? Math.min(u.slowFactor ?? 1, factor) : factor;
          u.slowUntil = until;
          hit++;
        });
        if (hit === 0) break;
        // A visible pulse every other firing is plenty.
        if (s.tick % 2 === 0) events.push({ type: 'blast', x, y, radius: range, style: 'frost' });
        reload = spec.cooldownSeconds ?? 1;
        break;
      }
      case Kind.Lightning: {
        if (!spec) break;
        let target = nearest(x, y, owner, range);
        if (!target) break;
        const struck = new Set<number>();
        let damage = (spec.damage ?? 0) * m.towerDamage;
        let fromX = x;
        let fromY = y;
        const jumps = spec.jumps ?? 0;
        for (let j = 0; j <= jumps && target; j++) {
          struck.add(target.id);
          hurt(t, target, damage);
          events.push({ type: 'shot', x0: fromX, y0: fromY, x1: target.x, y1: target.y, owner, style: 'lightning' });
          fromX = target.x;
          fromY = target.y;
          damage *= spec.falloff ?? 1;
          let next: Unit | null = null;
          let best = Infinity;
          enemiesIn(fromX, fromY, owner, spec.jumpRange ?? 0, (u, d) => {
            if (!struck.has(u.id) && d < best) {
              best = d;
              next = u;
            }
          });
          target = next;
        }
        reload = spec.cooldownSeconds ?? 1;
        break;
      }
      case Kind.Cannon: {
        if (!spec) break;
        const target = nearest(x, y, owner, range);
        if (!target) break;
        const splash = spec.splash ?? 1;
        const tx = target.x;
        const ty = target.y;
        enemiesIn(tx, ty, owner, splash, (u) => {
          hurt(t, u, (spec.damage ?? 0) * m.towerDamage);
        });
        events.push({ type: 'shot', x0: x, y0: y, x1: tx, y1: ty, owner, style: 'cannon' });
        events.push({ type: 'blast', x: tx, y: ty, radius: splash, style: 'cannon' });
        reload = spec.cooldownSeconds ?? 1;
        break;
      }
      case Kind.MachineGun: {
        // A hail of light bullets: very fast, very little each. Armour shrugs it off.
        const target = nearest(x, y, owner, range);
        if (!target || !spec) break;
        hurt(t, target, (spec.damage ?? 0) * m.towerDamage);
        if (s.tick % 2 === 0) events.push({ type: 'shot', x0: x, y0: y, x1: target.x, y1: target.y, owner, style: 'bolt' });
        reload = spec.cooldownSeconds ?? 1;
        break;
      }
      case Kind.AABattery: {
        // Anti-air: the only tower that can hit aircraft, and it shoots at nothing else.
        const target = nearest(x, y, owner, range, 'air');
        if (!target || !spec) break;
        hurt(t, target, (spec.damage ?? 0) * m.towerDamage, true);
        events.push({ type: 'shot', x0: x, y0: y, x1: target.x, y1: target.y, owner, style: 'ballista' });
        reload = spec.cooldownSeconds ?? 1;
        break;
      }
      case Kind.MissileSilo:
      case Kind.NukeSilo: {
        // A warhead at a random building of the colony your army is attacking (or else the
        // nearest rival), anywhere on the map. It flies for a few seconds, then lands.
        if (!spec) break;
        const aim = siloTarget(s, colony, x, y);
        if (!aim) break;
        const nuke = kind === Kind.NukeSilo;
        const tx = (aim.cell % w) + 0.5;
        const ty = ((aim.cell / w) | 0) + 0.5;
        s.strikes.push({
          owner,
          victim: aim.victim.id,
          x0: x,
          y0: y,
          x: tx,
          y: ty,
          launch: s.tick,
          land: s.tick + Math.max(1, Math.round((spec.flightSeconds ?? 2) * t.tickRate)),
          radius: spec.splash ?? 1,
          damage: (spec.damage ?? 0) * m.towerDamage,
          nuke,
        });
        events.push({ type: 'launch', owner, victim: aim.victim.id, x: tx, y: ty, nuke });
        reload = spec.cooldownSeconds ?? 1;
        break;
      }
      case Kind.Hex: {
        // Bewitch the nearest light enemy: from now on it fights for this colony.
        if (!spec) break;
        let victim: Unit | null = null;
        let best = Infinity;
        enemiesIn(x, y, owner, range, (u, d) => {
          if (unitMaxHp(t, s.colonies[u.owner - 1], u.type) > (spec.charmHp ?? 0)) return;
          if (d < best) {
            best = d;
            victim = u;
          }
        });
        const charmed = victim as Unit | null;
        if (!charmed) break;
        const from = charmed.owner;
        charmed.owner = owner;
        charmed.home = -1;
        charmed.target = -1;
        charmed.hp = Math.min(unitMaxHp(t, colony, charmed.type), charmed.hp + 10);
        s.navDirty = true;
        events.push({ type: 'shot', x0: x, y0: y, x1: charmed.x, y1: charmed.y, owner, style: 'hex' });
        events.push({ type: 'blast', x: charmed.x, y: charmed.y, radius: 0.8, style: 'hex' });
        events.push({ type: 'charm', owner, from, x: charmed.x, y: charmed.y });
        reload = spec.cooldownSeconds ?? 1;
        break;
      }
      case Kind.Marksman: {
        // Picks off the back line first: healers, bearers, sappers, mages and siege engines.
        if (!spec) break;
        let target: Unit | null = null;
        let best = Infinity;
        enemiesIn(x, y, owner, range, (u, d) => {
          const score = d - (BACK_LINE.includes(u.type) ? 100 : 0);
          if (score < best) {
            best = score;
            target = u;
          }
        });
        const aimed = target as Unit | null;
        if (!aimed) break;
        hurt(t, aimed, (spec.damage ?? 0) * m.towerDamage, true);
        events.push({ type: 'shot', x0: x, y0: y, x1: aimed.x, y1: aimed.y, owner, style: 'sniper' });
        reload = spec.cooldownSeconds ?? 1;
        break;
      }
      case Kind.Railgun: {
        // A slug through every enemy in a straight line, out to the end of its reach.
        if (!spec) break;
        const first = nearest(x, y, owner, range);
        if (!first) break;
        const fx = x + deltaX(s, x, first.x);
        const fy = y + deltaY(s, y, first.y);
        const len = Math.hypot(fx - x, fy - y) || 1;
        const ex = x + ((fx - x) / len) * range;
        const ey = y + ((fy - y) / len) * range;
        const damage = (spec.damage ?? 0) * m.towerDamage;
        enemiesIn((x + ex) / 2, (y + ey) / 2, owner, range / 2 + 1, (u) => {
          const ux = x + deltaX(s, x, u.x);
          const uy = y + deltaY(s, y, u.y);
          if (segmentDistance(ux, uy, x, y, ex, ey) <= 0.6) hurt(t, u, damage, true);
        });
        events.push({ type: 'shot', x0: x, y0: y, x1: ex, y1: ey, owner, style: 'rail' });
        reload = spec.cooldownSeconds ?? 1;
        break;
      }
      case Kind.Shrine: {
        if (!spec) break;
        if (healAround(s, t, colony, x, y, range, (spec.heal ?? 0), enemiesIn)) {
          events.push({ type: 'blast', x, y, radius: range, style: 'heal' });
        }
        reload = spec.cooldownSeconds ?? 1;
        break;
      }
    }
    if (reload > 0) s.timer[c] = reload * m.towerReload * bellFactor(s, t, owner, x, y);
  }

  // Every Center Tower defends itself (D15).
  for (const colony of s.colonies) {
    if (!colony.alive) continue;
    if (colony.towerReload > 0) {
      colony.towerReload -= dt;
      if (colony.towerReload > 1e-6) continue;
    }
    if (!blocks) continue;
    const def = t.defence.tower;
    const x = (colony.tower % w) + TOWER_SIZE / 2;
    const y = ((colony.tower / w) | 0) + TOWER_SIZE / 2;
    // The Center Tower shoots at anything, aircraft included.
    const target = nearest(x, y, colony.id, def.range + colony.mods.towerRange, 'both');
    if (!target) continue;
    hurt(t, target, def.damage * colony.mods.towerDamage);
    events.push({ type: 'shot', x0: x, y0: y, x1: target.x, y1: target.y, owner: colony.id, style: 'bolt' });
    colony.towerReload = def.cooldownSeconds * colony.mods.towerReload * bellFactor(s, t, colony.id, x, y);
  }
}

/** Tower damage to a unit. Shields take only part of it; so do armoured units, unless the shot pierces armour. */
function hurt(t: Tuning, u: Unit, damage: number, pierce = false): void {
  const def = unitTuning(t, u.type);
  u.hp -= damage * (def.towerArmor ?? 1) * (pierce ? 1 : (def.armor ?? 1));
}

/** Obelisk: hold the beam on one enemy; the longer it holds, the more it burns. */
function fireObelisk(
  s: GameState,
  t: Tuning,
  c: number,
  owner: number,
  x: number,
  y: number,
  range: number,
  enemiesIn: (x: number, y: number, owner: number, range: number, visit: (u: Unit, d: number) => void) => void,
  toughest: (x: number, y: number, owner: number, range: number) => Unit | null,
): void {
  const spec = unlockTuning(t, Kind.Obelisk);
  if (!spec) return;
  const dt = 1 / t.tickRate;
  let target: Unit | null = null;
  const locked = s.lock[c];
  if (locked > 0) {
    enemiesIn(x, y, owner, range, (u) => {
      if (u.id === locked) target = u;
    });
  }
  const held = target as Unit | null;
  if (held) {
    s.heat[c] += dt;
  } else {
    const fresh = toughest(x, y, owner, range);
    s.lock[c] = fresh ? fresh.id : 0;
    s.heat[c] = 0;
    target = fresh;
  }
  const victim = target as Unit | null;
  if (!victim) return;
  const ramp = spec.rampSeconds ?? 1;
  const start = spec.damage ?? 0;
  const dps = start + ((spec.maxDamage ?? start) - start) * Math.min(1, s.heat[c] / ramp);
  hurt(t, victim, dps * s.colonies[owner - 1].mods.towerDamage * dt);
}

/** Shrine: restore health to the colony's own squares and units in range. Returns true if anything healed. */
function healAround(
  s: GameState,
  t: Tuning,
  colony: Colony,
  x: number,
  y: number,
  range: number,
  amount: number,
  enemiesIn: (x: number, y: number, owner: number, range: number, visit: (u: Unit, d: number) => void) => void,
): boolean {
  const id = colony.id;
  let healed = false;
  const r = Math.ceil(range);
  let towerInRange = false;
  for (let cy = Math.floor(y) - r; cy <= Math.floor(y) + r; cy++) {
    for (let cx = Math.floor(x) - r; cx <= Math.floor(x) + r; cx++) {
      const c = cellAt(s, cx, cy);
      if (c < 0 || s.owner[c] !== id || Math.hypot(cx + 0.5 - x, cy + 0.5 - y) > range) continue;
      if (s.kind[c] === Kind.Tower) {
        towerInRange = true;
        continue;
      }
      // Buildings still going up mend themselves; the shrine leaves them alone.
      if (s.tick < s.readyTick[c]) continue;
      const full = maxHealthAt(s, t, c);
      if (s.hp[c] < full) {
        s.hp[c] = Math.min(full, s.hp[c] + amount);
        healed = true;
      }
    }
  }
  if (towerInRange) {
    const full = towerMaxHealth(t, colony);
    if (colony.towerHp < full) {
      colony.towerHp = Math.min(full, colony.towerHp + amount);
      healed = true;
    }
  }
  // Own units: enemiesIn skips its owner, so look them up as "enemies of nobody" and filter.
  enemiesIn(x, y, 0, range, (u) => {
    if (u.owner !== id) return;
    const full = unitMaxHp(t, colony, u.type);
    if (u.hp < full) {
      u.hp = Math.min(full, u.hp + amount);
      healed = true;
    }
  });
  return healed;
}
