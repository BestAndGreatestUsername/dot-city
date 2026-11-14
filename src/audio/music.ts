// The soundtrack: a little chiptune band that plays a different piece for each age, and turns
// tense (louder drums, a driving low pulse) while the player is under attack.
//
// Every piece is a 16-bar song: an 8-bar verse and an 8-bar chorus. The tune is built from a
// one-bar hook that repeats and answers itself (that is what makes a melody stick), and the
// chorus lifts it higher with a harmony line, fast arpeggios and bigger drums.
//
//   Medieval    D dorian, 116 bpm: folk-rock. Flute-like lead over a drone, galloping bass,
//               frame drum and tambourine. Old, a little magical, and it moves.
//   Gunpowder   G major, 124 bpm: a fife-and-drum march with snare rolls.
//   Industrial  A minor, 130 bpm: a pulse lead over pumping bass and rock drums.
//   Modern      E minor, 138 bpm: a synth lead, racing arpeggios, four-on-the-floor.

interface Style {
  bpm: number;
  /** MIDI note of the key's root, in the melody's octave. */
  root: number;
  /** The scale, in semitones above the root. */
  scale: number[];
  /** Chords for the verse and the chorus, as scale degrees, one per bar (4 bars, played twice). */
  verse: number[];
  chorus: number[];
  lead: OscillatorType;
  leadVol: number;
  /** A held drone on the root and fifth (medieval). */
  drone: boolean;
  arpWave: OscillatorType;
  /** Bass pattern: 'gallop' (da-da-dum), 'pump' (straight eighths) or 'octave' (root and octave). */
  bass: 'gallop' | 'pump' | 'octave';
  drums: 'folk' | 'march' | 'rock' | 'synth';
  /** Seed for composing this piece. */
  seed: number;
}

const STYLES: Style[] = [
  { bpm: 116, root: 62, scale: [0, 2, 3, 5, 7, 9, 10], verse: [0, 6, 3, 4], chorus: [3, 0, 6, 4], lead: 'triangle', leadVol: 0.2, drone: true, arpWave: 'square', bass: 'gallop', drums: 'folk', seed: 7 },
  { bpm: 124, root: 67, scale: [0, 2, 4, 5, 7, 9, 11], verse: [0, 3, 4, 0], chorus: [5, 3, 0, 4], lead: 'square', leadVol: 0.075, drone: false, arpWave: 'triangle', bass: 'octave', drums: 'march', seed: 23 },
  { bpm: 130, root: 69, scale: [0, 2, 3, 5, 7, 8, 10], verse: [0, 5, 2, 6], chorus: [5, 6, 0, 4], lead: 'square', leadVol: 0.07, drone: false, arpWave: 'square', bass: 'pump', drums: 'rock', seed: 41 },
  { bpm: 138, root: 64, scale: [0, 2, 3, 5, 7, 8, 10], verse: [0, 5, 3, 4], chorus: [5, 3, 0, 6], lead: 'sawtooth', leadVol: 0.055, drone: false, arpWave: 'square', bass: 'octave', drums: 'synth', seed: 59 },
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

/** One note per eighth: a scale step (from the root), or null for a rest. 8 a bar, 16 bars. */
type Melody = Array<number | null>;

/**
 * A one-bar hook: which eighths sound, and how the tune moves between them. Strong beats
 * always sound; the rest follow a catchy rhythm.
 */
function hook(rand: () => number): { hits: boolean[]; moves: number[] } {
  const rhythms = [
    [1, 0, 1, 1, 1, 0, 1, 0],
    [1, 1, 0, 1, 1, 0, 1, 1],
    [1, 0, 1, 0, 1, 1, 1, 0],
    [1, 1, 1, 0, 1, 0, 1, 1],
  ];
  const hits = rhythms[Math.floor(rand() * rhythms.length)].map((v) => v === 1);
  const moves: number[] = [];
  for (let i = 0; i < 8; i++) moves.push(rand() < 0.15 ? 2 * (rand() < 0.5 ? -1 : 1) : rand() < 0.5 ? -1 : 1);
  return { hits, moves };
}

/**
 * Compose the song. Each bar plays the hook, landing on a tone of that bar's chord, so the
 * same little figure is heard again and again over changing harmony. Every fourth bar answers
 * with a held note. The chorus uses its own hook, an octave-ish higher.
 */
function compose(style: Style): Melody {
  const rand = rng(style.seed);
  const verseHook = hook(rand);
  const chorusHook = hook(rand);
  const out: Melody = [];
  for (let bar = 0; bar < 16; bar++) {
    const chorus = bar >= 8;
    const chords = chorus ? style.chorus : style.verse;
    const chord = chords[bar % 4];
    const { hits, moves } = chorus ? chorusHook : verseHook;
    // Start on a chord tone near the middle of the range (higher in the chorus).
    let step = chord + (chorus ? 4 : 2);
    if (step > 9) step -= 7;
    const answer = bar % 4 === 3;
    for (let i = 0; i < 8; i++) {
      if (answer && i >= 4) {
        // The answer: a long note home on the chord's root, then a breath.
        out.push(i === 4 ? chord + (chorus ? 7 : 0) : null);
        continue;
      }
      if (!hits[i]) {
        out.push(null);
        continue;
      }
      if (i > 0) step += moves[i];
      step = Math.max(-2, Math.min(11, step));
      out.push(step);
    }
  }
  return out;
}

export class Music {
  private ctx: AudioContext | null = null;
  private bus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private timer = 0;
  private nextTime = 0;
  /** Sixteenth-note counter over the 16-bar song. */
  private step = 0;
  private age = 1;
  /** The age the band is playing now: it switches only at the top of a bar. */
  private playing = 1;
  private tension = 0;
  private volume = 0.5;
  private paused = false;
  private readonly melodies: Melody[] = STYLES.map((s) => compose(s));

  attach(ctx: AudioContext, destination: AudioNode): void {
    this.ctx = ctx;
    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    // A touch of compression glues the band together and makes it punchier.
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -18;
    glue.ratio.value = 4;
    glue.attack.value = 0.005;
    glue.release.value = 0.15;
    this.bus.connect(glue);
    glue.connect(destination);
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
    const level = this.volume * 0.6 * (this.paused ? 0.45 : 1);
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
      if (this.step % 16 === 0) {
        // A new age starts its piece from the top.
        if (this.playing !== this.age) this.step = 0;
        this.playing = this.age;
      }
      const style = STYLES[this.playing - 1];
      this.playStep(style, this.melodies[this.playing - 1], this.step, this.nextTime);
      this.nextTime += 60 / style.bpm / 4;
      this.step = (this.step + 1) % (16 * 16);
    }
  }

  private playStep(style: Style, melody: Melody, step: number, t: number): void {
    const sixteenth = 60 / style.bpm / 4;
    const bar = Math.floor(step / 16);
    const inBar = step % 16;
    const chorus = bar >= 8;
    const chords = chorus ? style.chorus : style.verse;
    const chordDegree = chords[bar % 4];
    const noteOf = (degree: number, octave = 0) => {
      const n = style.scale.length;
      const wrapped = ((degree % n) + n) % n;
      const oct = Math.floor(degree / n) + octave;
      return style.root + style.scale[wrapped] + 12 * oct;
    };
    const tense = this.tension > 0.3;
    // The band plays bigger in the chorus, and when the colony is in danger.
    const big = chorus || tense;

    // The drone (medieval): root and fifth under everything.
    if (style.drone && inBar === 0) {
      this.note(midiToFreq(noteOf(0, -2)), t, sixteenth * 16, 'sawtooth', 0.03, 700);
      this.note(midiToFreq(noteOf(4, -2)), t, sixteenth * 16, 'sawtooth', 0.022, 700);
    }

    // Bass.
    const root = noteOf(chordDegree, -2);
    if (style.bass === 'gallop') {
      // Da-da-DUM, da-da-DUM: the gallop of a folk-rock bass.
      const at = inBar % 4;
      if (at === 0 || at === 2 || at === 3) this.note(midiToFreq(at === 0 ? root : root + 12 * (at === 3 ? 1 : 0)), t, sixteenth * 0.9, 'triangle', 0.26, 0);
    } else if (style.bass === 'pump') {
      if (inBar % 2 === 0) this.note(midiToFreq(root), t, sixteenth * 1.5, 'triangle', 0.26, 0);
    } else if (inBar % 2 === 0) {
      this.note(midiToFreq(inBar % 4 === 0 ? root : root + 12), t, sixteenth * 1.5, 'triangle', 0.24, 0);
    }

    // Arpeggio: eighths in the verse, racing sixteenths in the chorus.
    const every = big ? 1 : 2;
    if (inBar % every === 0) {
      const tones = [0, 2, 4, 7, 4, 2];
      const k = Math.floor(inBar / every) % tones.length;
      this.note(midiToFreq(noteOf(chordDegree + tones[k], -1)), t, sixteenth * 0.9, style.arpWave, big ? 0.04 : 0.03, 2600);
    }

    // Melody, with a harmony a third below in the chorus.
    if (inBar % 2 === 0) {
      const i = bar * 8 + inBar / 2;
      const m = melody[i];
      if (m !== null && m !== undefined) {
        const next = melody[i + 1];
        const length = next === null || next === undefined ? 3.6 : 1.8;
        const vibrato = this.playing === 1 ? 0.018 : 0;
        const lowpass = style.lead === 'sawtooth' ? 2600 : 0;
        this.note(midiToFreq(noteOf(m)), t, sixteenth * length, style.lead, style.leadVol, lowpass, vibrato);
        if (chorus) this.note(midiToFreq(noteOf(m - 2)), t, sixteenth * length, style.lead, style.leadVol * 0.55, lowpass, vibrato);
      }
    }

    this.drums(style.drums, inBar, bar, t, big);
  }

  private drums(kit: Style['drums'], i: number, bar: number, t: number, big: boolean): void {
    // The last bar of each half rolls into the next: a fill.
    const fill = (bar === 7 || bar === 15) && i >= 12;
    switch (kit) {
      case 'folk':
        // A frame drum on the beat, a slap on the backbeat, tambourine on the off-beats.
        if (i === 0 || i === 6 || i === 8 || (big && i === 14)) this.kick(t, 0.3, 110);
        if (i === 4 || i === 12) this.snare(t, 0.11, 1400);
        if (i % 2 === 1 || (big && i % 2 === 0)) this.hat(t, big ? 0.03 : 0.02, 6000);
        if (fill) this.snare(t, 0.06 + (i - 12) * 0.02, 1600);
        break;
      case 'march':
        if (i === 0 || i === 8) this.kick(t, 0.32);
        if (i === 4 || i === 12) this.snare(t, 0.13);
        if (i >= 13 || (big && i % 2 === 1)) this.snare(t, 0.05);
        if (fill) this.snare(t, 0.08);
        break;
      case 'rock':
        if (i === 0 || i === 6 || i === 8 || (big && i === 10)) this.kick(t, 0.34);
        if (i === 4 || i === 12) this.snare(t, 0.15);
        if (i % 2 === 0 || big) this.hat(t, 0.025);
        if (fill) this.snare(t, 0.08);
        break;
      case 'synth':
        if (i % 4 === 0) this.kick(t, 0.36);
        if (i === 4 || i === 12) this.snare(t, 0.13);
        if (i % 4 === 2 || (big && i % 2 === 1)) this.hat(t, 0.04);
        if (fill && i % 2 === 0) this.snare(t, 0.09);
        break;
    }
    // A crash at the top of the chorus.
    if (bar === 8 && i === 0) this.noiseHit(t, 0.08, 0.9, 'highpass', 5000);
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
    env.gain.exponentialRampToValueAtTime(vol, t + 0.01);
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
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.13);
    const env = ctx.createGain();
    env.gain.setValueAtTime(vol, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    osc.connect(env);
    env.connect(this.bus as GainNode);
    osc.start(t);
    osc.stop(t + 0.22);
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

  private snare(t: number, vol: number, freq = 1800): void {
    this.noiseHit(t, vol, 0.12, 'bandpass', freq);
    // A little tone in the snare gives it body.
    this.kick(t, vol * 0.6, 260);
  }

  private hat(t: number, vol: number, freq = 7000): void {
    this.noiseHit(t, vol, 0.04, 'highpass', freq);
  }
}
