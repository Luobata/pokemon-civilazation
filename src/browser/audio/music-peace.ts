// "Green Field Wander" — calm exploration theme in F major, 90 BPM, 24-bar form.
// Original composition: pentatonic-leaning pulse lead with a soft echo, rolling
// seventh-chord arpeggios, a triangle bass and a brushed, sparse kit.

import type { SongData } from './song.ts';

export const PEACE_SONG: SongData = {
  bpm: 90,
  sections: {
    A: {
      chords: ['Fmaj7', 'Am7', 'Bbmaj7', 'Csus4 C'],
      lead: [
        'C5 - - A4 C5 D5 - -',
        'E5 - D5 C5 A4 - - .',
        'D5 - C5 A4 G4 - F4 -',
        'G4 - - - . . C5 -',
      ],
      leadAlt: [
        'C5 - - A4 C5 D5 F5 -',
        'E5 - D5 C5 D5 - A4 -',
        'Bb4 - A4 G4 F4 - G4 A4',
        'G4 - - - - - . .',
      ],
    },
    B: {
      chords: ['Dm7', 'Bbmaj7', 'Gm7', 'Csus4 C'],
      lead: [
        'D5 - A4 - F5 - E5 D5',
        'D5 - - C5 - - A4 -',
        'Bb4 - A4 - G4 - D5 -',
        'C5 - - - G4 - A4 -',
      ],
      leadAlt: [
        'F5 - E5 - D5 - A4 -',
        'D5 - F5 - - - C5 -',
        'D5 - Bb4 - A4 G4 - -',
        'C5 - - - E5 - G5 -',
      ],
    },
    C: {
      chords: ['Bbmaj7', 'C', 'Am7', 'Dm7', 'Gm7', 'Am7', 'Bbmaj7', 'Csus4 C'],
      lead: [
        'F5 - - - D5 - - -',
        'E5 - - - C5 - G4 -',
        'A4 - - - E5 - - -',
        'D5 - - - - - . .',
        'Bb4 - D5 - F5 - G5 -',
        'E5 - - - C5 - A4 -',
        'D5 - C5 - Bb4 - A4 -',
        'G4 - - - - - - -',
      ],
    },
  },
  form: ['A', 'A', 'B', 'C', 'A'],
  lead: { wave: 'pulse25', gain: 0.075, attack: 0.012, decay: 0.12, sustain: 0.55, release: 0.12, vibrato: 14, echo: 0.32 },
  arp: {
    wave: 'pulse12', gain: 0.032, attack: 0.004, decay: 0.05, sustain: 0.3, release: 0.06, low: 53, steps: 1,
    pattern: [0, 1, 2, 3, 2, 1, 0, 1, 0, 1, 2, 3, 4, 3, 2, 1],
    patternAlt: [0, -1, 2, -1, 1, -1, 3, -1, 2, -1, 4, -1, 3, -1, 1, -1],
  },
  bass: { wave: 'triangle', gain: 0.13, attack: 0.01, decay: 0.2, sustain: 0.7, release: 0.08, low: 36, pattern: 'R-----R-F---..O-' },
  drums: {
    gain: 0.35,
    kick: 'x.......o.......',
    snare: '....o.......o...',
    hat: '..o...o...o...o.',
    fills: [
      { kick: '....', snare: 'o.oo', hat: '....' },
      { kick: 'o...', snare: '..o.', hat: 'o.o.' },
      { kick: '....', snare: '....', hat: 'oooo' },
    ],
    ghostEvery: 9,
  },
};
