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
//
// Towers do nothing while under construction (D9). Cut-off towers keep firing (D5).

import { isProducer, towerRange, unitMaxHp, unitTuning, unlockTuning } from './catalog';
import { isActive, maxHealthAt, towerMaxHealth } from './health';
import { buildBlocks, forEachNearby, type Blocks } from './spatial';
import { cellAt, dist } from './topo';
import { blastSquares, mostValuableBuilding } from './units';
import { Kind, TOWER_SIZE, type Colony, type GameState, type SimEvent, type Tuning, type Unit } from './types';

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

export function stepDefences(s: GameState, t: Tuning, events: SimEvent[]): void {
  const dt = 1 / t.tickRate;
  const w = s.width;
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
        const flies = unitTuning(t, u.type).flies === true;
        if ((air === 'ground' && flies) || (air === 'air' && !flies)) return;
        const d = dist(s, x, y, u.x, u.y);
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
    const range = towerRange(t, colony, kind);

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
    if (!blocks && kind !== Kind.Shrine && kind !== Kind.MissileSilo) continue;

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
      case Kind.MissileSilo: {
        // A missile at the most valuable building of the colony at war with (or else the
        // nearest rival), anywhere on the map.
        if (!spec) break;
        let enemy = colony.order > 0 && s.colonies[colony.order - 1].alive ? s.colonies[colony.order - 1] : null;
        if (!enemy) {
          let far = Infinity;
          for (const other of s.colonies) {
            if (!other.alive || other.id === owner) continue;
            const d = dist(s, x, y, (other.tower % w) + 1, ((other.tower / w) | 0) + 1);
            if (d < far) {
              far = d;
              enemy = other;
            }
          }
        }
        if (!enemy) break;
        const aim = mostValuableBuilding(s, t, enemy.id);
        if (aim < 0) break;
        const tx = (aim % w) + 0.5;
        const ty = ((aim / w) | 0) + 0.5;
        blastSquares(s, t, owner, tx, ty, spec.splash ?? 1, (spec.damage ?? 0) * m.towerDamage, events);
        events.push({ type: 'shot', x0: x, y0: y, x1: tx, y1: ty, owner, style: 'missile' });
        events.push({ type: 'blast', x: tx, y: ty, radius: spec.splash ?? 1, style: 'cannon' });
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
