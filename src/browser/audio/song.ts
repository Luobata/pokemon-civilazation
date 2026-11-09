// Song data format and compiler. Song files describe music the way a tracker would:
// a chord per bar (or two, split by a space), a lead line on an eighth-note grid, and
// sixteen-step patterns for arpeggio, bass and drums. compileSong turns that into flat
// per-step arrays once at module load so the scheduler only does array lookups.

import type { Wave } from './synth.ts';

export interface VoiceData {
  wave: Wave;
  gain: number;
  attack?: number;
  decay?: number;
  sustain?: number;
  release?: number;
  vibrato?: number;
}

export interface SongSection {
  /** One entry per bar; "Csus4 C" splits the bar into two halves. */
  chords: string[];
  /** One entry per bar, eight space-separated tokens: note ("C#5"), "." rest, "-" hold. */
  lead: string[];
  /** Variation used on every other pass through the loop. */
  leadAlt?: string[];
}

export interface DrumPattern {
  kick: string;
  snare: string;
  hat: string;
}

export interface SongData {
  bpm: number;
  sections: Record<string, SongSection>;
  form: string[];
  lead: VoiceData & { echo: number };
  arp: VoiceData & {
    /** Lowest MIDI note the chord root may be voiced on. */
    low: number;
    /** Sixteen chord-tone indices (index past the chord size climbs an octave); -1 rests. */
    pattern: number[];
    patternAlt: number[];
    steps: number;
  };
  bass: VoiceData & {
    low: number;
    /** Sixteen chars: R root, T third, F fifth, O octave, . rest, - hold. */
    pattern: string;
  };
  drums?: DrumPattern & {
    gain: number;
    /** Replacements for the last four steps of each section's final bar. */
    fills: DrumPattern[];
    /** Chance (1 in n) of a soft ghost hat on an empty step; 0 disables. */
    ghostEvery: number;
  };
  /**
   * A3: an extra percussion layer that only sounds when the music's intensity asks for it (war at its peak,
   * the peace drums' warning). kick: low tom, snare: tight roll, hat: bright ride. Sixteen steps each.
   */
  accent?: DrumPattern & { gain: number };
}

export interface Chord {
  root: number;
  intervals: readonly number[];
}

export interface CompiledBar {
  chordA: Chord;
  chordB: Chord;
  /** Position of the bar's section in the form. */
  formIndex: number;
  sectionEnd: boolean;
  /** Per-sixteenth MIDI note (-1 none) and its length in sixteenths. */
  lead: Int16Array;
  leadLen: Uint8Array;
  leadAlt: Int16Array;
  leadAltLen: Uint8Array;
}

export interface CompiledSong {
  data: SongData;
  bars: CompiledBar[];
  stepSeconds: number;
  bassLen: Uint8Array;
}

const NOTE_INDEX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const QUALITIES: Record<string, readonly number[]> = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  '7': [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  add9: [0, 4, 7, 14],
  dim: [0, 3, 6],
};

export function parseNote(token: string): number {
  const match = /^([A-G])([#b]?)(-?\d)$/.exec(token);
  if (!match) throw new Error(`Bad note token "${token}"`);
  const accidental = match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0;
  return 12 * (Number(match[3]) + 1) + NOTE_INDEX[match[1]] + accidental;
}

export function parseChord(symbol: string): Chord {
  const match = /^([A-G])([#b]?)(.*)$/.exec(symbol);
  const intervals = match ? QUALITIES[match[3]] : undefined;
  if (!match || !intervals) throw new Error(`Bad chord symbol "${symbol}"`);
  const accidental = match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0;
  return { root: (NOTE_INDEX[match[1]] + accidental + 12) % 12, intervals };
}

/** MIDI pitch of chord tone `index`, with the root voiced in [low, low + 12). */
export function chordTone(chord: Chord, low: number, index: number): number {
  const base = low + ((chord.root - low) % 12 + 12) % 12;
  const size = chord.intervals.length;
  return base + chord.intervals[index % size] + 12 * Math.floor(index / size);
}

function compileLead(bar: string, where: string): { notes: Int16Array; lengths: Uint8Array } {
  const tokens = bar.trim().split(/\s+/);
  if (tokens.length !== 8) throw new Error(`${where}: expected 8 lead tokens, got ${tokens.length}`);
  const notes = new Int16Array(16).fill(-1);
  const lengths = new Uint8Array(16);
  let last = -1;
  tokens.forEach((token, i) => {
    if (token === '-') {
      if (last >= 0) lengths[last] += 2;
      return;
    }
    if (token === '.') { last = -1; return; }
    last = i * 2;
    notes[last] = parseNote(token);
    lengths[last] = 2;
  });
  return { notes, lengths };
}

export function compileSong(data: SongData): CompiledSong {
  const bars: CompiledBar[] = [];
  data.form.forEach((name, formIndex) => {
    const section = data.sections[name];
    if (!section) throw new Error(`Unknown section "${name}"`);
    if (section.lead.length !== section.chords.length || (section.leadAlt && section.leadAlt.length !== section.chords.length)) {
      throw new Error(`Section "${name}" lead and chords differ in length`);
    }
    section.chords.forEach((symbols, i) => {
      const [a, b = a] = symbols.trim().split(/\s+/);
      const main = compileLead(section.lead[i], `${name}[${i}]`);
      const alt = section.leadAlt ? compileLead(section.leadAlt[i], `${name}.alt[${i}]`) : main;
      bars.push({
        chordA: parseChord(a),
        chordB: parseChord(b),
        formIndex,
        sectionEnd: i === section.chords.length - 1,
        lead: main.notes,
        leadLen: main.lengths,
        leadAlt: alt.notes,
        leadAltLen: alt.lengths,
      });
    });
  });
  const patterns = [data.bass.pattern, data.arp.pattern, data.arp.patternAlt];
  if (data.drums) patterns.push(data.drums.kick, data.drums.snare, data.drums.hat);
  if (data.accent) patterns.push(data.accent.kick, data.accent.snare, data.accent.hat);
  for (const pattern of patterns) if (pattern.length !== 16) throw new Error('Patterns must have 16 steps');
  for (const fill of data.drums?.fills ?? []) {
    if (fill.kick.length !== 4 || fill.snare.length !== 4 || fill.hat.length !== 4) throw new Error('Fills must have 4 steps');
  }
  const bassLen = new Uint8Array(16);
  for (let s = 0; s < 16; s++) {
    if ('.-'.includes(data.bass.pattern[s])) continue;
    let length = 1;
    while (s + length < 16 && data.bass.pattern[s + length] === '-') length++;
    bassLen[s] = length;
  }
  return { data, bars, stepSeconds: 60 / data.bpm / 4, bassLen };
}

/** Small integer hash for deterministic per-pass variation. */
export function mix(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 13;
  h = Math.imul(h, 0x27d4eb2d);
  return (h ^ (h >>> 15)) >>> 0;
}
