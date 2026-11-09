// Gameplay v24 C (docs/design/world-v24.md §4): rival trainers — schedule, counters by starter, strength offsets, rewards, names.
// Scaffolding: the spec's numbers; no rule reads them yet.
import type { StarterId } from './units.ts';
import type { SpeciesId } from './species.ts';

export const RIVAL_RULES_V24 = {
  /** Arrival rounds; the warning appears `warningRounds` earlier. Fallback for the first visit: round 12 (§9, option 7B). */
  arrivals: [8, 25, 50], warningRounds: 2, spawnDistance: [5, 7], staysRounds: 6,
  /** 劲敌气势: clamp(S + offset − species attack, −cap, +cap), S = the target's second-highest attack strength. */
  strengthOffsets: [-6, -2, 2], strengthCap: 12,
  rewards: [{ gold: 25, pokeBalls: 2, eraScore: 1 }, { gold: 50, research: 20, eraScore: 2 }, { gold: 80, xp: 50, eraScore: 3 }],
} as const;
/** Primary and secondary counters to each starter (§4.1). */
export const RIVAL_COUNTERS: Record<StarterId, { primary: readonly SpeciesId[]; secondary: readonly SpeciesId[] }> = {
  bulbasaur: { primary: ['charmander', 'charmeleon', 'charizard', 'ponyta'], secondary: ['pidgey', 'pidgeotto'] },
  charmander: { primary: ['squirtle', 'wartortle', 'blastoise'], secondary: ['geodude', 'graveler'] },
  squirtle: { primary: ['bulbasaur', 'ivysaur', 'venusaur', 'exeggcute'], secondary: ['pikachu', 'magnemite'] },
};
/** Original names, picked per civilization with stableSeed. */
export const RIVAL_NAMES: readonly string[] = ['澈', '凛', '岚', '朔', '烬', '汀'];
