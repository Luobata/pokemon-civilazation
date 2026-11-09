// Lookahead music player. The engine calls scheduleUntil() from a ~25ms timer; each
// call schedules every sixteenth step that starts before the horizon. Variation is a
// pure function of (pass, bar, step), so the same session always sounds the same:
//   - odd passes swap in the alternate lead lines,
//   - every third pass opens with a "breakdown" (no lead, hats only, alternate arpeggio),
//   - section-ending bars get a drum fill picked by hash, plus hashed ghost hats.
// A3: each voice (lead, arp, bass, drums, accent) plays through its own gain, so the engine can bring layers in
// and out with the music's intensity. Changes ramp over a second or more (no clicks); a layer that is silent
// once its ramp has ended schedules no voices at all.

import { chordTone, mix, type CompiledSong } from './song.ts';
import { midiToFreq, noise, thump, tone, type SynthOut } from './synth.ts';

/** Gain of each voice layer, 0 (out) to about 1.2. */
export type LayerLevels = { lead: number; arp: number; bass: number; drums: number; accent: number };
export const LAYER_NAMES = ['lead', 'arp', 'bass', 'drums', 'accent'] as const;
type Layer = typeof LAYER_NAMES[number];

export class SongPlayer {
  readonly out: SynthOut;
  readonly gain: GainNode;
  private readonly layers: Record<Layer, { gain: GainNode; out: SynthOut; target: number; until: number }>;
  private readonly echoNodes: AudioNode[];
  private readonly echoIn: GainNode;
  private step = 0;
  private pass = 0;
  private nextTime: number;
  /** When set, the player is fading out and is dropped once the clock passes it. */
  stopAt: number | null = null;
  notes = 0;

  constructor(readonly song: CompiledSong, out: SynthOut, readonly mood: string, start: number, levels?: LayerLevels) {
    const { ctx } = out;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(out.dest);
    this.out = { ctx, bank: out.bank, dest: this.gain };
    const layer = (name: Layer) => {
      const gain = ctx.createGain();
      gain.gain.value = levels?.[name] ?? (name === 'accent' ? 0 : 1);
      gain.connect(this.gain);
      return { gain, out: { ctx, bank: out.bank, dest: gain }, target: gain.gain.value, until: 0 };
    };
    this.layers = { lead: layer('lead'), arp: layer('arp'), bass: layer('bass'), drums: layer('drums'), accent: layer('accent') };
    // Dotted-eighth echo on the lead: delay -> darkening filter -> feedback loop.
    this.echoIn = ctx.createGain();
    const delay = ctx.createDelay(2);
    delay.delayTime.value = song.stepSeconds * 3;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.3;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 2200;
    this.echoIn.connect(delay);
    delay.connect(damp);
    damp.connect(feedback);
    feedback.connect(delay);
    damp.connect(this.layers.lead.gain);
    this.echoNodes = [this.echoIn, delay, feedback, damp, ...LAYER_NAMES.map(name => this.layers[name].gain)];
    this.nextTime = start;
  }

  scheduleUntil(horizon: number, now: number, silent: boolean): void {
    // If the timer stalled (busy main thread), skip the missed steps instead of bursting.
    if (this.nextTime < now - 0.05) {
      const missed = Math.ceil((now - this.nextTime) / this.song.stepSeconds);
      for (let i = 0; i < missed; i++) this.advance();
      this.nextTime += missed * this.song.stepSeconds;
    }
    while (this.nextTime < horizon) {
      if (!silent) this.scheduleStep(this.nextTime);
      this.advance();
      this.nextTime += this.song.stepSeconds;
    }
  }

  /** Ramps every layer to `levels` over `seconds` (linear, from the current value: no clicks). */
  setLayers(levels: LayerLevels, now: number, seconds: number): void {
    for (const name of LAYER_NAMES) {
      const layer = this.layers[name], param = layer.gain.gain;
      if (layer.target === levels[name]) continue;
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
      param.linearRampToValueAtTime(levels[name], now + seconds);
      layer.target = levels[name];
      layer.until = now + seconds;
    }
  }

  /** Target level of each layer (diagnostics). */
  layerLevels(): LayerLevels {
    return { lead: this.layers.lead.target, arp: this.layers.arp.target, bass: this.layers.bass.target, drums: this.layers.drums.target, accent: this.layers.accent.target };
  }

  /** The layer's output, or null when it is silent at `time` (fully faded out): its voices are skipped. */
  private layerOut(name: Layer, time: number): SynthOut | null {
    const layer = this.layers[name];
    return layer.target > 0 || time < layer.until ? layer.out : null;
  }

  dispose(): void {
    this.gain.disconnect();
    for (const node of this.echoNodes) node.disconnect();
  }

  private advance(): void {
    this.step++;
    if (this.step >= this.song.bars.length * 16) {
      this.step = 0;
      this.pass++;
    }
  }

  private scheduleStep(time: number): void {
    const { data, bars, stepSeconds, bassLen } = this.song;
    const barIndex = this.step >> 4;
    const s = this.step & 15;
    const bar = bars[barIndex];
    const chord = s < 8 ? bar.chordA : bar.chordB;
    const alt = (this.pass & 1) === 1;
    const breakdown = this.pass % 3 === 2 && bar.formIndex === 0;

    const leadOut = this.layerOut('lead', time);
    if (!breakdown && leadOut) {
      const notes = alt ? bar.leadAlt : bar.lead;
      const note = notes[s];
      if (note >= 0) {
        const length = (alt ? bar.leadAltLen : bar.leadLen)[s] * stepSeconds;
        const lead = data.lead;
        tone(leadOut, time, midiToFreq(note), length * 0.9, {
          wave: lead.wave, gain: lead.gain, attack: lead.attack, decay: lead.decay, sustain: lead.sustain,
          release: lead.release, vibrato: length > 0.3 ? lead.vibrato : 0, vibratoDelay: 0.18,
          send: this.echoIn, sendLevel: lead.echo,
        });
        this.notes++;
      }
    }

    const arp = data.arp;
    const index = (alt || breakdown ? arp.patternAlt : arp.pattern)[s];
    const arpOut = this.layerOut('arp', time);
    if (index >= 0 && arpOut) {
      tone(arpOut, time, midiToFreq(chordTone(chord, arp.low, index)), arp.steps * stepSeconds, {
        wave: arp.wave, gain: arp.gain, attack: arp.attack, decay: arp.decay, sustain: arp.sustain, release: arp.release,
      });
      this.notes++;
    }

    const bass = data.bass;
    const symbol = bass.pattern[s];
    const bassOut = this.layerOut('bass', time);
    if (bassLen[s] > 0 && bassOut) {
      const size = chord.intervals.length;
      const toneIndex = symbol === 'T' ? 1 : symbol === 'F' ? 2 : symbol === 'O' ? size : 0;
      tone(bassOut, time, midiToFreq(chordTone(chord, bass.low, toneIndex)), bassLen[s] * stepSeconds * 0.92, {
        wave: bass.wave, gain: bass.gain, attack: bass.attack, decay: bass.decay, sustain: bass.sustain, release: bass.release,
      });
      this.notes++;
    }

    const accent = data.accent, accentOut = accent ? this.layerOut('accent', time) : null;
    if (accent && accentOut) {
      const g = accent.gain;
      // Low tom, a tight snare roll and a bright ride: original accent kit for the top of the intensity range.
      if (accent.kick[s] !== '.') { thump(accentOut, time, 110, 58, 0.18, g * (accent.kick[s] === 'x' ? 0.8 : 0.4)); this.notes++; }
      if (accent.snare[s] !== '.') {
        noise(accentOut, time, 0.05, { filter: 'bandpass', freq: 2600, q: 1.1, gain: g * (accent.snare[s] === 'x' ? 0.42 : 0.2) });
        this.notes++;
      }
      if (accent.hat[s] !== '.') {
        noise(accentOut, time, 0.22, { filter: 'highpass', freq: 5200, q: 0.4, gain: g * (accent.hat[s] === 'x' ? 0.16 : 0.08) });
        this.notes++;
      }
    }

    const drums = data.drums, drumOut = this.layerOut('drums', time);
    if (!drums || !drumOut) return;
    let kick = drums.kick[s];
    let snare = drums.snare[s];
    let hat = drums.hat[s];
    if (bar.sectionEnd && s >= 12 && !breakdown && drums.fills.length > 0) {
      const fill = drums.fills[mix(this.pass, barIndex) % drums.fills.length];
      kick = fill.kick[s - 12];
      snare = fill.snare[s - 12];
      hat = fill.hat[s - 12];
    }
    if (breakdown) { kick = '.'; snare = '.'; }
    if (hat === '.' && drums.ghostEvery > 0 && mix(this.pass * 131 + barIndex, s) % drums.ghostEvery === 0) hat = 'o';
    const g = drums.gain;
    if (kick !== '.') { thump(drumOut, time, 150, 42, 0.2, g * (kick === 'x' ? 0.9 : 0.45)); this.notes++; }
    if (snare !== '.') {
      const level = snare === 'x' ? 1 : 0.4;
      noise(drumOut, time, 0.12, { filter: 'bandpass', freq: 1900, q: 0.7, gain: g * 0.5 * level });
      tone(drumOut, time, 196, 0.03, { wave: 'triangle', gain: g * 0.3 * level, decay: 0.03, sustain: 0.1, release: 0.04 });
      this.notes++;
    }
    if (hat !== '.') {
      noise(drumOut, time, hat === 'x' ? 0.045 : 0.025, { filter: 'highpass', freq: 7000, q: 0.5, gain: g * (hat === 'x' ? 0.22 : 0.1) });
      this.notes++;
    }
  }
}
