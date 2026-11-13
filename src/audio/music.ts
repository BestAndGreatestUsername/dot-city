// The soundtrack: a little chiptune band that plays a different piece for each age, and turns
// tense (louder drums, a driving low pulse) while the player is under attack.
//
//   Medieval    D dorian, 84 bpm: a flute-like tune over a drone, plucked strings, a frame drum.
//               Old and a little magical.
//   Gunpowder   G major, 100 bpm: a fife march with snare rolls.
//   Industrial  A minor, 112 bpm: a pulse lead over pumping bass, rock drums.
//   Modern      E minor, 124 bpm: a synth lead, fast arpeggios, a four-on-the-floor beat.
//
// Each piece is composed once, from a fixed seed: an 8-bar loop of chords, bass, arpeggio and
// a melody whose phrases repeat and answer each other, so it sounds written rather than random.

interface Style {
  bpm: number;
  /** MIDI note of the key's root, in the melody's octave. */
  root: number;
  /** The scale, in semitones above the root. */
  scale: number[];
  /** The chords, as scale degrees, one per bar (4 bars, played twice). */
  progression: number[];
  lead: OscillatorType;
  leadVol: number;
  /** A held drone on the root and fifth (medieval). */
  drone: boolean;
  /** How busy the arpeggio is: notes per beat (0 = none). */
  arpRate: number;
  arpWave: OscillatorType;
  drums: 'frame' | 'march' | 'rock' | 'synth';
}

const STYLES: Style[] = [
  { bpm: 84, root: 62, scale: [0, 2, 3, 5, 7, 9, 10], progression: [0, 6, 3, 4], lead: 'triangle', leadVol: 0.16, drone: true, arpRate: 2, arpWave: 'square', drums: 'frame' },
  { bpm: 100, root: 67, scale: [0, 2, 4, 5, 7, 9, 11], progression: [0, 3, 4, 0], lead: 'square', leadVol: 0.07, drone: false, arpRate: 2, arpWave: 'triangle', drums: 'march' },
  { bpm: 112, root: 69, scale: [0, 2, 3, 5, 7, 8, 10], progression: [0, 5, 2, 6], lead: 'square', leadVol: 0.06, drone: false, arpRate: 2, arpWave: 'square', drums: 'rock' },
  { bpm: 124, root: 64, scale: [0, 2, 3, 5, 7, 8, 10], progression: [0, 5, 3, 4], lead: 'sawtooth', leadVol: 0.05, drone: false, arpRate: 4, arpWave: 'square', drums: 'synth' },
];

function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/** A tiny seeded random generator, so each age's piece is the same every game. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A melody note: scale step (relative to the root, may be negative or past an octave), or null for a rest. */
type Melody = Array<number | null>;

/**
 * Compose 8 bars of melody, 8 eighth-notes a bar: phrase A (bars 1-2), its answer B (3-4),
 * A again (5-6), and a closing phrase C (7-8) that comes home to the root.
 */
function compose(style: Style, seed: number): Melody {
  const rand = rng(seed);
  const phrase = (bars: number[], end: number | null): Melody => {
    const out: Melody = [];
    let step = style.progression[bars[0]] + (rand() < 0.5 ? 2 : 4);
    for (let b = 0; b < bars.length; b++) {
      const chord = style.progression[bars[b]];
      for (let i = 0; i < 8; i++) {
        // Strong beats land on a chord tone; in between the tune walks by step, or rests.
        if (i % 4 === 0) {
          const tones = [chord, chord + 2, chord + 4];
          let best = tones[0];
          for (const tone of tones) if (Math.abs(tone - step) < Math.abs(best - step)) best = tone;
          step = best;
          out.push(step);
        } else if (rand() < 0.22) {
          out.push(null);
        } else {
          step += rand() < 0.5 ? -1 : 1;
          if (rand() < 0.15) step += rand() < 0.5 ? -2 : 2;
          step = Math.max(-3, Math.min(9, step));
          out.push(step);
        }
      }
    }
    if (end !== null) out[out.length - 2] = end;
    out[out.length - 1] = null;
    return out;
  };
  const a = phrase([0, 1], null);
  const b = phrase([2, 3], null);
  const c = phrase([2, 3], 0);
  return [...a, ...b, ...a, ...c];
}

export class Music {
  private ctx: AudioContext | null = null;
  private bus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private timer = 0;
  private nextTime = 0;
  /** Sixteenth-note counter. */
  private step = 0;
  private age = 1;
  /** The age the band is playing now: it switches only at the top of a bar. */
  private playing = 1;
  private tension = 0;
  private volume = 0.5;
  private paused = false;
  private readonly melodies: Melody[] = STYLES.map((s, i) => compose(s, 1009 + i * 7919));

  attach(ctx: AudioContext, destination: AudioNode): void {
    this.ctx = ctx;
    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    this.bus.connect(destination);
    const length = Math.floor(ctx.sampleRate * 0.5);
    this.noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.nextTime = ctx.currentTime + 0.1;
    this.applyGain();
    // The scheduler: every 25 ms, line up the notes of the next 150 ms.
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  setVolume(v: number): void {
    this.volume = v;
    this.applyGain();
  }

  /** The age to play (1-4). The band changes piece at the start of the next bar. */
  setAge(age: number): void {
    this.age = Math.max(1, Math.min(STYLES.length, age));
  }

  /** 0 = peace, 1 = under attack. */
  setTension(t: number): void {
    this.tension = Math.max(0, Math.min(1, t));
  }

  /** While the game is paused the music plays on, quieter. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.applyGain();
  }

  private applyGain(): void {
    if (!this.ctx || !this.bus) return;
    const level = this.volume * 0.55 * (this.paused ? 0.45 : 1);
    this.bus.gain.setTargetAtTime(level, this.ctx.currentTime, 0.4);
  }

  stop(): void {
    window.clearInterval(this.timer);
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || this.volume <= 0) {
      if (ctx) this.nextTime = ctx.currentTime + 0.1;
      return;
    }
    // After a long stall (a hidden tab), start again from now rather than catching up.
    if (this.nextTime < ctx.currentTime - 0.5) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + 0.15) {
      if (this.step % 16 === 0) this.playing = this.age;
      const style = STYLES[this.playing - 1];
      this.playStep(style, this.melodies[this.playing - 1], this.step, this.nextTime);
      this.nextTime += 60 / style.bpm / 4;
      this.step = (this.step + 1) % (16 * 8);
    }
  }

  private playStep(style: Style, melody: Melody, step: number, t: number): void {
    const sixteenth = 60 / style.bpm / 4;
    const bar = Math.floor(step / 16) % 8;
    const inBar = step % 16;
    const chordDegree = style.progression[bar % 4];
    const noteOf = (degree: number, octave = 0) => {
      const n = style.scale.length;
      const wrapped = ((degree % n) + n) % n;
      const oct = Math.floor(degree / n) + octave;
      return style.root + style.scale[wrapped] + 12 * oct;
    };
    const tense = this.tension > 0.3;

    // The drone (medieval): root and fifth, renewed every bar.
    if (style.drone && inBar === 0) {
      this.note(midiToFreq(noteOf(0, -2)), t, sixteenth * 16, 'sawtooth', 0.025, 600);
      this.note(midiToFreq(noteOf(4, -2)), t, sixteenth * 16, 'sawtooth', 0.02, 600);
    }
    // Bass: the chord's root on the beat (pumping eighths in the later ages, or when tense).
    const pump = this.playing >= 3 || tense;
    if (inBar % (pump ? 2 : 8) === 0) {
      this.note(midiToFreq(noteOf(chordDegree, -2)), t, sixteenth * (pump ? 1.6 : 7), 'triangle', 0.22, 0);
    }
    // Arpeggio: the chord's notes, up and down.
    if (style.arpRate > 0 && inBar % (16 / (style.arpRate * 4)) === 0) {
      const tones = [0, 2, 4, 2];
      const k = Math.floor(inBar / (16 / (style.arpRate * 4))) % tones.length;
      this.note(midiToFreq(noteOf(chordDegree + tones[k], -1)), t, sixteenth * 1.2, style.arpWave, 0.035, 2400);
    }
    // Melody: eighth notes.
    if (inBar % 2 === 0) {
      const m = melody[bar * 8 + inBar / 2];
      if (m !== null && m !== undefined) {
        const next = melody[bar * 8 + inBar / 2 + 1];
        const length = next === null ? 3.6 : 1.8;
        this.note(midiToFreq(noteOf(m)), t, sixteenth * length, style.lead, style.leadVol, style.lead === 'sawtooth' ? 2200 : 0, this.playing === 1 ? 0.02 : 0);
      }
    }
    this.drums(style.drums, inBar, t, tense);
  }

  private drums(kit: Style['drums'], i: number, t: number, tense: boolean): void {
    switch (kit) {
      case 'frame':
        // A frame drum on the bar, and a tambourine shake when trouble comes.
        if (i === 0 || i === 10) this.kick(t, 0.25, 90);
        if (tense && i % 2 === 0) this.hat(t, 0.02);
        break;
      case 'march':
        if (i === 0 || i === 8) this.kick(t, 0.3);
        if (i === 4 || i === 12) this.snare(t, 0.12);
        // A snare roll into each bar.
        if (i >= 13 && (tense || i % 2 === 1)) this.snare(t, 0.05);
        break;
      case 'rock':
        if (i === 0 || i === 6 || i === 8) this.kick(t, 0.32);
        if (i === 4 || i === 12) this.snare(t, 0.14);
        if (i % 2 === 0 || tense) this.hat(t, 0.025);
        break;
      case 'synth':
        if (i % 4 === 0) this.kick(t, 0.34);
        if (i === 4 || i === 12) this.snare(t, 0.12);
        if (i % 4 === 2 || (tense && i % 2 === 1)) this.hat(t, 0.035);
        break;
    }
  }

  private note(freq: number, t: number, dur: number, wave: OscillatorType, vol: number, lowpass: number, vibrato = 0): void {
    const ctx = this.ctx as AudioContext;
    const osc = ctx.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, t);
    if (vibrato > 0) {
      // A gentle flute-like waver.
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = 5.5;
      depth.gain.value = freq * vibrato;
      lfo.connect(depth);
      depth.connect(osc.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.05);
    }
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    env.gain.setValueAtTime(vol * 0.8, t + dur * 0.6);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let out: AudioNode = osc;
    if (lowpass > 0) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = lowpass;
      osc.connect(filter);
      out = filter;
    }
    out.connect(env);
    env.connect(this.bus as GainNode);
    osc.start(t);
    osc.stop(t + dur + 0.05);
    osc.onended = () => env.disconnect();
  }

  private kick(t: number, vol: number, from = 150): void {
    const ctx = this.ctx as AudioContext;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    const env = ctx.createGain();
    env.gain.setValueAtTime(vol, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(env);
    env.connect(this.bus as GainNode);
    osc.start(t);
    osc.stop(t + 0.2);
    osc.onended = () => env.disconnect();
  }

  private noiseHit(t: number, vol: number, dur: number, type: BiquadFilterType, freq: number): void {
    const ctx = this.ctx as AudioContext;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const env = ctx.createGain();
    env.gain.setValueAtTime(vol, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(env);
    env.connect(this.bus as GainNode);
    src.start(t);
    src.stop(t + dur + 0.02);
    src.onended = () => env.disconnect();
  }

  private snare(t: number, vol: number): void {
    this.noiseHit(t, vol, 0.12, 'bandpass', 1800);
  }

  private hat(t: number, vol: number): void {
    this.noiseHit(t, vol, 0.04, 'highpass', 7000);
  }
}
