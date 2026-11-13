// The research draft (D17, D18, D19).
//
// Science accumulates. Each time it passes a threshold the colony banks one draw; thresholds
// rise with every draw. A draw offers two options and the colony takes one. Almost always they
// are new buildings; rarely one is a modifier that touches a whole category (all units, all
// towers, all gold...). For the player the game pauses until the choice is made (see main.ts).
// An offer can be re-rolled for gold (D18). The pool is data: src/data/research.json.

import researchJson from '../data/research.json';
import { ECONOMY, GROWTH, kindOfKey, SCIENCE } from './catalog';
import { nextFloat } from './rng';
import { Kind, type Colony, type GameState, type Mods, type SimEvent, type Tuning } from './types';

/** A new building, or (rarely) a modifier that touches a whole category. */
export type ResearchKind = 'building' | 'modifier';

export interface ResearchOption {
  id: string;
  tier: number;
  kind: ResearchKind;
  name: string;
  text: string;
  effects: Array<{ mod: string; mul?: number; add?: number }>;
  /** Catalog key of the building this unlocks. */
  unlock?: string;
  /** The age (1 Medieval, 2 Gunpowder, 3 Industrial, 4 Modern) from which it can be discovered. */
  age?: number;
}

export const RESEARCH: ResearchOption[] = researchJson as ResearchOption[];
const BY_ID = new Map(RESEARCH.map((o) => [o.id, o]));

export function researchOption(id: string): ResearchOption {
  return BY_ID.get(id) as ResearchOption;
}

/** Science needed for the next draw. */
export function nextThreshold(t: Tuning, colony: Colony): number {
  // Printing Presses make every discovery cheaper, up to a cap.
  const press = t.unlockables.press;
  const discount = press ? Math.min(press.cap ?? 0, (press.discount ?? 0) * colony.counts[Kind.PrintingPress]) : 0;
  return Math.round(t.research.baseCost * Math.pow(t.research.costGrowth, colony.drawsEarned) * (1 - discount));
}

export function openTier(t: Tuning, colony: Colony): number {
  if (colony.picks.length >= t.research.tier3Picks) return 3;
  if (colony.picks.length >= t.research.tier2Picks) return 2;
  return 1;
}

/** The age the game has reached at this tick: 1 Medieval, 2 Gunpowder, 3 Industrial, 4 Modern. */
export function ageAt(t: Tuning, tick: number): number {
  let age = 1;
  t.ages.forEach((a, i) => {
    if (tick >= a.startSeconds * t.tickRate) age = i + 1;
  });
  return age;
}

/**
 * Options not yet taken, from the open tiers and the ages reached so far. (Without a state, as
 * in some tests, every age counts as open.)
 */
export function offerPool(t: Tuning, colony: Colony, s?: GameState): ResearchOption[] {
  const tier = openTier(t, colony);
  const age = s ? s.age : 99;
  return RESEARCH.filter((o) => o.tier <= tier && (o.age ?? 1) <= age && !colony.picks.includes(o.id));
}

/** Options that add income: money and science buildings, and the modifiers that raise gold or science. */
export function isIncomeOption(option: ResearchOption): boolean {
  if (option.unlock) {
    const kind = kindOfKey(option.unlock);
    return kind !== undefined && (ECONOMY.includes(kind) || SCIENCE.includes(kind) || GROWTH.includes(kind));
  }
  return option.effects.some((e) => e.mod === 'gold' || e.mod === 'science');
}

/** How likely an option is to be drawn, against 1 for an ordinary one. Income is rarer. */
export function optionWeight(t: Tuning, option: ResearchOption): number {
  if (!isIncomeOption(option)) return 1;
  return option.kind === 'modifier' ? t.research.incomeModifierWeight : t.research.incomeWeight;
}

/** Draw one option, by weight, and take it out of the list. */
function drawWeighted(s: GameState, t: Tuning, from: ResearchOption[]): ResearchOption {
  let total = 0;
  for (const o of from) total += optionWeight(t, o);
  let roll = nextFloat(s) * total;
  let i = 0;
  for (; i < from.length - 1; i++) {
    roll -= optionWeight(t, from[i]);
    if (roll < 0) break;
  }
  return from.splice(i, 1)[0];
}

/**
 * `offerSize` different options. Each slot is a new building, except that with a small chance
 * (`modifierChance`) it is a general modifier instead. Buildings and modifiers that add gold or
 * science come up less often than the rest. Once every building is unlocked, only modifiers
 * are left.
 */
export function rollOffer(s: GameState, t: Tuning, colony: Colony): string[] {
  // An age breakthrough offers only the new age's buildings (while any are left to take).
  if (colony.ageOffer > 0) {
    const fresh = offerPool(t, colony, s).filter((o) => o.kind === 'building' && (o.age ?? 1) === colony.ageOffer);
    colony.ageOffer = 0;
    const offer: string[] = [];
    while (offer.length < t.research.offerSize && fresh.length > 0) offer.push(drawWeighted(s, t, fresh).id);
    if (offer.length > 0) return offer;
  }
  const pool = offerPool(t, colony, s);
  const buildings = pool.filter((o) => o.kind === 'building');
  const modifiers = pool.filter((o) => o.kind === 'modifier');
  const offer: string[] = [];
  while (offer.length < t.research.offerSize && buildings.length + modifiers.length > 0) {
    const rare = modifiers.length > 0 && (buildings.length === 0 || nextFloat(s) < t.research.modifierChance);
    offer.push(drawWeighted(s, t, rare ? modifiers : buildings).id);
  }
  return offer;
}

/** Take one option from the current offer. */
export function applyChoice(s: GameState, colony: Colony, index: number, events: SimEvent[]): boolean {
  if (!colony.offer || index < 0 || index >= colony.offer.length) return false;
  const option = researchOption(colony.offer[index]);
  const mods = colony.mods as unknown as Record<string, number>;
  for (const e of option.effects) {
    if (e.mul !== undefined) mods[e.mod] *= e.mul;
    if (e.add !== undefined) mods[e.mod] += e.add;
    // D3: upgrades apply in place. What already stands is strengthened with the rule.
    if (e.mul !== undefined && e.mod === 'towerHealth') colony.towerHp *= e.mul;
    if (e.mul !== undefined && e.mod === 'structureHealth') {
      for (let c = 0; c < s.kind.length; c++) {
        if (s.owner[c] === colony.id && s.kind[c] !== Kind.House && s.kind[c] !== Kind.Tower) s.hp[c] *= e.mul;
      }
    }
  }
  if (option.unlock) {
    const kind = kindOfKey(option.unlock);
    if (kind && !colony.unlocked.includes(kind)) colony.unlocked.push(kind);
  }
  colony.picks.push(option.id);
  colony.pendingDraws--;
  colony.offer = null;
  events.push({ type: 'research', owner: colony.id, id: option.id });
  return true;
}

/** Bank draws as science passes thresholds, and lay out an offer whenever one is owed. */
export function stepResearch(s: GameState, t: Tuning): void {
  for (const colony of s.colonies) {
    if (!colony.alive) continue;
    let need = nextThreshold(t, colony);
    while (colony.science >= need) {
      colony.science -= need;
      colony.drawsEarned++;
      colony.pendingDraws++;
      need = nextThreshold(t, colony);
    }
    if (colony.pendingDraws > 0 && !colony.offer) {
      const offer = rollOffer(s, t, colony);
      if (offer.length > 0) colony.offer = offer;
      else colony.pendingDraws = 0;
    }
  }
}

export function defaultMods(): Mods {
  return {
    unitSpeed: 1,
    unitDamage: 1,
    unitHealth: 1,
    spawnTime: 1,
    armySize: 0,
    siege: 1,
    roads: 0,
    towerRange: 0,
    towerDamage: 1,
    towerReload: 1,
    structureHealth: 1,
    towerHealth: 1,
    gold: 1,
    science: 1,
    buildTime: 1,
  };
}
