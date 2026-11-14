// Shared simulation types. The simulation never touches rendering, input or the clock.

export const Terrain = { Grass: 0, Forest: 1, Mountain: 2, Water: 3 } as const;

/**
 * What stands on a cell. Wall..Kennel are converted buildings. Rubble is what a destroyed
 * square leaves behind for a while (D4): nobody owns it and nothing can grow on it.
 */
export const Kind = {
  Empty: 0,
  Tower: 1,
  House: 2,
  Wall: 3,
  Farm: 4,
  Research: 5,
  Crossbow: 6,
  Barracks: 7,
  Kennel: 8,
  Rubble: 9,
  // Unlocked by research. Defence towers:
  Ballista: 10,
  Flame: 11,
  Bell: 12,
  Frost: 13,
  Lightning: 14,
  Shrine: 15,
  Cannon: 16,
  Obelisk: 17,
  // Money:
  Mine: 18,
  Fishery: 19,
  Market: 20,
  Bank: 21,
  // Science:
  Library: 22,
  Observatory: 23,
  Academy: 24,
  // Defence:
  Bastion: 25,
  // Army: the Warrior Camp is there from the start; research unlocks the rest.
  Camp: 26,
  Archery: 27,
  SpearHall: 28,
  Stable: 29,
  Workshop: 30,
  Monastery: 31,
  PowderHouse: 32,
  GiantLair: 33,
  Plaza: 34,
  Thorns: 35,
  BannerHall: 36,
  MusketRange: 37,
  PrintingPress: 38,
  Factory: 39,
  MachineGun: 40,
  ArtilleryWorks: 41,
  TankFactory: 42,
  Airfield: 43,
  AABattery: 44,
  PowerPlant: 45,
  MissileSilo: 46,
  // A second wave of discoveries: more towers, armies, money and science.
  Hex: 47,
  Marksman: 48,
  Railgun: 49,
  Radar: 50,
  NukeSilo: 51,
  RamWorks: 52,
  Arcanum: 53,
  Guild: 54,
  Helipad: 55,
  LumberMill: 56,
  Granary: 57,
  Exchange: 58,
  Alchemist: 59,
  University: 60,
  SpyDen: 61,
} as const;
export const KIND_COUNT = 62;

/** The Center Tower is a 2x2 structure, so it is clearly the most important thing on the map. */
export const TOWER_SIZE = 2;

/** How many AI playstyles there are (see DOCTRINES in ai.ts). */
export const DOCTRINE_COUNT = 5;

export const UnitType = {
  Shield: 0,
  Hound: 1,
  Warrior: 2,
  Archer: 3,
  Spearman: 4,
  Knight: 5,
  Catapult: 6,
  Monk: 7,
  Sapper: 8,
  Giant: 9,
  Bearer: 10,
  Musketeer: 11,
  Artillery: 12,
  Tank: 13,
  Bomber: 14,
  Ram: 15,
  Mage: 16,
  Assassin: 17,
  Gunship: 18,
} as const;

/** D1: "local" is the confirmed model; "pressure" exists only for comparison. */
export type GrowthModel = 'local' | 'pressure';

export interface BuildingTuning {
  /** Price of the first copy. */
  cost: number;
  /** Extra price per copy already owned. 0 = flat prices (D7, revised by the user). */
  costStep: number;
}

export interface DefenceTuning {
  range: number;
  damage: number;
  cooldownSeconds: number;
}

/**
 * Numbers for a building that research unlocks. Every building has a cost and health; the rest
 * depends on what it does (see src/sim/catalog.ts and src/data/tuning.json).
 */
export interface UnlockTuning {
  cost: number;
  health: number;
  range?: number;
  damage?: number;
  cooldownSeconds?: number;
  /** Frost: speed multiplier for slowed units, and how long it lasts. */
  slow?: number;
  slowSeconds?: number;
  /** Lightning: extra targets, how far it jumps, and the damage kept per jump. */
  jumps?: number;
  jumpRange?: number;
  falloff?: number;
  /** Shrine: health restored per pulse. */
  heal?: number;
  /** Cannon: blast radius. */
  splash?: number;
  /** Bell: reload multiplier for towers in range. */
  boost?: number;
  /** Obelisk: damage per second at full heat, and seconds to reach it. */
  maxDamage?: number;
  rampSeconds?: number;
  /** Money and science buildings: base yield per second... */
  gold?: number;
  science?: number;
  /** ...plus this much for each thing nearby that it feeds on. */
  per?: number;
  radius?: number;
  /** Bank: share of banked gold paid each second, up to a cap. */
  rate?: number;
  cap?: number;
  /** Thorn Wall: damage dealt back to every unit that strikes it. */
  thorns?: number;
  /** Printing Press: share knocked off the science each discovery needs, per press (up to `cap`). */
  discount?: number;
  /** Alchemist: gold it burns each second to make its science. */
  upkeep?: number;
  /** Hex Tower: the most health an enemy may have and still be bewitched. */
  charmHp?: number;
  /** Missile and nuke silos: seconds the warhead is in the air. */
  flightSeconds?: number;
}

export interface UnitTuning {
  hp: number;
  /** Cells per second on open ground. */
  speed: number;
  damage: number;
  cooldownSeconds: number;
  /** D13: living units one building supports. */
  cap: number;
  spawnSeconds: number;
  /** Archer, catapult, monk: how far it shoots, lobs or heals. */
  range?: number;
  /** Multiplier on damage against squares (buildings and houses). */
  siege?: number;
  /** Catapult and sapper: blast radius; giant: stomp radius. */
  splash?: number;
  /** Monk: health restored per pulse. */
  heal?: number;
  /** Spearman: the spear thrown when he is hit. */
  spearDamage?: number;
  spearRange?: number;
  spearCooldownSeconds?: number;
  /** Knight: a strike after this many seconds on the move hits this many times as hard. */
  chargeSeconds?: number;
  chargeMultiplier?: number;
  /** Multiplier on damage against enemy units (default 1). */
  vsUnits?: number;
  /** Warrior: extra damage for every other warrior close by, up to rallyCap. */
  rally?: number;
  rallyCap?: number;
  /** Shield: enemy towers shoot it first, and it takes only this share of tower damage. */
  towerArmor?: number;
  /** Hound: gold its colony loots for every house it destroys. */
  plunder?: number;
  /** Knight: how far it spots enemy units to ride down. */
  hunt?: number;
  /** Spearman: seconds between spears thrown at buildings while attacking. */
  throwSeconds?: number;
  /** Spearman: share of spear damage dealt to units (the spear is made for walls). */
  spearVsUnits?: number;
  /** Giant: the stomp also crushes enemy squares around it. */
  crush?: boolean;
  /** Shoots enemy units from `range` instead of fighting hand to hand (archers, musketeers, tanks). */
  shoots?: boolean;
  /** Musketeer: damage multiplier against heavy units (full health of 60 or more). */
  antiHeavy?: number;
  /** Tank, giant: share of damage taken from ordinary hits (small arms barely scratch them). */
  armor?: number;
  /** Bomber: flies straight over everything; only anti-air and Center Towers can hit it. */
  flies?: boolean;
  /** Artillery: only ever shells enemy towers. */
  towersOnly?: boolean;
  /** Standard Bearer: friends within this radius hit harder (auraDamage) and move faster (auraSpeed). */
  aura?: number;
  auraDamage?: number;
  auraSpeed?: number;
  /** Assassin: enemy towers only see it within this many squares. */
  stealth?: number;
  /** Ram: never fights units; it only batters squares. */
  noFight?: boolean;
}

export interface Tuning {
  tickRate: number;
  map: {
    width: number;
    height: number;
    colonies: number;
    startJitter: number;
    waterShare: number;
    mountainShare: number;
    forestShare: number;
    rivers: number;
    riverMaxLength: number;
    /** Gold a colony finds when its city grows onto Treasure. */
    treasureGold: number;
  };
  growth: {
    localEdgeRatePerSecond: number;
    pressureRatePerSecond: number;
    /** How many houses the Center Tower counts as in the pressure model. */
    pressureTowerWeight: number;
    vigorMin: number;
    vigorMax: number;
    towerVigor: number;
    forestMultiplier: number;
    /** D25: colonies smaller than this grow faster... */
    comebackSize: number;
    /** ...by up to this share, fading out as they reach that size. */
    comebackBonus: number;
    /** Sprawl: a colony of this many squares grows at half speed... */
    sprawlSize: number;
    /** ...and this sets how sharply it slows beyond that. */
    sprawlPower: number;
  };
  /** The ages: each opens at a time in the game, and research offers only what its age (or an earlier one) knows. */
  ages: Array<{ name: string; discoveries: number }>;
  research: {
    /** Science for the first draw. */
    baseCost: number;
    /** Each later draw costs this many times the one before (D18). */
    costGrowth: number;
    rerollCost: number;
    /** How many options a discovery offers. */
    offerSize: number;
    /** Chance that an option is a rare general modifier instead of a new building. */
    modifierChance: number;
    /** Instead of a discovery, a colony may take this much more city growth (+0.08 = +8%). */
    growthChoice: number;
    /** How likely a money or science building is to come up, against 1 for any other building. */
    incomeWeight: number;
    /** The same for the modifiers that raise gold or science, against 1 for other modifiers. */
    incomeModifierWeight: number;
    /** Picks needed to open tiers 2 and 3 (0 = everything is open from the start). */
    tier2Picks: number;
    tier3Picks: number;
  };
  economy: {
    startGold: number;
    /** D7: every house yields a flat amount of gold. */
    houseGoldPerSecond: number;
    /** D7: the tower's base income, so no colony sits at zero. */
    towerGoldPerSecond: number;
    /** D8 (revised): a farm earns gold itself... */
    farmGoldPerSecond: number;
    /** ...plus this much for every farm of the same colony touching it, so farms belong in groups. */
    farmNeighbourBonus: number;
    researchSciencePerSecond: number;
    /** Gold a colony gets for every forest square its city grows onto (the lumber). */
    lumberGold: number;
    /** Extra share of a house's gold when it touches a mountain (a quarry) or water (a fishing village). */
    terrainHouseBonus: number;
  };
  buildings: {
    wall: BuildingTuning;
    farm: BuildingTuning;
    research: BuildingTuning;
    crossbow: BuildingTuning;
    barracks: BuildingTuning;
    kennel: BuildingTuning;
  };
  health: {
    tower: number;
    house: number;
    wall: number;
    farm: number;
    research: number;
    crossbow: number;
    barracks: number;
    kennel: number;
  };
  combat: {
    /** D9: a new building starts at this share of its health... */
    buildStartHealth: number;
    /** ...and takes this long to finish. It does nothing until then. */
    buildSeconds: number;
    /** D4: how long a destroyed square stays rubble. */
    rubbleSeconds: number;
    /** D16: how long a fallen colony's squares stay rubble. */
    defeatRubbleSeconds: number;
    /** Paths are recomputed at most this often. */
    navIntervalTicks: number;
    /** Pathfinding assumes this many units share the work of breaking a square. */
    breachGroup: number;
    /** Squares of a colony that is not the target cost this many times more to break through. */
    thirdPartyPenalty: number;
    aggroRange: number;
    /** Units on Hold defend a wider area around themselves. */
    holdAggroRange: number;
    meleeRange: number;
    forestSpeed: number;
    mountainSpeed: number;
    /** How far (in squares) attacking units go out of their way to trample an enemy farm. */
    farmDetour: number;
    /** On Hold, how far a unit goes to hunt down an intruder on its colony's land. */
    defendRange: number;
    /** Seconds a square must go untouched before it starts to mend. */
    regenDelaySeconds: number;
    /** Share of full health a building or house mends per second; and the Center Tower. */
    regenPerSecond: number;
    towerRegenPerSecond: number;
    /** Share of a fallen colony's gold its attackers plunder. */
    plunderShare: number;
  };
  defence: {
    crossbow: DefenceTuning;
    tower: DefenceTuning;
  };
  /** Every unit type, keyed by catalog name (see UNIT_KEY in catalog.ts). */
  units: Record<string, UnitTuning> & { shield: UnitTuning; hound: UnitTuning };
  /** Buildings that research unlocks, by catalog key. */
  unlockables: Record<string, UnlockTuning>;
  /** The builder AI that runs rival colonies. It plays by the same rules and prices as the player. */
  ai: {
    intervalSeconds: number;
    minHouses: number;
    /** It keeps at least this share of its squares as houses. */
    minHouseShare: number;
    farmShare: number;
    squaresPerResearch: number;
    maxResearch: number;
    baseCrossbows: number;
    squaresPerCrossbow: number;
    maxCrossbows: number;
    squaresPerBarracks: number;
    maxBarracks: number;
    squaresPerKennel: number;
    maxKennels: number;
    /** Colony size at which it starts walling in its tower. */
    keepAtSize: number;
    /** How often it reconsiders its military order. */
    orderIntervalSeconds: number;
    /** It never attacks before this much game time has passed. */
    attackAfterSeconds: number;
    /** Smallest army it will attack with (a shield unit counts 3, a hound 1). */
    attackMinStrength: number;
    /** It attacks once its army has reached this share of what its buildings can support. */
    attackReadyShare: number;
    /** It retreats to regroup when its army falls below this share of what it set out with. */
    retreatShare: number;
    /** It calls its army home when this many enemy units are near its tower. */
    recallThreat: number;
    /** By difficulty (normal, hard, brutal): multiplier on rivals' gold and science. */
    levelIncome: number[];
    /** By difficulty: multiplier on how long rivals wait before their first attack. */
    levelAttackDelay: number[];
    /** No rival attacks before this many seconds (times the difficulty's delay); after that, whenever its army is ready. */
    graceSeconds: number;
    /** How long (seconds) a rival remembers who attacked it. */
    grudgeSeconds: number;
    /** After this many seconds every rival attacks with a smaller share of its full army. */
    lateGameSeconds: number;
    /** A colony with this many attacking towers counts as fortified: rivals answer with siege. */
    fortifiedTowers: number;
  };
}

/**
 * What research modifiers can change about a colony. They are deliberately general: they touch
 * every unit, every tower, every building, all gold or all science — never one unit type.
 * Multipliers start at 1, additions at 0.
 */
export interface Mods {
  /** All units. */
  unitSpeed: number;
  unitDamage: number;
  unitHealth: number;
  /** All army buildings: time to raise a unit, and units each one supports (added). */
  spawnTime: number;
  armySize: number;
  /** All units' damage against squares. */
  siege: number;
  /** Above 0: units cross forest and mountains at full speed. */
  roads: number;
  /** All towers, the Center Tower included. Range is added. */
  towerRange: number;
  towerDamage: number;
  towerReload: number;
  /** All buildings and walls (not houses, not the Center Tower). */
  structureHealth: number;
  /** The Center Tower's health. */
  towerHealth: number;
  /** All gold and all science income. */
  gold: number;
  science: number;
  /** Time for new buildings to finish. */
  buildTime: number;
  /** Multiplier on the city's growth (the growth choice on a discovery card adds to it). */
  growth: number;
  /** Multiplier on every building's price. */
  cost: number;
  /** Multiplier on what houses earn. */
  houseGold: number;
  /** Multiplier on how fast untouched squares repair themselves. */
  regen: number;
  /** Health every unit heals each second. */
  unitRegen: number;
}

/** What a colony is not getting because some of its squares are cut off from the tower (D5). */
export interface Dormant {
  cells: number;
  houses: number;
  farms: number;
  farmLinks: number;
  research: number;
}

export interface Unit {
  id: number;
  owner: number;
  type: number;
  /** Position in cell units; (3.5, 2.5) is the centre of cell (3, 2). */
  x: number;
  y: number;
  hp: number;
  /** The barracks or yard that supports this unit, or -1 once it is destroyed. */
  home: number;
  /** Ticks until this unit may strike again. */
  cooldown: number;
  /** 1 when last moving right, -1 when moving left. Cosmetic only. */
  facing: number;
  /** After a chase was blocked by water or buildings: no chasing again before this tick. */
  noChaseUntil?: number;
  /** Frost: slowed until this tick, to this share of its speed. */
  slowUntil?: number;
  slowFactor?: number;
  /** Health at the start of the last tick: a spearman throws when it drops. */
  lastHp?: number;
  /** Spearman: no new spear before this tick. */
  spearReady?: number;
  /** Knight: ticks spent moving since the last strike. */
  charge?: number;
  /** Bomber: the square it is flying to bomb (-1 = none chosen yet). */
  target?: number;
  /** Current heading, so units turn smoothly instead of snapping between grid directions. */
  vx?: number;
  vy?: number;
}

/** Shortest-time fields for one colony's units. Derived data: rebuilt whenever the map changes. */
export interface ColonyNav {
  /** To the target colony's Center Tower (shield units). */
  tower: Float32Array | null;
  /** To the nearest poorly defended enemy house (hounds). */
  raid: Float32Array | null;
  /** To the target's tower for sappers, who can blast through mountains on the way. */
  rock?: Float32Array | null;
  /** Back to this colony's own barracks and yards (Hold order). */
  home: Float32Array | null;
  /** Tick at which `home` was last rebuilt. */
  homeTick?: number;
}

export interface Colony {
  /** 1-based; 0 in the owner grid means "nobody". */
  id: number;
  alive: boolean;
  /** Top-left cell of the 2x2 Center Tower. */
  tower: number;
  /** All four cells of the Center Tower. Each one is a growth source. */
  towerCells: number[];
  /** The tower is one structure with one pool of health. */
  towerHp: number;
  /** Seconds until the tower may shoot again. */
  towerReload: number;
  houses: number;
  /** Total converted buildings. */
  buildings: number;
  /** Converted buildings per Kind. */
  counts: number[];
  gold: number;
  science: number;
  /** Farm adjacencies, counted once per farm: two farms side by side make 2. */
  farmLinks: number;
  /** D12: 0 = Hold, otherwise the id of the colony under attack. */
  order: number;
  /** AI bookkeeping: army strength when the current attack set out (0 while holding). */
  launchStrength: number;
  /** What this colony found beside its start: mountains, lake, forest or plains (empty on test boards). */
  flavour: string;
  /** AI: the colony that last attacked this one, and the tick until which it holds the grudge. */
  grudge: number;
  grudgeUntil: number;
  /** AI only: the playstyle this rival follows (an index into DOCTRINES in ai.ts), or -1. */
  doctrine: number;
  mods: Mods;
  /** Ids of the research options taken (gold rewards are not recorded). */
  picks: string[];
  /** Draws earned so far; sets the next threshold. */
  drawsEarned: number;
  /** Draws earned but not yet chosen (D17: a choice is banked, never forced). */
  pendingDraws: number;
  /** This colony's age, 1 (Medieval) to 4 (Modern): reached by the number of its discoveries. */
  age: number;
  /** A breakthrough is owed: the next offer comes only from the buildings of this age (0 = none). */
  ageOffer: number;
  /** The options currently on offer, or null. */
  offer: string[] | null;
  /** Buildings research has unlocked, by Kind. */
  unlocked: number[];
  /** Houses touching a mountain or water (they earn a bonus), counted once a second. */
  terrainHouses: number;
  /** Gold and science per second from money and science buildings, worked out each tick. */
  bonusGold: number;
  bonusScience: number;
  /** Territory changed: cut-off squares must be worked out again. */
  linkDirty: boolean;
  dormant: Dormant;
  /** Banked growth for the pressure model. */
  pool: number;
  /** Cells of this colony that can still grow (dense list, order is deterministic). */
  edge: number[];
  nav: ColonyNav;
}

export interface GameState {
  width: number;
  height: number;
  /** The map loops at its edges (a torus): only on the Endless World map. */
  wrap: boolean;
  /** Which kind of map this is (continent, highlands, rivers, lakes, endless; or custom for test boards). */
  mapType: string;
  /** Landmark on each cell, until a city grows onto it: 0 none, 1 Ancient Ruins, 2 Treasure. */
  feature: Uint8Array;
  seed: number;
  tick: number;
  /** State of the single seeded random generator. */
  rng: number;
  model: GrowthModel;
  terrain: Uint8Array;
  owner: Uint8Array;
  kind: Uint8Array;
  /** Health of houses and buildings. Tower cells use their colony's towerHp instead. */
  hp: Float32Array;
  /** For a building: the tick it is finished (D9). For rubble: the tick it clears (D4). */
  readyTick: Int32Array;
  /** Per-building clock in seconds: spawn progress for barracks, reload for crossbow towers. */
  timer: Float32Array;
  /** Per-square growth rate multiplier: "each square grows at a somewhat randomised rate". */
  vigor: Float32Array;
  /** Index of each cell in its colony's edge list, or -1. */
  edgePos: Int32Array;
  /** Cells that change with time: buildings under construction and rubble. */
  pending: number[];
  inPending: Uint8Array;
  /** 1 for squares cut off from their Center Tower (D5). */
  cutOff: Uint8Array;
  /** Cells holding a building that acts every tick: towers, barracks, yards, money and science buildings. */
  military: number[];
  /** Obelisk: id of the unit its beam is locked on (0 = none), and how long it has held it. */
  lock: Int32Array;
  heat: Float32Array;
  units: Unit[];
  nextUnitId: number;
  navDirty: boolean;
  navTick: number;
  /** Colonies run by the AI. */
  bots: number[];
  /** Whether AI colonies may give attack orders. Off = they only build and defend. */
  aiAttacks: boolean;
  /** Rival difficulty: 0 normal, 1 hard, 2 brutal. Harder rivals earn more and attack sooner. */
  aiLevel: number;
  /** Whether anyone has built an Airfield yet (then every colony learns Anti-Air). */
  airborne: boolean;
  /** The tick each square was last hit, for regeneration. */
  lastHit: Int32Array;
  /** Missiles and nukes in the air: they land (and do their damage) on tick `land`. */
  strikes: Strike[];
  colonies: Colony[];
}

export type Command =
  | { type: 'convert'; owner: number; cell: number; to: number }
  /** D12: target 0 means Hold; otherwise attack that colony. */
  | { type: 'order'; owner: number; target: number }
  /** Take option `choice` (0 or 1) of the current research offer. */
  | { type: 'research'; owner: number; choice: number }
  /** Pay gold for a fresh research offer. */
  | { type: 'reroll'; owner: number };

/** A warhead in flight, from a Missile Silo or a Nuke Silo. */
export interface Strike {
  owner: number;
  /** The colony it was fired at. */
  victim: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
  launch: number;
  land: number;
  radius: number;
  damage: number;
  nuke: boolean;
}

export type ShotStyle = 'bolt' | 'ballista' | 'lightning' | 'cannon' | 'arrow' | 'spear' | 'rock' | 'missile' | 'magic' | 'rail' | 'hex' | 'sniper' | 'gun';
export type BlastStyle = 'fire' | 'frost' | 'heal' | 'cannon' | 'magic' | 'hex' | 'nuke';

export type SimEvent =
  | { type: 'grow'; cell: number; owner: number; clearedForest: boolean }
  | { type: 'convert'; cell: number; owner: number; to: number }
  | { type: 'hit'; cell: number }
  | { type: 'destroy'; cell: number; owner: number; kind: number }
  | { type: 'clear'; cell: number }
  | { type: 'shot'; x0: number; y0: number; x1: number; y1: number; owner: number; style?: ShotStyle }
  /** An area effect: a flame burst, a frost pulse, a healing pulse or a cannon blast. */
  | { type: 'blast'; x: number; y: number; radius: number; style: BlastStyle }
  | { type: 'unitDied'; x: number; y: number; owner: number; unitType: number }
  /** A city grew onto a landmark: Ancient Ruins (a free discovery) or Treasure (gold). */
  | { type: 'landmark'; cell: number; owner: number; feature: number; gold: number }
  /** A new age began for everyone. */
  | { type: 'age'; owner: number; age: number }
  /** A colony built the first Airfield: everyone learns Anti-Air. */
  | { type: 'airborne'; owner: number }
  /** A warhead left its silo; it lands `ticks` later at (x, y). */
  | { type: 'launch'; owner: number; victim: number; x: number; y: number; nuke: boolean }
  /** A nuke went off. */
  | { type: 'nuke'; owner: number; victim: number; x: number; y: number }
  /** A Hex Tower bewitched an enemy unit: it now fights for `owner`. */
  | { type: 'charm'; owner: number; from: number; x: number; y: number }
  /** The ground itself changed (a sapper blasted a mountain away). */
  | { type: 'terrain'; cell: number }
  /** A unit was cut by the Thorn Wall it struck. */
  | { type: 'thorns'; x: number; y: number; owner: number }
  /** A hound looted gold from a house it destroyed. */
  | { type: 'loot'; x: number; y: number; owner: number; gold: number }
  /** A unit swung at something: an enemy unit or square at (tx, ty). */
  | { type: 'strike'; id: number; x: number; y: number; tx: number; ty: number; owner: number; heavy: boolean }
  /** A colony fell. `by`: the colonies attacking it, who shared `plunder` gold from its treasury. */
  | { type: 'defeat'; owner: number; by: number[]; plunder: number }
  /** A colony changed its military order. target 0 = Hold. */
  | { type: 'order'; owner: number; target: number }
  | { type: 'research'; owner: number; id: string };
