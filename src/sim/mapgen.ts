// Seeded map generation. Five kinds of map, each with its own shape:
//   Continent   one great landmass in the ocean, mountain spines across it
//   Highlands   ridges of mountains with valleys and passes between them
//   River Lands wide rivers cut the land, crossed only at fords
//   Lakes       a land of many lakes
//   Endless     the map loops at its edges
// Every colony starts with the same amount of open land, but a different flavour beside it
// (mountains for mines, a lake for fisheries, forest for timber, or open plains), and the map
// carries landmarks worth expanding towards: Ancient Ruins (a free discovery) and Treasure
// (a lump of gold), a few near each start and the richest in the contested ground between.

import { hash2, nextFloat, nextInt, type RngHost } from './rng';
import { Terrain, TOWER_SIZE, type Tuning } from './types';

export const MAP_TYPES = ['continent', 'highlands', 'rivers', 'lakes', 'endless'] as const;
export type MapType = (typeof MAP_TYPES)[number];
export const MAP_NAMES: Record<MapType, string> = {
  continent: 'Continent',
  highlands: 'Highlands',
  rivers: 'River Lands',
  lakes: 'Lakes',
  endless: 'Endless World',
};

/** Landmarks on the map, until a city grows onto them. */
export const Feature = { None: 0, Ruins: 1, Treasure: 2 } as const;

/** What each colony finds beside its start. */
export const FLAVOURS = ['mountains', 'lake', 'forest', 'plains'] as const;

export interface GeneratedMap {
  terrain: Uint8Array;
  /** Top-left cell of each colony's 2x2 tower; index 0 is the player. */
  towers: number[];
  /** Landmark on each cell (see Feature). */
  features: Uint8Array;
  /** Each colony's start flavour, by tower index. */
  flavours: string[];
}

/** A map type picked from the seed (Endless is only played when chosen). */
export function mapTypeFor(seed: number): MapType {
  return MAP_TYPES[(seed >>> 5) % 4];
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Smooth noise on a lattice. With a period, the lattice repeats every `period` cells, so the
 * noise (and so the terrain) joins up seamlessly where a looping map meets itself.
 */
function valueNoise(seed: number, x: number, y: number, period: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const tx = smooth(x - xi);
  const ty = smooth(y - yi);
  const at = (i: number, j: number) => (period > 0 ? hash2(seed, ((i % period) + period) % period, ((j % period) + period) % period) : hash2(seed, i, j));
  const a = at(xi, yi);
  const b = at(xi + 1, yi);
  const c = at(xi, yi + 1);
  const d = at(xi + 1, yi + 1);
  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  return top + (bottom - top) * ty;
}

function fbm(seed: number, x: number, y: number, octaves: number, period: number): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(seed + i * 1013, x * freq, y * freq, period * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

function quantile(values: Float32Array, q: number): number {
  const sorted = Float32Array.from(values).sort();
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[i];
}

/**
 * Side of the (square) map for this many colonies: the tuned size for up to four, growing with
 * the number of colonies so each keeps about the same room. Always a multiple of 16.
 */
export function mapSize(t: Tuning, colonies: number): number {
  const base = t.map.width;
  const size = base * Math.sqrt(Math.max(4, colonies) / 4);
  return Math.round(size / 16) * 16;
}

export function generateMap(seed: number, t: Tuning, colonies: number, size = t.map.width, wrap = false, type: MapType = wrap ? 'endless' : 'lakes'): GeneratedMap {
  const w = size;
  const h = size;
  const n = w * h;
  const terrain = new Uint8Array(n);
  const elev = new Float32Array(n);
  const moist = new Float32Array(n);

  // Noise features about 20 (elevation) and 11 (moisture) squares across. On a looping map the
  // scale is nudged so a whole number of them fit, and the lattice repeats with the map.
  const elevCells = Math.max(2, Math.round(w / 20));
  const moistCells = Math.max(2, Math.round(w / 11));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      elev[y * w + x] = fbm(seed ^ 0x51ed270b, (x * elevCells) / w, (y * elevCells) / h, 4, wrap ? elevCells : 0);
      moist[y * w + x] = fbm(seed ^ 0x2f6b1a3d, (x * moistCells) / w, (y * moistCells) / h, 3, wrap ? moistCells : 0);
    }
  }

  // Each kind of map bends the noise its own way.
  let waterShare = t.map.waterShare;
  let mountainShare = t.map.mountainShare;
  let forestShare = t.map.forestShare;
  if (type === 'continent') {
    // Sink the edges into the ocean, and raise spines of rock through the middle.
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = (x + 0.5) / w - 0.5;
        const dy = (y + 0.5) / h - 0.5;
        const edge = Math.max(Math.abs(dx), Math.abs(dy)) * 2;
        elev[y * w + x] -= 0.75 * Math.pow(Math.max(0, edge - 0.55) / 0.45, 1.6);
      }
    }
    waterShare = 0.24;
    mountainShare = 0.06;
  } else if (type === 'highlands') {
    // Ridged noise: sharp mountain lines with valleys between them.
    for (let c = 0; c < n; c++) elev[c] = 1 - Math.abs(elev[c] - 0.5) * 2;
    waterShare = 0.03;
    mountainShare = 0.2;
    forestShare = 0.18;
  } else if (type === 'rivers') {
    waterShare = 0.02;
    mountainShare = 0.06;
  } else if (type === 'lakes') {
    waterShare = 0.16;
    mountainShare = 0.06;
  }
  const waterLevel = quantile(elev, waterShare);
  const mountainLevel = quantile(elev, 1 - mountainShare);
  const forestLevel = quantile(moist, 1 - forestShare);
  for (let c = 0; c < n; c++) {
    if (elev[c] < waterLevel) terrain[c] = Terrain.Water;
    else if (elev[c] > mountainLevel) terrain[c] = Terrain.Mountain;
    else if (moist[c] > forestLevel) terrain[c] = Terrain.Forest;
    else terrain[c] = Terrain.Grass;
  }

  const rng: RngHost = { rng: (seed ^ 0x9e3779b9) >>> 0 };

  // Short rivers run downhill from the mountains until they meet water or run out of length.
  for (let r = 0; r < t.map.rivers; r++) {
    let start = -1;
    for (let tries = 0; tries < 60 && start < 0; tries++) {
      const c = nextInt(rng, n);
      if (terrain[c] === Terrain.Mountain) start = c;
    }
    if (start < 0) continue;
    const visited = new Set<number>([start]);
    let cur = start;
    for (let step = 0; step < t.map.riverMaxLength; step++) {
      const x = cur % w;
      const y = (cur / w) | 0;
      let best = -1;
      let bestScore = Infinity;
      const wrapAt = (nx: number, ny: number) => (wrap ? ((ny + h) % h) * w + ((nx + w) % w) : nx < 0 || ny < 0 || nx >= w || ny >= h ? -1 : ny * w + nx);
      const options = [wrapAt(x, y - 1), wrapAt(x + 1, y), wrapAt(x, y + 1), wrapAt(x - 1, y)];
      for (const o of options) {
        if (o < 0 || visited.has(o)) continue;
        const score = elev[o] + nextFloat(rng) * 0.02;
        if (score < bestScore) {
          bestScore = score;
          best = o;
        }
      }
      if (best < 0) break;
      cur = best;
      visited.add(cur);
      if (terrain[cur] === Terrain.Water) break;
      if (terrain[cur] !== Terrain.Mountain) terrain[cur] = Terrain.Water;
    }
  }

  if (type === 'rivers') {
    const count = 2 + (seed % 2);
    for (let r = 0; r < count; r++) {
      const across = r % 2 === 0;
      const base = (0.2 + 0.6 * ((r + 0.5) / count)) * (across ? h : w);
      const phase = nextFloat(rng) * Math.PI * 2;
      const fordEvery = 13 + nextInt(rng, 5);
      const fordAt = nextInt(rng, fordEvery);
      const length = across ? w : h;
      for (let i = 0; i < length; i++) {
        const mid = base + Math.sin(i / 9 + phase) * 5 + Math.sin(i / 23 + phase * 2) * 4;
        // A ford: a short stretch of shallows where the river can be crossed.
        const ford = (i + fordAt) % fordEvery < 2;
        for (let k = -1; k <= 1; k++) {
          const along = Math.round(mid) + k;
          const x = across ? i : along;
          const y = across ? along : i;
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          terrain[y * w + x] = ford ? Terrain.Grass : Terrain.Water;
        }
      }
    }
  }

  // Starting positions: as far apart as possible. The first is anywhere; each next one is the
  // candidate furthest from all those already chosen (the short way round on a looping map).
  const span = (a: number, b: number, len: number) => {
    const d = Math.abs(a - b);
    return wrap ? Math.min(d, len - d) : d;
  };
  const candidates: Array<[number, number]> = [];
  // On a looping map anywhere will do; on a flat one, keep clear of the edges.
  // A continent's edges are ocean, so its colonies start further in.
  const margin = wrap ? 0.03 : type === 'continent' ? 0.22 : 0.12;
  for (let i = 0; i < 600; i++) candidates.push([margin + nextFloat(rng) * (1 - 2 * margin), margin + nextFloat(rng) * (1 - 2 * margin)]);
  const gapBetween = (p: [number, number], q: [number, number]) => Math.hypot(span(p[0], q[0], 1), span(p[1], q[1], 1));
  /** Greedy spread from one starting candidate; returns the layout and its closest pair. */
  const spread = (first: [number, number]): [Array<[number, number]>, number] => {
    const chosen: Array<[number, number]> = [first];
    while (chosen.length < colonies) {
      let best = first;
      let bestGap = -1;
      for (const p of candidates) {
        let gap = Infinity;
        for (const q of chosen) gap = Math.min(gap, gapBetween(p, q));
        if (gap > bestGap) {
          bestGap = gap;
          best = p;
        }
      }
      chosen.push(best);
    }
    let closest = Infinity;
    for (let i = 0; i < chosen.length; i++) for (let j = i + 1; j < chosen.length; j++) closest = Math.min(closest, gapBetween(chosen[i], chosen[j]));
    return [chosen, closest];
  };
  // A greedy spread depends on where it starts: try a dozen starts and keep the roomiest.
  let quadrants: Array<[number, number]> = [];
  let roomiest = -1;
  for (let k = 0; k < 12; k++) {
    const [layout, closest] = spread(candidates[k * 37]);
    if (closest > roomiest) {
      roomiest = closest;
      quadrants = layout;
    }
  }
  // Who starts where is shuffled, so the player is not always first.
  for (let i = quadrants.length - 1; i > 0; i--) {
    const j = nextInt(rng, i + 1);
    [quadrants[i], quadrants[j]] = [quadrants[j], quadrants[i]];
  }

  const open = (c: number) => terrain[c] === Terrain.Grass || terrain[c] === Terrain.Forest;
  const towers: number[] = [];
  const jitter = t.map.startJitter;
  for (let i = 0; i < quadrants.length; i++) {
    const cx = Math.floor(quadrants[i][0] * w);
    const cy = Math.floor(quadrants[i][1] * h);
    let best = cy * w + cx;
    let bestScore = -1;
    for (let y = cy - jitter; y <= cy + jitter; y++) {
      for (let x = cx - jitter; x <= cx + jitter; x++) {
        if (x < 2 || y < 2 || x >= w - 3 || y >= h - 3) continue;
        const c = y * w + x;
        // The tower is 2x2 with this cell as its top-left corner: all four must be open land.
        if (!open(c) || !open(c + 1) || !open(c + w) || !open(c + w + 1)) continue;
        let land = 0;
        for (let dy = -6; dy <= 6; dy++) {
          for (let dx = -6; dx <= 6; dx++) {
            let nx = x + dx;
            let ny = y + dy;
            if (wrap) {
              nx = (nx + w) % w;
              ny = (ny + h) % h;
            } else if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            if (open(ny * w + nx)) land++;
          }
        }
        const score = land + hash2(seed, x, y) * 6;
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      }
    }
    // Guarantee breathing room: the 2x2 tower stands on grass and its ring is never rock or water.
    const bx = best % w;
    const by = (best / w) | 0;
    for (let dy = -1; dy <= TOWER_SIZE; dy++) {
      for (let dx = -1; dx <= TOWER_SIZE; dx++) {
        const c = (by + dy) * w + (bx + dx);
        const inside = dx >= 0 && dy >= 0 && dx < TOWER_SIZE && dy < TOWER_SIZE;
        if (inside || terrain[c] === Terrain.Mountain || terrain[c] === Terrain.Water) terrain[c] = Terrain.Grass;
      }
    }
    towers.push(best);
  }

  const features = new Uint8Array(n);
  const at = (x: number, y: number): number => {
    if (wrap) return (((y % h) + h) % h) * w + (((x % w) + w) % w);
    return x < 0 || y < 0 || x >= w || y >= h ? -1 : y * w + x;
  };
  const disc = (cx: number, cy: number, r: number, paint: (c: number, d: number) => void) => {
    for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
      for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
        const d = Math.hypot(dx, dy);
        if (d > r) continue;
        const c = at(cx + dx, cy + dy);
        if (c >= 0) paint(c, d);
      }
    }
  };

  // 1. Every start gets the same open ground around its tower, and a flavour beside it.
  const flavours: string[] = [];
  towers.forEach((tower, i) => {
    const tx = tower % w;
    const ty = (tower / w) | 0;
    // Open ground close in: no rock or water within 4 squares.
    disc(tx, ty, 4, (c) => {
      if (terrain[c] === Terrain.Mountain || terrain[c] === Terrain.Water) terrain[c] = Terrain.Grass;
    });
    const flavour = FLAVOURS[(seed + i * 3) % FLAVOURS.length];
    flavours.push(flavour);
    const angle = hash2(seed + 77, i, 1) * Math.PI * 2;
    const fx = Math.round(tx + Math.cos(angle) * 8);
    const fy = Math.round(ty + Math.sin(angle) * 8);
    if (flavour === 'mountains') {
      // A small range: rich ground for Mines and Observatories, and a wall at your back.
      disc(fx, fy, 2.6, (c, d) => {
        if (d < 2.2 || hash2(seed, c, 5) < 0.5) terrain[c] = Terrain.Mountain;
      });
    } else if (flavour === 'lake') {
      // A lake: room for Fisheries, and houses on its shore earn more.
      disc(fx, fy, 2.6, (c, d) => {
        if (d < 2.2 || hash2(seed, c, 6) < 0.5) terrain[c] = Terrain.Water;
      });
    } else if (flavour === 'forest') {
      // Deep forest: slow to grow into, but every square cleared pays timber.
      disc(fx, fy, 5, (c) => {
        if (terrain[c] === Terrain.Grass) terrain[c] = Terrain.Forest;
      });
    } else {
      // Open plains: nothing in the way, and an extra treasure close by.
      disc(tx, ty, 9, (c) => {
        if (terrain[c] !== Terrain.Grass) terrain[c] = Terrain.Grass;
      });
      const c = at(fx, fy);
      if (c >= 0) features[c] = Feature.Treasure;
    }
  });

  // 2. Landmarks. Each colony has Ancient Ruins at the same distance from its tower...
  const openLand = (c: number) => c >= 0 && (terrain[c] === Terrain.Grass || terrain[c] === Terrain.Forest);
  const placeNear = (x: number, y: number, kind: number) => {
    for (let r = 0; r <= 4; r++) {
      for (let k = 0; k < 8 * Math.max(1, r); k++) {
        const a = (k / (8 * Math.max(1, r))) * Math.PI * 2;
        const c = at(Math.round(x + Math.cos(a) * r), Math.round(y + Math.sin(a) * r));
        if (openLand(c) && features[c] === Feature.None) {
          features[c] = kind;
          return;
        }
      }
    }
  };
  towers.forEach((tower, i) => {
    const angle = hash2(seed + 91, i, 2) * Math.PI * 2;
    placeNear((tower % w) + Math.cos(angle) * 12, ((tower / w) | 0) + Math.sin(angle) * 12, Feature.Ruins);
  });
  // ...and the richest ones lie in the contested ground between colonies: the spots furthest from every tower.
  const spots: Array<[number, number]> = towers.map((tw) => [tw % w, (tw / w) | 0]);
  const spanX = (a: number, b: number) => (wrap ? Math.min(Math.abs(a - b), w - Math.abs(a - b)) : Math.abs(a - b));
  const spanY = (a: number, b: number) => (wrap ? Math.min(Math.abs(a - b), h - Math.abs(a - b)) : Math.abs(a - b));
  for (let k = 0; k < colonies + 1; k++) {
    let best: [number, number] | null = null;
    let bestGap = -1;
    for (let tries = 0; tries < 300; tries++) {
      const m = 0.1;
      const p: [number, number] = [Math.floor((m + nextFloat(rng) * (1 - 2 * m)) * w), Math.floor((m + nextFloat(rng) * (1 - 2 * m)) * h)];
      if (!openLand(at(p[0], p[1]))) continue;
      let gap = Infinity;
      for (const q of spots) gap = Math.min(gap, Math.hypot(spanX(p[0], q[0]), spanY(p[1], q[1])));
      if (gap > bestGap) {
        bestGap = gap;
        best = p;
      }
    }
    if (!best) continue;
    spots.push(best);
    features[at(best[0], best[1])] = k % 2 === 0 ? Feature.Ruins : Feature.Treasure;
  }
  for (const tw of towers) {
    for (let dy = -1; dy <= TOWER_SIZE; dy++) for (let dx = -1; dx <= TOWER_SIZE; dx++) {
      const c = at((tw % w) + dx, ((tw / w) | 0) + dy);
      if (c >= 0) features[c] = Feature.None;
    }
  }

  // 3. Everyone must be able to reach everyone on foot: where water cuts a colony off, lay a
  // causeway of land straight towards the first colony.
  const reach = () => {
    const seen = new Uint8Array(n);
    const stack = [towers[0]];
    seen[towers[0]] = 1;
    while (stack.length > 0) {
      const c = stack.pop() as number;
      const x = c % w;
      const y = (c / w) | 0;
      for (const nb of [at(x, y - 1), at(x + 1, y), at(x, y + 1), at(x - 1, y)]) {
        if (nb < 0 || seen[nb] || terrain[nb] === Terrain.Water) continue;
        seen[nb] = 1;
        stack.push(nb);
      }
    }
    return seen;
  };
  let seen = reach();
  for (let i = 1; i < towers.length; i++) {
    if (seen[towers[i]]) continue;
    const ax = towers[i] % w;
    const ay = (towers[i] / w) | 0;
    const bx = towers[0] % w;
    const by = (towers[0] / w) | 0;
    let dx = bx - ax;
    let dy = by - ay;
    if (wrap) {
      if (Math.abs(dx) > w / 2) dx -= Math.sign(dx) * w;
      if (Math.abs(dy) > h / 2) dy -= Math.sign(dy) * h;
    }
    const steps = Math.max(Math.abs(dx), Math.abs(dy));
    for (let k = 0; k <= steps; k++) {
      const x = Math.round(ax + (dx * k) / steps);
      const y = Math.round(ay + (dy * k) / steps);
      for (const c of [at(x, y), at(x + 1, y)]) if (c >= 0 && terrain[c] === Terrain.Water) terrain[c] = Terrain.Grass;
    }
    seen = reach();
  }

  return { terrain, towers, features, flavours };
}
