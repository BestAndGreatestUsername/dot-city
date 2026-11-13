// What each building is, which of them research unlocks, and which unit each army building raises.
//
// Available from the start: Wall, Farm, Research building, Crossbow Tower and Warrior Camp.
// Everything else is unlocked by research, including the Shield Barracks and Hound Yard
// (the user's change to D10). Numbers live in src/data/tuning.json: the original six under
// "buildings", the rest under "unlockables", keyed by the names below.

import { Kind, UnitType, type Colony, type Tuning, type UnitTuning, type UnlockTuning } from './types';

export type Category = 'economy' | 'science' | 'defence' | 'army';

/** Tuning key of every building whose numbers live under "unlockables". */
export const CATALOG_KEY: Record<number, string> = {
  [Kind.Ballista]: 'ballista',
  [Kind.Flame]: 'flame',
  [Kind.Bell]: 'bell',
  [Kind.Frost]: 'frost',
  [Kind.Lightning]: 'lightning',
  [Kind.Shrine]: 'shrine',
  [Kind.Cannon]: 'cannon',
  [Kind.Obelisk]: 'obelisk',
  [Kind.Mine]: 'mine',
  [Kind.Fishery]: 'fishery',
  [Kind.Market]: 'market',
  [Kind.Bank]: 'bank',
  [Kind.Library]: 'library',
  [Kind.Observatory]: 'observatory',
  [Kind.Academy]: 'academy',
  [Kind.Bastion]: 'bastion',
  [Kind.Camp]: 'camp',
  [Kind.Archery]: 'archery',
  [Kind.SpearHall]: 'spearhall',
  [Kind.Stable]: 'stable',
  [Kind.Workshop]: 'workshop',
  [Kind.Monastery]: 'monastery',
  [Kind.PowderHouse]: 'powder',
  [Kind.GiantLair]: 'lair',
  [Kind.Plaza]: 'plaza',
  [Kind.Thorns]: 'thorns',
  [Kind.BannerHall]: 'bannerhall',
  [Kind.MusketRange]: 'musket',
  [Kind.PrintingPress]: 'press',
  [Kind.Factory]: 'factory',
  [Kind.MachineGun]: 'mgnest',
  [Kind.ArtilleryWorks]: 'artworks',
  [Kind.TankFactory]: 'tankworks',
  [Kind.Airfield]: 'airfield',
  [Kind.AABattery]: 'aa',
  [Kind.PowerPlant]: 'power',
  [Kind.MissileSilo]: 'silo',
};

/** Research key of every building that has to be unlocked before it can be built. */
export const UNLOCK_KEY: Record<number, string> = {
  ...Object.fromEntries(Object.entries(CATALOG_KEY).filter(([kind]) => Number(kind) !== Kind.Camp)),
  [Kind.Barracks]: 'barracks',
  [Kind.Kennel]: 'kennel',
};

const KIND_BY_KEY: Record<string, number> = Object.fromEntries(Object.entries(UNLOCK_KEY).map(([kind, key]) => [key, Number(kind)]));

export const UNLOCKABLE: number[] = Object.keys(UNLOCK_KEY).map(Number);

/** Which unit each army building raises. */
export const PRODUCES: Record<number, number> = {
  [Kind.Camp]: UnitType.Warrior,
  [Kind.Barracks]: UnitType.Shield,
  [Kind.Kennel]: UnitType.Hound,
  [Kind.Archery]: UnitType.Archer,
  [Kind.SpearHall]: UnitType.Spearman,
  [Kind.Stable]: UnitType.Knight,
  [Kind.Workshop]: UnitType.Catapult,
  [Kind.Monastery]: UnitType.Monk,
  [Kind.PowderHouse]: UnitType.Sapper,
  [Kind.GiantLair]: UnitType.Giant,
  [Kind.BannerHall]: UnitType.Bearer,
  [Kind.MusketRange]: UnitType.Musketeer,
  [Kind.ArtilleryWorks]: UnitType.Artillery,
  [Kind.TankFactory]: UnitType.Tank,
  [Kind.Airfield]: UnitType.Bomber,
};
export const PRODUCERS: number[] = Object.keys(PRODUCES).map(Number);

/** Tuning key of every unit type. */
export const UNIT_KEY: Record<number, string> = {
  [UnitType.Shield]: 'shield',
  [UnitType.Hound]: 'hound',
  [UnitType.Warrior]: 'warrior',
  [UnitType.Archer]: 'archer',
  [UnitType.Spearman]: 'spearman',
  [UnitType.Knight]: 'knight',
  [UnitType.Catapult]: 'catapult',
  [UnitType.Monk]: 'monk',
  [UnitType.Sapper]: 'sapper',
  [UnitType.Giant]: 'giant',
  [UnitType.Bearer]: 'bearer',
  [UnitType.Musketeer]: 'musketeer',
  [UnitType.Artillery]: 'artillery',
  [UnitType.Tank]: 'tank',
  [UnitType.Bomber]: 'bomber',
};

export function unitTuning(t: Tuning, type: number): UnitTuning {
  return t.units[UNIT_KEY[type]] ?? t.units.shield;
}

/** Full health of a unit, with its colony's research. */
export function unitMaxHp(t: Tuning, colony: Colony, type: number): number {
  return unitTuning(t, type).hp * colony.mods.unitHealth;
}

/** Towers that hurt enemy units. */
export const ATTACKING: number[] = [Kind.Crossbow, Kind.Ballista, Kind.Flame, Kind.Frost, Kind.Lightning, Kind.Cannon, Kind.Obelisk, Kind.MachineGun, Kind.AABattery, Kind.MissileSilo];
/** Towers that help their own side instead. */
/** Buildings that help their own side instead: towers that boost or heal, and the production and power boosters. */
export const SUPPORT: number[] = [Kind.Bell, Kind.Shrine, Kind.Factory, Kind.PowerPlant];
export const ECONOMY: number[] = [Kind.Mine, Kind.Fishery, Kind.Market, Kind.Bank];
export const SCIENCE: number[] = [Kind.Library, Kind.Observatory, Kind.Academy, Kind.PrintingPress];
/** Buildings that speed up the growth of the city around them. */
export const GROWTH: number[] = [Kind.Plaza];

export function kindOfKey(key: string): number {
  return KIND_BY_KEY[key] ?? 0;
}

export function isUnlockable(kind: number): boolean {
  return kind in UNLOCK_KEY;
}

/** True while research has not yet unlocked this building for this colony. */
export function isLocked(colony: Colony, kind: number): boolean {
  return isUnlockable(kind) && !colony.unlocked.includes(kind);
}

export function unlockTuning(t: Tuning, kind: number): UnlockTuning | null {
  const key = CATALOG_KEY[kind];
  return key ? (t.unlockables[key] ?? null) : null;
}

export function categoryOf(kind: number): Category {
  if (kind === Kind.Farm || ECONOMY.includes(kind) || GROWTH.includes(kind) || kind === Kind.PowerPlant) return 'economy';
  if (kind === Kind.Factory) return 'army';
  if (kind === Kind.Research || SCIENCE.includes(kind)) return 'science';
  if (isProducer(kind)) return 'army';
  return 'defence';
}

export function isAttacking(kind: number): boolean {
  return ATTACKING.includes(kind);
}

export function isTower(kind: number): boolean {
  return ATTACKING.includes(kind) || SUPPORT.includes(kind);
}

export function isWall(kind: number): boolean {
  return kind === Kind.Wall || kind === Kind.Bastion || kind === Kind.Thorns;
}

export function isProducer(kind: number): boolean {
  return kind in PRODUCES;
}

/** Buildings kept in the per-tick list: everything that shoots, raises units, or yields. */
export function acts(kind: number): boolean {
  return isTower(kind) || isProducer(kind) || ECONOMY.includes(kind) || SCIENCE.includes(kind) || GROWTH.includes(kind);
}

/** Reach of a tower of this kind for this colony, research included. 0 for anything else. */
export function towerRange(t: Tuning, colony: Colony, kind: number): number {
  const extra = colony.mods.towerRange;
  if (kind === Kind.Crossbow) return t.defence.crossbow.range + extra;
  if (!isTower(kind)) return 0;
  return (unlockTuning(t, kind)?.range ?? 0) + extra;
}
