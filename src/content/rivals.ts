// Gameplay v24 C (docs/design/world-v24.md §4): rival trainers — schedule, counters by starter, strength offsets, rewards, names.
// Names and lines are original. Integers only.
import type { StarterId } from './units.ts';
import type { SpeciesId, TypeId } from './species.ts';

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
/**
 * v25 (fix 4 of docs/design/balance/gate-v24-ai.md): later visits were almost never beaten (v24 gate: 30% / 5% / 1.5% of visits). The
 * offsets are capped by `strengthCap` (±12 around each species' attack), so the later visits also stay longer. Probe, seeds 31–34 × 27
 * gate games to round 60: [-10, -12, -13] with stays [6, 7, 9] → 25% / 23% / 22% beaten (offsets alone at stay 6: 31% / 10% / 10%).
 */
export const RIVAL_RULES_V25 = { strengthOffsets: [-10, -12, -13], staysRounds: [6, 7, 9] } as const;
/**
 * v26 (docs/design/depth-v26.md §3.6): with duels a second way to win, the v25 offsets (set for map fights only) are too soft; the duel
 * prototype is steep between 气势 −5 and 0. Interim values after two gates (docs/design/balance/gate-v26-core.md): the beaten-per-visit rate
 * measures when the AI chooses to duel, so difficulty is read from the best-lineup estimate at arrival instead (the stays stay as in v25).
 */
export const RIVAL_RULES_V26 = {
  /**
   * The first visit sends a species neutral to the starter (`rivalNeutrals`), so its offset is calibrated on its own: the mean best-lineup
   * estimate of starter-only civilizations at arrival (gate setup, seeds 31–32) is 91% at −5, 66% at 0, 18% at +3, 3% at +6; +1 aims at
   * the 30–60% band (docs/design/balance/gate-v26.md). Visits 2–3 keep the interim −4 / 0 and their counters.
   */
  strengthOffsets: [1, -4, 0],
} as const;
/** Primary and secondary counters to each starter (§4.1), whole evolution lines so every visit finds its stage. */
export const RIVAL_COUNTERS: Record<StarterId, { primary: readonly SpeciesId[]; secondary: readonly SpeciesId[] }> = {
  bulbasaur: { primary: ['charmander', 'charmeleon', 'charizard', 'ponyta', 'rapidash'], secondary: ['pidgey', 'pidgeotto', 'pidgeot'] },
  charmander: { primary: ['squirtle', 'wartortle', 'blastoise'], secondary: ['geodude', 'graveler', 'golem'] },
  squirtle: { primary: ['bulbasaur', 'ivysaur', 'venusaur', 'exeggcute', 'exeggutor'], secondary: ['pikachu', 'raichu', 'magnemite', 'magneton'] },
};
/** v25 (roster-v25 §2.4): the same counters written as types, filled from the regional Pokédex (land species, primary type first, else
 * secondary). Each type keeps a line that is always regional: fire charmander, water squirtle, grass bulbasaur, electric pikachu,
 * rock geodude, flying the charizard line (secondary type). */
export const RIVAL_COUNTER_TYPES_V25: Record<StarterId, { primary: TypeId; secondary: TypeId }> = {
  bulbasaur: { primary: 'fire', secondary: 'flying' },
  charmander: { primary: 'water', secondary: 'rock' },
  squirtle: { primary: 'grass', secondary: 'electric' },
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
