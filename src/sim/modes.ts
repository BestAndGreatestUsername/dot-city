// Game modes: the same world, different ways to win.
//   Conquest   the classic: the last tower standing wins
//   Last Stand every rival hunts you from the start; survive until the clock runs out
//   Gold Rush  the first colony to bank a fortune wins (rivals race you for it)
//   Crown      a crown lies in the contested middle; hold its square long enough to win
//   Blitz      everything fast: double income and science, quicker armies, early wars
//   Sandbox    rivals never attack; a fat treasury and fast research to try everything
// In every mode, taking every rival tower is still a win, and losing your own is still a loss.

import { colonySize } from './state';
import { Kind, Terrain, type GameState, type SimEvent, type Tuning } from './types';

export const MODES = ['conquest', 'laststand', 'goldrush', 'crown', 'blitz', 'sandbox'] as const;
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
    case 'crown':
      return { name: 'King of the Hill', tagline: 'Hold the crown.', goal: `Grow onto the crown in the middle of the map and hold it for ${minutes(m.crownSeconds)} in all.` };
    case 'blitz':
      return { name: 'Blitz', tagline: 'Everything, faster.', goal: 'Double income and science, quicker armies, early wars. Last tower standing wins.' };
    case 'sandbox':
      return { name: 'Sandbox', tagline: 'Build in peace.', goal: 'Rivals never attack (unless you turn it on). A fat treasury and fast research.' };
    default:
      return { name: 'Conquest', tagline: 'The classic.', goal: 'Destroy every rival tower. Last tower standing wins.' };
  }
}

/** Set a new game up for its mode: start-up money, speed-ups, the crown. */
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
  } else if (mode === 'crown') {
    s.crown = crownCell(s);
  }
}

/** The open square furthest from every tower: the contested heart of the map. */
function crownCell(s: GameState): number {
  const w = s.width;
  let best = -1;
  let bestGap = -1;
  for (let c = 0; c < s.terrain.length; c++) {
    if (s.terrain[c] !== Terrain.Grass && s.terrain[c] !== Terrain.Forest) continue;
    const x = c % w;
    const y = (c / w) | 0;
    if (x < 3 || y < 3 || x >= w - 3 || y >= s.height - 3) continue;
    let gap = Infinity;
    for (const colony of s.colonies) {
      let dx = Math.abs(x - ((colony.tower % w) + 1));
      let dy = Math.abs(y - (((colony.tower / w) | 0) + 1));
      if (s.wrap) {
        dx = Math.min(dx, w - dx);
        dy = Math.min(dy, s.height - dy);
      }
      gap = Math.min(gap, Math.hypot(dx, dy));
    }
    if (gap > bestGap) {
      bestGap = gap;
      best = c;
    }
  }
  return best;
}

/** The colony holding the crown square, or 0. */
export function crownHolder(s: GameState): number {
  if (s.crown < 0) return 0;
  const o = s.owner[s.crown];
  return o > 0 && s.colonies[o - 1].alive && s.kind[s.crown] !== Kind.Rubble ? o : 0;
}

/** The colony leading the race: most gold (Gold Rush) or most crown time (Crown). */
export function modeLeader(s: GameState): number {
  let best = 0;
  let bestScore = -1;
  for (const colony of s.colonies) {
    if (!colony.alive) continue;
    const score = s.mode === 'goldrush' ? colony.gold : s.mode === 'crown' ? colony.crownTicks : colonySize(colony);
    if (score > bestScore) {
      bestScore = score;
      best = colony.id;
    }
  }
  return best;
}

/** Each tick: keep score, and declare a winner when someone meets the mode's goal. */
export function stepMode(s: GameState, t: Tuning, events: SimEvent[]): void {
  if (s.winner > 0) return;
  const m = t.modes;
  const win = (owner: number, reason: string) => {
    s.winner = owner;
    events.push({ type: 'modeWin', owner, reason });
  };
  if (s.mode === 'goldrush') {
    for (const colony of s.colonies) {
      if (colony.alive && colony.gold >= m.goldRushTarget) return win(colony.id, `banked ${m.goldRushTarget} gold first`);
    }
  } else if (s.mode === 'crown') {
    const holder = crownHolder(s);
    if (holder !== s.crownHolder) {
      s.crownHolder = holder;
      events.push({ type: 'crown', owner: holder });
    }
    if (holder > 0) {
      const colony = s.colonies[holder - 1];
      colony.crownTicks++;
      if (colony.crownTicks >= m.crownSeconds * t.tickRate) return win(holder, `held the crown for ${Math.round(m.crownSeconds / 60)} minutes`);
    }
  } else if (s.mode === 'laststand') {
    // The human colonies (not run by the AI) win by still standing when the clock runs out.
    if (s.tick >= m.lastStandSeconds * t.tickRate) {
      const human = s.colonies.find((c) => c.alive && !s.bots.includes(c.id));
      if (human) return win(human.id, `survived ${Math.round(m.lastStandSeconds / 60)} minutes`);
    }
  }
}
