// Draws the world. Terrain and town are cached in off-screen layers at 1 pixel per sprite
// pixel and only changed cells are repainted; the screen is an integer-scaled copy.
// Units, shots, health bars and other moving things are drawn on top every frame.

import { isTower, isWall, towerRange } from '../sim/catalog';
import { maxHealthAt, towerMaxHealth } from '../sim/health';
import { hash2 } from '../sim/rng';
import { ownFarmNeighbours } from '../sim/state';
import { Kind, Terrain, TOWER_SIZE, UnitType, type BlastStyle, type Colony, type GameState, type ShotStyle, type SimEvent, type Tuning, type Unit } from '../sim/types';
import { COLONY, PAL } from './palette';
import { buildSprites, silhouette, TILE, type Sprite, type SpriteSet } from './sprites';
import { buildingYield } from '../sim/economy';
import { ECONOMY, SCIENCE, unitMaxHp, unitTuning, unlockTuning } from '../sim/catalog';
import { deltaX, deltaY, step as neighbour } from '../sim/topo';

export interface ViewOptions {
  hover: number;
  showEdge: boolean;
  /** Kind of the selected building tool, or 0 for none. */
  toolKind: number;
  canConvertHover: boolean;
}

interface Effect {
  kind: 'grow' | 'convert' | 'hit' | 'puff' | 'blast' | 'slash';
  heavy?: boolean;
  style?: BlastStyle;
  /** Blasts: radius in cells. */
  radius?: number;
  start: number;
  cell: number;
  /** Position in cell units, for effects that are not tied to one cell. */
  x: number;
  y: number;
}

interface Shot {
  start: number;
  style: ShotStyle;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const MAX_ZOOM = 10;

/** A pixel flying off something: sparks, debris, dust. Positions in cells, speeds in cells/second. */
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Downward pull in cells/second². */
  fall: number;
  start: number;
  life: number;
  color: string;
  size: number;
}

/** Floating text: damage numbers and income pops. */
interface Floater {
  x: number;
  y: number;
  text: string;
  color: string;
  start: number;
  life: number;
}

/** What the renderer remembers about each unit between frames, for animation. */
interface Seen {
  x: number;
  y: number;
  hp: number;
  flashUntil: number;
  movedAt: number;
  lungeStart: number;
  lungeX: number;
  lungeY: number;
  /** The health bar's fading "just lost" chunk, as a share of full health. */
  trail: number;
}
/** How long each kind of shot takes to fly, in milliseconds. */
const SHOT_MS: Record<ShotStyle, number> = { bolt: 150, arrow: 220, ballista: 220, spear: 260, lightning: 170, cannon: 380, rock: 440, missile: 1300, magic: 320, rail: 300, hex: 420, sniper: 160, gun: 110 };
/** How long each kind of blast lasts. */
const BLAST_MS: Record<BlastStyle, number> = { fire: 320, frost: 420, heal: 560, cannon: 460, magic: 380, hex: 620, nuke: 2800 };

/** How often a block of farms shows what it earned. */
const HARVEST_MS = 8000;

/** The colours of the dead. */
const HORDE = { name: 'Horde', main: '#5e4b70', dark: '#3a2f48', light: '#a597b8' };

/** Buildings that reach a square area around them: their area is outlined when placed or hovered. */
const AREA_KINDS: number[] = [Kind.Factory, Kind.PowerPlant, Kind.Plaza, Kind.Radar, Kind.Granary, Kind.University, Kind.Market];

export class Renderer {
  readonly sprites: SpriteSet = buildSprites();
  zoom = 4;
  /** Camera centre in world pixels. */
  cx = 0;
  cy = 0;

  private readonly ctx: CanvasRenderingContext2D;
  private terrain: HTMLCanvasElement[] = [];
  private terrainCtx: CanvasRenderingContext2D[] = [];
  private town!: HTMLCanvasElement;
  private townCtx!: CanvasRenderingContext2D;
  private state!: GameState;
  private player = 1;
  private effects: Effect[] = [];
  private shots: Shot[] = [];
  /** Cells that have taken damage and should show a health bar. */
  private damaged = new Set<number>();
  /** Buildings still inside their build-up time. */
  private building = new Set<number>();
  private particles: Particle[] = [];
  private floaters: Floater[] = [];
  private seen = new Map<number, Seen>();
  /** When each unit was first drawn: the dead take a moment to climb out of the ground. */
  private bornAt = new Map<number, number>();
  private shakeUntil = 0;
  private shakeSize = 0;
  private shakeStart = 0;
  private shadows = new WeakMap<Sprite, Sprite>();
  private vignette: HTMLCanvasElement | null = null;
  /** The camera centre in cells, for this frame: things are drawn at their copy nearest to it. */
  private camX = 0;
  private camY = 0;
  /** Until when the screen edges flash red (the player's tower was hit). */
  private alarmUntil = 0;
  /** A nuke's white flash over the whole screen. */
  private whiteStart = 0;
  private whiteUntil = 0;
  /** Health bars' "just lost" chunks for squares, as a share of full health. */
  private cellTrail = new Map<number, number>();
  /** When the simulation last ticked, and how long a tick takes: warheads glide between ticks. */
  private tickSeen = -1;
  private tickAt = 0;
  private tickMs = 100;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly tuning: Tuning,
  ) {
    this.ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    this.resize();
  }

  // ---------- set-up ----------

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    this.canvas.height = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    this.vignette = null;
    if (this.state) this.zoom = Math.max(this.zoom, this.minZoom());
  }

  reset(state: GameState, player: number): void {
    this.state = state;
    this.player = player;
    this.effects = [];
    this.shots = [];
    this.damaged.clear();
    this.building.clear();
    this.particles = [];
    this.floaters = [];
    this.seen.clear();
    this.cellTrail.clear();
    const w = state.width * TILE;
    const h = state.height * TILE;
    const layer = () => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    };
    this.terrain = [layer(), layer()];
    this.terrainCtx = this.terrain.map((c) => c.getContext('2d') as CanvasRenderingContext2D);
    this.town = layer();
    this.townCtx = this.town.getContext('2d') as CanvasRenderingContext2D;
    for (let c = 0; c < state.kind.length; c++) {
      this.paintTerrain(c);
      this.paintTown(c);
    }
    this.zoom = Math.max(this.minZoom(), Math.max(2, Math.min(6, Math.round(this.canvas.width / (TILE * 34)))));
    this.centerOnTower(state.colonies[player - 1]);
  }

  /** Centre the camera on the middle of a colony's 2x2 tower. */
  centerOnTower(colony: Colony): void {
    this.cx = ((colony.tower % this.state.width) + TOWER_SIZE / 2) * TILE;
    this.cy = (((colony.tower / this.state.width) | 0) + TOWER_SIZE / 2) * TILE;
  }

  // ---------- cached layers ----------

  private paintTerrain(c: number): void {
    const s = this.state;
    const w = s.width;
    const x = c % w;
    const y = (c / w) | 0;
    const px = x * TILE;
    const py = y * TILE;
    const kind = s.terrain[c];
    const isWater = (n: number, nx: number, ny: number) => {
      if (s.wrap) return s.terrain[(((ny % s.height) + s.height) % s.height) * w + (((nx % w) + w) % w)] === Terrain.Water;
      return nx < 0 || ny < 0 || nx >= w || ny >= s.height || s.terrain[n] === Terrain.Water;
    };
    for (let frame = 0; frame < 2; frame++) {
      const g = this.terrainCtx[frame];
      if (kind === Terrain.Water) {
        // Deeper water away from the shore.
        const deep = !(!isWater(c - w, x, y - 1) || !isWater(c + w, x, y + 1) || !isWater(c - 1, x - 1, y) || !isWater(c + 1, x + 1, y));
        g.fillStyle = deep ? PAL.waterDark : PAL.water;
        g.fillRect(px, py, TILE, TILE);
        if (deep) {
          g.fillStyle = PAL.water;
          g.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
        }
        // A darker lip where a bank casts its shadow from the north.
        if (!isWater(c - w, x, y - 1)) {
          g.fillStyle = PAL.waterDark;
          g.fillRect(px, py, TILE, 1);
        }
        // Foam lapping at the shore, moving between the two frames.
        g.fillStyle = PAL.waterLight;
        const foam = (nx: number, ny: number, n: number) => !isWater(n, nx, ny);
        for (let i = frame; i < TILE; i += 2) {
          if (foam(x, y + 1, c + w)) g.fillRect(px + i, py + TILE - 1, 1, 1);
          if (foam(x - 1, y, c - 1)) g.fillRect(px, py + i, 1, 1);
          if (foam(x + 1, y, c + 1)) g.fillRect(px + TILE - 1, py + i, 1, 1);
        }
        for (let i = 0; i < 2; i++) {
          if (hash2(s.seed + 31 + i, x, y) < 0.35) continue;
          const row = 2 + i * 3;
          const col = (Math.floor(hash2(s.seed + 57 + i, x, y) * 6) + frame) % 6;
          g.fillRect(px + col, py + row, 2, 1);
        }
        continue;
      }
      // Grass in broad patches of two shades, with tufts and the odd flower.
      const patch = hash2(s.seed + 11, x >> 2, y >> 2) + hash2(s.seed + 12, (x + 2) >> 2, (y + 1) >> 2);
      g.fillStyle = kind === Terrain.Forest ? PAL.grassDark : patch > 1.15 ? PAL.grassLight : PAL.grass;
      g.fillRect(px, py, TILE, TILE);
      for (let i = 0; i < 5; i++) {
        const r = hash2(s.seed + 101 + i, x, y);
        const sx = Math.floor(hash2(s.seed + 211 + i, x, y) * TILE);
        const sy = Math.floor(hash2(s.seed + 307 + i, x, y) * (TILE - 1));
        g.fillStyle = r < 0.5 ? PAL.grassDark : r < 0.93 ? PAL.grassLight : PAL.flower;
        g.fillRect(px + sx, py + sy, 1, r < 0.5 ? 2 : 1);
      }
      // Landmarks sit on open ground until a city grows over them.
      if (s.feature[c] !== 0 && kind !== Terrain.Forest) {
        g.drawImage(s.feature[c] === 1 ? this.sprites.ruins : this.sprites.treasure, px, py);
        continue;
      }
      if (kind === Terrain.Forest) {
        const trees = this.sprites.trees;
        const tree = trees[Math.floor(hash2(s.seed + 401, x, y) * trees.length)];
        g.fillStyle = 'rgba(18, 40, 26, 0.45)';
        g.fillRect(px + 1, py + 6, 6, 2);
        // Leaves stir between frames.
        g.drawImage(tree, px + (frame === 1 && hash2(s.seed + 409, x, y) < 0.3 ? 1 : 0), py);
        if (s.feature[c] !== 0) g.drawImage(s.feature[c] === 1 ? this.sprites.ruins : this.sprites.treasure, px, py);
      } else if (kind === Terrain.Mountain) {
        const rocks = this.sprites.mountains;
        g.fillStyle = 'rgba(18, 19, 31, 0.3)';
        g.fillRect(px + 1, py + 7, 7, 1);
        g.drawImage(rocks[Math.floor(hash2(s.seed + 503, x, y) * rocks.length)], px, py);
      }
    }
  }

  private paintTown(c: number): void {
    const s = this.state;
    const g = this.townCtx;
    const x = c % s.width;
    const y = (c / s.width) | 0;
    const px = x * TILE;
    const py = y * TILE;
    g.clearRect(px, py, TILE, TILE);
    const k = s.kind[c];
    if (k === Kind.Rubble) {
      // Scorched ground with broken stone on it.
      g.fillStyle = 'rgba(38, 32, 28, 0.5)';
      g.fillRect(px, py, TILE, TILE);
      g.drawImage(this.sprites.rubble, px, py);
      return;
    }
    const owner = s.owner[c];
    if (owner === 0) return;
    const colors = COLONY[(owner - 1) % COLONY.length];
    const art = this.sprites.colonies[(owner - 1) % COLONY.length];

    if (k === Kind.Tower) {
      // The tower stands on a plaza in its colony's colour so it is easy to spot.
      g.fillStyle = colors.light;
      g.fillRect(px, py, TILE, TILE);
    } else {
      g.fillStyle = PAL.ground;
      g.fillRect(px, py, TILE, TILE);
      g.fillStyle = PAL.groundDark;
      for (let i = 0; i < 2; i++) {
        const sx = Math.floor(hash2(s.seed + 601 + i, x, y) * TILE);
        const sy = Math.floor(hash2(s.seed + 701 + i, x, y) * TILE);
        g.fillRect(px + sx, py + sy, 1, 1);
      }
    }

    // A one-pixel border in the colony colour wherever this cell meets the outside.
    g.fillStyle = colors.dark;
    const other = (dir: number) => {
      const n = neighbour(s, c, dir);
      return n < 0 || s.owner[n] !== owner;
    };
    if (other(0)) g.fillRect(px, py, TILE, 1);
    if (other(2)) g.fillRect(px, py + TILE - 1, TILE, 1);
    if (other(3)) g.fillRect(px, py, 1, TILE);
    if (other(1)) g.fillRect(px + TILE - 1, py, 1, TILE);

    if (k === Kind.House) {
      this.stamp(g, art.houses[Math.floor(hash2(s.seed + 809, x, y) * art.houses.length)], px, py, px, py, TILE);
    } else if (k === Kind.Tower) {
      // The tower is ONE 16x16 sprite. Whichever of its four cells is being repainted,
      // the whole sprite is drawn again in one piece from the tower's top-left corner.
      const anchor = s.colonies[owner - 1].tower;
      const ax = (anchor % s.width) * TILE;
      const ay = ((anchor / s.width) | 0) * TILE;
      this.stamp(g, art.tower, ax, ay, ax, ay, TILE * TOWER_SIZE);
    } else if (isWall(k)) {
      this.stamp(g, art.buildings[k], px, py, px, py, TILE);
      // Join up with walls above and below so a line of them reads as one wall.
      const wallAt = (n: number) => n >= 0 && isWall(s.kind[n]) && s.owner[n] === owner;
      if (wallAt(neighbour(s, c, 0))) {
        g.fillStyle = PAL.stoneLight;
        g.fillRect(px + 2, py, 4, 2);
      }
      if (wallAt(neighbour(s, c, 2))) {
        g.fillStyle = PAL.stoneDark;
        g.fillRect(px + 2, py + TILE - 1, 4, 1);
      }
    } else if (k === Kind.Farm) {
      // A farm inside a block is drawn as open field, so a group of farms reads as one big field.
      g.drawImage(ownFarmNeighbours(s, c, owner) >= 2 ? art.field : art.buildings[k], px, py);
    } else if (art.buildings[k]) {
      this.stamp(g, art.buildings[k], px, py, px, py, TILE);
    }
  }

  private paintTownAround(c: number): void {
    const s = this.state;
    this.paintTown(c);
    for (let d = 0; d < 4; d++) {
      const n = neighbour(s, c, d);
      if (n >= 0) this.paintTown(n);
    }
  }

  /** Repaint whatever the simulation just changed and queue a little animation for it. */
  apply(events: SimEvent[], now: number): void {
    const effect = (kind: Effect['kind'], cell: number, x = 0, y = 0) => this.effects.push({ kind, start: now, cell, x, y });
    // Blasts from shells and boulders go off when the shot lands, not when it is fired.
    const landing = new Map<string, number>();
    for (const e of events) {
      switch (e.type) {
        case 'grow':
          if (e.clearedForest) {
            this.paintTerrain(e.cell);
            if (e.owner === this.player) {
              const lx = (e.cell % this.state.width) + 0.5;
              const ly = ((e.cell / this.state.width) | 0) + 0.3;
              this.floaters.push({ x: lx, y: ly, text: `+${this.tuning.economy.lumberGold}`, color: PAL.wheatDark, start: now, life: 900 });
            }
          }
          this.paintTownAround(e.cell);
          effect('grow', e.cell);
          break;
        case 'convert':
          this.paintTownAround(e.cell);
          this.building.add(e.cell);
          effect('convert', e.cell);
          break;
        case 'hit':
          this.damaged.add(e.cell);
          effect('hit', e.cell);
          break;
        case 'destroy':
          this.paintTownAround(e.cell);
          this.damaged.delete(e.cell);
          this.building.delete(e.cell);
          effect('puff', -1, (e.cell % this.state.width) + 0.5, ((e.cell / this.state.width) | 0) + 0.5);
          this.burst((e.cell % this.state.width) + 0.5, ((e.cell / this.state.width) | 0) + 0.5, 12, [PAL.stoneLight, PAL.stoneDark, PAL.trunk, PAL.ground], now, 2.6, 1);
          if (e.kind !== Kind.House) this.shake(now, 1, 120, (e.cell % this.state.width) + 0.5, ((e.cell / this.state.width) | 0) + 0.5);
          break;
        case 'clear':
          this.paintTownAround(e.cell);
          break;
        case 'shot': {
          const style = e.style ?? 'bolt';
          this.shots.push({ start: now, style, x0: e.x0, y0: e.y0, x1: e.x1, y1: e.y1 });
          if (style === 'cannon' || style === 'rock' || style === 'magic') landing.set(`${e.x1.toFixed(2)},${e.y1.toFixed(2)}`, SHOT_MS[style]);
          if (style === 'rail') this.burst(e.x0, e.y0 - 0.3, 6, [PAL.science, PAL.scienceLight, '#ffffff'], now, 1.6, 0);
          if (style === 'sniper') this.burst(e.x1, e.y1, 3, [PAL.paper, PAL.bad], now, 1.4, 1);
          if (style === 'lightning') this.burst(e.x1, e.y1, 4, [PAL.spark, '#ffffff'], now, 2, 0);
          break;
        }
        case 'blast': {
          const delay = landing.get(`${e.x.toFixed(2)},${e.y.toFixed(2)}`) ?? 0;
          this.effects.push({ kind: 'blast', style: e.style, radius: e.radius, start: now + delay, cell: -1, x: e.x, y: e.y });
          if (e.style === 'cannon') {
            this.burst(e.x, e.y, 14, [PAL.fire, PAL.fireLight, PAL.rockMid, PAL.rockDark], now + delay, 3.2, 1.4);
            this.shake(now + delay, e.radius >= 1.5 ? 2 : 1, 180, e.x, e.y);
          } else if (e.style === 'heal') {
            this.burst(e.x, e.y, 4, [PAL.holy, PAL.holyLight], now, 0.8, -0.6);
          } else if (e.style === 'magic') {
            this.burst(e.x, e.y, 10, [PAL.void, '#ffd6ff', PAL.voidDark], now + delay, 2, -0.3);
          } else if (e.style === 'hex') {
            this.burst(e.x, e.y, 10, [PAL.holy, PAL.holyLight, PAL.void], now, 1.4, -0.8);
          } else if (e.style === 'nuke') {
            this.burst(e.x, e.y, 60, [PAL.fireLight, PAL.fire, '#ffffff', PAL.rockMid, PAL.rockDark], now, 7, 0.6);
            this.shake(now, 3, 1100, e.x, e.y);
            const sx = this.wx(e.x) * TILE * this.zoom - this.originX();
            const sy = this.wy(e.y) * TILE * this.zoom - this.originY();
            const margin = this.canvas.width * 0.5;
            if (sx > -margin && sy > -margin && sx < this.canvas.width + margin && sy < this.canvas.height + margin) {
              this.whiteStart = now;
              this.whiteUntil = now + 650;
            }
          }
          break;
        }
        case 'landmark': {
          // Found: the landmark is gone from the ground, with a burst of light (or of gold).
          this.paintTerrain(e.cell);
          const lx = (e.cell % this.state.width) + 0.5;
          const ly = ((e.cell / this.state.width) | 0) + 0.5;
          const ruins = e.feature === 1;
          this.burst(lx, ly, 18, ruins ? [PAL.void, PAL.holyLight, PAL.paper] : [PAL.gold, PAL.goldDark, PAL.paper], now, 2.6, -0.6);
          this.floaters.push({ x: lx, y: ly - 0.6, text: ruins ? 'DISCOVERY!' : `+${e.gold}`, color: ruins ? PAL.holyLight : PAL.gold, start: now, life: 1600 });
          break;
        }
        case 'terrain':
          this.paintTerrain(e.cell);
          break;
        case 'launch': {
          // Smoke billows from the silo as the warhead leaves.
          const strike = this.state.strikes[this.state.strikes.length - 1];
          if (strike) this.burst(strike.x0, strike.y0, e.nuke ? 24 : 12, [PAL.stoneLight, PAL.paper, PAL.fireLight], now, e.nuke ? 2.4 : 1.6, -0.4);
          break;
        }
        case 'rise':
          // The ground splits and the dead claw out: clods of earth and a puff of grave dust.
          this.burst(e.x, e.y + 0.3, 10, [PAL.groundDark, PAL.trunk, PAL.ground, '#5d6b4a'], now, 2, 1.2);
          effect('puff', -1, e.x, e.y + 0.2);
          break;
        case 'charm':
          this.floaters.push({ x: e.x, y: e.y - 0.7, text: 'BEWITCHED!', color: PAL.holy, start: now, life: 1100 });
          break;
        case 'thorns': {
          // Cut on a Thorn Wall: a spray of red.
          this.burst(e.x, e.y, 4, [PAL.fire, PAL.fireLight, '#b03030'], now, 1.2, 0.5);
          break;
        }
        case 'loot': {
          // A hound sacked a house: a shower of coins and the gold it took.
          this.burst(e.x, e.y, 8, [PAL.gold, PAL.goldDark, PAL.gold], now, 1.6, 0.8);
          this.floaters.push({ x: e.x, y: e.y - 0.6, text: `+${e.gold}`, color: PAL.gold, start: now, life: 900 });
          break;
        }
        case 'unitDied': {
          effect('puff', -1, e.x, e.y);
          const team = e.owner > 0 ? COLONY[(e.owner - 1) % COLONY.length] : HORDE;
          this.burst(e.x, e.y, 10, [team.main, team.dark, team.light, PAL.paper], now, 2.2, 1);
          break;
        }
        case 'strike': {
          const seen = this.seen.get(e.id);
          if (seen) {
            seen.lungeStart = now;
            seen.lungeX = e.tx - e.x;
            seen.lungeY = e.ty - e.y;
          }
          this.effects.push({ kind: 'slash', heavy: e.heavy, start: now, cell: -1, x: e.tx, y: e.ty });
          this.burst(e.tx, e.ty, e.heavy ? 8 : 3, [PAL.paper, PAL.spark], now, e.heavy ? 2.5 : 1.6, 1);

          break;
        }
        case 'defeat':
          // A whole colony just turned to rubble: repaint the town layer.
          this.damaged.clear();
          this.building.clear();
          for (let c = 0; c < this.state.kind.length; c++) this.paintTown(c);
          break;
      }
    }
    if (this.effects.length > 800) this.effects.splice(0, this.effects.length - 800);
    if (this.shots.length > 200) this.shots.splice(0, this.shots.length - 200);
    if (this.particles.length > 1500) this.particles.splice(0, this.particles.length - 1500);
  }

  // ---------- camera ----------

  private originX(): number {
    return Math.round(this.cx * this.zoom - this.canvas.width / 2);
  }

  private originY(): number {
    return Math.round(this.cy * this.zoom - this.canvas.height / 2);
  }

  private clampCamera(): void {
    const w = this.state.width * TILE;
    const h = this.state.height * TILE;
    if (this.state.wrap) {
      this.cx = ((this.cx % w) + w) % w;
      this.cy = ((this.cy % h) + h) % h;
    } else {
      this.cx = Math.max(0, Math.min(w, this.cx));
      this.cy = Math.max(0, Math.min(h, this.cy));
    }
  }

  /**
   * The furthest out the camera may zoom. On a looping map the view never shows more than one
   * whole map, so nothing would need drawing twice.
   */
  private minZoom(): number {
    if (!this.state?.wrap) return 1;
    return Math.max(1, Math.ceil(Math.max(this.canvas.width / (this.state.width * TILE), this.canvas.height / (this.state.height * TILE))));
  }

  /** The copy of a world x (in cells) nearest the camera. */
  private wx(x: number): number {
    return this.state.wrap ? this.camX + deltaX(this.state, this.camX, x) : x;
  }

  private wy(y: number): number {
    return this.state.wrap ? this.camY + deltaY(this.state, this.camY, y) : y;
  }

  /** Pan by a number of device pixels. */
  pan(dx: number, dy: number): void {
    this.cx -= dx / this.zoom;
    this.cy -= dy / this.zoom;
    this.clampCamera();
  }

  /** Zoom one step in or out, keeping the world point under (mx, my) in place. */
  zoomAt(mx: number, my: number, direction: number): void {
    const next = Math.max(this.minZoom(), Math.min(MAX_ZOOM, this.zoom + direction));
    if (next === this.zoom) return;
    const wx = (mx + this.originX()) / this.zoom;
    const wy = (my + this.originY()) / this.zoom;
    this.zoom = next;
    this.cx = wx - (mx - this.canvas.width / 2) / next;
    this.cy = wy - (my - this.canvas.height / 2) / next;
    this.clampCamera();
  }

  /** Cell under a point given in device pixels, or -1. */
  cellAt(mx: number, my: number): number {
    let x = Math.floor((mx + this.originX()) / this.zoom / TILE);
    let y = Math.floor((my + this.originY()) / this.zoom / TILE);
    const w = this.state.width;
    const h = this.state.height;
    if (this.state.wrap) {
      x = ((x % w) + w) % w;
      y = ((y % h) + h) % h;
    } else if (x < 0 || y < 0 || x >= w || y >= h) return -1;
    return y * w + x;
  }

  // ---------- frame ----------

  private blit(layer: HTMLCanvasElement, ox: number, oy: number): void {
    const z = this.zoom;
    const sx0 = Math.max(0, Math.floor(ox / z));
    const sy0 = Math.max(0, Math.floor(oy / z));
    const sx1 = Math.min(layer.width, Math.ceil((ox + this.canvas.width) / z));
    const sy1 = Math.min(layer.height, Math.ceil((oy + this.canvas.height) / z));
    if (sx1 <= sx0 || sy1 <= sy0) return;
    this.ctx.drawImage(layer, sx0, sy0, sx1 - sx0, sy1 - sy0, sx0 * z - ox, sy0 * z - oy, (sx1 - sx0) * z, (sy1 - sy0) * z);
  }

  /** A small two-colour bar: `share` of it filled. */
  private bar(x: number, y: number, width: number, share: number, color: string): void {
    const g = this.ctx;
    const z = this.zoom;
    const t = Math.max(2, z);
    g.fillStyle = PAL.ink;
    g.fillRect(x - 1, y - 1, width + 2, t + 2);
    g.fillStyle = '#4a1f28';
    g.fillRect(x, y, width, t);
    g.fillStyle = color;
    g.fillRect(x, y, Math.max(0, Math.round(width * Math.min(1, share))), t);
  }

  /**
   * A health bar: a dark frame, the health left in green, gold or red (with a light top edge and
   * a darker bottom), a pale chunk showing what was just lost, and notches every quarter. Below a
   * quarter it blinks. Big bars (Center Towers) get a frame in the colony's colour.
   */
  private healthBar(now: number, x: number, y: number, width: number, share: number, trail: number, big: boolean, frame?: string): void {
    const g = this.ctx;
    const z = this.zoom;
    const h = Math.max(3, Math.round(z * (big ? 1.5 : 1)));
    x = Math.round(x);
    y = Math.round(y);
    width = Math.max(4, Math.round(width));
    const fill = Math.round(width * Math.min(1, Math.max(0, share)));
    const lost = Math.round(width * Math.min(1, Math.max(share, trail)));
    g.fillStyle = PAL.ink;
    g.fillRect(x - 1, y - 1, width + 2, h + 2);
    if (frame) {
      g.fillStyle = frame;
      g.fillRect(x - 1, y - 2, width + 2, 1);
    }
    g.fillStyle = '#2b1a26';
    g.fillRect(x, y, width, h);
    if (lost > fill) {
      g.fillStyle = '#fff0c8';
      g.fillRect(x + fill, y, lost - fill, h);
    }
    const blink = share < 0.25 && Math.floor(now / 220) % 2 === 0;
    const main = blink ? '#ffb4a8' : share > 0.6 ? PAL.good : share > 0.3 ? PAL.gold : PAL.bad;
    const dark = share > 0.6 ? '#3c9440' : share > 0.3 ? PAL.goldDark : '#a63434';
    g.fillStyle = dark;
    g.fillRect(x, y, fill, h);
    g.fillStyle = main;
    g.fillRect(x, y, fill, h - Math.max(1, Math.round(h / 3)));
    g.fillStyle = 'rgba(255, 255, 255, 0.5)';
    g.fillRect(x, y, Math.max(0, fill - 1), 1);
    g.fillStyle = 'rgba(18, 19, 31, 0.6)';
    for (let q = 1; q < 4; q++) g.fillRect(x + Math.round((width * q) / 4), y, 1, h);
  }

  /** A bouncing downward chevron: "this one". */
  private marker(now: number, x: number, y: number, color: string): void {
    const g = this.ctx;
    const z = this.zoom;
    const bob = Math.floor(now / 300) % 2 === 0 ? 0 : z;
    const u = Math.max(1, Math.round(z * 0.75));
    const my = y - 3 * z - bob;
    g.fillStyle = PAL.ink;
    g.fillRect(x - 4 * u, my - 4 * u, 8 * u, 3 * u);
    g.fillStyle = color;
    g.fillRect(x - 3 * u, my - 3 * u, 6 * u, u);
    g.fillRect(x - 2 * u, my - 2 * u, 4 * u, u);
    g.fillRect(x - u, my - u, 2 * u, u);
  }

  draw(now: number, view: ViewOptions): void {
    const g = this.ctx;
    const s = this.state;
    const t = this.tuning;
    const z = this.zoom;
    const size = TILE * z;
    const [shakeX, shakeY] = this.shakeOffset(now);
    // The tick clock: how far between two simulation ticks this frame is.
    if (s.tick !== this.tickSeen) {
      if (this.tickSeen >= 0 && s.tick === this.tickSeen + 1) this.tickMs = Math.min(400, Math.max(16, this.tickMs * 0.8 + (now - this.tickAt) * 0.2));
      this.tickSeen = s.tick;
      this.tickAt = now;
    }
    this.clampCamera();
    this.camX = this.cx / TILE;
    this.camY = this.cy / TILE;
    const ox = this.originX() + shakeX;
    const oy = this.originY() + shakeY;
    // On a looping map every cell is drawn at its copy nearest the camera.
    const cellX = (c: number) => (this.wx((c % s.width) + 0.5) - 0.5) * size - ox;
    const cellY = (c: number) => (this.wy(((c / s.width) | 0) + 0.5) - 0.5) * size - oy;
    const onScreen = (x: number, y: number) => x > -size * 2 && y > -size * 2 && x < this.canvas.width + size && y < this.canvas.height + size;

    g.imageSmoothingEnabled = false;
    g.fillStyle = PAL.night;
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (s.wrap) {
      // The map has no edge: lay it down again beside itself wherever the view needs it.
      const mw = s.width * size;
      const mh = s.height * size;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          this.blit(this.terrain[Math.floor(now / 700) % 2], ox + kx * mw, oy + ky * mh);
          this.blit(this.town, ox + kx * mw, oy + ky * mh);
        }
      }
    } else {
      // A dark frame so the map reads as an object on the table.
      g.fillStyle = PAL.ink;
      g.fillRect(-ox - 2 * z, -oy - 2 * z, s.width * size + 4 * z, s.height * size + 4 * z);
      this.blit(this.terrain[Math.floor(now / 700) % 2], ox, oy);
      this.blit(this.town, ox, oy);
    }

    // Waving flags on every standing tower.
    const wave = Math.floor(now / 350) % 2;
    for (const colony of s.colonies) {
      if (!colony.alive) continue;
      const colors = COLONY[(colony.id - 1) % COLONY.length];
      const tx = cellX(colony.tower);
      const ty = cellY(colony.tower);
      // The pole stands at sprite column 7; the flag flies to its right.
      g.fillStyle = colors.main;
      if (wave === 0) {
        g.fillRect(tx + 8 * z, ty, 4 * z, z);
        g.fillRect(tx + 8 * z, ty + z, 3 * z, z);
        g.fillRect(tx + 8 * z, ty + 2 * z, 2 * z, z);
      } else {
        g.fillRect(tx + 8 * z, ty, 3 * z, z);
        g.fillRect(tx + 8 * z, ty + z, 4 * z, z);
        g.fillRect(tx + 8 * z, ty + 2 * z, 3 * z, z);
      }
    }

    // Buildings still under construction: dimmed, with a progress bar (D9).
    const buildTicks = Math.max(1, Math.round(t.combat.buildSeconds * t.tickRate));
    for (const c of this.building) {
      if (s.owner[c] === 0 || s.tick >= s.readyTick[c]) {
        this.building.delete(c);
        continue;
      }
      const x = cellX(c);
      const y = cellY(c);
      if (!onScreen(x, y)) continue;
      g.fillStyle = 'rgba(18, 19, 31, 0.45)';
      g.fillRect(x, y, size, size);
      this.bar(x + z, y + size - 2 * z, size - 2 * z, 1 - (s.readyTick[c] - s.tick) / buildTicks, PAL.gold);
    }

    // D5: squares cut off from their tower are dormant, and drawn dimmed.
    if (s.colonies.some((c) => c.dormant.cells > 0)) {
      g.fillStyle = 'rgba(18, 19, 31, 0.55)';
      for (let c = 0; c < s.cutOff.length; c++) {
        if (!s.cutOff[c]) continue;
        const x = cellX(c);
        const y = cellY(c);
        if (onScreen(x, y)) g.fillRect(x, y, size, size);
      }
    }

    // Edge view: the squares that still have growth to give up.
    if (view.showEdge) {
      const edge = s.colonies[this.player - 1].edge;
      const line = Math.max(1, Math.floor(z / 2));
      for (const c of edge) {
        const x = cellX(c);
        const y = cellY(c);
        g.fillStyle = 'rgba(255, 205, 74, 0.35)';
        g.fillRect(x, y, size, size);
        g.fillStyle = PAL.gold;
        g.fillRect(x, y, size, line);
        g.fillRect(x, y + size - line, size, line);
        g.fillRect(x, y, line, size);
        g.fillRect(x + size - line, y, line, size);
      }
    }

    this.drawEffects(now, cellX, cellY, size, ox, oy);

    // Units: one small sprite each, mirrored to face the way they walk.
    this.drawUnits(now, size, ox, oy, onScreen);

    this.drawBeams(now, size, ox, oy);
    this.drawStrikes(now, size, ox, oy);

    // Everything in flight.
    let keptShots = 0;
    for (const shot of this.shots) {
      const p = (now - shot.start) / SHOT_MS[shot.style];
      if (p >= 1) continue;
      this.shots[keptShots++] = shot;
      this.drawShot(shot, p, now, size, ox, oy);
    }
    this.shots.length = keptShots;

    this.drawIncome(now, size, ox, oy, onScreen);
    this.drawHarvest(now, size, ox, oy);
    this.drawParticles(now, size, ox, oy);
    this.drawFloaters(now, size, ox, oy);

    // Health bars over damaged squares.
    for (const c of this.damaged) {
      const k = s.kind[c];
      if (s.owner[c] === 0 || k === Kind.Tower) {
        this.damaged.delete(c);
        continue;
      }
      const full = maxHealthAt(s, t, c);
      if (s.hp[c] >= full && s.tick >= s.readyTick[c]) {
        this.damaged.delete(c);
        continue;
      }
      const x = cellX(c);
      const y = cellY(c);
      const share = Math.max(0, s.hp[c] / full);
      const trail = Math.max(share, (this.cellTrail.get(c) ?? share) - 0.01);
      this.cellTrail.set(c, trail);
      if (onScreen(x, y)) this.healthBar(now, x + z, y - z, size - 2 * z, share, trail, false);
    }
    for (const c of this.cellTrail.keys()) if (!this.damaged.has(c)) this.cellTrail.delete(c);
    for (const colony of s.colonies) {
      const full = towerMaxHealth(t, colony);
      if (!colony.alive || colony.towerHp >= full) continue;
      const share = Math.max(0, colony.towerHp / full);
      const key = -colony.id;
      const trail = Math.max(share, (this.cellTrail.get(key) ?? share) - 0.004);
      this.cellTrail.set(key, trail);
      this.healthBar(now, cellX(colony.tower) - z, cellY(colony.tower) + 2 * size + z, 2 * size + 2 * z, share, trail, true, COLONY[(colony.id - 1) % COLONY.length].main);
    }

    // Markers: home is always easy to find, and so is whoever you are attacking.
    const home = s.colonies[this.player - 1];
    if (home.alive) this.marker(now, cellX(home.tower) + size, cellY(home.tower), PAL.paper);
    const target = home.order > 0 ? s.colonies[home.order - 1] : null;
    if (target && target.alive) this.marker(now, cellX(target.tower) + size, cellY(target.tower), PAL.bad);

    this.drawVignette();
    if (now < this.whiteUntil) {
      g.globalAlpha = 0.85 * ((this.whiteUntil - now) / Math.max(1, this.whiteUntil - this.whiteStart));
      g.fillStyle = '#fffbe8';
      g.fillRect(0, 0, this.canvas.width, this.canvas.height);
      g.globalAlpha = 1;
    }
    this.drawAlarm(performance.now());
    this.drawLandmarks(now, size, ox, oy);
    this.drawThreats(now, size, ox, oy);
    if (view.hover >= 0) this.drawCursor(now, view, cellX(view.hover), cellY(view.hover), size);
  }

  /**
   * Incoming attacks the player cannot see: an arrow at the edge of the screen, in the
   * attacker's colour, pointing at the middle of each army marching on the player, with its size.
   */
  private drawThreats(now: number, size: number, ox: number, oy: number): void {
    const s = this.state;
    const g = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const z = this.zoom;
    const u = Math.max(2, Math.round(z * 0.9));
    for (const colony of s.colonies) {
      if (!colony.alive || colony.order !== this.player) continue;
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (const unit of s.units) {
        if (unit.owner !== colony.id) continue;
        sx += deltaX(s, this.camX, unit.x);
        sy += deltaY(s, this.camY, unit.y);
        n++;
      }
      if (n === 0) continue;
      const px = (this.camX + sx / n) * size - ox;
      const py = (this.camY + sy / n) * size - oy;
      // The open part of the screen, between the side panels, the clock and the building bar.
      const dpr = window.devicePixelRatio || 1;
      const left = Math.min(w * 0.3, 270 * dpr);
      const right = w - Math.min(w * 0.3, 270 * dpr);
      const top = Math.min(h * 0.2, 90 * dpr);
      const bottom = h - Math.min(h * 0.3, 190 * dpr);
      if (px > left && py > top && px < right && py < bottom) continue;
      // Where the line from the middle of that area to the army leaves it.
      const mx = (left + right) / 2;
      const my = (top + bottom) / 2;
      const dx = px - mx;
      const dy = py - my;
      const kx = dx > 0 ? (right - mx) / dx : dx < 0 ? (left - mx) / dx : Infinity;
      const ky = dy > 0 ? (bottom - my) / dy : dy < 0 ? (top - my) / dy : Infinity;
      const k = Math.min(kx, ky, 1);
      const ax = mx + dx * k;
      const ay = my + dy * k;
      const angle = Math.atan2(dy, dx);
      const team = COLONY[(colony.id - 1) % COLONY.length];
      const pulse = Math.floor(now / 250) % 2 === 0;
      // A pixel arrow: a chunky triangle of blocks pointing outward.
      g.save();
      g.translate(Math.round(ax), Math.round(ay));
      g.rotate(angle);
      g.fillStyle = PAL.ink;
      g.fillRect(-7 * u, -4 * u, 12 * u, 8 * u);
      g.fillStyle = pulse ? PAL.bad : team.main;
      for (let i = 0; i < 4; i++) g.fillRect((-5 + i * 2) * u, (-3 + i) * u, 2 * u, (6 - 2 * i) * u);
      g.restore();
      // The army's size, just inside the arrow.
      const label = String(n);
      const font = Math.max(10, 4 * u);
      this.text(label, Math.round(ax - Math.cos(angle) * 12 * u - (label.length * font) / 3), Math.round(ay - Math.sin(angle) * 12 * u), PAL.paper, font);
    }
  }

  /** A sparkle and a bobbing marker over each landmark still waiting to be claimed. */
  private drawLandmarks(now: number, size: number, ox: number, oy: number): void {
    const s = this.state;
    const g = this.ctx;
    const z = this.zoom;
    const w = s.width;
    for (let c = 0; c < s.feature.length; c++) {
      const f = s.feature[c];
      if (f === 0) continue;
      const x = (this.wx((c % w) + 0.5)) * size - ox;
      const y = (this.wy(((c / w) | 0) + 0.5)) * size - oy;
      if (x < -size || y < -size || x > this.canvas.width + size || y > this.canvas.height + size) continue;
      const color = f === 1 ? PAL.void : PAL.gold;
      const phase = (now / 600 + c * 0.37) % 1;
      // A four-pointed twinkle that grows and fades above the landmark.
      const k = Math.sin(phase * Math.PI);
      const r = Math.max(1, Math.round(z * (1 + 1.5 * k)));
      const px = Math.round(x + size * 0.3);
      const py = Math.round(y - size * 0.55 - k * z * 2);
      g.globalAlpha = 0.35 + 0.65 * k;
      g.fillStyle = color;
      g.fillRect(px - Math.floor(z / 2), py - r, Math.max(1, z), r * 2);
      g.fillRect(px - r, py - Math.floor(z / 2), r * 2, Math.max(1, z));
      g.fillStyle = PAL.paper;
      g.fillRect(px - Math.floor(z / 2), py - Math.floor(z / 2), Math.max(1, z), Math.max(1, z));
      g.globalAlpha = 1;
    }
  }

  /** The player's tower was just hit: flash the edges of the screen red for a moment. */
  flashAlarm(): void {
    this.alarmUntil = performance.now() + 450;
  }

  private drawAlarm(now: number): void {
    if (now >= this.alarmUntil) return;
    const g = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const band = Math.max(6, Math.round(Math.min(w, h) * 0.02));
    g.globalAlpha = 0.45 * ((this.alarmUntil - now) / 450);
    g.fillStyle = PAL.bad;
    g.fillRect(0, 0, w, band);
    g.fillRect(0, h - band, w, band);
    g.fillRect(0, 0, band, h);
    g.fillRect(w - band, 0, band, h);
    g.globalAlpha = 1;
  }

  /** The part of the map on screen, in cells: [left, top, right, bottom]. */
  viewRect(): [number, number, number, number] {
    const across = this.canvas.width / (this.zoom * TILE);
    const down = this.canvas.height / (this.zoom * TILE);
    const x = this.cx / TILE;
    const y = this.cy / TILE;
    return [x - across / 2, y - down / 2, x + across / 2, y + down / 2];
  }

  /** Centre the camera on a point given in cells. */
  lookAt(x: number, y: number): void {
    this.cx = x * TILE;
    this.cy = y * TILE;
    this.clampCamera();
  }

  /** A sprite with a soft drop shadow, kept inside its own square of the cached layer. */
  private stamp(g: CanvasRenderingContext2D, sprite: Sprite, x: number, y: number, clipX: number, clipY: number, clipSize: number): void {
    let shadow = this.shadows.get(sprite);
    if (!shadow) {
      shadow = silhouette(sprite, 'rgba(18, 19, 31, 0.32)');
      this.shadows.set(sprite, shadow);
    }
    g.save();
    g.beginPath();
    g.rect(clipX, clipY, clipSize, clipSize);
    g.clip();
    g.drawImage(shadow, x + 1, y + 1);
    g.restore();
    g.drawImage(sprite, x, y);
  }

  /** Throw a handful of pixels out from a point. */
  private burst(x: number, y: number, count: number, colors: string[], start: number, speed: number, fall: number): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.8);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - speed * 0.4,
        fall: fall * 6,
        start: start + Math.random() * 40,
        life: 260 + Math.random() * 320,
        color: colors[i % colors.length],
        size: Math.random() < 0.3 ? 2 : 1,
      });
    }
  }

  /** A jolt of the camera, only for things the player can see. */
  private shake(now: number, strength: number, ms: number, x: number, y: number): void {
    const z = this.zoom;
    const sx = x * TILE * z - this.originX();
    const sy = y * TILE * z - this.originY();
    if (sx < 0 || sy < 0 || sx > this.canvas.width || sy > this.canvas.height) return;
    this.shakeStart = now;
    this.shakeUntil = Math.max(this.shakeUntil, now + ms);
    // Never more than a few pixels, however close the zoom.
    this.shakeSize = Math.max(now < this.shakeUntil - ms ? this.shakeSize : 0, Math.min(3, strength * Math.max(1, z * 0.3)));
  }

  private shakeOffset(now: number): [number, number] {
    if (now >= this.shakeUntil) return [0, 0];
    // Fades out as it ends.
    const left = (this.shakeUntil - now) / Math.max(1, this.shakeUntil - this.shakeStart);
    const s = Math.round(this.shakeSize * left);
    return [Math.round((Math.random() * 2 - 1) * s), Math.round((Math.random() * 2 - 1) * s)];
  }

  private drawUnits(now: number, size: number, ox: number, oy: number, onScreen: (x: number, y: number) => boolean): void {
    const g = this.ctx;
    const s = this.state;
    const z = this.zoom;
    const alive = new Set<number>();
    for (const u of s.units) {
      alive.add(u.id);
      let seen = this.seen.get(u.id);
      if (!seen) {
        seen = { x: u.x, y: u.y, hp: u.hp, flashUntil: 0, movedAt: 0, lungeStart: 0, lungeX: 0, lungeY: 0, trail: 1 };
        this.bornAt.set(u.id, now);
        this.seen.set(u.id, seen);
        // A new recruit arrives in a puff of its colony's colour.
        const team = u.owner > 0 ? COLONY[(u.owner - 1) % COLONY.length] : HORDE;
        this.burst(u.x, u.y, 6, [team.light, PAL.paper], now, 1.2, -0.4);
      }
      if (Math.abs(u.x - seen.x) + Math.abs(u.y - seen.y) > 1e-3) seen.movedAt = now;
      if (u.hp < seen.hp - 0.01) {
        const lost = seen.hp - u.hp;
        seen.flashUntil = now + 110;
        this.burst(u.x, u.y - 0.2, lost >= 15 ? 6 : 3, [PAL.bad, PAL.paper], now, 1.6, 1);
        if (lost >= 12) this.floaters.push({ x: u.x, y: u.y - 0.5, text: `-${Math.round(lost)}`, color: lost >= 30 ? PAL.fireLight : PAL.paper, start: now, life: 650 });
      }
      seen.x = u.x;
      seen.y = u.y;
      seen.hp = u.hp;

      const team = u.owner > 0 ? this.sprites.colonies[(u.owner - 1) % COLONY.length] : this.sprites.horde;
      const facing = u.facing >= 0 ? 0 : 1;
      const walking = now - seen.movedAt < 160;
      const step = walking && (Math.floor(now / 130) + u.id) % 2 === 1;
      const sprite = (step ? team.unitsWalk : team.units)[u.type][facing];
      const giant = u.type === UnitType.Giant || u.type === UnitType.Brute;
      const flying = unitTuning(this.tuning, u.type).flies === true;
      // Assassins: barely visible, to their enemies most of all.
      const sneaky = u.type === UnitType.Assassin ? (u.owner === this.player ? 0.7 : 0.45) : 1;
      const unitSize = sprite.width * z * (giant ? 1.5 : u.type === UnitType.Tank ? 1.2 : 1);
      // Aircraft fly high above their shadow.
      const lift = flying ? Math.round(size * 0.9 + Math.sin(now / 240 + u.id) * z) : 0;
      // Lunge: a quick lean toward whatever it just struck.
      let lx = 0;
      let ly = 0;
      const lungeAge = now - seen.lungeStart;
      if (lungeAge < 170) {
        const k = Math.sin((lungeAge / 170) * Math.PI) * 0.3;
        const len = Math.hypot(seen.lungeX, seen.lungeY) || 1;
        lx = (seen.lungeX / len) * k * size;
        ly = (seen.lungeY / len) * k * size;
      }
      const cx = this.wx(u.x) * size - ox + lx;
      const feet = this.wy(u.y) * size - oy + ly + unitSize / 2 - (giant ? 2 * z : 0);
      const x = Math.round(cx - unitSize / 2);
      const y = Math.round(feet - unitSize);
      if (!onScreen(x, y)) continue;
      const bob = walking && step ? z : 0;

      // A standard bearer's banner reaches the friends around it: show how far.
      if (u.type === UnitType.Bearer) {
        const aura = unitTuning(this.tuning, UnitType.Bearer).aura ?? 0;
        const pulse = 0.18 + 0.08 * Math.sin(now / 300 + u.id);
        this.ring(cx, feet - z, aura * size, z, COLONY[(u.owner - 1) % COLONY.length].light, pulse);
      }

      // Shadow on the ground.
      g.fillStyle = 'rgba(18, 19, 31, 0.32)';
      g.fillRect(Math.round(cx - unitSize * 0.35), Math.round(feet - z), Math.round(unitSize * 0.7), z * (giant ? 2 : 1));

      g.globalAlpha = sneaky;
      const risen = u.owner === 0 ? Math.min(1, (now - (this.bornAt.get(u.id) ?? 0)) / 900) : 1;
      if (risen < 1) {
        // Only the part above the ground shows, climbing out.
        const show = Math.max(1, Math.round(sprite.height * risen));
        g.drawImage(sprite, 0, 0, sprite.width, show, x, y - bob + unitSize - (unitSize * show) / sprite.height, unitSize, (unitSize * show) / sprite.height);
      } else {
        g.drawImage(sprite, x, y - bob - lift, unitSize, unitSize);
      }
      g.globalAlpha = 1;
      if (u.type === UnitType.Gunship) {
        // Rotor: a blur that flickers between two lengths.
        const spin = Math.floor(now / 50) % 2;
        g.fillStyle = 'rgba(244, 236, 216, 0.75)';
        g.fillRect(Math.round(cx - unitSize * (spin ? 0.55 : 0.4)), Math.round(y - bob - lift - z), Math.round(unitSize * (spin ? 1.1 : 0.8)), z);
      }
      if (now < seen.flashUntil) {
        g.globalAlpha = 0.85;
        g.drawImage(team.unitsFlash[u.type][facing], x, y - bob, unitSize, unitSize);
        g.globalAlpha = 1;
      }
      if ((u.slowUntil ?? 0) > s.tick) {
        // Frost: an icy tint and a glint of ice.
        g.fillStyle = 'rgba(191, 233, 255, 0.45)';
        g.fillRect(x, y - bob, unitSize, unitSize);
        g.fillStyle = PAL.ice;
        g.fillRect(x + ((u.id * 3) % 4) * z, y - bob, z, z);
      }
      // Health, once it has been hurt.
      const full = unitMaxHp(this.tuning, s.colonies[u.owner - 1], u.type);
      const share = Math.max(0, u.hp / full);
      seen.trail = Math.max(share, seen.trail - 0.012);
      if (u.hp < full - 0.01) {
        const w = Math.max(6, Math.round(unitSize * 0.9));
        this.healthBar(now, cx - w / 2, y - bob - lift - 3 * z, w, share, seen.trail, false);
      }
    }
    for (const id of this.seen.keys()) if (!alive.has(id)) {
      this.seen.delete(id);
      this.bornAt.delete(id);
    }
  }

  /** Money and science buildings pop their earnings every few seconds, so you can see them work. */
  private drawIncome(now: number, size: number, ox: number, oy: number, onScreen: (x: number, y: number) => boolean): void {
    const s = this.state;
    const g = this.ctx;
    const z = this.zoom;
    const period = 4000;
    for (const c of s.military) {
      const kind = s.kind[c];
      if (s.owner[c] !== this.player || (!ECONOMY.includes(kind) && !SCIENCE.includes(kind))) continue;
      if (s.tick < s.readyTick[c] || s.cutOff[c]) continue;
      const x = (this.wx((c % s.width) + 0.5) - 0.5) * size - ox;
      const y = (this.wy(((c / s.width) | 0) + 0.5) - 0.5) * size - oy;
      if (!onScreen(x, y)) continue;
      const age = (now + hash2(s.seed + 9, c, 3) * period) % period;
      if (age > 1100) continue;
      const yieldNow = buildingYield(s, this.tuning, c, this.player, kind);
      const science = yieldNow.science > 0;
      const amount = (science ? yieldNow.science : yieldNow.gold) * (period / 1000);
      if (amount < 0.5) continue;
      const p = age / 1100;
      const rise = p * size * 1.2;
      g.globalAlpha = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
      const icon = science ? this.sprites.icons.science : this.sprites.icons.gold;
      const iconSize = Math.max(8, Math.round(z * 4));
      g.drawImage(icon, Math.round(x + size / 2 - iconSize), Math.round(y - rise), iconSize, iconSize);
      this.text(`+${Math.round(amount)}`, x + size / 2 + z, y - rise + iconSize / 2, science ? PAL.science : PAL.gold, Math.max(8, z * 4));
      g.globalAlpha = 1;
    }
  }

  /** The player's farm blocks and what each earns, worked out once per harvest. */
  private harvest: { round: number; blocks: Array<{ x: number; y: number; gold: number; farms: number }> } = { round: -1, blocks: [] };

  /**
   * Farms are the backbone of a colony's gold, but each earns a trickle. So every few seconds
   * each block of touching farms shows what the whole block earned since the last harvest, in
   * one number over its middle: bigger blocks, bigger numbers.
   */
  private drawHarvest(now: number, size: number, ox: number, oy: number): void {
    const s = this.state;
    const t = this.tuning;
    const z = this.zoom;
    const g = this.ctx;
    const period = HARVEST_MS;
    const round = Math.floor(now / period);
    const age = now % period;
    if (age > 1400) return;
    if (this.harvest.round !== round) {
      // Flood-fill the player's farms into blocks of touching farms.
      const colony = s.colonies[this.player - 1];
      const seen = new Uint8Array(s.kind.length);
      const blocks: Array<{ x: number; y: number; gold: number; farms: number }> = [];
      for (let c = 0; c < s.kind.length; c++) {
        if (seen[c] || s.kind[c] !== Kind.Farm || s.owner[c] !== this.player) continue;
        const stack = [c];
        seen[c] = 1;
        let gold = 0;
        let farms = 0;
        let sx = 0;
        let sy = 0;
        const fx = c % s.width;
        const fy = (c / s.width) | 0;
        while (stack.length > 0) {
          const f = stack.pop() as number;
          farms++;
          // Positions are averaged as offsets from the first farm, so a block across the seam stays whole.
          sx += deltaX(s, fx, f % s.width);
          sy += deltaY(s, fy, (f / s.width) | 0);
          if (!s.cutOff[f] && s.tick >= s.readyTick[f]) gold += t.economy.farmGoldPerSecond + t.economy.farmNeighbourBonus * ownFarmNeighbours(s, f, this.player);
          for (let d = 0; d < 4; d++) {
            const n = neighbour(s, f, d);
            if (n >= 0 && !seen[n] && s.kind[n] === Kind.Farm && s.owner[n] === this.player) {
              seen[n] = 1;
              stack.push(n);
            }
          }
        }
        blocks.push({ x: fx + 0.5 + sx / farms, y: fy + 0.5 + sy / farms, gold: gold * colony.mods.gold * (period / 1000), farms });
      }
      this.harvest = { round, blocks };
    }
    const p = age / 1400;
    const rise = p * size * 1.4;
    const iconSize = Math.max(8, Math.round(z * 4));
    g.globalAlpha = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
    for (const b of this.harvest.blocks) {
      if (b.gold < 1) continue;
      const x = this.wx(b.x) * size - ox;
      const y = this.wy(b.y) * size - oy - rise;
      if (x < -size * 4 || y < -size * 4 || x > this.canvas.width + size * 4 || y > this.canvas.height + size * 4) continue;
      // Wheat-gold for a block of farms, bigger for a bigger harvest.
      const font = Math.max(9, Math.round(z * (4 + Math.min(3, b.gold / 6))));
      g.drawImage(this.sprites.icons.gold, Math.round(x - iconSize - z), Math.round(y - iconSize / 2), iconSize, iconSize);
      this.text(`+${b.gold >= 10 ? Math.round(b.gold) : b.gold.toFixed(1)}`, x, y, PAL.wheat, font);
    }
    g.globalAlpha = 1;
  }

  private drawParticles(now: number, size: number, ox: number, oy: number): void {
    const g = this.ctx;
    const z = this.zoom;
    let keep = 0;
    for (const p of this.particles) {
      const age = now - p.start;
      if (age > p.life) continue;
      this.particles[keep++] = p;
      if (age < 0) continue;
      const t = age / 1000;
      const x = (this.wx(p.x) + p.vx * t) * size - ox;
      const y = (this.wy(p.y) + p.vy * t + 0.5 * p.fall * t * t) * size - oy;
      const fade = 1 - age / p.life;
      const d = Math.max(1, Math.round(p.size * z * (0.5 + fade * 0.5)));
      g.globalAlpha = Math.min(1, fade * 1.4);
      g.fillStyle = p.color;
      g.fillRect(Math.round(x - d / 2), Math.round(y - d / 2), d, d);
    }
    g.globalAlpha = 1;
    this.particles.length = keep;
  }

  private drawFloaters(now: number, size: number, ox: number, oy: number): void {
    let keep = 0;
    for (const f of this.floaters) {
      const age = now - f.start;
      if (age > f.life) continue;
      this.floaters[keep++] = f;
      const p = age / f.life;
      this.ctx.globalAlpha = p < 0.6 ? 1 : 1 - (p - 0.6) / 0.4;
      this.text(f.text, this.wx(f.x) * size - ox, (this.wy(f.y) - p * 0.8) * size - oy, f.color, Math.max(8, this.zoom * 4));
    }
    this.ctx.globalAlpha = 1;
    this.floaters.length = keep;
    if (this.floaters.length > 120) this.floaters.splice(0, this.floaters.length - 120);
  }

  /** Pixel-font text with a dark outline, readable over anything. */
  private text(text: string, x: number, y: number, color: string, px: number): void {
    const g = this.ctx;
    g.font = `${Math.round(px)}px Silkscreen, monospace`;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    const ix = Math.round(x);
    const iy = Math.round(y);
    g.fillStyle = PAL.ink;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1]]) g.fillText(text, ix + dx, iy + dy);
    g.fillStyle = color;
    g.fillText(text, ix, iy);
  }

  /** A soft darkening at the edges of the screen. */
  private drawVignette(): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (!this.vignette || this.vignette.width !== w || this.vignette.height !== h) {
      const v = document.createElement('canvas');
      v.width = w;
      v.height = h;
      const g = v.getContext('2d') as CanvasRenderingContext2D;
      const grad = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.6);
      grad.addColorStop(0, 'rgba(11, 12, 22, 0)');
      grad.addColorStop(1, 'rgba(11, 12, 22, 0.42)');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
      this.vignette = v;
    }
    this.ctx.drawImage(this.vignette, 0, 0);
  }

  /** A melee swing: a bright arc at the point of impact. */
  private drawSlash(e: Effect, p: number, size: number, ox: number, oy: number): void {
    const g = this.ctx;
    const z = this.zoom;
    const cx = this.wx(e.x) * size - ox;
    const cy = this.wy(e.y) * size - oy;
    const r = size * (e.heavy ? 0.75 : 0.45) * (0.6 + p * 0.4);
    const start = -Math.PI * 0.9 + (e.start % 1000) / 300;
    g.globalAlpha = 1 - p;
    g.fillStyle = e.heavy ? PAL.fireLight : PAL.paper;
    const steps = e.heavy ? 9 : 6;
    for (let i = 0; i < steps; i++) {
      const a = start + (i / steps) * Math.PI * 0.9 * Math.min(1, p * 2.5);
      const d = Math.max(1, Math.round(z * (i === steps - 1 ? 1.5 : 1)));
      g.fillRect(Math.round(cx + Math.cos(a) * r - d / 2), Math.round(cy + Math.sin(a) * r - d / 2), d, d);
    }
    g.globalAlpha = 1;
  }

  /** A ring of pixel blocks: range circles and blast fronts. */
  private ring(cx: number, cy: number, radius: number, block: number, color: string, alpha: number): void {
    const g = this.ctx;
    const steps = Math.max(12, Math.floor((2 * Math.PI * radius) / (block * 2.2)));
    g.globalAlpha = alpha;
    g.fillStyle = color;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      g.fillRect(Math.round(cx + Math.cos(a) * radius - block / 2), Math.round(cy + Math.sin(a) * radius - block / 2), block, block);
    }
    g.globalAlpha = 1;
  }

  /** A filled pixel ellipse, built from rows of blocks: round fireballs and puffs of smoke. */
  private disk(cx: number, cy: number, rx: number, ry: number, block: number, color: string): void {
    const g = this.ctx;
    g.fillStyle = color;
    if (rx < block || ry < block) {
      g.fillRect(Math.round(cx - block / 2), Math.round(cy - block / 2), block, block);
      return;
    }
    for (let y = -ry; y <= ry; y += block) {
      const k = 1 - (y * y) / (ry * ry);
      if (k <= 0) continue;
      const half = Math.round((rx * Math.sqrt(k)) / block) * block;
      g.fillRect(Math.round(cx - half), Math.round(cy + y), 2 * half, block);
    }
  }

  /** A line of pixel blocks between two screen points. */
  private pixelLine(x0: number, y0: number, x1: number, y1: number, block: number, color: string): void {
    const g = this.ctx;
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / Math.max(1, block * 0.8)));
    g.fillStyle = color;
    for (let i = 0; i <= steps; i++) {
      const k = i / steps;
      g.fillRect(Math.round(x0 + (x1 - x0) * k - block / 2), Math.round(y0 + (y1 - y0) * k - block / 2), block, block);
    }
  }

  private drawShot(shot: Shot, p: number, now: number, size: number, ox: number, oy: number): void {
    const g = this.ctx;
    const z = this.zoom;
    const x0 = this.wx(shot.x0);
    const y0 = this.wy(shot.y0);
    const sx = x0 * size - ox;
    const sy = y0 * size - oy;
    const ex = (x0 + deltaX(this.state, shot.x0, shot.x1)) * size - ox;
    const ey = (y0 + deltaY(this.state, shot.y0, shot.y1)) * size - oy;
    const along = (q: number): [number, number] => [sx + (ex - sx) * q, sy + (ey - sy) * q];
    const half = Math.max(1, Math.floor(z / 2));
    switch (shot.style) {
      case 'bolt': {
        // A crossbow bolt: a pale streak with a bright point.
        const [hx, hy] = along(p);
        const [tx, ty] = along(Math.max(0, p - 0.28));
        g.globalAlpha = 0.55;
        this.pixelLine(tx, ty, hx, hy, half, PAL.paper);
        g.globalAlpha = 1;
        g.fillStyle = '#ffffff';
        g.fillRect(Math.round(hx - z / 2), Math.round(hy - z / 2), z, z);
        break;
      }
      case 'arrow': {
        // An arrow on a shallow arc: wooden shaft, stone tip, white fletching.
        const lift = (q: number) => Math.sin(q * Math.PI) * size * 0.45;
        const [hx, hy0] = along(p);
        const [tx, ty0] = along(Math.max(0, p - 0.14));
        const hy = hy0 - lift(p);
        const ty = ty0 - lift(Math.max(0, p - 0.14));
        this.pixelLine(tx, ty, hx, hy, half, PAL.trunk);
        g.fillStyle = PAL.stoneLight;
        g.fillRect(Math.round(hx - half), Math.round(hy - half), 2 * half, 2 * half);
        g.fillStyle = PAL.paper;
        g.fillRect(Math.round(tx - half), Math.round(ty - half), half, half);
        break;
      }
      case 'ballista': {
        // A heavy bolt: a long dark shaft with a bright head and a white wake.
        const [hx, hy] = along(p);
        const [tx, ty] = along(Math.max(0, p - 0.2));
        const [wx, wy] = along(Math.max(0, p - 0.45));
        g.globalAlpha = 0.35;
        this.pixelLine(wx, wy, tx, ty, half, PAL.paper);
        g.globalAlpha = 1;
        this.pixelLine(tx, ty, hx, hy, z, PAL.trunk);
        g.fillStyle = PAL.paper;
        g.fillRect(Math.round(hx - z), Math.round(hy - z), 2 * z, 2 * z);
        break;
      }
      case 'spear': {
        // A streak that flies the whole line, piercing everything on it.
        const [hx, hy] = along(p);
        const [tx, ty] = along(Math.max(0, p - 0.3));
        g.globalAlpha = 0.4;
        this.pixelLine(...along(Math.max(0, p - 0.5)), tx, ty, half, PAL.paper);
        g.globalAlpha = 1;
        this.pixelLine(tx, ty, hx, hy, z, PAL.wall);
        g.fillStyle = PAL.stoneLight;
        g.fillRect(Math.round(hx - z), Math.round(hy - z), 2 * z, 2 * z);
        break;
      }
      case 'lightning': {
        // A jagged bolt that flickers between two shapes, with a glow round it.
        const flicker = Math.floor(now / 50) % 2;
        let px = sx;
        let py = sy;
        const segments = 6;
        g.globalAlpha = 1 - p * 0.6;
        for (let i = 1; i <= segments; i++) {
          const k = i / segments;
          const jitter = i === segments ? 0 : (hash2(shot.start + flicker, i, 7) - 0.5) * size * 0.9;
          const nx = sx + (ex - sx) * k + jitter * ((ey - sy) / (Math.hypot(ex - sx, ey - sy) || 1));
          const ny = sy + (ey - sy) * k - jitter * ((ex - sx) / (Math.hypot(ex - sx, ey - sy) || 1));
          this.pixelLine(px, py, nx, ny, Math.max(3, 2 * z), 'rgba(255, 243, 106, 0.25)');
          this.pixelLine(px, py, nx, ny, Math.max(2, z), PAL.spark);
          this.pixelLine(px, py, nx, ny, half, '#ffffff');
          px = nx;
          py = ny;
        }
        g.globalAlpha = 1;
        break;
      }
      case 'magic': {
        // A fireball of violet light on a gentle arc, trailing sparks.
        const lift = (q: number) => Math.sin(q * Math.PI) * size * 0.6;
        for (let i = 4; i >= 1; i--) {
          const q = Math.max(0, p - i * 0.06);
          const [qx, qy] = along(q);
          g.globalAlpha = 0.6 * (1 - i / 5);
          g.fillStyle = i % 2 ? PAL.void : '#ffd6ff';
          g.fillRect(Math.round(qx - half), Math.round(qy - lift(q) - half), 2 * half, 2 * half);
        }
        g.globalAlpha = 1;
        const [hx, hy0] = along(p);
        const hy = hy0 - lift(p);
        const pulse = Math.floor(now / 70) % 2;
        g.fillStyle = 'rgba(192, 108, 255, 0.35)';
        g.fillRect(Math.round(hx - 2.5 * z), Math.round(hy - 2.5 * z), 5 * z, 5 * z);
        g.fillStyle = PAL.void;
        g.fillRect(Math.round(hx - 1.5 * z), Math.round(hy - 1.5 * z), 3 * z, 3 * z);
        g.fillStyle = pulse ? '#ffffff' : '#ffd6ff';
        g.fillRect(Math.round(hx - z / 2), Math.round(hy - z / 2), z, z);
        break;
      }
      case 'hex': {
        // A spiral of green motes winding towards its victim.
        const len = Math.hypot(ex - sx, ey - sy) || 1;
        const nx = -(ey - sy) / len;
        const ny = (ex - sx) / len;
        for (let i = 0; i < 7; i++) {
          const q = Math.max(0, p - i * 0.05);
          const [qx, qy] = along(q);
          const swirl = Math.sin(q * 14 + i) * size * 0.35 * (1 - q * 0.5);
          g.globalAlpha = 1 - i / 8;
          g.fillStyle = i % 2 ? PAL.holy : PAL.holyLight;
          g.fillRect(Math.round(qx + nx * swirl - half), Math.round(qy + ny * swirl - half), 2 * half, 2 * half);
        }
        g.globalAlpha = 1;
        break;
      }
      case 'sniper': {
        // A crack and a hair-thin tracer straight to the target, fading fast.
        const reach = Math.min(1, p * 4);
        const [hx, hy] = along(reach);
        g.globalAlpha = 1 - p;
        this.pixelLine(sx, sy, hx, hy, half, PAL.paper);
        g.fillStyle = '#ffffff';
        g.fillRect(Math.round(hx - z / 2), Math.round(hy - z / 2), z, z);
        if (p < 0.25) {
          g.fillStyle = PAL.fireLight;
          g.fillRect(Math.round(sx - z), Math.round(sy - z), 2 * z, 2 * z);
        }
        g.globalAlpha = 1;
        break;
      }
      case 'rail': {
        // An instant beam down the whole line: wide and blinding, then thinning out.
        const fade = 1 - p;
        const wide = Math.max(1, Math.round(z * 3 * fade));
        g.globalAlpha = 0.35 * fade;
        this.pixelLine(sx, sy, ex, ey, wide + 2 * z, PAL.science);
        g.globalAlpha = fade;
        this.pixelLine(sx, sy, ex, ey, Math.max(1, wide), PAL.scienceLight);
        this.pixelLine(sx, sy, ex, ey, Math.max(1, Math.round(wide / 2)), '#ffffff');
        g.globalAlpha = 1;
        // Rings ripple along it.
        for (let i = 1; i < 6; i++) {
          const [rx, ry] = along(i / 6);
          this.ring(rx, ry, size * (0.2 + p * 0.5), z, PAL.science, 0.5 * fade);
        }
        break;
      }
      case 'gun': {
        // A short yellow tracer.
        const [hx, hy] = along(p);
        const [tx, ty] = along(Math.max(0, p - 0.35));
        this.pixelLine(tx, ty, hx, hy, half, PAL.spark);
        break;
      }
      case 'cannon':
      case 'missile':
      case 'rock': {
        // A shell or boulder on an arc, with its shadow on the ground and a puff of smoke behind.
        const height = shot.style === 'rock' ? 2.2 : shot.style === 'missile' ? 6 : 1.4;
        const lift = (q: number) => Math.sin(q * Math.PI) * size * height;
        const r = shot.style === 'rock' ? 3 * z : 2 * z;
        const [x, y] = along(p);
        g.fillStyle = 'rgba(18, 19, 31, 0.35)';
        g.fillRect(Math.round(x - r / 2), Math.round(y - z / 2), r, z);
        if (shot.style !== 'rock') {
          for (let i = 1; i <= 4; i++) {
            const q = Math.max(0, p - i * 0.07);
            const [qx, qy] = along(q);
            const b = Math.max(z, Math.round(z * (0.8 + i * 0.4)));
            g.globalAlpha = 0.45 * (1 - i / 5);
            g.fillStyle = PAL.stoneLight;
            g.fillRect(Math.round(qx - b / 2), Math.round(qy - lift(q) - b / 2), b, b);
          }
          g.globalAlpha = 1;
        }
        const top = Math.round(y - lift(p) - r / 2);
        const left = Math.round(x - r / 2);
        g.fillStyle = PAL.ink;
        g.fillRect(left - 1, top - 1, r + 2, r + 2);
        g.fillStyle = shot.style === 'rock' ? PAL.rockMid : PAL.metal;
        g.fillRect(left, top, r, r);
        // A highlight that tumbles round as it flies.
        const spin = Math.floor(p * 8) % 4;
        g.fillStyle = shot.style === 'rock' ? PAL.rockLight : PAL.stoneLight;
        g.fillRect(left + (spin === 1 || spin === 2 ? r - z : 0), top + (spin >= 2 ? r - z : 0), z, z);
        break;
      }
    }
  }

  /**
   * Missiles and nukes in the air, drawn from the simulation so they land exactly when they hit:
   * a target marker on the ground (growing more solid as the warhead nears), and the warhead
   * itself climbing, arcing and plunging, with a flame and a trail of smoke.
   */
  private drawStrikes(now: number, size: number, ox: number, oy: number): void {
    const s = this.state;
    if (s.strikes.length === 0) return;
    const g = this.ctx;
    const z = this.zoom;
    const frac = Math.min(1, Math.max(0, (now - this.tickAt) / this.tickMs));
    for (const st of s.strikes) {
      const p = Math.max(0, Math.min(1, (s.tick + frac - st.launch) / Math.max(1, st.land - st.launch)));
      const tx = this.wx(st.x) * size - ox;
      const ty = this.wy(st.y) * size - oy;
      const color = st.nuke ? PAL.gold : PAL.bad;
      // The target marker: a shrinking ring and a blinking crosshair.
      const blink = Math.floor(now / (st.nuke ? 140 : 200)) % 2 === 0;
      this.ring(tx, ty, st.radius * size * (1.15 - 0.3 * p), z, color, 0.3 + 0.5 * p);
      if (st.nuke) this.ring(tx, ty, st.radius * size * 0.55, z, PAL.ink, 0.4 + 0.4 * p);
      const arm = Math.round(size * 0.7);
      const gap = Math.round(size * 0.25);
      g.globalAlpha = blink ? 1 : 0.55;
      g.fillStyle = PAL.ink;
      g.fillRect(Math.round(tx - arm) - 1, Math.round(ty - z / 2) - 1, arm - gap + 2, z + 2);
      g.fillRect(Math.round(tx + gap) - 1, Math.round(ty - z / 2) - 1, arm - gap + 2, z + 2);
      g.fillRect(Math.round(tx - z / 2) - 1, Math.round(ty - arm) - 1, z + 2, arm - gap + 2);
      g.fillRect(Math.round(tx - z / 2) - 1, Math.round(ty + gap) - 1, z + 2, arm - gap + 2);
      g.fillStyle = color;
      g.fillRect(Math.round(tx - arm), Math.round(ty - z / 2), arm - gap, z);
      g.fillRect(Math.round(tx + gap), Math.round(ty - z / 2), arm - gap, z);
      g.fillRect(Math.round(tx - z / 2), Math.round(ty - arm), z, arm - gap);
      g.fillRect(Math.round(tx - z / 2), Math.round(ty + gap), z, arm - gap);
      g.globalAlpha = 1;

      // The warhead.
      const x0 = this.wx(st.x0);
      const y0 = this.wy(st.y0);
      const sx = x0 * size - ox;
      const sy = y0 * size - oy;
      const ex = (x0 + deltaX(s, st.x0, st.x)) * size - ox;
      const ey = (y0 + deltaY(s, st.y0, st.y)) * size - oy;
      const height = size * (st.nuke ? 10 : 7);
      const at = (q: number): [number, number] => [sx + (ex - sx) * q, sy + (ey - sy) * q - Math.sin(q * Math.PI) * height];
      // Smoke behind it, oldest and widest last.
      for (let i = 12; i >= 1; i--) {
        const q = p - i * 0.022;
        if (q < 0) continue;
        const [qx, qy] = at(q);
        const b = Math.max(z, Math.round(z * (1 + i * 0.35)));
        g.globalAlpha = 0.55 * (1 - i / 13);
        g.fillStyle = i <= 2 ? PAL.fireLight : i <= 4 ? PAL.paper : PAL.stoneLight;
        g.fillRect(Math.round(qx - b / 2), Math.round(qy - b / 2), b, b);
      }
      g.globalAlpha = 1;
      const [hx, hy] = at(p);
      const [bx0, by0] = at(Math.max(0, p - 0.02));
      const dx = hx - bx0;
      const dy = hy - by0;
      const len = Math.hypot(dx, dy) || 1;
      const body = (st.nuke ? 7 : 5) * z;
      const bx = hx - (dx / len) * body;
      const by = hy - (dy / len) * body;
      const thick = Math.max(3, Math.round(z * (st.nuke ? 2.6 : 1.8)));
      // A soft halo, so it stands out against forest and city alike.
      g.fillStyle = Math.floor(now / 120) % 2 === 0 ? 'rgba(255, 255, 255, 0.35)' : 'rgba(255, 107, 107, 0.3)';
      g.fillRect(Math.round((bx + hx) / 2 - body * 0.7), Math.round((by + hy) / 2 - body * 0.7), Math.round(body * 1.4), Math.round(body * 1.4));
      const flame = Math.floor(now / 50) % 2 === 0;
      const fl = (flame ? 3 : 2.2) * z * (st.nuke ? 1.3 : 1);
      g.fillStyle = PAL.fire;
      g.fillRect(Math.round(bx - fl / 2), Math.round(by - fl / 2), Math.round(fl), Math.round(fl));
      g.fillStyle = flame ? '#ffffff' : PAL.fireLight;
      g.fillRect(Math.round(bx - fl / 4), Math.round(by - fl / 4), Math.round(fl / 2), Math.round(fl / 2));
      this.pixelLine(bx, by, hx, hy, thick + 2, PAL.ink);
      this.pixelLine(bx, by, hx, hy, thick, st.nuke ? PAL.gold : PAL.paper);
      if (st.nuke) {
        // Black bands on the yellow body.
        for (const k of [0.35, 0.65]) {
          g.fillStyle = PAL.ink;
          g.fillRect(Math.round(bx + (hx - bx) * k - z / 2), Math.round(by + (hy - by) * k - z / 2), z, z);
        }
      }
      const nose = Math.round(z * (st.nuke ? 2.6 : 2));
      g.fillStyle = st.nuke ? PAL.ink : PAL.bad;
      g.fillRect(Math.round(hx - nose / 2), Math.round(hy - nose / 2), nose, nose);
      // Its shadow, sliding over the ground.
      const gx = sx + (ex - sx) * p;
      const gy = sy + (ey - sy) * p;
      g.fillStyle = 'rgba(18, 19, 31, 0.3)';
      g.fillRect(Math.round(gx - z), Math.round(gy - z / 2), 2 * z, z);
    }
  }

  private drawBlast(e: Effect, p: number, size: number, ox: number, oy: number): void {
    const g = this.ctx;
    const z = this.zoom;
    const cx = this.wx(e.x) * size - ox;
    const cy = this.wy(e.y) * size - oy;
    const radius = (e.radius ?? 1) * size;
    switch (e.style) {
      case 'fire': {
        // Flames licking out across the whole reach.
        const n = 18;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + e.start * 0.001;
          const d = radius * (0.35 + 0.65 * hash2(Math.floor(e.start), i, 3)) * (0.6 + 0.4 * p);
          const b = Math.max(z, Math.round((1 - p) * 3) * z);
          g.fillStyle = p < 0.3 ? PAL.fireLight : p < 0.7 ? PAL.fire : PAL.bad;
          g.fillRect(Math.round(cx + Math.cos(a) * d - b / 2), Math.round(cy + Math.sin(a) * d - b / 2 - p * size * 0.5), b, b);
        }
        break;
      }
      case 'frost':
        this.ring(cx, cy, radius * (0.3 + 0.7 * p), z, PAL.ice, 1 - p);
        this.ring(cx, cy, radius * (0.15 + 0.55 * p), z, PAL.iceDark, (1 - p) * 0.6);
        break;
      case 'heal': {
        // Green crosses rising.
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          const d = radius * 0.6 * hash2(Math.floor(e.start), i, 9);
          const x = Math.round(cx + Math.cos(a) * d);
          const y = Math.round(cy + Math.sin(a) * d - p * size);
          g.globalAlpha = 1 - p;
          g.fillStyle = PAL.holy;
          g.fillRect(x - z, y - 3 * z, 2 * z, 6 * z);
          g.fillRect(x - 3 * z, y - z, 6 * z, 2 * z);
          g.globalAlpha = 1;
        }
        break;
      }
      case 'magic': {
        // A violet burst: a flash, then a ring of sparks flying out.
        if (p < 0.2) {
          const r = radius * (0.5 + p * 2.5);
          g.fillStyle = '#ffd6ff';
          g.fillRect(Math.round(cx - r / 2), Math.round(cy - r / 2), Math.round(r), Math.round(r));
        }
        this.ring(cx, cy, radius * (0.3 + 0.7 * p), Math.max(z, Math.round((1 - p) * 2) * z), PAL.void, 1 - p);
        this.ring(cx, cy, radius * (0.15 + 0.5 * p), z, '#ffd6ff', (1 - p) * 0.7);
        break;
      }
      case 'hex': {
        // Green runes circling the bewitched unit, rising.
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 + p * 5;
          const d = radius * size * 0 + radius * (0.4 + 0.6 * (1 - p));
          const x = Math.round(cx + Math.cos(a) * d);
          const y = Math.round(cy + Math.sin(a) * d * 0.6 - p * size * 0.8);
          g.globalAlpha = 1 - p;
          g.fillStyle = i % 2 ? PAL.holy : PAL.void;
          g.fillRect(x - z, y - z, 2 * z, 2 * z);
        }
        g.globalAlpha = 1;
        break;
      }
      case 'nuke': {
        // A blinding round fireball, a shockwave racing out, and a mushroom cloud that climbs,
        // darkens from fire to smoke, and drifts away.
        const b = Math.max(2, 2 * z);
        const seed = Math.floor(e.start);
        if (p < 0.55) {
          const r1 = radius * (0.35 + Math.min(1, p * 5) * 0.65);
          g.globalAlpha = Math.min(1, 1.5 - p * 2.6);
          this.disk(cx, cy, r1, r1 * 0.8, b, p < 0.1 ? '#ffffff' : PAL.fire);
          this.disk(cx, cy, r1 * 0.72, r1 * 0.58, b, p < 0.2 ? '#ffffff' : PAL.fireLight);
          this.disk(cx, cy, r1 * 0.38, r1 * 0.3, b, '#ffffff');
          g.globalAlpha = 1;
        }
        this.ring(cx, cy, radius * (0.4 + p * 2.2), Math.max(z, Math.round((1 - p) * 4) * z), PAL.paper, Math.max(0, 0.9 - p));
        this.ring(cx, cy, radius * (0.3 + p * 1.6), Math.max(z, Math.round((1 - p) * 3) * z), PAL.fire, Math.max(0, 0.7 - p));
        const rise = Math.min(1, p * 1.5);
        const capY = cy - rise * size * 7;
        const capR = size * (1.4 + rise * 2.8);
        const fade = p > 0.7 ? 1 - (p - 0.7) / 0.3 : 1;
        const hot = p < 0.3;
        const warm = p < 0.55;
        g.globalAlpha = 0.9 * fade;
        // The stem: a column of puffs, narrowing as it climbs.
        for (let k = 0; k <= 6; k++) {
          const q = k / 6;
          const py = cy + (capY - cy) * q;
          const pr = size * (1.1 - 0.45 * q);
          this.disk(cx + (hash2(seed, k, 5) - 0.5) * size * 0.3, py, pr, pr * 0.8, b, hot ? PAL.fire : warm ? PAL.rockLight : PAL.rockMid);
        }
        // The cap: a ring of overlapping puffs around a bright (then sooty) heart.
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * Math.PI * 2;
          const pr = capR * (0.4 + 0.2 * hash2(seed, i, 13));
          const px = cx + Math.cos(a) * capR * 0.6;
          const py = capY + Math.sin(a) * capR * 0.28;
          this.disk(px, py, pr, pr * 0.75, b, hot ? (i % 2 ? PAL.fire : PAL.fireLight) : warm ? (i % 2 ? PAL.fire : PAL.rockLight) : i % 2 ? PAL.rockLight : PAL.rockMid);
        }
        this.disk(cx, capY - capR * 0.1, capR * 0.6, capR * 0.4, b, hot ? '#ffffff' : warm ? PAL.fireLight : PAL.stoneLight);
        g.globalAlpha = 1;
        break;
      }
      case 'cannon':
      default: {
        // A flash, a fireball, then a ring of smoke.
        if (p < 0.25) {
          const r = radius * (0.4 + p * 2);
          g.fillStyle = PAL.fireLight;
          g.fillRect(Math.round(cx - r / 2), Math.round(cy - r / 2), Math.round(r), Math.round(r));
          g.fillStyle = PAL.fire;
          g.fillRect(Math.round(cx - r / 4), Math.round(cy - r / 4), Math.round(r / 2), Math.round(r / 2));
        }
        this.ring(cx, cy, radius * (0.4 + 0.6 * p), Math.max(z, Math.round((1 - p) * 3) * z), p < 0.4 ? PAL.fire : PAL.rockLight, 1 - p);
        break;
      }
    }
  }

  /** Obelisk beams: drawn straight from the simulation, since a beam is held, not fired. */
  private drawBeams(now: number, size: number, ox: number, oy: number): void {
    const s = this.state;
    if (!s.colonies.some((c) => c.counts[Kind.Obelisk] > 0)) return;
    const z = this.zoom;
    const byId = new Map<number, Unit>();
    for (const u of s.units) byId.set(u.id, u);
    const ramp = this.tuning.unlockables.obelisk?.rampSeconds ?? 1;
    for (const c of s.military) {
      if (s.kind[c] !== Kind.Obelisk || s.lock[c] === 0) continue;
      const target = byId.get(s.lock[c]);
      if (!target) continue;
      const heat = Math.min(1, s.heat[c] / ramp);
      const bx = this.wx((c % s.width) + 0.5);
      const by = this.wy(((c / s.width) | 0) + 0.5) - 0.35;
      const x0 = bx * size - ox;
      const y0 = by * size - oy;
      const x1 = (bx + deltaX(s, (c % s.width) + 0.5, target.x)) * size - ox;
      const y1 = (by + 0.35 + deltaY(s, ((c / s.width) | 0) + 0.5, target.y)) * size - oy;
      const width = Math.max(1, Math.round(z * (1 + heat * 2)));
      const flicker = Math.floor(now / 60) % 2 === 0;
      this.pixelLine(x0, y0, x1, y1, width + (flicker ? z : 0), PAL.voidDark);
      this.pixelLine(x0, y0, x1, y1, width, PAL.void);
      if (heat > 0.5) this.pixelLine(x0, y0, x1, y1, Math.max(1, Math.floor(width / 2)), '#ffffff');
      // A glowing tip on the obelisk and a burn on the target.
      this.ctx.fillStyle = flicker ? '#ffffff' : PAL.void;
      this.ctx.fillRect(Math.round(x0 - z), Math.round(y0 - z), 2 * z, 2 * z);
      this.ctx.fillRect(Math.round(x1 - z * (1 + heat)), Math.round(y1 - z * (1 + heat)), Math.round(2 * z * (1 + heat)), Math.round(2 * z * (1 + heat)));
    }
  }

  private drawEffects(
    now: number,
    cellX: (c: number) => number,
    cellY: (c: number) => number,
    size: number,
    ox: number,
    oy: number,
  ): void {
    const g = this.ctx;
    const z = this.zoom;
    let keep = 0;
    for (const e of this.effects) {
      const age = now - e.start;
      const life = e.kind === 'slash' ? 170 : e.kind === 'blast' ? BLAST_MS[e.style ?? 'cannon'] : e.kind === 'grow' ? 380 : e.kind === 'convert' ? 520 : e.kind === 'hit' ? 90 : 420;
      if (age >= life) continue;
      this.effects[keep++] = e;
      if (age < 0) continue; // a blast waiting for its shell to land
      if (e.kind === 'blast') {
        this.drawBlast(e, age / life, size, ox, oy);
        continue;
      }
      if (e.kind === 'slash') {
        this.drawSlash(e, age / life, size, ox, oy);
        continue;
      }
      const x = e.cell >= 0 ? cellX(e.cell) : Math.round(this.wx(e.x) * size - ox - size / 2);
      const y = e.cell >= 0 ? cellY(e.cell) : Math.round(this.wy(e.y) * size - oy - size / 2);
      if (x < -size * 2 || y < -size * 2 || x > this.canvas.width + size || y > this.canvas.height + size) continue;

      if (e.kind === 'hit') {
        g.fillStyle = 'rgba(244, 236, 216, 0.6)';
        g.fillRect(x, y, size, size);
        continue;
      }
      if (e.kind === 'puff') {
        // Dust: four squares flying outward and shrinking.
        const p = age / life;
        const d = Math.max(z, Math.round((1 - p) * 3) * z);
        const out = Math.round(p * 5) * z;
        const mx = x + size / 2;
        const my = y + size / 2;
        g.fillStyle = p < 0.4 ? PAL.paper : PAL.rockLight;
        g.fillRect(mx - out - d, my - out - d, d, d);
        g.fillRect(mx + out, my - out - d, d, d);
        g.fillRect(mx - out - d, my + out, d, d);
        g.fillRect(mx + out, my + out, d, d);
        continue;
      }
      g.fillStyle = e.kind === 'grow' ? PAL.paper : PAL.gold;
      if (age < 90) {
        g.fillRect(x, y, size, size);
      } else if (age < 230) {
        g.fillRect(x, y, size, z);
        g.fillRect(x, y + size - z, size, z);
        g.fillRect(x, y, z, size);
        g.fillRect(x + size - z, y, z, size);
      } else {
        const d = 2 * z;
        const out = e.kind === 'convert' ? Math.round(((age - 230) / 290) * 3) * z : 0;
        g.fillRect(x - out, y - out, d, d);
        g.fillRect(x + size - d + out, y - out, d, d);
        g.fillRect(x - out, y + size - d + out, d, d);
        g.fillRect(x + size - d + out, y + size - d + out, d, d);
      }
    }
    this.effects.length = keep;
  }

  private drawCursor(now: number, view: ViewOptions, x: number, y: number, size: number): void {
    const g = this.ctx;
    const z = this.zoom;
    const toolActive = view.toolKind !== 0;
    // How far this tower reaches: the one under the cursor, or the one about to be built.
    const s = this.state;
    const hoverKind = s.kind[view.hover];
    const ringKind = toolActive ? view.toolKind : isTower(hoverKind) ? hoverKind : 0;
    const ringOwner = toolActive ? this.player : s.owner[view.hover];
    // Buildings that reach a square area around them (Factory, Power Plant, Plaza): outline it.
    const areaKind = toolActive ? view.toolKind : hoverKind;
    const area = AREA_KINDS.includes(areaKind) ? unlockTuning(this.tuning, areaKind)?.radius ?? 0 : 0;
    if (area > 0 && (toolActive || s.owner[view.hover] > 0)) {
      const left = x - area * size;
      const top = y - area * size;
      const span = (area * 2 + 1) * size;
      const line = Math.max(1, Math.floor(z / 2));
      g.globalAlpha = 0.8;
      g.fillStyle = areaKind === Kind.Plaza ? PAL.good : areaKind === Kind.Radar ? PAL.science : areaKind === Kind.University ? PAL.scienceLight : PAL.gold;
      for (let i = 0; i < span; i += 3 * line) {
        g.fillRect(left + i, top, line * 2, line);
        g.fillRect(left + i, top + span - line, line * 2, line);
        g.fillRect(left, top + i, line, line * 2);
        g.fillRect(left + span - line, top + i, line, line * 2);
      }
      g.globalAlpha = 0.12;
      g.fillRect(left, top, span, span);
      g.globalAlpha = 1;
    } else if (ringKind && isTower(ringKind) && ringOwner > 0) {
      const range = towerRange(this.tuning, s.colonies[ringOwner - 1], ringKind);
      this.ring(x + size / 2, y + size / 2, range * size, z, ringKind === Kind.Bell || ringKind === Kind.Shrine ? PAL.holyLight : PAL.paper, 0.75);
    }
    if (toolActive && view.canConvertHover) {
      const preview = this.sprites.colonies[(this.player - 1) % COLONY.length].buildings[view.toolKind];
      if (preview) {
        g.globalAlpha = 0.8;
        g.drawImage(preview, x, y, size, size);
        g.globalAlpha = 1;
      }
    }
    const t = Math.max(1, Math.floor(z / 2));
    const pulse = Math.floor(now / 450) % 2 === 0 ? 0 : t;
    const len = Math.max(2, 2 * z);
    const x0 = x - t - pulse;
    const y0 = y - t - pulse;
    const x1 = x + size + pulse;
    const y1 = y + size + pulse;
    g.fillStyle = !toolActive ? PAL.paper : view.canConvertHover ? PAL.good : PAL.bad;
    // Four corner brackets.
    g.fillRect(x0, y0, len, t);
    g.fillRect(x0, y0, t, len);
    g.fillRect(x1 + t - len, y0, len, t);
    g.fillRect(x1, y0, t, len);
    g.fillRect(x0, y1, len, t);
    g.fillRect(x0, y1 + t - len, t, len);
    g.fillRect(x1 + t - len, y1, len, t);
    g.fillRect(x1, y1 + t - len, t, len);
  }
}
