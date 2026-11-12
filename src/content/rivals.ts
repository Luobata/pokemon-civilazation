// Gameplay v24 C (docs/design/world-v24.md §4): rival trainers — schedule, counters by starter, strength offsets, rewards, names.
// Names and lines are original. Integers only.
import type { StarterId } from './units.ts';
import type { SpeciesId } from './species.ts';

export const RIVAL_RULES_V24 = {
  /** Arrival rounds; the warning appears `warningRounds` earlier. Fallback for the first visit: round 12 (§9, option 7B). */
  arrivals: [8, 25, 50], warningRounds: 2, spawnDistance: [5, 7], staysRounds: 6,
  /** Tiles a rival Pokémon walks per round toward its target city (it attacks instead when a target is in range). */
  stepsPerRound: 2,
  /** The AI treats its own cities this close to one of its rival's Pokémon as threatened (§4.3). */
  threatRadius: 4,
  /** 劲敌气势: clamp(S + offset − species attack, −cap, +cap), S = the target's second-highest attack strength. */
  strengthOffsets: [-10, -2, 2], strengthCap: 12,
  rewards: [{ gold: 25, pokeBalls: 2, eraScore: 1 }, { gold: 50, research: 20, eraScore: 2 }, { gold: 80, xp: 50, eraScore: 3 }],
} as const;
/** Primary and secondary counters to each starter (§4.1), whole evolution lines so every visit finds its stage. */
export const RIVAL_COUNTERS: Record<StarterId, { primary: readonly SpeciesId[]; secondary: readonly SpeciesId[] }> = {
  bulbasaur: { primary: ['charmander', 'charmeleon', 'charizard', 'ponyta', 'rapidash'], secondary: ['pidgey', 'pidgeotto', 'pidgeot'] },
  charmander: { primary: ['squirtle', 'wartortle', 'blastoise'], secondary: ['geodude', 'graveler', 'golem'] },
  squirtle: { primary: ['bulbasaur', 'ivysaur', 'venusaur', 'exeggcute', 'exeggutor'], secondary: ['pikachu', 'raichu', 'magnemite', 'magneton'] },
};
/** Team per visit: which counter list and which stage (§4.1). */
export const RIVAL_TEAMS: readonly (readonly { list: 'primary' | 'secondary'; stage: number }[])[] = [
  [{ list: 'primary', stage: 1 }],
  [{ list: 'primary', stage: 2 }, { list: 'secondary', stage: 1 }],
  [{ list: 'primary', stage: 3 }, { list: 'secondary', stage: 2 }, { list: 'primary', stage: 2 }],
];
/** Original names, picked per civilization with stableSeed. */
export const RIVAL_NAMES: readonly string[] = ['澈', '凛', '岚', '朔', '烬', '汀'];
/** Two original lines per visit: on arrival and on leaving undefeated. */
export const RIVAL_LINES: readonly { arrive: string; leave: string; beaten: string }[] = [
  { arrive: '听说你选了这只搭档？让我看看它有几分本事！', leave: '今天就到这里，下次再较量！', beaten: '……还不赖嘛。我会变得更强再来。' },
  { arrive: '我的队伍又壮大了。这一次，你可别让我失望。', leave: '哼，算你走运。下次再较量！', beaten: '输了就是输了。你的城市守得真牢。' },
  { arrive: '最后一战！把你最强的宝可梦都叫出来吧！', leave: '胜负留到下一次——我们还会再见。', beaten: '我认输。你配得上这片土地。' },
];
