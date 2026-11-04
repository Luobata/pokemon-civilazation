// Tiny Web Audio voice toolkit shared by the music sequencer and the sound effects.
// Every voice is a short-lived oscillator/noise source with its own envelope; nothing
// here allocates outside of the node graph a single note needs.

export type Wave = 'sine' | 'triangle' | 'square' | 'sawtooth' | 'pulse25' | 'pulse12' | 'soft';

export interface SynthOut {
  readonly ctx: AudioContext;
  readonly dest: AudioNode;
  readonly bank: WaveBank;
}

export interface ToneOptions {
  wave?: Wave;
  gain?: number;
  attack?: number;
  /** Time constant of the decay towards the sustain level. */
  decay?: number;
  /** Sustain as a fraction of the peak gain. */
  sustain?: number;
  release?: number;
  /** Glide the pitch to this frequency over the note's duration. */
  slideTo?: number;
  /** Vibrato depth in cents; starts after `vibratoDelay` seconds. */
  vibrato?: number;
  vibratoRate?: number;
  vibratoDelay?: number;
  detune?: number;
  filter?: BiquadFilterType;
  filterFreq?: number;
  filterTo?: number;
  q?: number;
  /** Optional second destination (e.g. an echo send) at the given level. */
  send?: AudioNode;
  sendLevel?: number;
}

export interface NoiseOptions {
  gain?: number;
  attack?: number;
  filter?: BiquadFilterType;
  freq?: number;
  freqTo?: number;
  q?: number;
}

export class WaveBank {
  private readonly waves = new Map<Wave, PeriodicWave>();
  readonly noise: AudioBuffer;

  constructor(private readonly ctx: AudioContext) {
    const length = Math.floor(ctx.sampleRate * 2);
    this.noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    // Deterministic LCG noise so every session sounds identical.
    let seed = 0x2f6b1d;
    for (let i = 0; i < length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      data[i] = seed / 0x80000000 - 1;
    }
  }

  apply(osc: OscillatorNode, wave: Wave): void {
    if (wave === 'sine' || wave === 'triangle' || wave === 'square' || wave === 'sawtooth') {
      osc.type = wave;
      return;
    }
    let periodic = this.waves.get(wave);
    if (!periodic) {
      periodic = wave === 'soft' ? this.soft() : this.pulse(wave === 'pulse25' ? 0.25 : 0.125);
      this.waves.set(wave, periodic);
    }
    osc.setPeriodicWave(periodic);
  }

  /** Band-limited pulse wave with the given duty cycle: the classic handheld lead. */
  private pulse(duty: number): PeriodicWave {
    const harmonics = 40;
    const real = new Float32Array(harmonics);
    const imag = new Float32Array(harmonics);
    for (let n = 1; n < harmonics; n++) {
      real[n] = Math.sin(2 * Math.PI * n * duty) / (n * Math.PI);
      imag[n] = (1 - Math.cos(2 * Math.PI * n * duty)) / (n * Math.PI);
    }
    return this.ctx.createPeriodicWave(real, imag);
  }

  /** A rounded organ-like tone: fundamental plus a few gentle partials. */
  private soft(): PeriodicWave {
    const real = new Float32Array([0, 0, 0, 0, 0, 0]);
    const imag = new Float32Array([0, 1, 0.42, 0.18, 0.08, 0.03]);
    return this.ctx.createPeriodicWave(real, imag);
  }
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Schedules one enveloped oscillator note. Returns the time the voice ends. */
export function tone(out: SynthOut, time: number, freq: number, duration: number, options: ToneOptions = {}): number {
  const { ctx } = out;
  const peak = options.gain ?? 0.3;
  const attack = Math.max(0.002, options.attack ?? 0.005);
  const decay = options.decay ?? 0.08;
  const sustain = options.sustain ?? 0.6;
  const release = Math.max(0.01, options.release ?? 0.06);
  const end = time + Math.max(duration, attack) + release;

  const osc = ctx.createOscillator();
  out.bank.apply(osc, options.wave ?? 'square');
  osc.frequency.setValueAtTime(freq, time);
  if (options.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, options.slideTo), time + Math.max(duration, 0.01));
  if (options.detune) osc.detune.setValueAtTime(options.detune, time);

  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, time);
  amp.gain.linearRampToValueAtTime(peak, time + attack);
  amp.gain.setTargetAtTime(peak * sustain, time + attack, Math.max(0.005, decay));
  amp.gain.setTargetAtTime(0, time + Math.max(duration, attack), release / 5);

  let head: AudioNode = osc;
  if (options.filter) {
    const filter = ctx.createBiquadFilter();
    filter.type = options.filter;
    filter.frequency.setValueAtTime(options.filterFreq ?? 1800, time);
    if (options.filterTo) filter.frequency.exponentialRampToValueAtTime(Math.max(20, options.filterTo), time + Math.max(duration, 0.01));
    filter.Q.value = options.q ?? 0.8;
    osc.connect(filter);
    head = filter;
  }
  head.connect(amp);
  amp.connect(out.dest);
  if (options.send) {
    const send = ctx.createGain();
    send.gain.value = options.sendLevel ?? 0.3;
    amp.connect(send);
    send.connect(options.send);
  }

  if (options.vibrato) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = options.vibratoRate ?? 5.5;
    const depth = ctx.createGain();
    const onset = time + (options.vibratoDelay ?? 0.15);
    depth.gain.setValueAtTime(0, time);
    depth.gain.setValueAtTime(0, onset);
    depth.gain.linearRampToValueAtTime(options.vibrato, onset + 0.2);
    lfo.connect(depth);
    depth.connect(osc.detune);
    lfo.start(time);
    lfo.stop(end);
  }

  osc.start(time);
  osc.stop(end);
  osc.onended = () => amp.disconnect();
  return end;
}

/** Schedules one filtered noise burst (drums, swishes, impacts). */
export function noise(out: SynthOut, time: number, duration: number, options: NoiseOptions = {}): number {
  const { ctx } = out;
  const src = ctx.createBufferSource();
  src.buffer = out.bank.noise;
  const filter = ctx.createBiquadFilter();
  filter.type = options.filter ?? 'bandpass';
  filter.frequency.setValueAtTime(options.freq ?? 2000, time);
  if (options.freqTo) filter.frequency.exponentialRampToValueAtTime(Math.max(20, options.freqTo), time + duration);
  filter.Q.value = options.q ?? 0.9;
  const amp = ctx.createGain();
  const peak = options.gain ?? 0.3;
  const attack = Math.max(0.001, options.attack ?? 0.002);
  amp.gain.setValueAtTime(0, time);
  amp.gain.linearRampToValueAtTime(peak, time + attack);
  amp.gain.exponentialRampToValueAtTime(0.0008, time + attack + duration);
  src.connect(filter);
  filter.connect(amp);
  amp.connect(out.dest);
  // Start at a deterministic offset into the buffer so consecutive hits are not identical.
  const offset = (Math.floor(time * 977) % 50) / 100;
  const end = time + attack + duration + 0.01;
  src.start(time, offset);
  src.stop(end);
  src.onended = () => amp.disconnect();
  return end;
}

/** Pitch-dropping sine: kick drums, thuds, timpani. */
export function thump(out: SynthOut, time: number, from: number, to: number, duration: number, gain: number): number {
  return tone(out, time, from, duration * 0.6, { wave: 'sine', gain, attack: 0.002, decay: duration * 0.4, sustain: 0.2, release: duration * 0.4, slideTo: to });
}
