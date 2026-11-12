// Gameplay v24 B (docs/design/world-v24.md §3): gym circuit leaders, team strength by badges held, Elite Four, rewards.
// All names are original. Numbers are integers; the authority, the view and the AI read the same tables.
import type { EssenceId } from './essences.ts';
import type { TypeId } from './species.ts';
import type { StarterId } from './units.ts';

export type GymLeaderId = EssenceId | 'dragon';
/** Original leaders, one per essence plus the dragon gym (§3.1). */
export const GYM_LEADERS: Record<GymLeaderId, { name: string }> = {
  life: { name: '风铃' }, sylvan: { name: '苔衣' }, earth: { name: '磐叔' }, tide: { name: '汐澄' },
  spark: { name: '铁闪' }, mind: { name: '灵雪' }, blaze: { name: '烛影' }, dragon: { name: '渊鳞' },
};
/** A gym's type is picked (stableSeed) from its leader's group; the dragon gym is always dragon. */
export const GYM_TYPES: Record<GymLeaderId, readonly TypeId[]> = {
  life: ['normal', 'flying'], sylvan: ['grass', 'bug', 'poison'], earth: ['rock', 'ground', 'fighting'], tide: ['water', 'ice'],
  spark: ['electric', 'steel'], mind: ['psychic', 'fairy'], blaze: ['fire', 'ghost', 'dark'], dragon: ['dragon'],
};
/** The home gym: a type your starter beats, like the first gym of the games (§3.1). */
export const HOME_GYMS: Record<StarterId, { leader: GymLeaderId; typeId: TypeId }> = {
  bulbasaur: { leader: 'tide', typeId: 'water' }, charmander: { leader: 'sylvan', typeId: 'grass' }, squirtle: { leader: 'blaze', typeId: 'fire' },
};
/** Placement order of the leaders that are not a home gym: missing essences first, the dragon gym last. */
export const GYM_LEADER_ORDER: readonly GymLeaderId[] = ['life', 'sylvan', 'earth', 'tide', 'spark', 'mind', 'blaze', 'dragon'];
export const GYM_RULES_V24 = {
  gymCount: 8, homeGymDistance: [5, 8], minCapitalDistance: 4, minSpacing: 4, minOverseas: 2,
  maxTeam: 3, siteRange: 2, cooldownRounds: 3,
  /** Leader team by the challenger's badges held (0..7): members, stage and total power (maxHp + attack + defense). */
  teams: [
    { members: 1, stage: 1, power: 170 }, { members: 1, stage: 1, power: 200 }, { members: 2, stage: 1, power: 300 }, { members: 2, stage: 2, power: 380 },
    { members: 2, stage: 2, power: 440 }, { members: 3, stage: 2, power: 560 }, { members: 3, stage: 3, power: 640 }, { members: 3, stage: 3, power: 700 },
  ],
  reward: { goldPerBadge: 15, essence: 10, xp: 20 },
  /** Era score at these badge counts (milestone `gymBadge`, +1 each). */
  eraBadges: [1, 4, 8],
  eliteFour: { team: 6, cooldownRounds: 10, healPercentBetween: 50, gold: 100, titlesPerGame: 1 },
} as const;
/** Four battles and the champion; each team is stage-3 Pokémon of the listed types. The spec's 620/660/700/760/880 gave a 92% win rate to
 *  six random stage-3 Pokémon at full HP; ×1.1 gives 62% (target ~60%, docs/design/world-v24.md §3.2, §10). */
export const ELITE_FOUR: readonly { name: string; title: string; typeIds: readonly TypeId[]; members: number; power: number }[] = [
  { name: '霜岭', title: '四天王', typeIds: ['ice'], members: 3, power: 680 },
  { name: '夜鸦', title: '四天王', typeIds: ['dark'], members: 3, power: 725 },
  { name: '钢心', title: '四天王', typeIds: ['steel'], members: 3, power: 770 },
  { name: '苍空', title: '四天王', typeIds: ['flying'], members: 3, power: 835 },
  { name: '曜', title: '冠军', typeIds: ['dragon', 'fire', 'water', 'grass'], members: 4, power: 970 },
];
export const STAGE_NAMES: Record<number, string> = { 1: '一阶', 2: '二阶', 3: '三阶' };
