// Original procedural sound effects. Each entry schedules a handful of voices starting
// at `t`; all are under a second except the wonder fanfare (~1.6s). `duck` dips the
// music for that many seconds so big moments cut through.

import { midiToFreq as hz, noise, thump, tone, type SynthOut } from './synth.ts';

export type SoundId =
  | 'click' | 'select' | 'move' | 'attack' | 'hit' | 'knockdown' | 'capture' | 'captureFail' | 'evolve'
  | 'cityFounded' | 'production' | 'research' | 'turn' | 'war' | 'peace' | 'promotion' | 'wonder' | 'error' | 'notify';

export interface SoundEffect {
  duck?: number;
  play(out: SynthOut, t: number): void;
}

const blip = (out: SynthOut, t: number, midi: number, dur: number, gain: number, wave: 'pulse25' | 'pulse12' | 'square' = 'pulse25') =>
  tone(out, t, hz(midi), dur, { wave, gain, attack: 0.003, decay: 0.04, sustain: 0.5, release: 0.04 });

const bell = (out: SynthOut, t: number, midi: number, gain: number, ring = 0.4) => {
  tone(out, t, hz(midi), 0.06, { wave: 'soft', gain, attack: 0.004, decay: 0.12, sustain: 0.3, release: ring });
  tone(out, t, hz(midi + 19), 0.03, { wave: 'sine', gain: gain * 0.25, attack: 0.002, decay: 0.05, sustain: 0.2, release: ring * 0.5 });
};

const brass = (out: SynthOut, t: number, midi: number, dur: number, gain: number, vibrato = 0) =>
  tone(out, t, hz(midi), dur, {
    wave: 'sawtooth', gain, attack: 0.025, decay: 0.15, sustain: 0.75, release: 0.12,
    filter: 'lowpass', filterFreq: 900, filterTo: 2600, q: 1.2, vibrato, vibratoDelay: 0.12, vibratoRate: 6,
  });

export const SOUND_EFFECTS: Record<SoundId, SoundEffect> = {
  click: { play: (o, t) => { tone(o, t, 1760, 0.016, { wave: 'pulse12', gain: 0.1, decay: 0.01, sustain: 0.3, release: 0.02 }); } },

  select: { play: (o, t) => { blip(o, t, 84, 0.035, 0.11); blip(o, t + 0.05, 91, 0.05, 0.1); } },

  move: {
    play: (o, t) => {
      for (const [dt, level] of [[0, 1], [0.11, 0.7]] as const) {
        noise(o, t + dt, 0.07, { filter: 'bandpass', freq: 900, freqTo: 420, q: 1.3, gain: 0.12 * level });
        tone(o, t + dt, 300, 0.06, { wave: 'triangle', gain: 0.1 * level, slideTo: 200, decay: 0.04, sustain: 0.3, release: 0.03 });
      }
    },
  },

  attack: {
    play: (o, t) => {
      noise(o, t, 0.16, { filter: 'bandpass', freq: 4200, freqTo: 700, q: 1.4, gain: 0.22, attack: 0.02 });
      tone(o, t, 720, 0.13, { wave: 'sawtooth', gain: 0.09, slideTo: 150, filter: 'lowpass', filterFreq: 2400, decay: 0.08, sustain: 0.4, release: 0.04 });
    },
  },

  hit: {
    play: (o, t) => {
      thump(o, t, 190, 52, 0.2, 0.45);
      noise(o, t, 0.12, { filter: 'lowpass', freq: 1800, freqTo: 300, q: 0.7, gain: 0.3 });
      tone(o, t, 233, 0.05, { wave: 'square', gain: 0.06, slideTo: 110, decay: 0.03, sustain: 0.2, release: 0.03 });
    },
  },

  knockdown: {
    play: (o, t) => {
      [74, 69, 62].forEach((m, i) => blip(o, t + i * 0.09, m, 0.07, 0.1));
      tone(o, t + 0.27, hz(57), 0.18, { wave: 'pulse25', gain: 0.09, slideTo: hz(40), decay: 0.1, sustain: 0.5, release: 0.08 });
      thump(o, t + 0.3, 120, 38, 0.32, 0.45);
      noise(o, t + 0.3, 0.32, { filter: 'lowpass', freq: 700, freqTo: 140, q: 0.6, gain: 0.2 });
    },
  },

  capture: {
    duck: 0.6,
    play: (o, t) => {
      [84, 88, 91, 96].forEach((m, i) => blip(o, t + i * 0.055, m, 0.045, 0.1));
      noise(o, t + 0.26, 0.025, { filter: 'highpass', freq: 5000, gain: 0.25 });
      tone(o, t + 0.26, 2400, 0.012, { wave: 'square', gain: 0.07, decay: 0.01, sustain: 0.2, release: 0.01 });
      bell(o, t + 0.32, 79, 0.08, 0.3);
      bell(o, t + 0.32, 84, 0.08, 0.3);
    },
  },

  captureFail: {
    play: (o, t) => {
      [84, 88, 91].forEach((m, i) => blip(o, t + i * 0.05, m, 0.04, 0.09));
      tone(o, t + 0.18, 784, 0.3, { wave: 'pulse25', gain: 0.09, slideTo: 330, vibrato: 70, vibratoRate: 9, vibratoDelay: 0.02, decay: 0.1, sustain: 0.6, release: 0.06 });
      noise(o, t + 0.5, 0.06, { filter: 'bandpass', freq: 1300, q: 1, gain: 0.16 });
    },
  },

  evolve: {
    duck: 1.2,
    play: (o, t) => {
      for (const detune of [-9, 0, 11]) {
        tone(o, t, 330, 0.8, { wave: 'triangle', gain: 0.05, slideTo: 1320, detune, attack: 0.15, decay: 0.3, sustain: 0.8, release: 0.12, vibrato: 25, vibratoRate: 12, vibratoDelay: 0 });
      }
      [84, 88, 91, 93, 96, 98, 100].forEach((m, i) => bell(o, t + 0.1 + i * 0.1, m, 0.045, 0.15));
    },
  },

  cityFounded: {
    duck: 0.8,
    play: (o, t) => {
      [60, 67, 72, 76, 79].forEach((m, i) => tone(o, t + i * 0.04, hz(m), 0.45, { wave: 'triangle', gain: 0.07, attack: 0.03, decay: 0.25, sustain: 0.6, release: 0.3 }));
      bell(o, t + 0.22, 84, 0.09, 0.45);
    },
  },

  production: {
    play: (o, t) => {
      for (const [dt, base, level] of [[0, 1568, 1], [0.12, 1760, 0.6]] as const) {
        tone(o, t + dt, base, 0.025, { wave: 'square', gain: 0.07 * level, decay: 0.03, sustain: 0.1, release: 0.08, filter: 'bandpass', filterFreq: base * 1.5, q: 2 });
        tone(o, t + dt, base * 1.5, 0.04, { wave: 'sine', gain: 0.08 * level, decay: 0.06, sustain: 0.2, release: 0.15 });
        noise(o, t + dt, 0.03, { filter: 'highpass', freq: 6000, gain: 0.12 * level });
      }
    },
  },

  research: {
    play: (o, t) => { [81, 86, 91].forEach((m, i) => bell(o, t + i * 0.09, m, 0.11, 0.35)); },
  },

  turn: {
    play: (o, t) => {
      tone(o, t, hz(79), 0.12, { wave: 'soft', gain: 0.1, attack: 0.012, decay: 0.15, sustain: 0.4, release: 0.35 });
      tone(o, t + 0.14, hz(84), 0.14, { wave: 'soft', gain: 0.1, attack: 0.012, decay: 0.15, sustain: 0.4, release: 0.4 });
    },
  },

  war: {
    duck: 1.2,
    play: (o, t) => {
      thump(o, t, 110, 38, 0.5, 0.5);
      noise(o, t, 0.5, { filter: 'lowpass', freq: 500, freqTo: 120, q: 0.7, gain: 0.22 });
      for (const m of [38, 50, 57]) brass(o, t, m, 0.3, 0.08);
      for (const m of [37, 49, 56]) brass(o, t + 0.36, m, 0.2, 0.07);
      thump(o, t + 0.36, 90, 34, 0.4, 0.35);
    },
  },

  peace: {
    duck: 0.8,
    play: (o, t) => {
      [74, 78, 81].forEach((m, i) => tone(o, t + i * 0.11, hz(m), 0.12, { wave: 'triangle', gain: 0.09, attack: 0.02, decay: 0.15, sustain: 0.5, release: 0.25 }));
      tone(o, t + 0.33, hz(86), 0.25, { wave: 'soft', gain: 0.1, attack: 0.03, decay: 0.2, sustain: 0.6, release: 0.3, vibrato: 12 });
    },
  },

  promotion: {
    play: (o, t) => {
      [79, 83, 86].forEach((m, i) => blip(o, t + i * 0.06, m, 0.05, 0.1));
      tone(o, t + 0.18, hz(91), 0.22, { wave: 'pulse25', gain: 0.1, decay: 0.1, sustain: 0.6, release: 0.12, vibrato: 20, vibratoDelay: 0.06 });
      noise(o, t + 0.2, 0.15, { filter: 'highpass', freq: 8000, gain: 0.05 });
    },
  },

  wonder: {
    duck: 2.2,
    play: (o, t) => {
      [67, 72, 76].forEach((m, i) => brass(o, t + i * 0.1, m, 0.07, 0.09));
      brass(o, t + 0.3, 79, 0.32, 0.1);
      brass(o, t + 0.66, 77, 0.08, 0.08);
      brass(o, t + 0.76, 76, 0.08, 0.08);
      brass(o, t + 0.88, 84, 0.55, 0.1, 14);
      for (const m of [60, 64, 67, 72]) tone(o, t + 0.88, hz(m), 0.5, { wave: 'triangle', gain: 0.06, attack: 0.04, decay: 0.3, sustain: 0.7, release: 0.25 });
      thump(o, t + 0.3, 98, 78, 0.3, 0.35);
      thump(o, t + 0.88, 65, 52, 0.45, 0.45);
      noise(o, t + 0.88, 0.5, { filter: 'highpass', freq: 6500, gain: 0.05, attack: 0.05 });
    },
  },

  error: {
    play: (o, t) => {
      for (const dt of [0, 0.11]) {
        for (const detune of [0, 18]) tone(o, t + dt, 110, 0.07, { wave: 'square', gain: 0.07, detune, filter: 'lowpass', filterFreq: 900, decay: 0.05, sustain: 0.8, release: 0.03 });
      }
    },
  },

  notify: {
    play: (o, t) => {
      tone(o, t, hz(88), 0.05, { wave: 'sine', gain: 0.12, decay: 0.08, sustain: 0.3, release: 0.35 });
      tone(o, t + 0.12, hz(83), 0.05, { wave: 'sine', gain: 0.06, decay: 0.08, sustain: 0.3, release: 0.3 });
    },
  },
};
