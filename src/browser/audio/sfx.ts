// Original procedural sound effects. Each entry schedules a handful of voices starting
// at `t`; most are under a second; the wonder, era and victory fanfares run 1.5–3.5 s.
// `duck` dips the music for that many seconds so big moments cut through.

import type { TypeId } from '../../content/species.ts';
import { midiToFreq as hz, noise, thump, tone, type SynthOut } from './synth.ts';

/** A2: the 18 attack types share six sound families. */
export type AttackFamily = 'fire' | 'water' | 'electric' | 'grass' | 'psychic' | 'impact';
export const ATTACK_FAMILIES: Record<TypeId, AttackFamily> = {
  fire: 'fire', dragon: 'fire',
  water: 'water', ice: 'water', poison: 'water',
  electric: 'electric', steel: 'electric',
  grass: 'grass', bug: 'grass', flying: 'grass',
  psychic: 'psychic', ghost: 'psychic', fairy: 'psychic', dark: 'psychic',
  fighting: 'impact', rock: 'impact', ground: 'impact', normal: 'impact',
};
/** The attack sound for a type; the generic swing when the type is unknown. */
export const attackSound = (type: TypeId | null | undefined): SoundId => type ? `attack:${ATTACK_FAMILIES[type]}` : 'attack';

export type SoundId =
  | 'click' | 'select' | 'move' | 'attack' | 'hit' | 'knockdown' | 'capture' | 'captureFail' | 'evolve'
  | 'cityFounded' | 'production' | 'research' | 'turn' | 'war' | 'peace' | 'promotion' | 'wonder' | 'error' | 'notify'
  | 'cityCaptured' | 'cityLost' | 'eraChange' | 'victory' | 'defeat' | 'weather' | 'formChange' | 'tradeRoute'
  | 'legendLost' | 'alarm' | 'endTurn' | `attack:${AttackFamily}` | 'superEffective';

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

  /** Our banner goes up: drum hit, rising brass triad, bright cymbal. */
  cityCaptured: {
    duck: 1.4,
    play: (o, t) => {
      thump(o, t, 120, 45, 0.35, 0.45);
      [62, 66, 69].forEach((m, i) => brass(o, t + 0.08 + i * 0.09, m, 0.09, 0.08));
      brass(o, t + 0.36, 74, 0.42, 0.1, 12);
      for (const m of [50, 57]) tone(o, t + 0.36, hz(m), 0.4, { wave: 'triangle', gain: 0.07, attack: 0.03, decay: 0.3, sustain: 0.6, release: 0.25 });
      noise(o, t + 0.36, 0.45, { filter: 'highpass', freq: 5200, gain: 0.07, attack: 0.02 });
    },
  },

  /** One of our cities falls: low falling minor brass over a dull drum. */
  cityLost: {
    duck: 1.6,
    play: (o, t) => {
      thump(o, t, 90, 32, 0.5, 0.5);
      noise(o, t, 0.5, { filter: 'lowpass', freq: 420, freqTo: 90, q: 0.6, gain: 0.2 });
      [[57, 0], [53, 0.22], [50, 0.44]].forEach(([m, dt]) => brass(o, t + dt, m, 0.2, 0.08));
      tone(o, t + 0.66, hz(45), 0.55, { wave: 'sawtooth', gain: 0.06, slideTo: hz(40), filter: 'lowpass', filterFreq: 500, attack: 0.04, decay: 0.3, sustain: 0.7, release: 0.35 });
    },
  },

  /** A new era: short horn call (about 3 s) with a held chord. */
  eraChange: {
    duck: 3.2,
    play: (o, t) => {
      brass(o, t, 67, 0.22, 0.09);
      brass(o, t + 0.28, 72, 0.22, 0.09);
      brass(o, t + 0.56, 76, 0.16, 0.09);
      brass(o, t + 0.76, 79, 0.9, 0.1, 10);
      for (const m of [55, 60, 64, 67]) tone(o, t + 0.76, hz(m), 1.4, { wave: 'soft', gain: 0.05, attack: 0.25, decay: 0.6, sustain: 0.8, release: 0.9 });
      thump(o, t + 0.76, 80, 50, 0.5, 0.35);
      [84, 88, 91].forEach((m, i) => bell(o, t + 1.6 + i * 0.12, m, 0.05, 0.6));
    },
  },

  /** Game won: bright major fanfare. */
  victory: {
    duck: 3.5,
    play: (o, t) => {
      [72, 72, 72].forEach((m, i) => brass(o, t + i * 0.13, m, 0.08, 0.09));
      brass(o, t + 0.4, 79, 0.3, 0.1);
      brass(o, t + 0.78, 77, 0.12, 0.09);
      brass(o, t + 0.94, 79, 0.12, 0.09);
      brass(o, t + 1.1, 84, 1.0, 0.11, 14);
      for (const m of [48, 60, 64, 67, 72]) tone(o, t + 1.1, hz(m), 1.0, { wave: 'triangle', gain: 0.055, attack: 0.04, decay: 0.4, sustain: 0.7, release: 0.6 });
      thump(o, t + 0.4, 98, 70, 0.3, 0.35);
      thump(o, t + 1.1, 70, 48, 0.5, 0.5);
      noise(o, t + 1.1, 0.8, { filter: 'highpass', freq: 6200, gain: 0.06, attack: 0.05 });
    },
  },

  /** Game lost: a quiet descending minor phrase. */
  defeat: {
    duck: 3,
    play: (o, t) => {
      [[69, 0], [67, 0.4], [65, 0.8], [64, 1.2]].forEach(([m, dt]) => tone(o, t + dt, hz(m), 0.32, { wave: 'soft', gain: 0.08, attack: 0.05, decay: 0.3, sustain: 0.6, release: 0.4 }));
      for (const m of [45, 52, 57]) tone(o, t + 1.2, hz(m), 1.2, { wave: 'triangle', gain: 0.05, attack: 0.2, decay: 0.6, sustain: 0.7, release: 0.9 });
    },
  },

  /** Weather summoned: a wind sweep with a shimmer. */
  weather: {
    duck: 0.8,
    play: (o, t) => {
      noise(o, t, 0.7, { filter: 'bandpass', freq: 400, freqTo: 2400, q: 1.6, gain: 0.16, attack: 0.25 });
      [86, 89, 93].forEach((m, i) => bell(o, t + 0.3 + i * 0.08, m, 0.04, 0.3));
    },
  },

  /** Mega Evolution / Dynamax / Terastal / Z-Move: rising sweep into a bright burst. */
  formChange: {
    duck: 1,
    play: (o, t) => {
      for (const detune of [-12, 0, 12]) tone(o, t, 220, 0.4, { wave: 'sawtooth', gain: 0.04, slideTo: 1760, detune, filter: 'lowpass', filterFreq: 800, filterTo: 5000, attack: 0.05, decay: 0.2, sustain: 0.8, release: 0.08 });
      thump(o, t + 0.42, 150, 60, 0.25, 0.4);
      noise(o, t + 0.42, 0.3, { filter: 'highpass', freq: 3500, gain: 0.12 });
      [91, 95, 98].forEach(m => bell(o, t + 0.42, m, 0.05, 0.35));
    },
  },

  /** A trade route opens: a coin jingle. */
  tradeRoute: {
    play: (o, t) => {
      [88, 91, 96].forEach((m, i) => {
        tone(o, t + i * 0.07, hz(m), 0.03, { wave: 'square', gain: 0.05, decay: 0.03, sustain: 0.1, release: 0.1, filter: 'bandpass', filterFreq: hz(m) * 1.5, q: 2 });
        tone(o, t + i * 0.07, hz(m + 12), 0.05, { wave: 'sine', gain: 0.06, decay: 0.06, sustain: 0.2, release: 0.2 });
      });
      noise(o, t, 0.2, { filter: 'highpass', freq: 7000, gain: 0.06 });
    },
  },

  /** A wonder we were building went to someone else: a deflating tone. */
  legendLost: {
    duck: 1,
    play: (o, t) => {
      brass(o, t, 64, 0.18, 0.08);
      tone(o, t + 0.22, hz(63), 0.5, { wave: 'pulse25', gain: 0.07, slideTo: hz(55), vibrato: 30, vibratoRate: 5, vibratoDelay: 0.1, decay: 0.2, sustain: 0.6, release: 0.2 });
    },
  },

  /** Rampage, wild spawn or one of our cities under attack: two-tone alarm. */
  alarm: {
    play: (o, t) => {
      for (const [dt, m] of [[0, 81], [0.14, 76], [0.28, 81], [0.42, 76]] as const) tone(o, t + dt, hz(m), 0.1, { wave: 'pulse25', gain: 0.07, decay: 0.05, sustain: 0.7, release: 0.03 });
    },
  },

  /** Fire / dragon: a low-pass-swept roar of noise over a falling growl. */
  'attack:fire': {
    play: (o, t) => {
      noise(o, t, 0.34, { filter: 'lowpass', freq: 3200, freqTo: 280, q: 1.3, gain: 0.3, attack: 0.02 });
      tone(o, t, 150, 0.24, { wave: 'sawtooth', gain: 0.06, slideTo: 62, filter: 'lowpass', filterFreq: 700, decay: 0.12, sustain: 0.5, release: 0.08 });
    },
  },

  /** Water / ice / poison: rising bubbles through a band-pass splash. */
  'attack:water': {
    play: (o, t) => {
      [0, 0.05, 0.1, 0.16].forEach((dt, i) => tone(o, t + dt, 380 + i * 90, 0.04, { wave: 'sine', gain: 0.1, slideTo: 900 + i * 140, decay: 0.03, sustain: 0.2, release: 0.03 }));
      noise(o, t, 0.26, { filter: 'bandpass', freq: 1300, freqTo: 650, q: 3, gain: 0.15 });
    },
  },

  /** Electric / steel: a crackle of square-wave zaps over hiss. */
  'attack:electric': {
    play: (o, t) => {
      for (let i = 0; i < 6; i++) tone(o, t + i * 0.028, hz(i % 2 ? 91 : 84), 0.022, { wave: 'square', gain: 0.055, decay: 0.015, sustain: 0.4, release: 0.01 });
      noise(o, t, 0.2, { filter: 'highpass', freq: 4200, gain: 0.13 });
      tone(o, t, 1200, 0.18, { wave: 'sawtooth', gain: 0.03, slideTo: 300, filter: 'bandpass', filterFreq: 1800, q: 4, decay: 0.1, sustain: 0.3, release: 0.04 });
    },
  },

  /** Grass / bug / flying: two leafy rustles. */
  'attack:grass': {
    play: (o, t) => {
      for (const [dt, level] of [[0, 1], [0.09, 0.75]] as const) noise(o, t + dt, 0.12, { filter: 'bandpass', freq: 3200, freqTo: 5200, q: 0.9, gain: 0.18 * level, attack: 0.01 });
      tone(o, t + 0.04, 520, 0.08, { wave: 'triangle', gain: 0.05, slideTo: 760, decay: 0.05, sustain: 0.3, release: 0.05 });
    },
  },

  /** Psychic / ghost / fairy / dark: a wavering sine pair. */
  'attack:psychic': {
    play: (o, t) => {
      for (const detune of [0, 14]) tone(o, t, hz(76), 0.36, { wave: 'sine', gain: 0.08, detune, slideTo: hz(83), attack: 0.05, decay: 0.2, sustain: 0.7, release: 0.12, vibrato: 90, vibratoRate: 13, vibratoDelay: 0 });
    },
  },

  /** Fighting / rock / ground / normal: a swing and a heavy thud. */
  'attack:impact': {
    play: (o, t) => {
      noise(o, t, 0.09, { filter: 'bandpass', freq: 2600, freqTo: 900, q: 1.2, gain: 0.14 });
      thump(o, t + 0.07, 170, 45, 0.24, 0.5);
      noise(o, t + 0.07, 0.14, { filter: 'lowpass', freq: 1400, freqTo: 220, q: 0.7, gain: 0.26 });
    },
  },

  /** Super effective: a quick rising arpeggio on top of the attack sound. */
  superEffective: {
    play: (o, t) => {
      [79, 83, 86, 91].forEach((m, i) => blip(o, t + 0.12 + i * 0.045, m, 0.04, 0.085));
      bell(o, t + 0.3, 95, 0.05, 0.25);
    },
  },

  /** End turn: a soft low-to-high two-note seal, distinct from the generic click. */
  endTurn: {
    play: (o, t) => {
      thump(o, t, 160, 90, 0.12, 0.2);
      tone(o, t, hz(67), 0.08, { wave: 'soft', gain: 0.09, attack: 0.008, decay: 0.1, sustain: 0.4, release: 0.2 });
      tone(o, t + 0.09, hz(74), 0.12, { wave: 'soft', gain: 0.09, attack: 0.008, decay: 0.12, sustain: 0.4, release: 0.3 });
    },
  },
};
