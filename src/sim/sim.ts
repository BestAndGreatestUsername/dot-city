// The simulation's two entry points: apply a command, advance one tick.
// The player and the AI both act only through commands, under the same rules and prices.

import { aiCommands } from './ai';
import { buildingTuning, costOf, stepEconomy } from './economy';
import { isLocked } from './catalog';
import { stepGrowth } from './growth';
import { isMilitary, maxHealthAt, stepStructures } from './health';
import { refreshLinks } from './link';
import { stepRegen } from './health';
import { applyChoice, rollOffer, stepResearch } from './research';
import { refreshNav } from './nav';
import { addPending, ownFarmNeighbours, refreshAround } from './state';
import { Kind, type Command, type GameState, type SimEvent, type Tuning } from './types';
import { stepDefences } from './towers';
import { removeDeadUnits, stepProduction, stepUnits } from './units';

/** Whether this colony may convert this cell at all (ignoring price): only its own houses. */
export function canConvert(s: GameState, owner: number, cell: number): boolean {
  return cell >= 0 && cell < s.kind.length && s.owner[cell] === owner && s.kind[cell] === Kind.House;
}

/** Returns true if the command was legal, affordable, and changed the state. */
export function applyCommand(s: GameState, t: Tuning, cmd: Command, events: SimEvent[]): boolean {
  const colony = s.colonies[cmd.owner - 1];
  if (!colony || !colony.alive) return false;

  if (cmd.type === 'convert') {
    if (!buildingTuning(t, cmd.to) || !canConvert(s, cmd.owner, cmd.cell)) return false;
    // Buildings that research unlocks cannot be built before they are unlocked.
    if (isLocked(colony, cmd.to)) return false;
    const cost = costOf(s, t, cmd.owner, cmd.to);
    if (colony.gold < cost) return false;
    colony.gold -= cost;

    // A new farm links up with every farm beside it: one link for itself, one for the neighbour.
    if (cmd.to === Kind.Farm) colony.farmLinks += 2 * ownFarmNeighbours(s, cmd.cell, cmd.owner);

    // Conversion is instant and permanent (D3): the square stops being a growth source.
    s.kind[cmd.cell] = cmd.to;
    colony.houses--;
    colony.buildings++;
    colony.counts[cmd.to]++;

    // D9: the building appears at once but starts weak and does nothing until it is finished.
    s.hp[cmd.cell] = maxHealthAt(s, t, cmd.cell) * t.combat.buildStartHealth;
    s.readyTick[cmd.cell] = s.tick + Math.round(t.combat.buildSeconds * t.tickRate * colony.mods.buildTime);
    // What a cut-off district contains has changed.
    if (colony.dormant.cells > 0) colony.linkDirty = true;
    s.timer[cmd.cell] = 0;
    s.lock[cmd.cell] = 0;
    s.heat[cmd.cell] = 0;
    addPending(s, cmd.cell);
    if (isMilitary(cmd.to)) s.military.push(cmd.cell);

    refreshAround(s, cmd.cell);
    s.navDirty = true;
    events.push({ type: 'convert', cell: cmd.cell, owner: cmd.owner, to: cmd.to });
    return true;
  }

  if (cmd.type === 'order') {
    // D12: one order for the whole colony. 0 = Hold, otherwise attack that colony.
    if (cmd.target !== 0) {
      const target = s.colonies[cmd.target - 1];
      if (!target || !target.alive || target.id === colony.id) return false;
    }
    if (colony.order === cmd.target) return false;
    colony.order = cmd.target;
    if (cmd.target === 0) colony.launchStrength = 0;
    events.push({ type: 'order', owner: colony.id, target: cmd.target });
    // Units should react at once, not at the next scheduled path refresh.
    s.navDirty = true;
    s.navTick = -1000000;
    return true;
  }

  if (cmd.type === 'research') {
    if (!applyChoice(s, t, colony, cmd.choice, events)) return false;
    // More draws banked: lay out the next offer at once, so choosing works while paused too.
    if (colony.pendingDraws > 0) {
      const offer = rollOffer(s, t, colony);
      if (offer.length > 0) colony.offer = offer;
      else colony.pendingDraws = 0;
    }
    return true;
  }

  if (cmd.type === 'reroll') {
    // D18: pay gold for a fresh set of options.
    if (!colony.offer || colony.gold < t.research.rerollCost) return false;
    colony.gold -= t.research.rerollCost;
    colony.offer = rollOffer(s, t, colony);
    return true;
  }
  return false;
}

/** Advance the world by exactly one fixed tick. */
export function step(s: GameState, t: Tuning, events: SimEvent[]): void {
  // The first Airfield or Helipad anywhere: from now on Anti-Air can turn up in research, and often.
  if (!s.airborne) {
    const flier = s.colonies.find((c) => c.alive && (c.counts[Kind.Airfield] > 0 || c.counts[Kind.Helipad] > 0));
    if (flier) {
      s.airborne = true;
      events.push({ type: 'airborne', owner: flier.id });
    }
  }
  stepRegen(s, t);
  if (s.bots.length > 0) for (const cmd of aiCommands(s, t)) applyCommand(s, t, cmd, events);
  refreshLinks(s);
  stepGrowth(s, t, events);
  stepEconomy(s, t);
  stepResearch(s, t);
  stepStructures(s, t, events);
  stepProduction(s, t);
  refreshNav(s, t);
  stepUnits(s, t, events);
  stepDefences(s, t, events);
  removeDeadUnits(s, events);
  s.tick++;
}
