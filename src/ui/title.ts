// The title screen's pieces: a logo that builds itself house by house, and a live preview of
// the map you are about to play.

import { COLONY, PAL } from '../render/palette';
import { TILE, type Sprite, type SpriteSet } from '../render/sprites';
import { generateMap, mapSize, type MapType } from '../sim/mapgen';
import { Terrain, type Tuning } from '../sim/types';

/** A 5x7 pixel font, just the letters the title needs. */
const LETTERS: Record<string, string[]> = {
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
};

interface LogoCell {
  x: number;
  y: number;
  /** Which colony's colours its houses wear. */
  colony: number;
  /** Milliseconds after the start at which it appears. */
  at: number;
  /** Which house sprite. */
  look: number;
  /** When it twinkles. */
  phase: number;
}

/**
 * "DOT CITY" spelled in houses. They spring up one by one from the middle outwards, the way a
 * city grows, each letter in a different colony's colours, with a Center Tower in the O. Once
 * built, houses twinkle now and then.
 */
export class Logo {
  private cells: LogoCell[] = [];
  private start = 0;
  private readonly g: CanvasRenderingContext2D;
  private readonly cols: number;
  /** Top-left of the O's hollow, in logo pixels, for the tower. */
  private readonly hollow: [number, number];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly sprites: SpriteSet,
  ) {
    const word = 'DOT CITY';
    let x = 0;
    let hollow: [number, number] = [0, 0];
    const lit: Array<{ x: number; y: number; colony: number }> = [];
    let letterIndex = 0;
    for (const ch of word) {
      if (ch === ' ') {
        x += 3;
        continue;
      }
      const rows = LETTERS[ch];
      if (ch === 'O') hollow = [x + 1, 1];
      for (let y = 0; y < rows.length; y++) for (let k = 0; k < 5; k++) if (rows[y][k] === '1') lit.push({ x: x + k, y, colony: letterIndex % COLONY.length });
      x += 6;
      letterIndex++;
    }
    this.cols = x - 1;
    this.hollow = hollow;
    const midX = this.cols / 2;
    const midY = 3;
    // Grow from the middle outwards, with a little jitter so it looks alive.
    this.cells = lit.map((p, i) => ({
      ...p,
      at: Math.hypot(p.x - midX, (p.y - midY) * 1.6) * 48 + ((i * 37) % 11) * 9,
      look: (i * 7) % 4,
      phase: ((i * 53) % 97) / 97,
    }));
    canvas.width = this.cols * TILE;
    canvas.height = 7 * TILE + 4;
    this.g = canvas.getContext('2d') as CanvasRenderingContext2D;
    this.g.imageSmoothingEnabled = false;
  }

  restart(now: number): void {
    this.start = now;
  }

  draw(now: number): void {
    const g = this.g;
    const t = now - this.start;
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    let last = 0;
    // Dark outlines first, all of them, so they frame each letter without cutting into it.
    g.fillStyle = PAL.ink;
    for (const cell of this.cells) if (t - cell.at >= 110) g.fillRect(cell.x * TILE - 1, cell.y * TILE + 1, TILE + 2, TILE + 2);
    for (const cell of this.cells) {
      last = Math.max(last, cell.at);
      const age = t - cell.at;
      if (age < 0) continue;
      const px = cell.x * TILE;
      const py = cell.y * TILE + 2;
      if (age < 110) {
        // A white pop as it appears, rising into place.
        g.fillStyle = PAL.paper;
        const lift = Math.round((1 - age / 110) * 3);
        g.fillRect(px + 1, py + 1 - lift, TILE - 2, TILE - 2);
        continue;
      }
      // A plot in the colony's colour under every house, so the letters read as solid shapes.
      const team = COLONY[cell.colony];
      g.fillStyle = team.dark;
      g.fillRect(px, py, TILE, TILE);
      g.fillStyle = team.main;
      g.fillRect(px, py, TILE, 1);
      const houses = this.sprites.colonies[cell.colony].houses;
      g.drawImage(houses[cell.look % houses.length], px, py);
      // Twinkle: a window lights up for a moment every few seconds.
      if (((now / 1000) * 0.18 + cell.phase) % 1 < 0.025) {
        g.fillStyle = PAL.fireLight;
        g.fillRect(px + 3, py + 4, 2, 2);
      }
    }
    // The Center Tower rises in the O once the letters stand.
    if (t > last * 0.6) {
      const tower = this.sprites.colonies[1].tower;
      const rise = Math.max(0, Math.min(1, (t - last * 0.6) / 400));
      const [hx, hy] = this.hollow;
      const x = hx * TILE + (3 * TILE - tower.width) / 2;
      const y = hy * TILE + 2 + (5 * TILE - tower.height) / 2 + Math.round((1 - rise) * 10);
      g.globalAlpha = rise;
      g.drawImage(tower, x, y);
      g.globalAlpha = 1;
    }
  }
}

const TERRAIN_RGB: Record<number, [number, number, number]> = {
  [Terrain.Grass]: [95, 155, 74],
  [Terrain.Forest]: [56, 120, 74],
  [Terrain.Mountain]: [127, 134, 154],
  [Terrain.Water]: [63, 116, 198],
};

/**
 * A small picture of the map a seed and map type would make, with every colony's start. The
 * player's start (the first) is ringed in white. Returns what the player finds beside them.
 */
export function drawMapPreview(canvas: HTMLCanvasElement, t: Tuning, seed: number, type: MapType, colonies: number): string {
  const size = mapSize(t, colonies);
  const map = generateMap(seed, t, colonies, size, type === 'endless', type);
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  const image = g.createImageData(size, size);
  for (let c = 0; c < map.terrain.length; c++) {
    const [r, gg, b] = TERRAIN_RGB[map.terrain[c]] ?? [0, 0, 0];
    const shade = map.features[c] ? 1.4 : 1;
    image.data[c * 4] = Math.min(255, r * shade);
    image.data[c * 4 + 1] = Math.min(255, gg * shade);
    image.data[c * 4 + 2] = Math.min(255, b * shade);
    image.data[c * 4 + 3] = 255;
  }
  g.putImageData(image, 0, 0);
  map.towers.forEach((tower, i) => {
    const x = tower % size;
    const y = (tower / size) | 0;
    if (i === 0) {
      g.fillStyle = '#ffffff';
      g.fillRect(x - 3, y - 3, 8, 8);
    }
    g.fillStyle = PAL.ink;
    g.fillRect(x - 2, y - 2, 6, 6);
    g.fillStyle = COLONY[i % COLONY.length].main;
    g.fillRect(x - 1, y - 1, 4, 4);
  });
  return map.flavours[0] ?? '';
}

/** A sprite drawn big into its own little canvas, for buttons and cards. */
export function iconOf(sprite: Sprite, scale = 4): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = sprite.width * scale;
  canvas.height = sprite.height * scale;
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  g.imageSmoothingEnabled = false;
  g.drawImage(sprite, 0, 0, canvas.width, canvas.height);
  return canvas;
}
