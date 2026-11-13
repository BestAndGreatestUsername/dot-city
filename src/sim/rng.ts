// One seeded generator (mulberry32). Its whole state is a single number stored on the host,
// so the same seed and the same commands always replay the same match.

export interface RngHost {
  rng: number;
}

export function nextU32(h: RngHost): number {
  h.rng = (h.rng + 0x6d2b79f5) >>> 0;
  let t = h.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

/** Uniform in [0, 1). */
export function nextFloat(h: RngHost): number {
  return nextU32(h) / 4294967296;
}

/** Uniform integer in [0, n). */
export function nextInt(h: RngHost, n: number): number {
  return Math.floor(nextFloat(h) * n);
}

/** Stateless hash of a lattice point, in [0, 1). Used for noise and for cosmetic variety. */
export function hash2(seed: number, x: number, y: number): number {
  let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** FNV-1a of a string, for turning a typed seed into a number. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
