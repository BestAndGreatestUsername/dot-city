// Sound: every effect and every note is synthesised with the Web Audio API, so the game ships
// without a single audio file. Effects are placed in the world (quieter the further they are
// from the view), throttled so a big battle stays listenable, and the music follows the ages.

import { Music } from './music';

export interface AudioSettings {
  /** 0 to 1. */
  music: number;
  sfx: number;
}

const STORAGE_KEY = 'dot-city-audio';

/** One synthesised voice: an oscillator or a burst of noise, shaped by an envelope. */
interface Tone {
  /** Oscillator shape, or 'noise'. */
  wave: OscillatorType | 'noise';
  /** Start frequency (Hz); for noise, the filter frequency. */
  freq: number;
  /** End frequency, for slides. */
  to?: number;
  /** Seconds. */
  dur: number;
  vol: number;
  /** Seconds after the sound starts. */
  delay?: number;
  attack?: number;
  /** For noise: the filter type. */
  filter?: BiquadFilterType;
  /** For noise: the filter's Q. */
  q?: number;
}

/** Each named sound: its tones, and the shortest gap (ms) between two plays of it. */
const SOUNDS: Record<string, { tones: Tone[]; gap: number }> = {
  // The city.
  grow: { tones: [{ wave: 'triangle', freq: 1320, to: 1480, dur: 0.06, vol: 0.05 }], gap: 90 },
  build: {
    tones: [
      { wave: 'square', freq: 220, to: 110, dur: 0.12, vol: 0.18 },
      { wave: 'noise', freq: 900, dur: 0.08, vol: 0.18, filter: 'lowpass' },
      { wave: 'triangle', freq: 660, dur: 0.1, vol: 0.12, delay: 0.08 },
    ],
    gap: 40,
  },
  collapse: {
    tones: [
      { wave: 'noise', freq: 700, to: 200, dur: 0.35, vol: 0.32, filter: 'lowpass' },
      { wave: 'sine', freq: 90, to: 50, dur: 0.25, vol: 0.25 },
    ],
    gap: 60,
  },
  hit: { tones: [{ wave: 'noise', freq: 2500, dur: 0.03, vol: 0.08, filter: 'highpass' }], gap: 45 },
  timber: { tones: [{ wave: 'square', freq: 330, to: 220, dur: 0.05, vol: 0.06 }, { wave: 'noise', freq: 1200, dur: 0.04, vol: 0.06, filter: 'bandpass' }], gap: 120 },
  // Shots.
  bolt: { tones: [{ wave: 'noise', freq: 3200, to: 1200, dur: 0.07, vol: 0.12, filter: 'bandpass', q: 3 }], gap: 50 },
  arrow: { tones: [{ wave: 'noise', freq: 4200, to: 2000, dur: 0.09, vol: 0.08, filter: 'bandpass', q: 5 }], gap: 50 },
  ballista: {
    tones: [
      { wave: 'triangle', freq: 140, to: 70, dur: 0.12, vol: 0.22 },
      { wave: 'noise', freq: 1800, to: 600, dur: 0.2, vol: 0.12, filter: 'bandpass', q: 2 },
    ],
    gap: 80,
  },
  spear: { tones: [{ wave: 'noise', freq: 1500, to: 600, dur: 0.22, vol: 0.14, filter: 'bandpass', q: 4 }], gap: 80 },
  zap: {
    tones: [
      { wave: 'sawtooth', freq: 1400, to: 180, dur: 0.14, vol: 0.12 },
      { wave: 'noise', freq: 5000, dur: 0.1, vol: 0.1, filter: 'highpass' },
    ],
    gap: 70,
  },
  boom: {
    tones: [
      { wave: 'sine', freq: 130, to: 38, dur: 0.45, vol: 0.45 },
      { wave: 'noise', freq: 900, to: 150, dur: 0.4, vol: 0.3, filter: 'lowpass' },
    ],
    gap: 90,
  },
  whoosh: { tones: [{ wave: 'noise', freq: 500, to: 1400, dur: 0.3, vol: 0.12, filter: 'bandpass', q: 1 }], gap: 120 },
  missile: {
    tones: [
      { wave: 'sawtooth', freq: 300, to: 1200, dur: 1.1, vol: 0.08 },
      { wave: 'noise', freq: 2000, to: 800, dur: 1.2, vol: 0.08, filter: 'bandpass', q: 1 },
    ],
    gap: 300,
  },
  magic: {
    tones: [
      { wave: 'triangle', freq: 300, to: 900, dur: 0.18, vol: 0.1 },
      { wave: 'noise', freq: 2400, to: 900, dur: 0.2, vol: 0.06, filter: 'bandpass', q: 2 },
    ],
    gap: 90,
  },
  rail: {
    tones: [
      { wave: 'sawtooth', freq: 2400, to: 300, dur: 0.18, vol: 0.12 },
      { wave: 'square', freq: 90, to: 45, dur: 0.25, vol: 0.18 },
      { wave: 'noise', freq: 6000, dur: 0.08, vol: 0.12, filter: 'highpass' },
    ],
    gap: 120,
  },
  hex: {
    tones: [
      { wave: 'sine', freq: 660, to: 440, dur: 0.3, vol: 0.08 },
      { wave: 'sine', freq: 698, to: 415, dur: 0.3, vol: 0.06, delay: 0.05 },
      { wave: 'triangle', freq: 1320, to: 880, dur: 0.25, vol: 0.04, delay: 0.1 },
    ],
    gap: 400,
  },
  sniper: {
    tones: [
      { wave: 'noise', freq: 5200, to: 2000, dur: 0.06, vol: 0.18, filter: 'highpass' },
      { wave: 'square', freq: 1600, to: 200, dur: 0.08, vol: 0.06 },
    ],
    gap: 90,
  },
  gun: { tones: [{ wave: 'noise', freq: 3000, dur: 0.03, vol: 0.09, filter: 'bandpass', q: 2 }], gap: 45 },
  nuke: {
    tones: [
      { wave: 'sine', freq: 70, to: 22, dur: 2.6, vol: 0.6 },
      { wave: 'noise', freq: 500, to: 60, dur: 2.8, vol: 0.5, filter: 'lowpass' },
      { wave: 'noise', freq: 4000, to: 300, dur: 0.6, vol: 0.25, filter: 'bandpass', q: 0.7 },
    ],
    gap: 1500,
  },
  groan: {
    tones: [
      { wave: 'sawtooth', freq: 110, to: 70, dur: 0.6, vol: 0.09, attack: 0.08 },
      { wave: 'sawtooth', freq: 116, to: 66, dur: 0.6, vol: 0.06, attack: 0.1 },
      { wave: 'noise', freq: 400, to: 200, dur: 0.5, vol: 0.06, filter: 'lowpass' },
    ],
    gap: 700,
  },
  // Blasts and magic.
  fire: { tones: [{ wave: 'noise', freq: 1400, to: 600, dur: 0.3, vol: 0.14, filter: 'bandpass', q: 0.8 }], gap: 120 },
  frost: {
    tones: [
      { wave: 'triangle', freq: 1760, dur: 0.35, vol: 0.05 },
      { wave: 'triangle', freq: 2217, dur: 0.35, vol: 0.04, delay: 0.04 },
      { wave: 'triangle', freq: 2637, dur: 0.35, vol: 0.03, delay: 0.08 },
    ],
    gap: 250,
  },
  heal: {
    tones: [
      { wave: 'sine', freq: 784, dur: 0.18, vol: 0.06 },
      { wave: 'sine', freq: 988, dur: 0.18, vol: 0.06, delay: 0.07 },
      { wave: 'sine', freq: 1175, dur: 0.25, vol: 0.06, delay: 0.14 },
    ],
    gap: 300,
  },
  // Fighting.
  clang: {
    tones: [
      { wave: 'triangle', freq: 880, to: 700, dur: 0.06, vol: 0.08 },
      { wave: 'noise', freq: 3500, dur: 0.04, vol: 0.08, filter: 'highpass' },
    ],
    gap: 35,
  },
  thud: {
    tones: [
      { wave: 'sine', freq: 110, to: 55, dur: 0.18, vol: 0.3 },
      { wave: 'noise', freq: 600, dur: 0.12, vol: 0.2, filter: 'lowpass' },
    ],
    gap: 60,
  },
  death: { tones: [{ wave: 'square', freq: 520, to: 140, dur: 0.16, vol: 0.07 }], gap: 50 },
  thorns: { tones: [{ wave: 'noise', freq: 5000, dur: 0.05, vol: 0.06, filter: 'highpass' }], gap: 80 },
  // Rewards.
  coin: {
    tones: [
      { wave: 'square', freq: 988, dur: 0.07, vol: 0.09 },
      { wave: 'square', freq: 1319, dur: 0.18, vol: 0.09, delay: 0.07 },
    ],
    gap: 70,
  },
  treasure: {
    tones: [1047, 1319, 1568, 2093, 2637].map((f, i) => ({ wave: 'square' as const, freq: f, dur: 0.12, vol: 0.08, delay: i * 0.06 })),
    gap: 400,
  },
  ruins: {
    tones: [440, 554, 659, 880, 1109, 1319].map((f, i) => ({ wave: 'triangle' as const, freq: f, dur: 0.5, vol: 0.07, delay: i * 0.08 })),
    gap: 400,
  },
  discovery: {
    tones: [523, 659, 784, 1047].map((f, i) => ({ wave: 'triangle' as const, freq: f, dur: 0.3, vol: 0.1, delay: i * 0.09 })),
    gap: 500,
  },
  // Big moments.
  age: {
    tones: [
      ...[392, 523, 659, 784].map((f, i) => ({ wave: 'square' as const, freq: f, dur: 0.22, vol: 0.09, delay: i * 0.14 })),
      { wave: 'square', freq: 1047, dur: 0.9, vol: 0.1, delay: 0.56 },
      { wave: 'triangle', freq: 523, dur: 0.9, vol: 0.12, delay: 0.56 },
    ],
    gap: 2000,
  },
  horn: {
    tones: [
      { wave: 'sawtooth', freq: 147, dur: 0.7, vol: 0.12, attack: 0.08 },
      { wave: 'sawtooth', freq: 220, dur: 0.7, vol: 0.08, attack: 0.08 },
    ],
    gap: 1500,
  },
  warn: {
    tones: [
      { wave: 'square', freq: 660, dur: 0.15, vol: 0.12 },
      { wave: 'square', freq: 440, dur: 0.15, vol: 0.12, delay: 0.18 },
      { wave: 'square', freq: 660, dur: 0.15, vol: 0.12, delay: 0.36 },
      { wave: 'square', freq: 440, dur: 0.2, vol: 0.12, delay: 0.54 },
    ],
    gap: 3000,
  },
  fallen: {
    tones: [
      { wave: 'sine', freq: 90, to: 30, dur: 1.2, vol: 0.5 },
      { wave: 'noise', freq: 600, to: 80, dur: 1.4, vol: 0.35, filter: 'lowpass' },
      { wave: 'triangle', freq: 220, to: 110, dur: 1, vol: 0.1, delay: 0.3 },
    ],
    gap: 1000,
  },
  victory: {
    tones: [523, 659, 784, 1047, 784, 1047, 1319].map((f, i) => ({ wave: 'square' as const, freq: f, dur: i === 6 ? 1.2 : 0.18, vol: 0.1, delay: i * 0.16 })),
    gap: 3000,
  },
  defeat: {
    tones: [392, 370, 349, 262].map((f, i) => ({ wave: 'triangle' as const, freq: f, dur: i === 3 ? 1.4 : 0.35, vol: 0.14, delay: i * 0.4 })),
    gap: 3000,
  },
  // The interface.
  click: { tones: [{ wave: 'square', freq: 1200, dur: 0.025, vol: 0.05 }], gap: 30 },
  pick: { tones: [{ wave: 'triangle', freq: 880, to: 1320, dur: 0.08, vol: 0.08 }], gap: 30 },
};

/** Where a sound happens, in cells; and how far the view reaches, for falling off with distance. */
export interface Listener {
  x: number;
  y: number;
  /** Half the width of the view, in cells. */
  reach: number;
  /** The map's size, for measuring across the seam of a looping map (0 = flat map). */
  wrapW: number;
  wrapH: number;
}

export class SoundSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private lastPlayed = new Map<string, number>();
  private voices = 0;
  readonly settings: AudioSettings;
  readonly music = new Music();

  constructor() {
    this.settings = { music: 0.5, sfx: 0.7 };
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
      if (saved && typeof saved.music === 'number' && typeof saved.sfx === 'number') Object.assign(this.settings, saved);
    } catch {
      // No storage (private window): use the defaults.
    }
  }

  /** Browsers only allow sound after the player has clicked or pressed a key: start then. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.connect(this.master);
      // One second of white noise, reused by every noisy sound.
      const length = this.ctx.sampleRate;
      this.noiseBuffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      this.music.attach(this.ctx, this.master);
      this.applyVolumes();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setVolumes(music: number, sfx: number): void {
    this.settings.music = music;
    this.settings.sfx = sfx;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // Not saved: fine.
    }
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx || !this.sfxBus) return;
    this.sfxBus.gain.setTargetAtTime(this.settings.sfx, this.ctx.currentTime, 0.05);
    this.music.setVolume(this.settings.music);
  }

  /**
   * Play a named sound. With a position and a listener, it fades with distance from the view
   * and is skipped altogether when far off screen.
   */
  play(name: string, volume = 1, at?: { x: number; y: number }, listener?: Listener): void {
    const ctx = this.ctx;
    const sound = SOUNDS[name];
    if (!ctx || !this.sfxBus || !sound || this.settings.sfx <= 0) return;
    let gain = volume;
    if (at && listener) {
      let dx = Math.abs(at.x - listener.x);
      let dy = Math.abs(at.y - listener.y);
      if (listener.wrapW > 0) dx = Math.min(dx, listener.wrapW - dx);
      if (listener.wrapH > 0) dy = Math.min(dy, listener.wrapH - dy);
      const d = Math.hypot(dx, dy);
      const reach = Math.max(4, listener.reach);
      if (d > reach * 2) return;
      if (d > reach) gain *= 1 - (d - reach) / reach;
    }
    if (gain <= 0.02) return;
    const now = performance.now();
    if (now - (this.lastPlayed.get(name) ?? -Infinity) < sound.gap) return;
    // Never more than a couple of dozen voices at once.
    if (this.voices > 24) return;
    this.lastPlayed.set(name, now);
    const t0 = ctx.currentTime + 0.005;
    // A touch of random pitch so repeats do not sound mechanical.
    const detune = 1 + (Math.random() - 0.5) * 0.06;
    for (const tone of sound.tones) this.voice(ctx, tone, t0, gain, detune);
  }

  private voice(ctx: AudioContext, tone: Tone, t0: number, gain: number, detune: number): void {
    const start = t0 + (tone.delay ?? 0);
    const end = start + tone.dur;
    const env = ctx.createGain();
    const attack = tone.attack ?? 0.004;
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, tone.vol * gain), start + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    env.connect(this.sfxBus as GainNode);
    let source: AudioScheduledSourceNode;
    if (tone.wave === 'noise') {
      const noise = ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      noise.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = tone.filter ?? 'lowpass';
      filter.Q.value = tone.q ?? 0.7;
      filter.frequency.setValueAtTime(tone.freq * detune, start);
      if (tone.to) filter.frequency.exponentialRampToValueAtTime(tone.to * detune, end);
      noise.connect(filter);
      filter.connect(env);
      source = noise;
    } else {
      const osc = ctx.createOscillator();
      osc.type = tone.wave;
      osc.frequency.setValueAtTime(tone.freq * detune, start);
      if (tone.to) osc.frequency.exponentialRampToValueAtTime(tone.to * detune, end);
      osc.connect(env);
      source = osc;
    }
    this.voices++;
    source.onended = () => {
      this.voices--;
      env.disconnect();
    };
    source.start(start);
    source.stop(end + 0.02);
  }
}
