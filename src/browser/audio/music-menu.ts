// "Lantern by the Map Table" — gentle menu loop in G major, 76 BPM, 8-bar form.
// Original composition: a rounded soft lead over slow chord ripples and whole-note bass,
// no drums.

import type { SongData } from './song.ts';

export const MENU_SONG: SongData = {
  bpm: 76,
  sections: {
    A: {
      chords: ['Gmaj7', 'Em7', 'Cmaj7', 'D'],
      lead: [
        'D5 - - B4 - - A4 -',
        'G4 - - - B4 - - -',
        'E5 - - D5 - - B4 -',
        'A4 - - - - - . .',
      ],
      leadAlt: [
        'D5 - - B4 - - G5 -',
        'F#5 - E5 - D5 - B4 -',
        'C5 - - E5 - - G5 -',
        'F#5 - - - A4 - . .',
      ],
    },
    B: {
      chords: ['Gmaj7', 'Bm7', 'Cmaj7', 'Dsus4 D'],
      lead: [
        'D5 - - B4 - - D5 -',
        'F#5 - - - D5 - - -',
        'E5 - - G5 - - E5 -',
        'D5 - - - - - - -',
      ],
      leadAlt: [
        'G5 - - F#5 - - D5 -',
        'B4 - - - D5 - F#5 -',
        'G5 - - E5 - - C5 -',
        'D5 - - - A4 - - -',
      ],
    },
  },
  form: ['A', 'B'],
  lead: { wave: 'soft', gain: 0.1, attack: 0.03, decay: 0.3, sustain: 0.6, release: 0.3, vibrato: 10, echo: 0.38 },
  arp: {
    wave: 'triangle', gain: 0.045, attack: 0.01, decay: 0.15, sustain: 0.4, release: 0.2, low: 55, steps: 2,
    pattern: [0, -1, 1, -1, 2, -1, 3, -1, 4, -1, 3, -1, 2, -1, 1, -1],
    patternAlt: [0, -1, -1, 2, -1, -1, 4, -1, -1, 3, -1, -1, 2, -1, 1, -1],
  },
  bass: { wave: 'triangle', gain: 0.11, attack: 0.03, decay: 0.4, sustain: 0.6, release: 0.2, low: 36, pattern: 'R-------F-------' },
};
