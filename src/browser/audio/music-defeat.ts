// "Embers after the Rain" — quiet defeat coda in A minor, 66 BPM, 8-bar form (A5).
// Original composition: a soft, slow lead that keeps falling back, sparse chord ripples and
// a long-note bass; no drums. It plays on the end screen after a loss.

import type { SongData } from './song.ts';

export const DEFEAT_SONG: SongData = {
  bpm: 66,
  sections: {
    A: {
      chords: ['Am', 'Fmaj7', 'Dm7', 'E'],
      lead: [
        'E5 - - - C5 - - -',
        'A4 - - - C5 - B4 -',
        'A4 - - - F4 - - -',
        'G#4 - - - - - . .',
      ],
      leadAlt: [
        'E5 - - D5 C5 - - -',
        'C5 - - - A4 - G4 -',
        'F4 - - - A4 - D5 -',
        'B4 - - - G#4 - . .',
      ],
    },
    B: {
      chords: ['Am', 'Dm7', 'Fmaj7', 'Esus4 E'],
      lead: [
        'C5 - - B4 A4 - - -',
        'F4 - - - A4 - - -',
        'C5 - - - E5 - D5 -',
        'B4 - - - - - . .',
      ],
    },
  },
  form: ['A', 'B'],
  lead: { wave: 'soft', gain: 0.09, attack: 0.04, decay: 0.35, sustain: 0.55, release: 0.4, vibrato: 8, echo: 0.42 },
  arp: {
    wave: 'triangle', gain: 0.035, attack: 0.02, decay: 0.2, sustain: 0.35, release: 0.3, low: 52, steps: 2,
    pattern: [0, -1, -1, -1, 2, -1, -1, -1, 1, -1, -1, -1, 2, -1, -1, -1],
    patternAlt: [0, -1, -1, 2, -1, -1, 3, -1, -1, -1, 2, -1, -1, -1, 1, -1],
  },
  bass: { wave: 'triangle', gain: 0.1, attack: 0.05, decay: 0.5, sustain: 0.6, release: 0.3, low: 33, pattern: 'R---------------' },
};
