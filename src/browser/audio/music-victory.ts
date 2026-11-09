// "Lanterns over the Capital" — victory theme in C major, 116 BPM, 16-bar form (A5).
// Original composition: a bright climbing pulse lead over broken-chord arpeggios, a bouncing
// bass and a light march kit; it plays on the end screen after a win.

import type { SongData } from './song.ts';

export const VICTORY_SONG: SongData = {
  bpm: 116,
  sections: {
    A: {
      chords: ['C', 'Am', 'F', 'G'],
      lead: [
        'C5 - E5 - G5 - - E5',
        'A5 - G5 - E5 - C5 -',
        'F5 - A5 - C6 - A5 -',
        'G5 - - - D5 - G5 -',
      ],
      leadAlt: [
        'E5 - G5 - C6 - - G5',
        'A5 - C6 - B5 - A5 -',
        'A5 - F5 - C5 - F5 -',
        'D5 - - - B4 - D5 -',
      ],
    },
    B: {
      chords: ['F', 'G', 'Em Am', 'Dm G'],
      lead: [
        'A5 - G5 F5 E5 - F5 -',
        'G5 - - - B4 - D5 -',
        'E5 - - G5 C6 - - B5',
        'A5 - - - G5 - - -',
      ],
      leadAlt: [
        'C6 - A5 - F5 - A5 -',
        'B5 - G5 - D5 - G5 -',
        'G5 - E5 - E5 - A5 -',
        'F5 - D5 - B4 - - -',
      ],
    },
  },
  form: ['A', 'B', 'A', 'B'],
  lead: { wave: 'pulse25', gain: 0.075, attack: 0.008, decay: 0.1, sustain: 0.55, release: 0.1, vibrato: 12, echo: 0.28 },
  arp: {
    wave: 'pulse12', gain: 0.03, attack: 0.003, decay: 0.05, sustain: 0.3, release: 0.05, low: 55, steps: 1,
    pattern: [0, 1, 2, 3, 2, 1, 0, 1, 0, 1, 2, 3, 4, 3, 2, 1],
    patternAlt: [0, 2, 4, 2, 1, 3, 5, 3, 0, 2, 4, 2, 1, 3, 5, 3],
  },
  bass: { wave: 'triangle', gain: 0.13, attack: 0.006, decay: 0.12, sustain: 0.6, release: 0.05, low: 36, pattern: 'R...F.O.R...F.T.' },
  drums: {
    gain: 0.38,
    kick: 'x.....x.x.......',
    snare: '....x.......x..o',
    hat: 'x.o.x.o.x.o.x.o.',
    fills: [
      { kick: 'x...', snare: '.xxx', hat: '....' },
      { kick: 'x.x.', snare: '..xx', hat: 'o...' },
    ],
    ghostEvery: 8,
  },
};
