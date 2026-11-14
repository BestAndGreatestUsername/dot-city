// Game modes: the same world, different ways to win.
//   Conquest   the classic: the last tower standing wins
//   Last Stand every rival hunts you from the start; survive until the clock runs out
//   Gold Rush  the first colony to bank a fortune wins (rivals race you for it)
//   Apocalypse swarms of the dead rise from the ground around every city, bigger each wave;
//              the last colony standing wins
//   Blitz      everything fast: double income and science, quicker armies, early wars
//   Sandbox    rivals never attack; a fat treasury and fast research to try everything
// In every mode, taking every rival tower is still a win, and losing your own is still a loss.

import { unitTuning } from './catalog';
import { nextFloat, nextInt } from './rng';
import { cellAt } from './topo';
import { Terrain, UnitType, type GameState, type SimEvent, type Tuning } from './types';

export const MODES = ['conquest', 'laststand', 'goldrush', 'apocalypse', 'blitz', 'sandbox'] as const;
export type GameMode = (typeof MODES)[number];

export interface ModeInfo {
  name: string;
  /** One line for the mode card. */
  tagline: string;
  /** How to win, in a sentence. */
  goal: string;
}

export function modeInfo(t: Tuning, mode: GameMode): ModeInfo {
  const m = t.modes;
  const minutes = (s: number) => `${Math.round(s / 60)} minutes`;
  switch (mode) {
    case 'laststand':
      return { name: 'Last Stand', tagline: 'Every rival hunts you.', goal: `Survive ${minutes(m.lastStandSeconds)} while every rival comes for you.` };
    case 'goldrush':
      return { name: 'Gold Rush', tagline: 'Race to a fortune.', goal: `Be the first to bank ${m.goldRushTarget} gold. Rivals race you for it.` };
    case 'apocalypse':
      return {
        name: 'Apocalypse',
        tagline: 'The dead rise.',
        goal: `Every ${m.waveSeconds} seconds the dead claw out of the ground around every city, more each time. Last colony standing wins.`,
      };
    case 'blitz':
      return { name: 'Blitz', tagline: 'Everything, faster.', goal: 'Double income and science, quicker armies, early wars. Last tower standing wins.' };
    case 'sandbox':
      return { name: 'Sandbox', tagline: 'Build in peace.', goal: 'Rivals never attack (unless you turn it on). A fat treasury and fast research.' };
    default:
      return { name: 'Conquest', tagline: 'The classic.', goal: 'Destroy every rival tower. Last tower standing wins.' };
  }
}

/** Set a new game up for its mode: start-up money, speed-ups, the first wave's timer. */
export function setupMode(s: GameState, t: Tuning, mode: GameMode): void {
  s.mode = mode;
  const m = t.modes;
  if (mode === 'blitz') {
    for (const colony of s.colonies) {
      colony.gold += m.blitzStartGold;
      colony.mods.gold *= m.blitzEconomy;
      colony.mods.science *= m.blitzEconomy;
      colony.mods.growth *= m.blitzGrowth;
      colony.mods.spawnTime *= 0.6;
      colony.mods.buildTime *= 0.5;
    }
  } else if (mode === 'sandbox') {
    s.aiAttacks = false;
    for (const colony of s.colonies) {
      if (s.bots.includes(colony.id)) continue;
      colony.gold += m.sandboxStartGold;
      colony.mods.science *= 3;
    }
  } else if (mode === 'apocalypse') {
    s.wave = 0;
    s.nextWave = Math.round(m.apocalypseGraceSeconds * t.tickRate);
  }
}

/** The colony leading the race: most gold (Gold Rush), or the biggest. */
export function modeLeader(s: GameState): number {
  let best = 0;
  let bestScore = -1;
  for (const colony of s.colonies) {
    if (!colony.alive) continue;
    const score = s.mode === 'goldrush' ? colony.gold : colony.houses + colony.buildings;
    if (score > bestScore) {
      bestScore = score;
      best = colony.id;
    }
  }
  return best;
}

/**
 * A wave of the dead: around every living city, a pack claws its way out of the open ground
 * just beyond its edge. Each wave is bigger and tougher than the last, and from a few waves in,
 * hulking brutes come with them.
 */
function spawnWave(s: GameState, t: Tuning, events: SimEvent[]): void {
  const m = t.modes;
  s.wave++;
  const w = s.width;
  const zombie = unitTuning(t, UnitType.Zombie);
  const brute = unitTuning(t, UnitType.Brute);
  const toughness = 1 + (s.wave - 1) * m.waveHpGrowth;
  let perColony = Math.round(m.waveBase + (s.wave - 1) * m.waveGrowth);
  // Never more than so many of the dead walk at once: past that, the wave is thinner.
  let walking = 0;
  for (const u of s.units) if (u.owner === 0) walking++;
  const alive = s.colonies.filter((c) => c.alive).length;
  perColony = Math.max(0, Math.min(perColony, Math.floor((m.maxDead - walking) / Math.max(1, alive))));
  let total = 0;
  for (const colony of s.colonies) {
    if (!colony.alive) continue;
    const tx = (colony.tower % w) + 1;
    const ty = ((colony.tower / w) | 0) + 1;
    // Two or three packs from different sides.
    const packs = s.wave >= 3 ? 3 : 2;
    for (let p = 0; p < packs; p++) {
      // Walk out from the tower until past the city's edge, then a few squares more.
      let spot = -1;
      for (let tries = 0; tries < 10 && spot < 0; tries++) {
        const a = nextFloat(s) * Math.PI * 2;
        let outside = 0;
        for (let r = 3; r < 60; r++) {
          const c = cellAt(s, Math.round(tx + Math.cos(a) * r), Math.round(ty + Math.sin(a) * r));
          if (c < 0) break;
          const open = s.terrain[c] === Terrain.Grass || s.terrain[c] === Terrain.Forest;
          if (s.owner[c] !== 0 || !open) {
            outside = 0;
            continue;
          }
          if (++outside >= 3) {
            spot = c;
            break;
          }
        }
      }
      if (spot < 0) continue;
      const sx = (spot % w) + 0.5;
      const sy = ((spot / w) | 0) + 0.5;
      if (perColony === 0) break;
      const count = Math.max(1, Math.round(perColony / packs));
      for (let i = 0; i < count; i++) {
        const big = s.wave >= m.bruteFromWave && i === 0 && (s.wave + p) % 2 === 0;
        const type = big ? UnitType.Brute : UnitType.Zombie;
        const def = big ? brute : zombie;
        // Scatter the pack over open ground around the spot.
        let x = sx;
        let y = sy;
        for (let k = 0; k < 6; k++) {
          const cx = sx + (nextFloat(s) - 0.5) * 3;
          const cy = sy + (nextFloat(s) - 0.5) * 3;
          const c = cellAt(s, Math.floor(cx), Math.floor(cy));
          if (c >= 0 && s.owner[c] === 0 && (s.terrain[c] === Terrain.Grass || s.terrain[c] === Terrain.Forest)) {
            x = cx;
            y = cy;
            break;
          }
        }
        const hp = def.hp * toughness;
        s.units.push({
          id: s.nextUnitId++,
          owner: 0,
          type,
          x,
          y,
          hp,
          home: -1,
          cooldown: nextInt(s, 10),
          facing: x < tx ? 1 : -1,
          noChaseUntil: 0,
          slowUntil: 0,
          slowFactor: 1,
          lastHp: hp,
          spearReady: 0,
          charge: 0,
          vx: 0,
          vy: 0,
          target: colony.id,
        });
        events.push({ type: 'rise', x, y });
        total++;
      }
    }
  }
  events.push({ type: 'wave', wave: s.wave, count: total });
  s.navDirty = true;
}

/** Each tick: keep score, raise the dead, and declare a winner when someone meets the mode's goal. */
export function stepMode(s: GameState, t: Tuning, events: SimEvent[]): void {
  const m = t.modes;
  if (s.mode === 'apocalypse' && s.tick >= s.nextWave && s.colonies.some((c) => c.alive)) {
    spawnWave(s, t, events);
    s.nextWave = s.tick + Math.round(m.waveSeconds * t.tickRate);
  }
  if (s.winner > 0) return;
  const win = (owner: number, reason: string) => {
    s.winner = owner;
    events.push({ type: 'modeWin', owner, reason });
  };
  if (s.mode === 'goldrush') {
    for (const colony of s.colonies) {
      if (colony.alive && colony.gold >= m.goldRushTarget) return win(colony.id, `banked ${m.goldRushTarget} gold first`);
    }
  } else if (s.mode === 'laststand') {
    // The human colonies (not run by the AI) win by still standing when the clock runs out.
    if (s.tick >= m.lastStandSeconds * t.tickRate) {
      const human = s.colonies.find((c) => c.alive && !s.bots.includes(c.id));
      if (human) return win(human.id, `survived ${Math.round(m.lastStandSeconds / 60)} minutes`);
    }
  }
}
