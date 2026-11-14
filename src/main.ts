// Browser entry point: owns the clock, input and interface. All rules live in src/sim.

import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/600.css';
import '@fontsource/silkscreen/400.css';
import '@fontsource/silkscreen/700.css';
import './ui/style.css';

import tuningJson from './data/tuning.json';
import { COLONY } from './render/palette';
import { Renderer } from './render/renderer';
import { SoundSystem, type Listener } from './audio/audio';
import { doctrineOf } from './sim/ai';
import { MAP_NAMES, MAP_TYPES, mapTypeFor, type MapType } from './sim/mapgen';
import { crownHolder, MODES, modeInfo, modeLeader, type GameMode } from './sim/modes';
import { drawMapPreview, iconOf, Logo } from './ui/title';
import {
  categoryOf,
  isLocked,
  isProducer,
  isTower,
  kindOfKey,
  PRODUCERS,
  PRODUCES,
  towerRange,
  UNIT_KEY,
  UNLOCK_KEY,
  unitTuning,
  unlockTuning,
  type Category,
} from './sim/catalog';
import { buildingYield, canAfford, costOf, farmYieldAt, goldPerSecond, sciencePerSecond } from './sim/economy';
import { healthAt, isActive, maxHealth, maxHealthAt, towerMaxHealth } from './sim/health';
import { nextThreshold, RESEARCH, researchOption } from './sim/research';
import { hashString } from './sim/rng';
import { applyCommand, canConvert, step } from './sim/sim';
import { colonySize, createGame, isGrowable, isSource, ownFarmNeighbours } from './sim/state';
import { Kind, Terrain, UnitType, type GameState, type GrowthModel, type SimEvent, type Tuning } from './sim/types';

const tuning = tuningJson as Tuning;
const PLAYER = 1;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('view');
const renderer = new Renderer(canvas, tuning);

interface Tool {
  kind: number;
  name: string;
  label: string;
}

/** The hotbar, one tab per category. Locked buildings show up too, so the tech tree is visible. */
const TABS: Array<{ id: Category; name: string; key: string; tools: Tool[] }> = [
  {
    id: 'economy',
    name: 'ECONOMY',
    key: 'z',
    tools: [
      { kind: Kind.Farm, name: 'FARM', label: 'Farm' },
      { kind: Kind.Mine, name: 'MINE', label: 'Mine' },
      { kind: Kind.Fishery, name: 'FISHERY', label: 'Fishery' },
      { kind: Kind.Market, name: 'MARKET', label: 'Market' },
      { kind: Kind.Bank, name: 'BANK', label: 'Bank' },
      { kind: Kind.Plaza, name: 'PLAZA', label: 'Plaza' },
      { kind: Kind.PowerPlant, name: 'POWER', label: 'Power Plant' },
      { kind: Kind.LumberMill, name: 'SAWMILL', label: 'Lumber Mill' },
      { kind: Kind.Granary, name: 'GRANARY', label: 'Granary' },
      { kind: Kind.Exchange, name: 'EXCHANGE', label: 'Stock Exchange' },
    ],
  },
  {
    id: 'science',
    name: 'SCIENCE',
    key: 'x',
    tools: [
      { kind: Kind.Research, name: 'RESEARCH', label: 'Research building' },
      { kind: Kind.Library, name: 'LIBRARY', label: 'Library' },
      { kind: Kind.Observatory, name: 'STARGAZE', label: 'Observatory' },
      { kind: Kind.Academy, name: 'ACADEMY', label: 'Academy' },
      { kind: Kind.PrintingPress, name: 'PRESS', label: 'Printing Press' },
      { kind: Kind.Alchemist, name: 'ALCHEMY', label: 'Alchemist' },
      { kind: Kind.University, name: 'UNIVERSITY', label: 'University' },
      { kind: Kind.SpyDen, name: 'SPIES', label: 'Spy Den' },
    ],
  },
  {
    id: 'defence',
    name: 'DEFENCE',
    key: 'c',
    tools: [
      { kind: Kind.Wall, name: 'WALL', label: 'Wall' },
      { kind: Kind.Bastion, name: 'BASTION', label: 'Bastion' },
      { kind: Kind.Thorns, name: 'THORNS', label: 'Thorn Wall' },
      { kind: Kind.Crossbow, name: 'CROSSBOW', label: 'Crossbow Tower' },
      { kind: Kind.Ballista, name: 'BALLISTA', label: 'Ballista' },
      { kind: Kind.Flame, name: 'FLAME', label: 'Flame Tower' },
      { kind: Kind.Frost, name: 'FROST', label: 'Frost Tower' },
      { kind: Kind.Lightning, name: 'LIGHTNING', label: 'Lightning Tower' },
      { kind: Kind.Cannon, name: 'CANNON', label: 'Cannon Tower' },
      { kind: Kind.Obelisk, name: 'OBELISK', label: 'Obelisk' },
      { kind: Kind.Bell, name: 'BELL', label: 'Bell Tower' },
      { kind: Kind.Shrine, name: 'SHRINE', label: 'Shrine' },
      { kind: Kind.MachineGun, name: 'MG NEST', label: 'Machine Gun Nest' },
      { kind: Kind.AABattery, name: 'ANTI-AIR', label: 'AA Battery' },
      { kind: Kind.MissileSilo, name: 'MISSILES', label: 'Missile Silo' },
      { kind: Kind.Hex, name: 'HEX', label: 'Hex Tower' },
      { kind: Kind.Marksman, name: 'MARKSMAN', label: 'Marksman Tower' },
      { kind: Kind.Railgun, name: 'RAILGUN', label: 'Railgun' },
      { kind: Kind.Radar, name: 'RADAR', label: 'Radar' },
      { kind: Kind.NukeSilo, name: 'NUKE', label: 'Nuke Silo' },
    ],
  },
  {
    id: 'army',
    name: 'ARMY',
    key: 'v',
    tools: [
      { kind: Kind.Camp, name: 'WARRIORS', label: 'Warrior Camp' },
      { kind: Kind.Barracks, name: 'SHIELDS', label: 'Shield Barracks' },
      { kind: Kind.Kennel, name: 'HOUNDS', label: 'Hound Yard' },
      { kind: Kind.Archery, name: 'ARCHERS', label: 'Archery Range' },
      { kind: Kind.SpearHall, name: 'SPEARMEN', label: 'Spear Hall' },
      { kind: Kind.Stable, name: 'KNIGHTS', label: 'Stable' },
      { kind: Kind.Workshop, name: 'CATAPULTS', label: 'Siege Workshop' },
      { kind: Kind.Monastery, name: 'MONKS', label: 'Monastery' },
      { kind: Kind.PowderHouse, name: 'SAPPERS', label: 'Powder House' },
      { kind: Kind.GiantLair, name: 'GIANTS', label: "Giant's Lair" },
      { kind: Kind.BannerHall, name: 'BANNERS', label: 'Banner Hall' },
      { kind: Kind.MusketRange, name: 'MUSKETS', label: 'Musket Range' },
      { kind: Kind.ArtilleryWorks, name: 'ARTILLERY', label: 'Artillery Works' },
      { kind: Kind.TankFactory, name: 'TANKS', label: 'Tank Factory' },
      { kind: Kind.Airfield, name: 'BOMBERS', label: 'Airfield' },
      { kind: Kind.Factory, name: 'FACTORY', label: 'Factory' },
      { kind: Kind.RamWorks, name: 'RAMS', label: 'Ram Works' },
      { kind: Kind.Arcanum, name: 'MAGES', label: 'Arcane Hall' },
      { kind: Kind.Guild, name: 'ASSASSINS', label: "Thieves' Guild" },
      { kind: Kind.Helipad, name: 'GUNSHIPS', label: 'Helipad' },
    ],
  },
];
const TOOLS: Tool[] = TABS.flatMap((tab) => tab.tools);

const KIND_NAMES: Record<number, string> = { [Kind.House]: 'house' };
for (const tool of TOOLS) KIND_NAMES[tool.kind] = tool.label;

const U = tuning.unlockables;
const cap = (kind: number) => unitTuning(tuning, PRODUCES[kind]).cap;
const KIND_NOTES: Record<number, string> = {
  [Kind.Wall]: `A tough barrier (${tuning.health.wall} health): enemies must break it to get through. Your own units walk straight over it.`,
  [Kind.Bastion]: `A wall with ${U.bastion.health} health, about twice an ordinary wall.`,
  [Kind.Farm]: 'Free, but very fragile. Alone it earns less than a house; every farm of yours touching it adds more, so grow them in big blocks.',
  [Kind.Mine]: 'Earns gold, and much more for every mountain around it.',
  [Kind.Fishery]: 'Earns gold, and more for every square of water around it.',
  [Kind.Market]: `Earns gold for every house of yours within ${U.market.radius} squares.`,
  [Kind.Bank]: `Pays ${(U.bank.rate! * 100).toFixed(1)}% interest a second on your saved gold, up to ${U.bank.cap} a second.`,
  [Kind.Research]: 'Produces science.',
  [Kind.Library]: 'Makes science, and more for every science building touching it.',
  [Kind.Observatory]: 'Makes plenty of science, and more for every mountain around it.',
  [Kind.Academy]: `Makes ${U.academy.science} science a second, wherever it stands.`,
  [Kind.Crossbow]: 'Shoots the nearest enemy unit in range.',
  [Kind.Ballista]: `Range ${U.ballista.range}. Hurls a ${U.ballista.damage}-damage bolt at the toughest enemy in reach.`,
  [Kind.Flame]: `Scorches every enemy within ${U.flame.range} squares at once.`,
  [Kind.Frost]: `Chills every enemy within ${U.frost.range} squares: half speed, half the strikes.`,
  [Kind.Lightning]: `A bolt that leaps between up to ${U.lightning.jumps! + 1} enemies.`,
  [Kind.Cannon]: `Range ${U.cannon.range}. Shells blast every enemy near where they land.`,
  [Kind.Obelisk]: `A beam that locks onto one enemy and burns hotter, up to ${U.obelisk.maxDamage} damage a second.`,
  [Kind.Bell]: 'Towers within reach reload 40% faster.',
  [Kind.Shrine]: 'Heals your squares, tower and units within reach.',
  [Kind.Camp]: `Keeps ${cap(Kind.Camp)} warriors alive, for free. The mob: each warrior hits harder for every warrior fighting beside it.`,
  [Kind.Barracks]: `Keeps ${cap(Kind.Barracks)} shields alive. The escort: enemy towers shoot shields first and do half damage to them. They hit weakly.`,
  [Kind.Kennel]: `Keeps ${cap(Kind.Kennel)} hounds alive. The raiders: fast, they dodge fights, bite only houses and loot ${unitTuning(tuning, UnitType.Hound).plunder} gold from each one they destroy.`,
  [Kind.Archery]: `Keeps ${cap(Kind.Archery)} archers alive. The defenders: they shoot enemy units hard from ${unitTuning(tuning, UnitType.Archer).range} squares, but barely scratch buildings.`,
  [Kind.SpearHall]: `Keeps ${cap(Kind.SpearHall)} spearmen alive. The line-breakers: their spears pierce every building in a straight line. Poor against other units.`,
  [Kind.Stable]: `Keeps ${cap(Kind.Stable)} knights alive. The hunters: they spot enemy units from far off and ride them down, a charge hitting three times as hard. Poor against buildings.`,
  [Kind.Workshop]: `Keeps ${cap(Kind.Workshop)} catapults alive. The artillery: boulders at buildings from ${unitTuning(tuning, UnitType.Catapult).range} squares. They never fight units.`,
  [Kind.Monastery]: `Keeps ${cap(Kind.Monastery)} monks alive. The healers: they walk with your army and mend it. They never fight.`,
  [Kind.PowderHouse]: `Keeps ${cap(Kind.PowderHouse)} sappers alive. The demolishers: they run at enemy walls and blow them apart, themselves included. The only unit that can blast a way through mountains.`,
  [Kind.Plaza]: `Your city grows ${U.plaza.boost} times as fast within ${U.plaza.radius} squares of it: steer where it spreads.`,
  [Kind.Thorns]: `A tough wall (${U.thorns.health} health) that cuts every enemy who strikes it for ${U.thorns.thorns} damage.`,
  [Kind.MusketRange]: `Keeps ${cap(Kind.MusketRange)} musketeers alive. Slow, huge shots that pierce armour: ${unitTuning(tuning, UnitType.Musketeer).antiHeavy}x damage to heavy units (knights, shields, giants, tanks).`,
  [Kind.PrintingPress]: `Every press makes each future discovery ${Math.round((U.press.discount ?? 0) * 100)}% cheaper, up to ${Math.round((U.press.cap ?? 0) * 100)}%.`,
  [Kind.Factory]: `Army buildings within ${U.factory.radius} squares raise their units ${Math.round((U.factory.boost ?? 0) * 100)}% faster.`,
  [Kind.MachineGun]: 'A hail of light bullets at long range: shreds unarmoured swarms. Armour (tanks, giants) shrugs it off.',
  [Kind.ArtilleryWorks]: `Keeps ${cap(Kind.ArtilleryWorks)} artillery guns alive. They outrange every tower (${unitTuning(tuning, UnitType.Artillery).range} squares) and shell only towers.`,
  [Kind.TankFactory]: `Keeps ${cap(Kind.TankFactory)} tanks alive: armoured, they shell units and buildings in an area and shrug off small arms.`,
  [Kind.Airfield]: `Keeps ${cap(Kind.Airfield)} bombers alive. They fly over walls and water to bomb the most valuable building of the colony you attack. Only anti-air and Center Towers can hit them.`,
  [Kind.AABattery]: 'The only tower that can shoot down aircraft. It shoots at nothing else.',
  [Kind.PowerPlant]: `Money buildings within ${U.power.radius} squares earn ${Math.round((U.power.boost ?? 0) * 100)}% more.`,
  [Kind.MissileSilo]: `Every ${U.silo.cooldownSeconds} seconds it fires a missile at a random building (never a house) of the colony you are attacking, or of the nearest rival while you hold. Any range: it lands ${U.silo.flightSeconds} seconds later and blasts everything within ${U.silo.splash} squares.`,
  [Kind.NukeSilo]: `Every ${U.nuke.cooldownSeconds} seconds a nuclear warhead flies at a random building of the colony you are attacking. It lands ${U.nuke.flightSeconds} seconds later and flattens everything within ${U.nuke.splash} squares, armies included.`,
  [Kind.Hex]: `Every ${U.hex.cooldownSeconds} seconds it bewitches the nearest light enemy in range (${U.hex.charmHp} health or less): it fights for you from then on.`,
  [Kind.Marksman]: `Range ${U.marksman.range}. Armour-piercing shots that pick off the back line first: monks, bearers, sappers, mages, catapults and artillery.`,
  [Kind.Railgun]: `Range ${U.railgun.range}. A slug that tears through every enemy unit in a straight line, armour and all.`,
  [Kind.Radar]: `Every tower within ${U.radar.radius} squares of it reaches ${U.radar.boost} squares further.`,
  [Kind.LumberMill]: 'Earns gold, and more for every forest square still standing around it.',
  [Kind.Granary]: `Earns gold for every farm of yours within ${U.granary.radius} squares.`,
  [Kind.Exchange]: 'Earns gold for every money building you own, anywhere in your city.',
  [Kind.Alchemist]: `Turns gold into science: burns ${U.alchemist.upkeep} gold a second for ${U.alchemist.science} science. Stops when your treasury is empty.`,
  [Kind.University]: `Makes science for every house of yours within ${U.university.radius} squares.`,
  [Kind.SpyDen]: 'Steals science from every rival still standing: worth most early, in a crowded game.',
  [Kind.RamWorks]: `Keeps ${cap(Kind.RamWorks)} rams alive. The wall-breakers: armoured, they smash buildings three times as hard. They never fight units.`,
  [Kind.Arcanum]: `Keeps ${cap(Kind.Arcanum)} mages alive. Fireballs from ${unitTuning(tuning, UnitType.Mage).range} squares that burst over a whole group of enemy units. Fragile.`,
  [Kind.Guild]: `Keeps ${cap(Kind.Guild)} assassins alive. Enemy towers cannot see them until they are ${unitTuning(tuning, UnitType.Assassin).stealth} squares away: they slip past defences. Fast and deadly up close.`,
  [Kind.Helipad]: `Keeps ${cap(Kind.Helipad)} gunships alive. They fly over everything and rake enemy units with fire; they never touch buildings. Only anti-air and Center Towers can hit them.`,
  [Kind.BannerHall]: `Keeps ${cap(Kind.BannerHall)} standard bearers alive. They never fight, but every unit near a banner hits ${Math.round((unitTuning(tuning, UnitType.Bearer).auraDamage ?? 0) * 100)}% harder and moves ${Math.round((unitTuning(tuning, UnitType.Bearer).auraSpeed ?? 0) * 100)}% faster.`,
  [Kind.GiantLair]: 'Keeps one giant alive. The juggernaut: its stomp hits every enemy around it and crushes the buildings too.',
};

/** The research option that unlocks a building, for the hotbar's locked buttons. */
function unlockedBy(kind: number): string {
  const key = UNLOCK_KEY[kind];
  const option = RESEARCH.find((o) => o.unlock === key);
  return option ? option.name : 'research';
}

const UNIT_NAMES: Record<number, [string, string]> = {
  [UnitType.Warrior]: ['warrior', 'warriors'],
  [UnitType.Shield]: ['shield', 'shields'],
  [UnitType.Hound]: ['hound', 'hounds'],
  [UnitType.Archer]: ['archer', 'archers'],
  [UnitType.Spearman]: ['spearman', 'spearmen'],
  [UnitType.Knight]: ['knight', 'knights'],
  [UnitType.Catapult]: ['catapult', 'catapults'],
  [UnitType.Monk]: ['monk', 'monks'],
  [UnitType.Sapper]: ['sapper', 'sappers'],
  [UnitType.Giant]: ['giant', 'giants'],
  [UnitType.Bearer]: ['bearer', 'bearers'],
  [UnitType.Musketeer]: ['musketeer', 'musketeers'],
  [UnitType.Artillery]: ['gun', 'guns'],
  [UnitType.Tank]: ['tank', 'tanks'],
  [UnitType.Bomber]: ['bomber', 'bombers'],
  [UnitType.Ram]: ['ram', 'rams'],
  [UnitType.Mage]: ['mage', 'mages'],
  [UnitType.Assassin]: ['assassin', 'assassins'],
  [UnitType.Gunship]: ['gunship', 'gunships'],
};
void UNIT_KEY;

// ---------- session ----------

const ADJECTIVES = ['MOSSY', 'GOLDEN', 'QUIET', 'WINDY', 'EMBER', 'FROSTY', 'HOLLOW', 'SUNNY', 'MISTY', 'RUSTY', 'LUCKY', 'STONY'];
const NOUNS = ['RIDGE', 'HARBOR', 'MEADOW', 'CROSSING', 'HOLLOW', 'ORCHARD', 'BASIN', 'SUMMIT', 'MARSH', 'GROVE', 'FORD', 'VALE'];

function randomSeedName(): string {
  const pick = (list: string[]) => list[Math.floor(Math.random() * list.length)];
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${Math.floor(Math.random() * 90 + 10)}`;
}

// ---------- sound ----------

const sound = new SoundSystem();
// Browsers allow sound only after the player clicks or presses a key.
const unlockSound = () => sound.unlock();
window.addEventListener('pointerdown', unlockSound);
window.addEventListener('keydown', unlockSound);

/** Where the player is listening from: the middle of the view. */
function listener(): Listener {
  const [x0, y0, x1, y1] = renderer.viewRect();
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, reach: (x1 - x0) / 2, wrapW: state.wrap ? state.width : 0, wrapH: state.wrap ? state.height : 0 };
}

/** The noises of the world: each event at its own place, quieter the further it is from the view. */
function playEvents(): void {
  if (onTitle) return;
  const ear = listener();
  const w = state.width;
  const cellSpot = (c: number) => ({ x: (c % w) + 0.5, y: ((c / w) | 0) + 0.5 });
  for (const e of events) {
    switch (e.type) {
      case 'grow':
        if (e.owner === PLAYER) sound.play(e.clearedForest ? 'timber' : 'grow', 1, cellSpot(e.cell), ear);
        break;
      case 'convert':
        if (e.owner === PLAYER) sound.play('build', 1, cellSpot(e.cell), ear);
        break;
      case 'destroy':
        sound.play('collapse', 1, cellSpot(e.cell), ear);
        break;
      case 'hit':
        sound.play('hit', 1, cellSpot(e.cell), ear);
        break;
      case 'shot': {
        const name = { bolt: 'bolt', arrow: 'arrow', ballista: 'ballista', spear: 'spear', lightning: 'zap', cannon: 'thud', rock: 'whoosh', missile: 'missile', magic: 'magic', rail: 'rail', hex: 'hex', sniper: 'sniper', gun: 'gun' }[e.style ?? 'bolt'];
        sound.play(name, 1, { x: e.x0, y: e.y0 }, ear);
        break;
      }
      case 'blast': {
        const name = { fire: 'fire', frost: 'frost', heal: 'heal', cannon: 'boom', magic: 'fire', hex: 'heal', nuke: 'nuke' }[e.style];
        sound.play(name, 1, { x: e.x, y: e.y }, ear);
        break;
      }
      case 'unitDied':
        sound.play('death', 1, { x: e.x, y: e.y }, ear);
        break;
      case 'strike':
        sound.play(e.heavy ? 'thud' : 'clang', 1, { x: e.x, y: e.y }, ear);
        break;
      case 'thorns':
        sound.play('thorns', 1, { x: e.x, y: e.y }, ear);
        break;
      case 'loot':
        sound.play('coin', e.owner === PLAYER ? 1 : 0.5, { x: e.x, y: e.y }, ear);
        break;
      case 'age':
        if (e.owner === PLAYER) sound.play('age');
        break;
      case 'airborne':
        sound.play('warn');
        break;
      case 'launch':
        // Loud when it concerns you; a distant roar otherwise.
        sound.play('missile', e.owner === PLAYER || e.victim === PLAYER ? 1 : 0.35);
        if (e.nuke && e.victim === PLAYER) sound.play('warn');
        break;
      case 'landmark':
        if (e.owner === PLAYER) sound.play(e.feature === 1 ? 'ruins' : 'treasure');
        break;
      case 'order':
        // Your own war horn when you send the army out; an alarm when someone comes for you.
        if (e.owner === PLAYER && e.target > 0) sound.play('horn');
        else if (e.target === PLAYER) sound.play('warn');
        break;
      case 'defeat':
        sound.play('fallen', e.owner === PLAYER ? 1 : 0.7);
        break;
    }
  }
}

/** The soundtrack follows the age, turns tense while anyone is attacking the player, and quietens when paused. */
function updateMusic(): void {
  sound.music.setAge(me().age);
  const threatened = state.colonies.some((c) => c.alive && c.order === PLAYER);
  sound.music.setTension(threatened ? 1 : 0);
  sound.music.setPaused(settings.paused);
}

const VOLUME_STEPS = [0, 0.25, 0.5, 0.75, 1];
function syncSoundButtons(): void {
  $('btn-music').textContent = `MUSIC: ${Math.round(sound.settings.music * 100)}%`;
  $('btn-sfx').textContent = `SOUND: ${Math.round(sound.settings.sfx * 100)}%`;
}

const settings = {
  seedName: randomSeedName(),
  model: 'local' as GrowthModel,
  /** How many rival colonies share the map (0 = play alone). */
  rivals: 5,
  /** Whether rival colonies may attack. Off = they only build and defend. */
  aiAttacks: true,
  /** Rival difficulty: 0 normal, 1 hard, 2 brutal. */
  level: 2,
  /** The game mode. */
  mode: 'conquest' as GameMode,
  /** Which kind of map; 'any' picks one from the seed. */
  mapType: 'any' as 'any' | MapType,
  speed: 1,
  paused: true,
  showEdge: false,
  /** Kind of the selected building tool, or 0 for none. */
  tool: 0 as number,
  /** The hotbar tab on show. */
  tab: 'defence' as Category,
};

/** Buildings the player has seen unlocked, so a new one can be announced and highlighted. */
let knownUnlocked = new Set<number>();
const freshUntil = new Map<number, number>();

let state: GameState;
/** Colony sizes, one sample per game second. */
let samples: number[][] = [];
const events: SimEvent[] = [];
let hover = -1;

function me() {
  return state.colonies[PLAYER - 1];
}

function newGame(): void {
  state = createGame({
    seed: hashString(settings.seedName),
    model: settings.model,
    colonies: 1 + settings.rivals,
    tuning,
    // Every rival is run by the AI: it develops, defends, and attacks whoever looks weakest.
    bots: Array.from({ length: settings.rivals }, (_, i) => i + 2),
    aiAttacks: settings.aiAttacks,
    aiLevel: settings.level,
    mapType: settings.mapType === 'any' ? undefined : settings.mapType,
    mode: settings.mode,
  });
  samples = state.colonies.map((colony) => [colonySize(colony)]);
  events.length = 0;
  hover = -1;
  renderer.reset(state, PLAYER);
  banner.classList.add('hidden');
  announcedDraws = 0;
  researchPause = false;
  shownOffer = '';
  knownUnlocked = new Set();
  freshUntil.clear();
  shownArmy = '';
  conquered = 0;
  lastTowerAlarm = -Infinity;
  buildLegend();
  buildOrders();
  syncControls();
  refreshHud();
}

// ---------- interface ----------

const seedInput = $<HTMLInputElement>('seed');
const pauseButton = $<HTMLButtonElement>('btn-pause');
const edgeButton = $<HTMLButtonElement>('btn-edge');
const rivalsButton = $<HTMLButtonElement>('btn-rivals');
const attacksButton = $<HTMLButtonElement>('btn-attacks');
const levelButton = $<HTMLButtonElement>('btn-level');
const LEVELS = ['EASY', 'NORMAL', 'HARD', 'BRUTAL', 'NIGHTMARE'];
/** What each start flavour means for the player. */
const FLAVOUR_TEXT: Record<string, string> = {
  mountains: 'a mountain range (Mines and Observatories, and richer houses on its slopes)',
  lake: 'a lake (Fisheries, and richer houses on its shore)',
  forest: 'a deep forest (slow to grow into, but it pays timber)',
  plains: 'open plains (room to grow, and treasure close by)',
};
const tip = $<HTMLDivElement>('tip');
const legend = $<HTMLDivElement>('legend');
const intro = $<HTMLDivElement>('intro');
const toolBar = $<HTMLDivElement>('tools');
const goldRow = $<HTMLDivElement>('row-gold');
const orders = $<HTMLDivElement>('orders');
const banner = $<HTMLDivElement>('banner');
const toast = $<HTMLDivElement>('toast');

function colonyName(id: number): string {
  return COLONY[(id - 1) % COLONY.length].name;
}

/** D12: one order for the whole colony: Hold, or Attack one rival. */
function buildOrders(): void {
  orders.innerHTML = '';
  const make = (target: number, label: string, color: string | null, wide: boolean) => {
    const button = document.createElement('button');
    button.className = wide ? 'btn wide order' : 'btn order';
    button.dataset.target = String(target);
    if (color) {
      const swatch = document.createElement('i');
      swatch.style.background = color;
      button.append(swatch);
    }
    button.append(label);
    button.addEventListener('click', () => {
      applyCommand(state, tuning, { type: 'order', owner: PLAYER, target }, events);
      syncControls();
      button.blur();
    });
    return button;
  };
  orders.append(make(0, 'HOLD', null, true));
  const rivals = state.colonies.filter((c) => c.id !== PLAYER && c.alive);
  if (rivals.length === 0) {
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = state.colonies.length === 1 ? 'Add rivals in the menu (M) to have someone to attack.' : 'No rivals left.';
    orders.append(note);
    return;
  }
  const label = document.createElement('p');
  label.className = 'note order-label';
  label.textContent = 'Attack:';
  const grid = document.createElement('div');
  grid.className = 'order-grid';
  for (const colony of rivals) {
    const button = make(colony.id, colonyName(colony.id).toUpperCase(), COLONY[(colony.id - 1) % COLONY.length].main, false);
    button.title = `Send your whole army against ${colonyName(colony.id)}`;
    grid.append(button);
  }
  orders.append(label, grid);
}

let toastTimer = 0;
/** Where clicking the current message takes the camera, if anywhere (in cells). */
let toastLook: [number, number] | null = null;

function showToast(text: string, alarm = false, look: [number, number] | null = null): void {
  toast.textContent = look ? `${text}  »` : text;
  toast.classList.toggle('alarm', alarm);
  toast.classList.toggle('clickable', look !== null);
  toast.title = look ? 'Click to look' : '';
  toastLook = look;
  toast.classList.remove('hidden');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.add('hidden'), alarm ? 6000 : 4000);
}

toast.addEventListener('click', () => {
  if (!toastLook) return;
  renderer.lookAt(toastLook[0], toastLook[1]);
  toast.classList.add('hidden');
});

/** The crown's square, in cells. */
function crownSpot(): [number, number] {
  return [(state.crown % state.width) + 0.5, ((state.crown / state.width) | 0) + 0.5];
}

/** The middle of a colony's tower, in cells. */
function towerSpot(id: number): [number, number] {
  const c = state.colonies[id - 1];
  return [(c.tower % state.width) + 1, ((c.tower / state.width) | 0) + 1];
}

/** Towers the player has taken, for the end screen. */
let conquered = 0;
/** When the player was last warned that their tower is being hit. */
let lastTowerAlarm = -Infinity;
let lastMissileWarning = 0;
let lastCharmNote = 0;

function clock(ticks: number): string {
  const seconds = Math.floor(ticks / tuning.tickRate);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

/** The end of a game: the verdict, how it went, and what to do next. */
function showEnd(won: boolean, headline?: string, line?: string): void {
  const colony = me();
  sound.play(won ? 'victory' : 'defeat');
  const peak = Math.max(...samples[PLAYER - 1]);
  const stat = (value: string | number, label: string) => `<div><b>${value}</b><span>${label}</span></div>`;
  const title = headline ?? (won ? 'VICTORY' : 'YOUR TOWER HAS FALLEN');
  const text = line ?? (won ? 'Every rival tower has fallen. The map is yours.' : 'Your colony is gone. The rivals fight on without you.');
  banner.innerHTML =
    `<h1>${title}</h1><p>${text}</p><p class="note">${modeInfo(tuning, state.mode).name} &middot; ${LEVELS[settings.level]} &middot; ${MAP_NAMES[state.mapType as MapType] ?? ''}</p>` +
    `<div class="end-stats">${stat(clock(state.tick), 'TIME')}${stat(peak, 'PEAK SIZE')}${stat(colony.picks.length, 'DISCOVERIES')}${stat(conquered, 'TOWERS TAKEN')}</div>` +
    `<div class="row"><button class="btn on" data-act="again">PLAY THIS MAP AGAIN</button><button class="btn" data-act="new">NEW MAP</button><button class="btn" data-act="watch">${won ? 'KEEP PLAYING' : 'WATCH'}</button><button class="btn" data-act="title">MAIN MENU</button></div>`;
  banner.classList.remove('hidden');
}

banner.addEventListener('click', (e) => {
  const act = (e.target as HTMLElement).closest('button')?.dataset.act;
  if (act === 'again') restart(false);
  else if (act === 'new') restart(true);
  else if (act === 'watch') banner.classList.add('hidden');
  else if (act === 'title') goToTitle();
});

/** React to the few simulation events the interface cares about. */
function noteEvents(): void {
  if (onTitle) return;
  for (const e of events) {
    // The player's tower is being hit: flash the screen, and say so (not every hit).
    if (e.type === 'age') {
      const ageName = tuning.ages[e.age - 1].name.toUpperCase();
      if (e.owner === PLAYER) {
        showToast(`YOU ENTER THE ${ageName} AGE! A BREAKTHROUGH AWAITS`);
        // The breakthrough is a free discovery: open it at once, like any other.
        announcedDraws = Math.min(announcedDraws, me().drawsEarned - 1);
      } else {
        showToast(`${colonyName(e.owner).toUpperCase()} ENTERS THE ${ageName} AGE`);
      }
      continue;
    }
    if (e.type === 'modeWin') {
      const info = modeInfo(tuning, state.mode);
      if (e.owner === PLAYER) showEnd(true, 'VICTORY', `${info.name}: you ${e.reason}.`);
      else showEnd(false, 'DEFEAT', `${info.name}: ${colonyName(e.owner)} ${e.reason}.`);
      continue;
    }
    if (e.type === 'crown') {
      if (e.owner === PLAYER) showToast('YOU HOLD THE CROWN! KEEP IT', false, crownSpot());
      else if (e.owner > 0) showToast(`${colonyName(e.owner).toUpperCase()} HOLDS THE CROWN`, true, crownSpot());
      continue;
    }
    if (e.type === 'launch' && e.nuke) {
      const from = e.owner === PLAYER ? 'YOU' : colonyName(e.owner).toUpperCase();
      const at = e.victim === PLAYER ? 'YOU' : colonyName(e.victim).toUpperCase();
      showToast(`NUKE LAUNCHED! ${from} → ${at}`, e.victim === PLAYER, [e.x, e.y]);
      continue;
    }
    if (e.type === 'launch' && e.victim === PLAYER) {
      const now = performance.now();
      if (now - lastMissileWarning > 15000) {
        lastMissileWarning = now;
        showToast(`INCOMING MISSILE FROM ${colonyName(e.owner).toUpperCase()}!`, true, [e.x, e.y]);
      }
      continue;
    }
    if (e.type === 'charm' && (e.owner === PLAYER || e.from === PLAYER)) {
      const now = performance.now();
      if (now - lastCharmNote > 20000) {
        lastCharmNote = now;
        showToast(e.owner === PLAYER ? 'YOUR HEX TOWER BEWITCHED AN ENEMY: IT FIGHTS FOR YOU NOW' : 'A HEX TOWER TURNED ONE OF YOUR UNITS AGAINST YOU', e.from === PLAYER, [e.x, e.y]);
      }
      continue;
    }
    if (e.type === 'airborne') {
      const who = e.owner === PLAYER ? 'YOU HAVE' : `${colonyName(e.owner).toUpperCase()} HAS`;
      showToast(`${who} AIRCRAFT! ANTI-AIR CAN NOW TURN UP IN RESEARCH`, e.owner !== PLAYER);
      continue;
    }
    if (e.type === 'landmark') {
      if (e.owner !== PLAYER) continue;
      const spot: [number, number] = [(e.cell % state.width) + 0.5, ((e.cell / state.width) | 0) + 0.5];
      if (e.feature === 1) {
        showToast('ANCIENT RUINS! A FREE DISCOVERY', false, spot);
        // Open the discovery at once, like any other.
        announcedDraws = Math.min(announcedDraws, me().drawsEarned - 1);
      } else {
        showToast(`TREASURE! +${e.gold} GOLD`, false, spot);
      }
      continue;
    }
    if (e.type === 'hit') {
      if (state.owner[e.cell] === PLAYER && state.kind[e.cell] === Kind.Tower) {
        renderer.flashAlarm();
        const now = performance.now();
        if (now - lastTowerAlarm > 12000) {
          lastTowerAlarm = now;
          showToast('YOUR TOWER IS UNDER ATTACK!', true, towerSpot(PLAYER));
          sound.play('warn');
        }
      }
      continue;
    }
    // A rival discovering one of the stronger buildings is worth knowing about.
    if (e.type === 'research' && e.owner !== PLAYER) {
      const option = researchOption(e.id);
      const kind = option.unlock ? kindOfKey(option.unlock) : 0;
      if (kind && costOf(state, tuning, e.owner, kind) >= 90) showToast(`${colonyName(e.owner).toUpperCase()} DISCOVERED ${option.name.toUpperCase()}`);
      continue;
    }
    if (e.type === 'order' && e.owner !== PLAYER && me().alive) {
      // Only wars that involve the player are announced; the legend shows the rest.
      const style = doctrineOf(state.colonies[e.owner - 1]).name.toUpperCase();
      if (e.target === PLAYER) showToast(`${colonyName(e.owner).toUpperCase()} (${style}) IS ATTACKING YOU!`, true, towerSpot(PLAYER));
      continue;
    }
    if (e.type !== 'defeat') continue;
    buildOrders();
    syncControls();
    const tookIt = e.by.includes(PLAYER);
    if (tookIt) conquered++;
    if (e.owner === PLAYER) {
      showEnd(false);
    } else if (state.colonies.every((c) => c.id === PLAYER || !c.alive)) {
      showEnd(true);
    } else if (tookIt) {
      const share = Math.floor(e.plunder / e.by.length);
      showToast(`YOU DESTROYED ${colonyName(e.owner).toUpperCase()}! +${share} GOLD PLUNDERED`);
    } else {
      const who = e.by.length > 0 ? ` TO ${e.by.map((id) => colonyName(id).toUpperCase()).join(' AND ')}` : '';
      showToast(`${colonyName(e.owner).toUpperCase()} HAS FALLEN${who}`, false, towerSpot(e.owner));
    }
  }
}

function drawIcon(target: HTMLCanvasElement, sprite: HTMLCanvasElement): void {
  const g = target.getContext('2d') as CanvasRenderingContext2D;
  g.clearRect(0, 0, target.width, target.height);
  g.drawImage(sprite, 0, 0);
}

const tabBar = $<HTMLDivElement>('tool-tabs');

function buildToolBar(): void {
  const art = renderer.sprites.colonies[PLAYER - 1];
  for (const tab of TABS) {
    const tabButton = document.createElement('button');
    tabButton.className = 'btn tab';
    tabButton.dataset.tab = tab.id;
    tabButton.title = `${tab.name} (${tab.key.toUpperCase()})`;
    const label = document.createElement('span');
    label.textContent = tab.name;
    const count = document.createElement('span');
    count.className = 'tab-count';
    count.id = `tab-count-${tab.id}`;
    const key = document.createElement('kbd');
    key.textContent = tab.key.toUpperCase();
    tabButton.append(key, label, count);
    tabButton.addEventListener('click', () => {
      setTab(tab.id);
      tabButton.blur();
    });
    tabBar.append(tabButton);

    for (const tool of tab.tools) {
      const button = document.createElement('button');
      button.className = 'btn tool';
      button.dataset.kind = String(tool.kind);
      button.dataset.tab = tab.id;

      const icon = document.createElement('canvas');
      icon.width = 8;
      icon.height = 8;
      icon.className = 'tool-icon';
      drawIcon(icon, art.buildings[tool.kind]);

      const name = document.createElement('span');
      name.className = 'tool-name';
      name.textContent = tool.name;
      const cost = document.createElement('span');
      cost.className = 'tool-cost';
      cost.id = `cost-${tool.kind}`;

      button.append(icon, name, cost);
      button.addEventListener('click', () => {
        if (isLocked(me(), tool.kind)) {
          showToast(`RESEARCH ${unlockedBy(tool.kind).toUpperCase()} TO UNLOCK`);
        } else {
          setTool(settings.tool === tool.kind ? 0 : tool.kind);
        }
        button.blur();
      });
      // Hovering a button explains it in the tip bar.
      button.addEventListener('mouseenter', () => (toolHover = tool.kind));
      button.addEventListener('mouseleave', () => (toolHover = 0));
      toolBar.append(button);
    }
  }
  drawIcon($<HTMLCanvasElement>('icon-gold'), renderer.sprites.icons.gold);
  drawIcon($<HTMLCanvasElement>('icon-science'), renderer.sprites.icons.science);
}

/** One line on each rival playstyle, for the colony list's tooltips. */
const DOCTRINE_NOTES: Record<string, string> = {
  Fortress: 'rings of towers and walls, then rolls forward with shields, archers and catapults.',
  Raiders: 'attacks early; hounds loot houses and knights ride down defenders.',
  Siege: 'spearmen carve lines through cities; catapults, sappers and giants follow.',
  Horde: 'masses of warriors under banners, with monks behind them, again and again.',
  Merchant: 'gets rich first, then buys giants, knights and cannons.',
};

/** The colony list: colour, name, playstyle and discoveries, who it is at war with, and its size. */
function buildLegend(): void {
  legend.innerHTML = '';
  state.colonies.forEach((colony, i) => {
    const row = document.createElement('div');
    row.className = 'legend-row';
    const swatch = document.createElement('i');
    swatch.style.background = COLONY[i % COLONY.length].main;
    const main = document.createElement('div');
    main.className = 'legend-main';
    const name = document.createElement('span');
    name.className = 'legend-name';
    name.textContent = COLONY[i % COLONY.length].name.toUpperCase();
    const sub = document.createElement('span');
    sub.className = 'legend-sub';
    sub.id = `legend-sub-${i}`;
    main.append(name, sub);
    const war = document.createElement('em');
    war.id = `legend-war-${i}`;
    const count = document.createElement('b');
    count.id = `legend-${i}`;
    row.id = `legend-row-${i}`;
    if (colony.id === PLAYER) row.classList.add('you');
    row.append(swatch, main, war, count);
    // Click a colony to look at it.
    row.addEventListener('click', () => {
      const c = state.colonies[i];
      renderer.lookAt((c.tower % state.width) + 1, ((c.tower / state.width) | 0) + 1);
    });
    legend.append(row);
  });
}

/** The army as a row of unit icons with counts. Rebuilt only when the numbers change. */
let shownArmy = '';
const unitIcons = new Map<number, string>();
function refreshArmyList(alive: Map<number, number>): void {
  const entries = [...alive.entries()].sort((p, q) => q[1] - p[1]);
  const key = entries.map(([type, n]) => `${type}:${n}`).join(',');
  if (key === shownArmy) return;
  shownArmy = key;
  const list = $('army-list');
  list.innerHTML = '';
  if (entries.length === 0) {
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = 'No units yet. Build a Warrior Camp (V).';
    list.append(note);
    return;
  }
  for (const [type, n] of entries) {
    let src = unitIcons.get(type);
    if (!src) {
      src = renderer.sprites.colonies[PLAYER - 1].units[type][0].toDataURL();
      unitIcons.set(type, src);
    }
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.title = `${n} ${UNIT_NAMES[type][n === 1 ? 0 : 1]}`;
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    chip.append(img, String(n));
    list.append(chip);
  }
}

// ---------- minimap ----------

const minimap = $<HTMLCanvasElement>('minimap');
const miniCtx = minimap.getContext('2d') as CanvasRenderingContext2D;

function rgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

const TERRAIN_RGB: Record<number, [number, number, number]> = {
  [Terrain.Grass]: [62, 104, 58],
  [Terrain.Forest]: [38, 74, 42],
  [Terrain.Water]: [36, 70, 128],
  [Terrain.Mountain]: [104, 104, 120],
};
const TEAM_RGB = COLONY.map((c) => ({ main: rgb(c.main), dark: rgb(c.dark), light: rgb(c.light) }));

/** The whole map at one pixel per square: land, colonies, armies, and the part on screen. */
function drawMinimap(): void {
  const w = state.width;
  const h = state.height;
  if (minimap.width !== w || minimap.height !== h) {
    minimap.width = w;
    minimap.height = h;
  }
  const img = miniCtx.createImageData(w, h);
  const d = img.data;
  for (let c = 0; c < w * h; c++) {
    const owner = state.owner[c];
    let col: [number, number, number];
    if (owner > 0) {
      const team = TEAM_RGB[(owner - 1) % TEAM_RGB.length];
      const kind = state.kind[c];
      col = kind === Kind.Tower ? [255, 255, 255] : kind === Kind.House ? team.main : team.dark;
    } else if (state.feature[c] !== 0) {
      // Landmarks stand out on the minimap: violet ruins, gold treasure.
      col = state.feature[c] === 1 ? [208, 130, 255] : [255, 215, 80];
    } else if (state.kind[c] === Kind.Rubble) {
      col = [70, 66, 62];
    } else {
      col = TERRAIN_RGB[state.terrain[c]] ?? TERRAIN_RGB[Terrain.Grass];
    }
    d[c * 4] = col[0];
    d[c * 4 + 1] = col[1];
    d[c * 4 + 2] = col[2];
    d[c * 4 + 3] = 255;
  }
  // The crown: a gold cross that blinks.
  if (state.crown >= 0 && Math.floor(performance.now() / 400) % 2 === 0) {
    const cx = state.crown % w;
    const cy = (state.crown / w) | 0;
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = (((cy + dy + h) % h) * w + ((cx + dx + w) % w)) * 4;
      d[k] = 255;
      d[k + 1] = 215;
      d[k + 2] = 80;
    }
  }
  // Armies: a bright dot per unit, in its colony's light colour.
  for (const u of state.units) {
    const c = Math.floor(u.y) * w + Math.floor(u.x);
    const team = TEAM_RGB[(u.owner - 1) % TEAM_RGB.length].light;
    d[c * 4] = team[0];
    d[c * 4 + 1] = team[1];
    d[c * 4 + 2] = team[2];
  }
  miniCtx.putImageData(img, 0, 0);
  // The part of the map on screen.
  const [x0, y0, x1, y1] = renderer.viewRect();
  miniCtx.strokeStyle = '#f4ecd8';
  miniCtx.lineWidth = 1;
  const rw = Math.max(2, Math.round(x1 - x0) - 1);
  const rh = Math.max(2, Math.round(y1 - y0) - 1);
  // On a looping map the box can run off one side and come back in at the other.
  const shifts = state.wrap ? [-1, 0, 1] : [0];
  for (const ky of shifts) {
    for (const kx of shifts) miniCtx.strokeRect(Math.round(x0) + kx * w + 0.5, Math.round(y0) + ky * h + 0.5, rw, rh);
  }
}

let miniDrag = false;
function minimapLook(e: MouseEvent): void {
  const rect = minimap.getBoundingClientRect();
  renderer.lookAt(((e.clientX - rect.left) / rect.width) * state.width, ((e.clientY - rect.top) / rect.height) * state.height);
}
minimap.addEventListener('mousedown', (e) => {
  miniDrag = true;
  minimapLook(e);
});
window.addEventListener('mousemove', (e) => {
  if (miniDrag) minimapLook(e);
});
window.addEventListener('mouseup', () => (miniDrag = false));

// ---------- menu ----------

const menu = $<HTMLDivElement>('menu');
/** True while the game is paused because the menu is open: closing it resumes. */
let menuPause = false;
const LEVEL_NOTES = [
  'Easy: rivals earn 25% less and take their time before attacking. Learn the ropes.',
  'Normal: rivals play fair and wait a little longer before their first attack.',
  'Hard: rivals earn 25% more gold and science.',
  'Brutal: rivals earn 50% more, start with extra gold and attack sooner. Good luck.',
  'Nightmare: rivals earn double, start rich and strike almost at once. You were warned.',
];

function setMenuOpen(open: boolean): void {
  menu.classList.toggle('hidden', !open);
  setText('level-note', LEVEL_NOTES[settings.level]);
  if (open && !settings.paused) {
    menuPause = true;
    settings.paused = true;
    syncControls();
  } else if (!open && menuPause) {
    menuPause = false;
    setPaused(false);
  }
}

/** Facts about a building for the hotbar's info card: what it costs, how tough it is, what it does. */
/**
 * What a money or science building earns, in plain numbers a minute: its base, and what each
 * neighbour adds. Empty for anything that earns nothing.
 */
function yieldsOf(kind: number): string[] {
  const e = tuning.economy;
  const spec = unlockTuning(tuning, kind);
  const m = me().mods;
  const g = (v: number) => (v * 60 * m.gold).toFixed(v * 60 * m.gold < 10 ? 1 : 0);
  const sc = (v: number) => (v * 60 * m.science).toFixed(v * 60 * m.science < 10 ? 1 : 0);
  switch (kind) {
    case Kind.Farm:
      return [`+${g(e.farmGoldPerSecond)} GOLD/MIN`, `+${g(e.farmNeighbourBonus)}/MIN PER TOUCHING FARM`];
    case Kind.Research:
      return [`+${sc(e.researchSciencePerSecond)} SCIENCE/MIN`];
    case Kind.Mine:
      return [`+${g(spec?.gold ?? 0)} GOLD/MIN`, `+${g(spec?.per ?? 0)}/MIN PER MOUNTAIN AROUND`];
    case Kind.Fishery:
      return [`+${g(spec?.gold ?? 0)} GOLD/MIN`, `+${g(spec?.per ?? 0)}/MIN PER WATER SQUARE AROUND`];
    case Kind.Market:
      return [`+${g(spec?.per ?? 0)} GOLD/MIN PER HOUSE WITHIN ${spec?.radius}`];
    case Kind.Bank:
      return [`${((spec?.rate ?? 0) * 100).toFixed(1)}% OF SAVED GOLD EACH SECOND`, `UP TO ${g(spec?.cap ?? 0)} GOLD/MIN`];
    case Kind.Library:
      return [`+${sc(spec?.science ?? 0)} SCIENCE/MIN`, `+${sc(spec?.per ?? 0)}/MIN PER SCIENCE BUILDING TOUCHING`];
    case Kind.Observatory:
      return [`+${sc(spec?.science ?? 0)} SCIENCE/MIN`, `+${sc(spec?.per ?? 0)}/MIN PER MOUNTAIN AROUND`];
    case Kind.Academy:
      return [`+${sc(spec?.science ?? 0)} SCIENCE/MIN`];
    case Kind.PrintingPress:
      return [`DISCOVERIES ${Math.round((spec?.discount ?? 0) * 100)}% CHEAPER EACH`];
    case Kind.PowerPlant:
      return [`MONEY BUILDINGS +${Math.round((spec?.boost ?? 0) * 100)}% WITHIN ${spec?.radius}`];
    case Kind.Plaza:
      return [`CITY GROWS x${spec?.boost} WITHIN ${spec?.radius}`];
    case Kind.LumberMill:
      return [`+${g(spec?.gold ?? 0)} GOLD/MIN`, `+${g(spec?.per ?? 0)}/MIN PER FOREST AROUND`];
    case Kind.Granary:
      return [`+${g(spec?.per ?? 0)} GOLD/MIN PER FARM WITHIN ${spec?.radius}`];
    case Kind.Exchange:
      return [`+${g(spec?.per ?? 0)} GOLD/MIN PER MONEY BUILDING YOU OWN`];
    case Kind.Alchemist:
      return [`+${sc(spec?.science ?? 0)} SCIENCE/MIN`, `COSTS ${g(spec?.upkeep ?? 0)} GOLD/MIN`];
    case Kind.University:
      return [`+${sc(spec?.per ?? 0)} SCIENCE/MIN PER HOUSE WITHIN ${spec?.radius}`];
    case Kind.SpyDen:
      return [`+${sc(spec?.per ?? 0)} SCIENCE/MIN PER RIVAL ALIVE`];
    case Kind.Radar:
      return [`TOWERS +${spec?.boost} RANGE WITHIN ${spec?.radius}`];
    default:
      return [];
  }
}

function statsFor(kind: number): string[] {
  const colony = me();
  const out: string[] = [];
  const health = Math.round(maxHealth(tuning, kind) * colony.mods.structureHealth);
  if (health > 0) out.push(`HEALTH ${health}`);
  const spec = unlockTuning(tuning, kind);
  if (kind === Kind.Crossbow || isTower(kind)) {
    const range = towerRange(tuning, colony, kind);
    if (range > 0) out.push(`RANGE ${range}`);
    const damage = kind === Kind.Crossbow ? tuning.defence.crossbow.damage : spec?.damage;
    if (damage) out.push(`DAMAGE ${Math.round(damage * colony.mods.towerDamage)}`);
    const reload = kind === Kind.Crossbow ? tuning.defence.crossbow.cooldownSeconds : spec?.cooldownSeconds;
    if (reload) out.push(`RELOAD ${+(reload * colony.mods.towerReload).toFixed(1)}S`);
  }
  if (isProducer(kind)) {
    const def = unitTuning(tuning, PRODUCES[kind]);
    out.push(`${def.cap + colony.mods.armySize} UNITS`);
    out.push(`UNIT HEALTH ${Math.round(def.hp * colony.mods.unitHealth)}`);
    if (def.damage > 0) out.push(`UNIT DAMAGE ${def.damage}`);
    out.push(`SPEED ${def.speed}`);
    out.push(`NEW UNIT EVERY ${Math.round(def.spawnSeconds * colony.mods.spawnTime)}S`);
  }
  out.push(...yieldsOf(kind).filter((line) => (kind !== Kind.Plaza && kind !== Kind.PowerPlant && kind !== Kind.Radar) || !line.includes('WITHIN')));
  if (kind === Kind.Plaza && spec) out.push(`GROWTH x${spec.boost}`, `REACH ${spec.radius}`);
  if ((kind === Kind.Factory || kind === Kind.PowerPlant) && spec) out.push(`+${Math.round((spec.boost ?? 0) * 100)}%`, `REACH ${spec.radius}`);
  if ((kind === Kind.MissileSilo || kind === Kind.NukeSilo) && spec) out.push('ANY RANGE', `BLAST ${spec.splash}`);
  if (kind === Kind.Radar && spec) out.push(`+${spec.boost} RANGE`, `REACH ${spec.radius}`);
  if (kind === Kind.Thorns && spec) out.push(`CUTS ${spec.thorns} PER STRIKE`);
  return out;
}

function syncControls(): void {
  seedInput.value = settings.seedName;
  pauseButton.textContent = settings.paused ? 'PLAY' : 'PAUSE';
  pauseButton.classList.toggle('on', settings.paused);
  document.querySelectorAll<HTMLButtonElement>('.btn.speed').forEach((b) => {
    b.classList.toggle('on', Number(b.dataset.speed) === settings.speed);
  });
  document.querySelectorAll<HTMLButtonElement>('.btn.tool').forEach((b) => {
    b.classList.toggle('on', Number(b.dataset.kind) === settings.tool);
    // Only what this colony has discovered is shown.
    b.classList.toggle('hidden', b.dataset.tab !== settings.tab || isLocked(me(), Number(b.dataset.kind)));
  });
  document.querySelectorAll<HTMLButtonElement>('.btn.tab').forEach((b) => {
    b.classList.toggle('on', b.dataset.tab === settings.tab);
  });
  document.querySelectorAll<HTMLButtonElement>('.btn.order').forEach((b) => {
    b.classList.toggle('on', Number(b.dataset.target) === me().order);
  });
  edgeButton.textContent = `EDGE VIEW: ${settings.showEdge ? 'ON' : 'OFF'}`;
  edgeButton.classList.toggle('on', settings.showEdge);
  rivalsButton.textContent = settings.rivals > 0 ? `RIVALS: ${settings.rivals}` : 'RIVALS: NONE';
  rivalsButton.classList.toggle('on', settings.rivals > 0);
  attacksButton.textContent = `AI ATTACKS: ${settings.aiAttacks ? 'ON' : 'OFF'}`;
  attacksButton.classList.toggle('on', settings.aiAttacks);
  levelButton.textContent = `LEVEL: ${LEVELS[settings.level]}`;
  // The map: which kind is chosen, and what this game's map and start are like.
  $('btn-maptype').textContent = `MAP: ${settings.mapType === 'any' ? 'ANY' : MAP_NAMES[settings.mapType].toUpperCase()}`;
  const mapName = MAP_NAMES[state.mapType as MapType] ?? 'A custom map';
  setText('map-note', `This game: ${mapName}. You start beside ${FLAVOUR_TEXT[me().flavour] ?? 'open ground'}.`);
  levelButton.classList.toggle('on', settings.level >= 2);
}

/** The mode's goal and the race for it, in the top bar. */
function refreshObjective(): void {
  const el = $('objective');
  const m = tuning.modes;
  let text = '';
  const name = (id: number) => (id === PLAYER ? 'YOU' : colonyName(id).toUpperCase());
  const mmss = (ticks: number) => clock(Math.max(0, ticks));
  if (state.mode === 'laststand') text = `SURVIVE ${mmss(m.lastStandSeconds * tuning.tickRate - state.tick)}`;
  else if (state.mode === 'goldrush') {
    const lead = modeLeader(state);
    text = `GOLD RUSH ${Math.floor(me().gold)}/${m.goldRushTarget}` + (lead && lead !== PLAYER ? ` · ${name(lead)} ${Math.floor(state.colonies[lead - 1].gold)}` : '');
  } else if (state.mode === 'crown') {
    const holder = crownHolder(state);
    const need = m.crownSeconds * tuning.tickRate;
    text = holder ? `CROWN: ${name(holder)} ${mmss(state.colonies[holder - 1].crownTicks)}/${mmss(need)}` : 'CROWN: UNCLAIMED';
    if (holder !== PLAYER && me().crownTicks > 0) text += ` · YOU ${mmss(me().crownTicks)}`;
  } else if (state.mode === 'blitz') text = 'BLITZ';
  else if (state.mode === 'sandbox') text = 'SANDBOX';
  el.classList.toggle('hidden', text === '');
  el.classList.toggle('alarm', state.mode === 'crown' && crownHolder(state) > 0 && crownHolder(state) !== PLAYER);
  if (el.textContent !== text) el.textContent = text;
}

function setText(id: string, value: string | number): void {
  const el = $(id);
  const text = String(value);
  if (el.textContent !== text) el.textContent = text;
}

function perSecond(value: number): string {
  return `+${value.toFixed(value < 10 ? 1 : 0)}/s`;
}

function refreshHud(): void {
  const colony = me();
  refreshObjective();

  setText('res-gold', Math.floor(colony.gold));
  setText('res-gold-rate', perSecond(goldPerSecond(colony, tuning)));
  // Where the gold comes from: houses (with the tower's small base income), and the economy:
  // farms plus every money building (mines, fisheries, markets, banks).
  const e = tuning.economy;
  const d = colony.dormant;
  const fromFarms = (e.farmGoldPerSecond * (colony.counts[Kind.Farm] - d.farms) + e.farmNeighbourBonus * (colony.farmLinks - d.farmLinks)) * colony.mods.gold;
  const fromHouses = goldPerSecond(colony, tuning) - fromFarms - colony.bonusGold;
  const part = (label: string, value: number) => `<span>${label} <b>+${value.toFixed(1)}</b></span>`;
  const split = part('HOUSES', fromHouses) + part('ECONOMY', fromFarms + colony.bonusGold);
  const splitEl = $('gold-split');
  if (splitEl.innerHTML !== split) splitEl.innerHTML = split;
  setText('res-science', `${Math.floor(colony.science)}/${nextThreshold(tuning, colony)}`);
  refreshResearch();
  checkDiscovery();
  setText('res-science-rate', perSecond(sciencePerSecond(colony, tuning)));

  // The Center Tower's health: green, then gold, then red as it falls.
  const towerFull = towerMaxHealth(tuning, colony);
  const towerShare = Math.max(0, colony.towerHp) / towerFull;
  const towerBar = $('tower-bar');
  const towerWidth = `${Math.round(towerShare * 100)}%`;
  if (towerBar.style.width !== towerWidth) towerBar.style.width = towerWidth;
  towerBar.className = towerShare > 0.6 ? '' : towerShare > 0.3 ? 'warn' : 'danger';
  towerBar.parentElement!.title = `${Math.max(0, Math.ceil(colony.towerHp))} / ${Math.round(towerFull)} health`;

  // The army: how many of each unit type are alive, out of what the buildings support.
  const alive = new Map<number, number>();
  let total = 0;
  for (const u of state.units) {
    if (u.owner !== PLAYER) continue;
    alive.set(u.type, (alive.get(u.type) ?? 0) + 1);
    total++;
  }
  let room = 0;
  for (const kind of PRODUCERS) {
    const type = PRODUCES[kind];
    room += colony.counts[kind] * (unitTuning(tuning, type).cap + colony.mods.armySize);
  }
  setText('st-army', `${total}/${room}`);
  refreshArmyList(alive);

  // Progress to the next discovery.
  const bar = $('sci-bar');
  const share = `${Math.min(100, Math.round((colony.science / nextThreshold(tuning, colony)) * 100))}%`;
  if (bar.style.width !== share) bar.style.width = share;
  // The order can change without a click (a target falls), so keep its buttons in step.
  document.querySelectorAll<HTMLButtonElement>('.btn.order').forEach((b) => {
    b.classList.toggle('on', Number(b.dataset.target) === colony.order);
  });

  setText('clock', clock(state.tick));
  updateMusic();
  setText('age-name', tuning.ages[me().age - 1].name.toUpperCase());
  // A clear PAUSED badge, unless a card on screen already explains the pause.
  const card = ['intro', 'research', 'menu', 'banner'].some((id) => !$(id).classList.contains('hidden'));
  $('paused-badge').classList.toggle('hidden', !settings.paused || card);
  state.colonies.forEach((c, i) => {
    setText(`legend-${i}`, c.alive ? colonySize(c) : 'FALLEN');
    // Who each colony is at war with, so alliances of convenience are visible at a glance.
    const war = c.alive && c.order > 0 ? `→ ${c.order === PLAYER ? 'YOU' : colonyName(c.order).toUpperCase()}` : '';
    setText(`legend-war-${i}`, war);
    // Playstyle and discoveries on the second line; hover the row for the full list.
    const style = c.id === PLAYER ? 'YOU' : c.doctrine >= 0 ? doctrineOf(c).name.toUpperCase() : 'RIVAL';
    setText(`legend-sub-${i}`, c.alive ? `${style} · ${tuning.ages[c.age - 1].name.toUpperCase()}` : style);
    const row = document.getElementById(`legend-row-${i}`);
    if (row) {
      row.classList.toggle('fallen', !c.alive);
      row.classList.toggle('threat', c.alive && c.order === PLAYER);
      const about = c.doctrine >= 0 ? `${doctrineOf(c).name}: ${DOCTRINE_NOTES[doctrineOf(c).name] ?? ''} ` : '';
      row.title = about + (c.picks.length > 0 ? `Discoveries: ${c.picks.map((id) => researchOption(id).name).join(', ')}.` : 'No discoveries yet.') + ' Click to look.';
    }
  });

  const now = performance.now();
  for (const tool of TOOLS) {
    const button = toolBar.querySelector<HTMLButtonElement>(`[data-kind="${tool.kind}"]`);
    if (!button) continue;
    const locked = isLocked(colony, tool.kind);
    // A building just unlocked by research: announce it and make its button glow for a while.
    if (!locked && !knownUnlocked.has(tool.kind)) {
      knownUnlocked.add(tool.kind);
      // (At tick 0 these are just the starting buildings: nothing to announce.)
      if (state.tick > 0) {
        freshUntil.set(tool.kind, now + 12000);
        showToast(`NEW ${categoryOf(tool.kind).toUpperCase()}: ${tool.label.toUpperCase()}`);
      }
    }
    // Undiscovered buildings stay off the bar altogether.
    button.classList.toggle('hidden', locked || button.dataset.tab !== settings.tab);
    button.classList.toggle('fresh', (freshUntil.get(tool.kind) ?? 0) > now);
    if (locked) continue;
    const cost = costOf(state, tuning, PLAYER, tool.kind);
    const owned = colony.counts[tool.kind];
    const price = cost === 0 ? 'FREE' : `${cost}G`;
    setText(`cost-${tool.kind}`, owned > 0 ? `${price} · x${owned}` : price);
    button.title = tool.label;
    button.classList.toggle('poor', colony.gold < cost);
  }
  for (const tab of TABS) {
    const open = tab.tools.filter((tool) => !isLocked(colony, tool.kind)).length;
    setText(`tab-count-${tab.id}`, String(open));
    const fresh = tab.tools.some((tool) => (freshUntil.get(tool.kind) ?? 0) > now);
    tabBar.querySelector(`[data-tab="${tab.id}"]`)?.classList.toggle('fresh', fresh && tab.id !== settings.tab);
  }

  drawMinimap();
  // The hint bar only shows up when it has something to say.
  const html = describe(hover);
  if (tip.innerHTML !== html) tip.innerHTML = html;
  tip.classList.toggle('card', html.startsWith('<div class="info"'));
  tip.classList.toggle('hidden', html === '');
}

function touchesPlayer(cell: number): boolean {
  const w = state.width;
  const x = cell % w;
  const y = (cell / w) | 0;
  const mine = (c: number) => state.owner[c] === PLAYER && isSource(state, c);
  return (y > 0 && mine(cell - w)) || (x < w - 1 && mine(cell + 1)) || (y < state.height - 1 && mine(cell + w)) || (x > 0 && mine(cell - 1));
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** What converting the hovered house with the selected tool would cost and do. */
function describeBuild(cell: number): string {
  const tool = TOOLS.find((t) => t.kind === settings.tool);
  if (!tool) return '';
  const colony = me();
  const cost = costOf(state, tuning, PLAYER, tool.kind);
  let text = `<b>${tool.label} here</b> — ${cost === 0 ? 'free' : `${cost} gold`}`;
  if (colony.gold < cost) text += ` (you have ${Math.floor(colony.gold)})`;
  text += '. ';
  const preview = buildingYield(state, tuning, cell, PLAYER, tool.kind);
  if (preview.gold > 0 || preview.science > 0) {
    const what = preview.gold > 0 ? `${(preview.gold * 60).toFixed(1)} gold` : `${(preview.science * 60).toFixed(1)} science`;
    text += `Here it would make ${what} a minute. `;
  } else if (tool.kind === Kind.Farm) {
    const beside = ownFarmNeighbours(state, cell, PLAYER);
    const perMinute = (farmYieldAt(state, tuning, cell, PLAYER) * 60).toFixed(1);
    text +=
      beside > 0
        ? `Touches ${plural(beside, 'farm')}: adds ${perMinute} gold a minute. `
        : `No farm beside it: adds only ${perMinute} gold a minute. Farms earn more in groups. `;
  } else {
    text += `${KIND_NOTES[tool.kind]} `;
  }
  text +=
    state.edgePos[cell] !== -1
      ? 'This is an edge house: you also give up growth here.'
      : 'Interior house: you give up only its gold income.';
  return `<span>${text}</span>`;
}

/** One line of plain language about the hovered cell. */
function describe(cell: number): string {
  if (toolHover) {
    // An info card: name, kind, price, what it does, and its numbers.
    const cost = costOf(state, tuning, PLAYER, toolHover);
    const poor = me().gold < cost ? ' poor' : '';
    const chips = statsFor(toolHover)
      .map((s) => `<span>${s}</span>`)
      .join('');
    return (
      `<div class="info"><div class="info-head"><b>${KIND_NAMES[toolHover].toUpperCase()}</b>` +
      `<span class="tag ${categoryOf(toolHover)}">${categoryOf(toolHover).toUpperCase()}</span>` +
      `<span class="info-cost${poor}">${cost === 0 ? 'FREE' : `${cost} GOLD`}</span></div>` +
      `<div class="info-text">${KIND_NOTES[toolHover]}</div>` +
      (chips ? `<div class="chips">${chips}</div>` : '') +
      `</div>`
    );
  }
  if (cell < 0) {
    return settings.tool
      ? '<span><b>BUILD MODE</b> — click or drag across your houses. <kbd>ESC</kbd> puts the tool away.</span>'
      : '';
  }
  const owner = state.owner[cell];
  const kind = state.kind[cell];
  if (owner !== 0) {
    const mine = owner === PLAYER;
    const who = mine ? 'Your' : `${COLONY[(owner - 1) % COLONY.length].name}'s`;
    const dormant = state.cutOff[cell] ? ' Cut off from its tower: dormant until reconnected.' : '';
    const health = `${Math.max(0, Math.ceil(healthAt(state, cell)))}/${Math.round(maxHealthAt(state, tuning, cell))} health.${dormant}`;
    if (kind === Kind.Tower) {
      return `<span><b>${who} Center Tower</b> — ${health} It shoots enemy units that come close. If it falls, the colony falls.</span>`;
    }
    if (kind === Kind.Farm) {
      // A farm says plainly what it earns, and how much of that its neighbours add.
      const m = state.colonies[owner - 1].mods.gold;
      const touching = ownFarmNeighbours(state, cell, owner);
      const own = tuning.economy.farmGoldPerSecond * 60 * m;
      const bonus = tuning.economy.farmNeighbourBonus * touching * 60 * m;
      const earns = state.cutOff[cell] ? 'Cut off from its tower: earns nothing until reconnected.' : `Earns <b>${(own + bonus).toFixed(1)} gold a minute</b>: ${own.toFixed(1)} of its own, +${bonus.toFixed(1)} from ${plural(touching, 'touching farm')}.`;
      return `<span><b>${who} Farm</b> — ${earns}${touching < 4 ? ' More farms beside it earn more.' : ''}</span>`;
    }
    if (kind !== Kind.House) {
      const state_ = isActive(state, cell) ? '' : ' Still under construction: weak, and not working yet.';
      return `<span><b>${who} ${KIND_NAMES[kind]}</b> — ${health} ${KIND_NOTES[kind]}${state_}</span>`;
    }
    if (mine && settings.tool) return describeBuild(cell);
    if (state.edgePos[cell] !== -1) {
      return mine
        ? `<span><b>Edge house</b> — still growing. Converting it gives up growth here.</span>`
        : `<span><b>${who} edge house</b> — still growing.</span>`;
    }
    return mine
      ? `<span><b>Interior house</b> — no empty neighbour, so it has no growth left to lose.</span>`
      : `<span><b>${who} interior house</b> — it cannot grow any more.</span>`;
  }
  if (cell === state.crown) return `<span><b>The Crown</b> — grow your city onto this square and hold it for ${Math.round(tuning.modes.crownSeconds / 60)} minutes in all to win. ${crownHolder(state) ? `Held by ${crownHolder(state) === PLAYER ? 'you' : colonyName(crownHolder(state))}.` : 'Nobody holds it yet.'}</span>`;
  if (state.feature[cell] === 1) return '<span><b>Ancient Ruins</b> — grow your city onto this square for a <b>free discovery</b>. First city to reach it wins it.</span>';
  if (state.feature[cell] === 2) return `<span><b>Treasure</b> — grow your city onto this square for <b>+${tuning.map.treasureGold} gold</b>. First city to reach it wins it.</span>`;
  if (kind === Kind.Rubble) return '<span><b>Rubble</b> — nothing can grow here until it clears. Units can cross it.</span>';
  const terrain = state.terrain[cell];
  if (terrain === Terrain.Water) return '<span><b>Water</b> — closed to growth; armies on foot cannot cross it (aircraft fly over). Houses beside it earn 50% more.</span>';
  if (terrain === Terrain.Mountain) return '<span><b>Mountain</b> — closed to growth, and armies on foot cannot cross it: only <b>Sappers</b> can blast a way through, and aircraft fly over. Houses beside it earn 50% more.</span>';
  const reach = isGrowable(state, cell) && touchesPlayer(cell) ? ' Your city can grow here next.' : '';
  if (terrain === Terrain.Forest) return `<span><b>Forest</b> — slow to grow into, but every square cleared pays +${tuning.economy.lumberGold} gold of timber. Lumber Mills earn from the forest left standing.${reach}</span>`;
  return `<span><b>Open grass</b> — free land.${reach}</span>`;
}

// ---------- research ----------

const researchButton = $<HTMLButtonElement>('btn-research');
const researchPanel = $<HTMLDivElement>('research');
const researchCards = $<HTMLDivElement>('research-cards');
const rerollButton = $<HTMLButtonElement>('btn-reroll');
/** The offer the cards currently show, so they are rebuilt only when it changes. */
let shownOffer = '';
let announcedDraws = 0;
/** True while the game is paused because a discovery is waiting: it resumes once the choice is made. */
let researchPause = false;

function setResearchOpen(open: boolean): void {
  researchPanel.classList.toggle('hidden', !open || !me().offer);
}

/**
 * A new discovery for the player stops everything (the user's change to D17): the game pauses
 * and the choice opens at once. Returns true if that just happened.
 */
function checkDiscovery(): boolean {
  if (onTitle) return false;
  const colony = me();
  if (!colony.alive || !colony.offer || colony.drawsEarned <= announcedDraws) return false;
  announcedDraws = colony.drawsEarned;
  sound.play('discovery');
  if (!settings.paused) {
    researchPause = true;
    settings.paused = true;
    syncControls();
  }
  refreshResearch();
  setResearchOpen(true);
  return true;
}

function refreshResearch(): void {
  const colony = me();
  const ready = colony.alive && colony.offer !== null;
  researchButton.classList.toggle('hidden', !ready);
  researchButton.textContent = colony.pendingDraws > 1 ? `DISCOVERY READY x${colony.pendingDraws}` : 'DISCOVERY READY';
  if (!ready) {
    researchPanel.classList.add('hidden');
    shownOffer = '';
    return;
  }
  const key = (colony.offer as string[]).join(',');
  if (key !== shownOffer) {
    shownOffer = key;
    researchCards.innerHTML = '';
    (colony.offer as string[]).forEach((id, index) => {
      const option = researchOption(id);
      const card = document.createElement('button');
      card.className = `btn card ${option.kind}`;
      const tag = document.createElement('span');
      tag.className = 'card-tag';
      const unlocks = option.unlock ? Number(Object.keys(UNLOCK_KEY).find((k) => UNLOCK_KEY[Number(k)] === option.unlock)) : 0;
      const kindTag = unlocks ? `NEW ${categoryOf(unlocks).toUpperCase()}` : 'RARE MODIFIER';
      tag.textContent = `${kindTag} · ${tuning.ages[(option.age ?? 1) - 1].name.toUpperCase()}`;
      if (option.kind === 'modifier') card.classList.add('rare');
      if (unlocks) {
        card.classList.add('unlock');
        const icon = document.createElement('canvas');
        icon.width = 8;
        icon.height = 8;
        icon.className = 'card-icon';
        drawIcon(icon, renderer.sprites.colonies[PLAYER - 1].buildings[unlocks]);
        card.append(icon);
      }
      const name = document.createElement('span');
      name.className = 'card-name';
      name.textContent = option.name.toUpperCase();
      const text = document.createElement('span');
      text.className = 'card-text';
      text.textContent = option.text;
      card.append(tag, name, text);
      if (unlocks) {
        const price = costOf(state, tuning, PLAYER, unlocks);
        const cost = document.createElement('span');
        cost.className = 'card-cost';
        cost.textContent = price === 0 ? 'FREE TO BUILD' : `COSTS ${price} GOLD EACH`;
        const earns = yieldsOf(unlocks);
        if (earns.length > 0) {
          const yields = document.createElement('span');
          yields.className = 'card-yield';
          yields.textContent = earns.join(' · ');
          card.append(yields);
        }
        card.append(cost);
      }
      card.addEventListener('click', () => {
        applyCommand(state, tuning, { type: 'research', owner: PLAYER, choice: index }, events);
        showToast(`DISCOVERED: ${option.name.toUpperCase()}`);
        // More draws banked: the next choice is already laid out, so keep the card open.
        // Otherwise close it, and carry on if the game was running when the discovery came.
        if (colony.pendingDraws === 0) {
          setResearchOpen(false);
          if (researchPause) {
            researchPause = false;
            setPaused(false);
          }
        }
      });
      researchCards.append(card);
    });
    // Or no discovery at all: a faster-growing city. It does not bring the next age closer.
    const offerCount = (colony.offer as string[]).length;
    const grow = document.createElement('button');
    grow.className = 'btn card grow';
    const growName = document.createElement('span');
    growName.className = 'card-name';
    growName.textContent = `OR: +${Math.round(tuning.research.growthChoice * 100)}% CITY GROWTH`;
    const growText = document.createElement('span');
    growText.className = 'card-text';
    growText.textContent = `Skip the discovery: your city grows ${Math.round(tuning.research.growthChoice * 100)}% faster from now on (now ${Math.round((colony.mods.growth - 1) * 100)}% faster). It still counts towards the next age.`;
    grow.append(growName, growText);
    grow.addEventListener('click', () => {
      applyCommand(state, tuning, { type: 'research', owner: PLAYER, choice: offerCount }, events);
      showToast(`YOUR CITY NOW GROWS ${Math.round((me().mods.growth - 1) * 100)}% FASTER`);
      refreshResearch();
      if (!me().offer) {
        setResearchOpen(false);
        if (researchPause) {
          researchPause = false;
          setPaused(false);
        }
      }
    });
    researchCards.append(grow);
    const taken = colony.picks.map((id) => researchOption(id).name).join(', ');
    $('research-taken').textContent = taken ? `Your discoveries: ${taken}.` : 'No discoveries yet.';
  }
  rerollButton.textContent = `RE-ROLL (${tuning.research.rerollCost} GOLD)`;
  rerollButton.classList.toggle('poor', colony.gold < tuning.research.rerollCost);
}

researchButton.addEventListener('click', () => setResearchOpen(true));
rerollButton.addEventListener('click', () => {
  if (!applyCommand(state, tuning, { type: 'reroll', owner: PLAYER }, events)) flashGold();
});

// ---------- commands ----------

let denyTimer = 0;

/** Flash the gold counter when a conversion is refused for lack of gold. */
function flashGold(): void {
  goldRow.classList.add('deny');
  window.clearTimeout(denyTimer);
  denyTimer = window.setTimeout(() => goldRow.classList.remove('deny'), 350);
}

function convert(cell: number): void {
  if (!settings.tool || !canConvert(state, PLAYER, cell)) return;
  if (!canAfford(state, tuning, PLAYER, settings.tool)) {
    flashGold();
    return;
  }
  // Orders are allowed while paused (D27), so commands apply immediately rather than on a tick.
  applyCommand(state, tuning, { type: 'convert', owner: PLAYER, cell, to: settings.tool }, events);
}

/** Convert every cell on the straight line between two cells, so a fast drag never skips one. */
function convertLine(from: number, to: number): void {
  if (to < 0) return;
  if (from < 0) {
    convert(to);
    return;
  }
  const w = state.width;
  let x = from % w;
  let y = (from / w) | 0;
  const x1 = to % w;
  const y1 = (to / w) | 0;
  const dx = Math.abs(x1 - x);
  const dy = Math.abs(y1 - y);
  const sx = x < x1 ? 1 : -1;
  const sy = y < y1 ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    convert(y * w + x);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}

let toolHover = 0;

function setTab(tab: Category): void {
  settings.tab = tab;
  // Keep the tool only if it belongs to the tab on show.
  if (settings.tool && categoryOf(settings.tool) !== tab) settings.tool = 0;
  syncControls();
}

function setTool(kind: number): void {
  if (kind !== 0 && kind !== settings.tool) sound.play('pick');
  settings.tool = kind;
  syncControls();
}

function setPaused(paused: boolean): void {
  // A discovery is waiting: the game stays paused until it is chosen.
  if (!paused && me().alive && me().offer) {
    setResearchOpen(true);
    return;
  }
  settings.paused = paused;
  syncControls();
}

function restart(randomize: boolean): void {
  settings.seedName = randomize ? randomSeedName() : seedInput.value.trim().toUpperCase() || randomSeedName();
  newGame();
}

// ---------- input ----------

const pointer = { down: false, painting: false, panning: false, x: 0, y: 0, lastPaint: -1 };

function toDevice(e: MouseEvent): [number, number] {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  return [(e.clientX - rect.left) * dpr, (e.clientY - rect.top) * dpr];
}

canvas.addEventListener('mousedown', (e) => {
  const [mx, my] = toDevice(e);
  pointer.down = true;
  pointer.x = mx;
  pointer.y = my;
  if (e.button === 0 && settings.tool) {
    pointer.painting = true;
    pointer.lastPaint = renderer.cellAt(mx, my);
    convert(pointer.lastPaint);
  } else {
    pointer.panning = true;
    canvas.classList.add('panning');
  }
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  const [mx, my] = toDevice(e);
  if (pointer.panning) renderer.pan(mx - pointer.x, my - pointer.y);
  pointer.x = mx;
  pointer.y = my;
  hover = e.target === canvas || pointer.down ? renderer.cellAt(mx, my) : -1;
  if (pointer.painting && hover >= 0) {
    convertLine(pointer.lastPaint, hover);
    pointer.lastPaint = hover;
  }
});

window.addEventListener('mouseup', () => {
  pointer.down = false;
  pointer.painting = false;
  pointer.panning = false;
  canvas.classList.remove('panning');
});

canvas.addEventListener('mouseleave', () => {
  if (!pointer.down) hover = -1;
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener(
  'wheel',
  (e) => {
    const [mx, my] = toDevice(e);
    renderer.zoomAt(mx, my, e.deltaY < 0 ? 1 : -1);
    e.preventDefault();
  },
  { passive: false },
);

const held = new Set<string>();

window.addEventListener('keydown', (e) => {
  if (e.target === seedInput) {
    if (e.key === 'Enter') {
      seedInput.blur();
      restart(false);
    }
    return;
  }
  const key = e.key.toLowerCase();
  held.add(key);
  const tab = TABS.find((t) => t.key === key);
  if (tab) setTab(tab.id);
  else if (key === ' ') {
    setPaused(!settings.paused);
    e.preventDefault();
  } else if (key === '1' || key === '2' || key === '3') {
    settings.speed = Number(key);
    syncControls();
  } else if (key === 'escape') {
    if (!menu.classList.contains('hidden')) setMenuOpen(false);
    else setTool(0);
  } else if (key === 'm') setMenuOpen(menu.classList.contains('hidden'));
  else if (key === 'e') {
    settings.showEdge = !settings.showEdge;
    syncControls();
  } else if (key === 'h') renderer.centerOnTower(me());
  else if (key === 't') setResearchOpen(true);
  else if (key === 'r') restart(false);
  else if (key === '+' || key === '=') renderer.zoomAt(canvas.width / 2, canvas.height / 2, 1);
  else if (key === '-') renderer.zoomAt(canvas.width / 2, canvas.height / 2, -1);
});

window.addEventListener('keyup', (e) => held.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => held.clear());
window.addEventListener('resize', () => renderer.resize());

pauseButton.addEventListener('click', () => setPaused(!settings.paused));
edgeButton.addEventListener('click', () => {
  settings.showEdge = !settings.showEdge;
  syncControls();
});
rivalsButton.addEventListener('click', () => {
  // 3, 5, 7 rivals, or none; a new game starts on a map sized for them.
  const counts = [3, 5, 7, 0];
  settings.rivals = counts[(counts.indexOf(settings.rivals) + 1) % counts.length];
  restart(false);
});
attacksButton.addEventListener('click', () => {
  // Takes effect at once: armies already on the march are called home.
  settings.aiAttacks = !settings.aiAttacks;
  state.aiAttacks = settings.aiAttacks;
  syncControls();
});
$('btn-maptype').addEventListener('click', () => {
  // Any, then each kind of map in turn. A different map means a new game.
  const order: Array<'any' | MapType> = ['any', ...MAP_TYPES];
  settings.mapType = order[(order.indexOf(settings.mapType) + 1) % order.length];
  menuPause = false;
  menu.classList.add('hidden');
  restart(false);
});
levelButton.addEventListener('click', () => {
  // Easy to nightmare, round again. Rivals' income is set when a game starts, so this restarts.
  settings.level = (settings.level + 1) % LEVELS.length;
  restart(false);
});
$('btn-music').addEventListener('click', () => {
  const next = VOLUME_STEPS[(VOLUME_STEPS.indexOf(sound.settings.music) + 1) % VOLUME_STEPS.length];
  sound.setVolumes(next, sound.settings.sfx);
  syncSoundButtons();
});
$('btn-sfx').addEventListener('click', () => {
  const next = VOLUME_STEPS[(VOLUME_STEPS.indexOf(sound.settings.sfx) + 1) % VOLUME_STEPS.length];
  sound.setVolumes(sound.settings.music, next);
  syncSoundButtons();
  sound.play('coin');
});
syncSoundButtons();
$('btn-menu').addEventListener('click', () => setMenuOpen(menu.classList.contains('hidden')));
$('btn-close-menu').addEventListener('click', () => setMenuOpen(false));
$('btn-help').addEventListener('click', () => {
  // The intro's START button resumes the game.
  menuPause = false;
  menu.classList.add('hidden');
  intro.classList.remove('hidden');
});
$('btn-title').addEventListener('click', () => {
  menuPause = false;
  menu.classList.add('hidden');
  goToTitle();
});
$('btn-restart').addEventListener('click', () => {
  menuPause = false;
  menu.classList.add('hidden');
  restart(false);
});
$('btn-random').addEventListener('click', () => {
  menuPause = false;
  menu.classList.add('hidden');
  restart(true);
});
$('btn-intro').addEventListener('click', () => {
  intro.classList.add('hidden');
  setPaused(false);
});
document.querySelectorAll<HTMLButtonElement>('.btn.speed').forEach((b) =>
  b.addEventListener('click', () => {
    settings.speed = Number(b.dataset.speed);
    syncControls();
  }),
);
// Buttons should not keep keyboard focus, or Space would press them again.
document.querySelectorAll<HTMLButtonElement>('.btn').forEach((b) => b.addEventListener('click', () => b.blur()));
// Every button clicks.
document.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('.btn')) sound.play('click');
});

// ---------- title screen ----------

/** True while the title screen is up: a game of rivals plays itself behind it. */
let onTitle = false;
const titleEl = $<HTMLDivElement>('title');
const logo = new Logo($<HTMLCanvasElement>('logo'), renderer.sprites);
const titleSeed = $<HTMLInputElement>('t-seed');
const RIVAL_CHOICES = [1, 2, 3, 4, 5, 6, 7];
/** The attract mode's camera: where it is drifting to, and when it picks somewhere new. */
const titleCam = { x: 0, y: 0, next: 0 };

const MODE_ICONS: Record<GameMode, () => HTMLCanvasElement> = {
  conquest: () => iconOf(renderer.sprites.colonies[0].tower, 2),
  laststand: () => iconOf(renderer.sprites.colonies[1].buildings[Kind.Bastion]),
  goldrush: () => iconOf(renderer.sprites.icons.gold),
  crown: () => iconOf(renderer.sprites.crown),
  blitz: () => iconOf(renderer.sprites.colonies[2].buildings[Kind.Lightning]),
  sandbox: () => iconOf(renderer.sprites.colonies[4].buildings[Kind.Plaza]),
};

function setupTitle(): void {
  const cards = $('title-modes');
  for (const mode of MODES) {
    const info = modeInfo(tuning, mode);
    const card = document.createElement('button');
    card.className = 'btn mode-card';
    card.dataset.mode = mode;
    const name = document.createElement('b');
    name.textContent = info.name.toUpperCase();
    const tag = document.createElement('span');
    tag.textContent = info.tagline;
    card.append(MODE_ICONS[mode](), name, tag);
    card.addEventListener('click', () => {
      settings.mode = mode;
      syncTitle(false);
    });
    cards.append(card);
  }
  titleEl.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((b) =>
    b.addEventListener('click', () => {
      const dir = Number(b.dataset.dir);
      if (b.dataset.step === 'map') {
        const order: Array<'any' | MapType> = ['any', ...MAP_TYPES];
        settings.mapType = order[(order.indexOf(settings.mapType) + dir + order.length) % order.length];
      } else if (b.dataset.step === 'rivals') {
        const i = RIVAL_CHOICES.indexOf(settings.rivals);
        settings.rivals = RIVAL_CHOICES[Math.max(0, Math.min(RIVAL_CHOICES.length - 1, (i < 0 ? 4 : i) + dir))];
      } else if (b.dataset.step === 'level') {
        settings.level = Math.max(0, Math.min(LEVELS.length - 1, settings.level + dir));
      }
      syncTitle(b.dataset.step !== 'level');
    }),
  );
  titleSeed.addEventListener('change', () => {
    settings.seedName = titleSeed.value.trim().toUpperCase() || randomSeedName();
    syncTitle(true);
  });
  titleSeed.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') titleSeed.blur();
    e.stopPropagation();
  });
  $('t-reroll').addEventListener('click', () => {
    settings.seedName = randomSeedName();
    syncTitle(true);
  });
  $('btn-play').addEventListener('click', play);
  $('btn-title-help').addEventListener('click', () => {
    const help = $('title-help');
    if (help.innerHTML === '') help.innerHTML = intro.querySelector('ol')?.outerHTML + (intro.querySelector('.note')?.outerHTML ?? '');
    help.classList.toggle('hidden');
  });
  $('btn-title-sound').addEventListener('click', () => {
    const on = sound.settings.music > 0 || sound.settings.sfx > 0;
    sound.setVolumes(on ? 0 : 0.5, on ? 0 : 0.7);
    syncSoundButtons();
    syncTitle(false);
  });
  const tips = [
    'Tip: every discovery card can be traded for faster growth instead.',
    'Tip: mountains stop armies on foot. Sappers blast through; aircraft fly over.',
    'Tip: rivals remember who attacked them, and hit back.',
    'Tip: walls repair themselves when left alone. Build them thick.',
    'Tip: you only get a handful of discoveries a game. Specialise.',
    'Tip: a Hex Tower turns light enemies to your side.',
    'Tip: farms are free but fragile. Grow them in big blocks.',
  ];
  $('title-foot').textContent = tips[Math.floor(Math.random() * tips.length)];
}

/** Show the title's current choices; redraw the map preview when the map would change. */
function syncTitle(redrawMap: boolean): void {
  titleEl.querySelectorAll<HTMLButtonElement>('.mode-card').forEach((c) => c.classList.toggle('on', c.dataset.mode === settings.mode));
  setText('title-goal', modeInfo(tuning, settings.mode).goal);
  const seed = hashString(settings.seedName);
  const type: MapType = settings.mapType === 'any' ? mapTypeFor(seed) : settings.mapType;
  setText('t-map', settings.mapType === 'any' ? `ANY (${MAP_NAMES[type].toUpperCase()})` : MAP_NAMES[type].toUpperCase());
  setText('t-rivals', String(settings.rivals));
  setText('t-level', LEVELS[settings.level]);
  setText('t-level-note', LEVEL_NOTES[settings.level]);
  $('t-level').dataset.level = String(settings.level);
  if (document.activeElement !== titleSeed) titleSeed.value = settings.seedName;
  const on = sound.settings.music > 0 || sound.settings.sfx > 0;
  setText('btn-title-sound', on ? 'SOUND: ON' : 'SOUND: OFF');
  if (redrawMap) {
    const flavour = drawMapPreview($<HTMLCanvasElement>('map-preview'), tuning, seed, type, 1 + settings.rivals);
    setText('t-map-note', `You start beside ${FLAVOUR_TEXT[flavour] ?? 'open ground'}.`);
  }
}

/** Back to the title: a fresh game of rivals plays itself behind it. */
function goToTitle(): void {
  onTitle = true;
  document.body.classList.add('on-title');
  titleEl.classList.remove('hidden');
  banner.classList.add('hidden');
  intro.classList.add('hidden');
  setResearchOpen(false);
  // The attract mode: six AI colonies on a random map, at double speed.
  state = createGame({
    seed: (Math.random() * 1e9) | 0,
    model: settings.model,
    colonies: 6,
    tuning,
    bots: [1, 2, 3, 4, 5, 6],
    aiLevel: 2,
    mapType: MAP_TYPES[Math.floor(Math.random() * (MAP_TYPES.length - 1))],
  });
  samples = state.colonies.map((colony) => [colonySize(colony)]);
  events.length = 0;
  renderer.reset(state, 1);
  renderer.zoom = Math.max(3, renderer.zoom);
  // Skip the quiet start: jump in a few minutes, when cities are up and armies about.
  for (let i = 0; i < 2400; i++) step(state, tuning, events);
  events.length = 0;
  renderer.reset(state, 1);
  titleCam.next = 0;
  settings.paused = false;
  settings.speed = 2;
  logo.restart(performance.now());
  syncTitle(true);
}

/** Each frame on the title: build the logo, and drift the camera over the action. */
function titleFrame(now: number, dt: number): void {
  logo.draw(now);
  if (now > titleCam.next) {
    titleCam.next = now + 9000;
    // Somewhere worth watching: the middle of a marching army, or else a random city.
    const marching = state.units.filter((u) => state.colonies[u.owner - 1].order > 0);
    if (marching.length > 0) {
      const u = marching[Math.floor(Math.random() * marching.length)];
      titleCam.x = u.x;
      titleCam.y = u.y;
    } else {
      const alive = state.colonies.filter((c) => c.alive);
      const c = alive[Math.floor(Math.random() * alive.length)];
      if (c) [titleCam.x, titleCam.y] = [(c.tower % state.width) + 1, ((c.tower / state.width) | 0) + 1];
    }
  }
  const k = Math.min(1, dt * 0.6);
  renderer.cx += (titleCam.x * 8 - renderer.cx) * k;
  renderer.cy += (titleCam.y * 8 - renderer.cy) * k;
  // A game that ends behind the title simply starts again.
  if (state.colonies.filter((c) => c.alive).length <= 1) goToTitle();
}

/** Leave the title and start the chosen game. */
function play(): void {
  onTitle = false;
  document.body.classList.remove('on-title');
  titleEl.classList.add('hidden');
  $('title-help').classList.add('hidden');
  settings.speed = 1;
  settings.paused = true;
  newGame();
  renderer.centerOnTower(me());
  renderer.zoom = 4;
  let seen = false;
  try {
    seen = localStorage.getItem('dot-city-intro') === '1';
    localStorage.setItem('dot-city-intro', '1');
  } catch {
    // Storage blocked: show the intro every time.
  }
  if (seen) setPaused(false);
  else intro.classList.remove('hidden');
}

// ---------- main loop ----------

let last = performance.now();
let acc = 0;
let lastHud = 0;

function sample(): void {
  if (state.tick % tuning.tickRate === 0) samples.forEach((series, i) => series.push(colonySize(state.colonies[i])));
}

function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  const panSpeed = 900 * dt * (window.devicePixelRatio || 1);
  if (held.has('a') || held.has('arrowleft')) renderer.pan(panSpeed, 0);
  if (held.has('d') || held.has('arrowright')) renderer.pan(-panSpeed, 0);
  if (held.has('w') || held.has('arrowup')) renderer.pan(0, panSpeed);
  if (held.has('s') || held.has('arrowdown')) renderer.pan(0, -panSpeed);

  if (!settings.paused) {
    // Fixed ticks: game speed only changes how many run per frame.
    acc += dt * settings.speed * tuning.tickRate;
    let ran = 0;
    while (acc >= 1 && ran < 10) {
      step(state, tuning, events);
      acc -= 1;
      ran++;
      // A discovery stops the clock on the very tick it arrives.
      if (checkDiscovery()) {
        acc = 0;
        sample();
        break;
      }
      sample();
    }
    if (acc > 5) acc = 0;
  }

  if (onTitle) titleFrame(now, dt);

  if (events.length > 0) {
    playEvents();
    noteEvents();
    renderer.apply(events, now);
    events.length = 0;
  }

  renderer.draw(now, {
    hover,
    showEdge: settings.showEdge,
    toolKind: settings.tool,
    canConvertHover: hover >= 0 && settings.tool !== 0 && canConvert(state, PLAYER, hover) && canAfford(state, tuning, PLAYER, settings.tool),
  });

  if (now - lastHud > 150) {
    lastHud = now;
    refreshHud();
  }
  requestAnimationFrame(frame);
}

buildToolBar();
newGame();
setupTitle();
goToTitle();

// Debug handle for automated checks.
(window as unknown as Record<string, unknown>).dotCity = {
  getState: () => state,
  /** The sound system, for checks. */
  sound,
  settings,
  renderer,
  advance: (ticks: number) => {
    for (let i = 0; i < ticks; i++) {
      step(state, tuning, events);
      sample();
    }
  },
  /** Issue a command exactly as the interface would. */
  command: (cmd: Parameters<typeof applyCommand>[2]) => applyCommand(state, tuning, cmd, events),
  /** Step the game and draw a frame by hand, for checks while the page is throttled. */
  play: (ticks: number, msPerTick = 100) => {
    const start = performance.now();
    for (let i = 0; i < ticks; i++) {
      step(state, tuning, events);
      sample();
      renderer.apply(events, start + i * msPerTick);
      events.length = 0;
    }
    const now = start + ticks * msPerTick - 60;
    renderer.draw(now, { hover, showEdge: settings.showEdge, toolKind: settings.tool, canConvertHover: false });
  },
};

requestAnimationFrame(frame);
