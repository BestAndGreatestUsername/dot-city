// Browser entry point: owns the clock, input and interface. All rules live in src/sim.

import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/600.css';
import '@fontsource/silkscreen/400.css';
import '@fontsource/silkscreen/700.css';
import './ui/style.css';

import tuningJson from './data/tuning.json';
import { COLONY } from './render/palette';
import { Renderer } from './render/renderer';
import { doctrineOf } from './sim/ai';
import { MAP_NAMES, MAP_TYPES, type MapType } from './sim/mapgen';
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
    ],
  },
];
const TOOLS: Tool[] = TABS.flatMap((tab) => tab.tools);

const KIND_NAMES: Record<number, string> = { [Kind.House]: 'house' };
for (const tool of TOOLS) KIND_NAMES[tool.kind] = tool.label;

const U = tuning.unlockables;
const cap = (kind: number) => unitTuning(tuning, PRODUCES[kind]).cap;
const KIND_NOTES: Record<number, string> = {
  [Kind.Wall]: 'Enemies must break it to get through. Your own units walk straight over it.',
  [Kind.Bastion]: `A wall with ${U.bastion.health} health, more than three times an ordinary wall.`,
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
  [Kind.PowderHouse]: `Keeps ${cap(Kind.PowderHouse)} sappers alive. The demolishers: they run at enemy walls and blow them apart, themselves included.`,
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
  [Kind.MissileSilo]: `Every ${U.silo.cooldownSeconds} seconds it strikes the most valuable building of your enemy, anywhere on the map.`,
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
};
void UNIT_KEY;

// ---------- session ----------

const ADJECTIVES = ['MOSSY', 'GOLDEN', 'QUIET', 'WINDY', 'EMBER', 'FROSTY', 'HOLLOW', 'SUNNY', 'MISTY', 'RUSTY', 'LUCKY', 'STONY'];
const NOUNS = ['RIDGE', 'HARBOR', 'MEADOW', 'CROSSING', 'HOLLOW', 'ORCHARD', 'BASIN', 'SUMMIT', 'MARSH', 'GROVE', 'FORD', 'VALE'];

function randomSeedName(): string {
  const pick = (list: string[]) => list[Math.floor(Math.random() * list.length)];
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${Math.floor(Math.random() * 90 + 10)}`;
}

const settings = {
  seedName: randomSeedName(),
  model: 'local' as GrowthModel,
  /** How many rival colonies share the map (0 = play alone). */
  rivals: 5,
  /** Whether rival colonies may attack. Off = they only build and defend. */
  aiAttacks: true,
  /** Rival difficulty: 0 normal, 1 hard, 2 brutal. */
  level: 1,
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
const LEVELS = ['NORMAL', 'HARD', 'BRUTAL'];
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

/** The middle of a colony's tower, in cells. */
function towerSpot(id: number): [number, number] {
  const c = state.colonies[id - 1];
  return [(c.tower % state.width) + 1, ((c.tower / state.width) | 0) + 1];
}

/** Towers the player has taken, for the end screen. */
let conquered = 0;
/** When the player was last warned that their tower is being hit. */
let lastTowerAlarm = -Infinity;

function clock(ticks: number): string {
  const seconds = Math.floor(ticks / tuning.tickRate);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

/** The end of a game: the verdict, how it went, and what to do next. */
function showEnd(won: boolean): void {
  const colony = me();
  const peak = Math.max(...samples[PLAYER - 1]);
  const stat = (value: string | number, label: string) => `<div><b>${value}</b><span>${label}</span></div>`;
  banner.innerHTML =
    (won ? '<h1>VICTORY</h1><p>Every rival tower has fallen. The map is yours.</p>' : '<h1>YOUR TOWER HAS FALLEN</h1><p>Your colony is gone. The rivals fight on without you.</p>') +
    `<div class="end-stats">${stat(clock(state.tick), 'TIME')}${stat(peak, 'PEAK SIZE')}${stat(colony.picks.length, 'DISCOVERIES')}${stat(conquered, 'TOWERS TAKEN')}</div>` +
    `<div class="row"><button class="btn on" data-act="again">PLAY THIS MAP AGAIN</button><button class="btn" data-act="new">NEW MAP</button>${won ? '' : '<button class="btn" data-act="watch">WATCH</button>'}</div>`;
  banner.classList.remove('hidden');
}

banner.addEventListener('click', (e) => {
  const act = (e.target as HTMLElement).closest('button')?.dataset.act;
  if (act === 'again') restart(false);
  else if (act === 'new') restart(true);
  else if (act === 'watch') banner.classList.add('hidden');
});

/** React to the few simulation events the interface cares about. */
function noteEvents(): void {
  for (const e of events) {
    // The player's tower is being hit: flash the screen, and say so (not every hit).
    if (e.type === 'age') {
      showToast(`THE ${tuning.ages[e.age - 1].name.toUpperCase()} AGE BEGINS! A BREAKTHROUGH AWAITS`);
      // The breakthrough is a free discovery: open it at once, like any other.
      announcedDraws = Math.min(announcedDraws, me().drawsEarned - 1);
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
  'Normal: rivals play fair and wait a little longer before their first attack.',
  'Hard: rivals earn 25% more gold and science.',
  'Brutal: rivals earn 50% more and attack sooner. Good luck.',
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
  if (kind === Kind.Plaza && spec) out.push(`GROWTH x${spec.boost}`, `REACH ${spec.radius}`);
  if ((kind === Kind.Factory || kind === Kind.PowerPlant) && spec) out.push(`+${Math.round((spec.boost ?? 0) * 100)}%`, `REACH ${spec.radius}`);
  if (kind === Kind.MissileSilo && spec) out.push(`DAMAGE ${spec.damage}`, `EVERY ${spec.cooldownSeconds}S`, 'ANY RANGE');
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
  levelButton.classList.toggle('on', settings.level > 0);
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
  setText('age-name', tuning.ages[state.age - 1].name.toUpperCase());
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
    setText(`legend-sub-${i}`, c.alive ? `${style} · ${c.picks.length} TECH` : style);
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
  if (kind === Kind.Rubble) return '<span><b>Rubble</b> — nothing can grow here until it clears. Units can cross it.</span>';
  const terrain = state.terrain[cell];
  if (terrain === Terrain.Water) return '<span><b>Water</b> — closed to growth, and units cannot cross it.</span>';
  if (terrain === Terrain.Mountain) return '<span><b>Mountain</b> — closed to growth. Units cross it slowly.</span>';
  const reach = isGrowable(state, cell) && touchesPlayer(cell) ? ' Your city can grow here next.' : '';
  if (terrain === Terrain.Forest) return `<span><b>Forest</b> — the city grows onto it twice as fast, then it is cleared.${reach}</span>`;
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
  const colony = me();
  if (!colony.alive || !colony.offer || colony.drawsEarned <= announcedDraws) return false;
  announcedDraws = colony.drawsEarned;
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
  // Normal, hard, brutal, round again. Rivals' income is set when a game starts, so this restarts.
  settings.level = (settings.level + 1) % LEVELS.length;
  restart(false);
});
$('btn-menu').addEventListener('click', () => setMenuOpen(menu.classList.contains('hidden')));
$('btn-close-menu').addEventListener('click', () => setMenuOpen(false));
$('btn-help').addEventListener('click', () => {
  // The intro's START button resumes the game.
  menuPause = false;
  menu.classList.add('hidden');
  intro.classList.remove('hidden');
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

  if (events.length > 0) {
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

// Debug handle for automated checks.
(window as unknown as Record<string, unknown>).dotCity = {
  getState: () => state,
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
