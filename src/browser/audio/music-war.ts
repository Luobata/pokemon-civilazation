// "Banners at the Ford" — tense battle theme in D (harmonic) minor, 132 BPM, 24-bar form.
// Original composition: clipped pulse lead, racing triad arpeggios, an octave-pumping
// bass and a driving noise kit with rolling fills.

import type { SongData } from './song.ts';

export const WAR_SONG: SongData = {
  bpm: 132,
  sections: {
    A: {
      chords: ['Dm', 'Dm', 'Bb', 'A'],
      lead: [
        'D5 . D5 . F5 - E5 D5',
        'A4 - - - . . A4 C5',
        'D5 . D5 . F5 - G5 F5',
        'E5 - - - C#5 - - -',
      ],
      leadAlt: [
        'D5 . D5 . F5 - A5 G5',
        'F5 - E5 - D5 - A4 -',
        'Bb4 . D5 . F5 - E5 D5',
        'C#5 - - - E5 - A4 -',
      ],
    },
    B: {
      chords: ['Dm', 'C', 'Bb', 'A7'],
      lead: [
        'A5 - G5 F5 E5 - D5 -',
        'G5 - F5 E5 - - C5 -',
        'F5 - E5 D5 - - Bb4 -',
        'C#5 - E5 - G5 - E5 -',
      ],
      leadAlt: [
        'A5 . A5 . G5 F5 E5 -',
        'E5 . E5 . G5 - C5 -',
        'D5 . D5 . F5 - Bb4 -',
        'A4 - C#5 - E5 - A5 -',
      ],
    },
    C: {
      chords: ['Gm', 'Dm', 'Gm', 'A', 'Bb', 'C', 'A', 'A7'],
      lead: [
        'G4 . Bb4 . D5 - - .',
        'F5 . E5 . D5 - A4 -',
        'G4 . Bb4 . D5 - G5 -',
        'E5 - - - C#5 - - -',
        'D5 - F5 - Bb5 - - -',
        'G5 - E5 - C5 - - -',
        'C#5 - E5 - A5 - - -',
        'G5 - F5 - E5 - C#5 -',
      ],
    },
  },
  form: ['A', 'B', 'A', 'C', 'B'],
  lead: { wave: 'pulse25', gain: 0.07, attack: 0.006, decay: 0.08, sustain: 0.5, release: 0.06, vibrato: 18, echo: 0.2 },
  arp: {
    wave: 'pulse12', gain: 0.03, attack: 0.003, decay: 0.04, sustain: 0.25, release: 0.04, low: 50, steps: 1,
    pattern: [0, 1, 2, 1, 0, 1, 2, 1, 0, 1, 2, 3, 2, 1, 0, 1],
    patternAlt: [0, 2, 3, 2, 0, 2, 3, 2, 1, 2, 3, 4, 3, 2, 1, 2],
  },
  bass: { wave: 'triangle', gain: 0.15, attack: 0.004, decay: 0.08, sustain: 0.6, release: 0.03, low: 38, pattern: 'R.R.O.R.R.R.O.F.' },
  drums: {
    gain: 0.5,
    kick: 'x...x...x...x.x.',
    snare: '....x.......x...',
    hat: 'x.x.x.x.x.x.x.xx',
    fills: [
      { kick: 'x...', snare: 'xxxx', hat: '....' },
      { kick: 'x.x.', snare: '.x.x', hat: 'x...' },
      { kick: 'xx..', snare: '..xx', hat: 'x.x.' },
      { kick: 'x...', snare: 'oxox', hat: '....' },
    ],
    ghostEvery: 6,
  },
  // A3 top intensity (one of our cities under attack): driving low toms, snare rolls into each half bar, a ride on the beat.
  accent: { gain: 0.42, kick: 'x.x...x.x.x...xx', snare: '.....oox.....oox', hat: 'x...x...x...x...' },
};
