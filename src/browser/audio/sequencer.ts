// Lookahead music player. The engine calls scheduleUntil() from a ~25ms timer; each
// call schedules every sixteenth step that starts before the horizon. Variation is a
// pure function of (pass, bar, step), so the same session always sounds the same:
//   - odd passes swap in the alternate lead lines,
//   - every third pass opens with a "breakdown" (no lead, hats only, alternate arpeggio),
//   - section-ending bars get a drum fill picked by hash, plus hashed ghost hats.

import { chordTone, mix, type CompiledSong } from './song.ts';
import { midiToFreq, noise, thump, tone, type SynthOut } from './synth.ts';

export class SongPlayer {
  readonly out: SynthOut;
  readonly gain: GainNode;
  private readonly echoNodes: AudioNode[];
  private readonly echoIn: GainNode;
  private step = 0;
  private pass = 0;
  private nextTime: number;
  /** When set, the player is fading out and is dropped once the clock passes it. */
  stopAt: number | null = null;
  notes = 0;

  constructor(readonly song: CompiledSong, out: SynthOut, readonly mood: string, start: number) {
    const { ctx } = out;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(out.dest);
    this.out = { ctx, bank: out.bank, dest: this.gain };
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
    damp.connect(this.gain);
    this.echoNodes = [this.echoIn, delay, feedback, damp];
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

    if (!breakdown) {
      const notes = alt ? bar.leadAlt : bar.lead;
      const note = notes[s];
      if (note >= 0) {
        const length = (alt ? bar.leadAltLen : bar.leadLen)[s] * stepSeconds;
        const lead = data.lead;
        tone(this.out, time, midiToFreq(note), length * 0.9, {
          wave: lead.wave, gain: lead.gain, attack: lead.attack, decay: lead.decay, sustain: lead.sustain,
          release: lead.release, vibrato: length > 0.3 ? lead.vibrato : 0, vibratoDelay: 0.18,
          send: this.echoIn, sendLevel: lead.echo,
        });
        this.notes++;
      }
    }

    const arp = data.arp;
    const index = (alt || breakdown ? arp.patternAlt : arp.pattern)[s];
    if (index >= 0) {
      tone(this.out, time, midiToFreq(chordTone(chord, arp.low, index)), arp.steps * stepSeconds, {
        wave: arp.wave, gain: arp.gain, attack: arp.attack, decay: arp.decay, sustain: arp.sustain, release: arp.release,
      });
      this.notes++;
    }

    const bass = data.bass;
    const symbol = bass.pattern[s];
    if (bassLen[s] > 0) {
      const size = chord.intervals.length;
      const toneIndex = symbol === 'T' ? 1 : symbol === 'F' ? 2 : symbol === 'O' ? size : 0;
      tone(this.out, time, midiToFreq(chordTone(chord, bass.low, toneIndex)), bassLen[s] * stepSeconds * 0.92, {
        wave: bass.wave, gain: bass.gain, attack: bass.attack, decay: bass.decay, sustain: bass.sustain, release: bass.release,
      });
      this.notes++;
    }

    const drums = data.drums;
    if (!drums) return;
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
    if (kick !== '.') { thump(this.out, time, 150, 42, 0.2, g * (kick === 'x' ? 0.9 : 0.45)); this.notes++; }
    if (snare !== '.') {
      const level = snare === 'x' ? 1 : 0.4;
      noise(this.out, time, 0.12, { filter: 'bandpass', freq: 1900, q: 0.7, gain: g * 0.5 * level });
      tone(this.out, time, 196, 0.03, { wave: 'triangle', gain: g * 0.3 * level, decay: 0.03, sustain: 0.1, release: 0.04 });
      this.notes++;
    }
    if (hat !== '.') {
      noise(this.out, time, hat === 'x' ? 0.045 : 0.025, { filter: 'highpass', freq: 7000, q: 0.5, gain: g * (hat === 'x' ? 0.22 : 0.1) });
      this.notes++;
    }
  }
}
