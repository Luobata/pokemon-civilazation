// Gameplay v24 B (docs/design/world-v24.md §3): gym circuit leaders, team strength by badges held, Elite Four, rewards.
// Scaffolding: the spec's numbers; no rule reads them yet.
import type { EssenceId } from './essences.ts';

/** Original leaders, one per essence plus the dragon gym (§3.1). */
export const GYM_LEADERS: Record<EssenceId | 'dragon', { name: string }> = {
  life: { name: '风铃' }, sylvan: { name: '苔衣' }, earth: { name: '磐叔' }, tide: { name: '汐澄' },
  spark: { name: '铁闪' }, mind: { name: '灵雪' }, blaze: { name: '烛影' }, dragon: { name: '渊鳞' },
};
export const GYM_RULES_V24 = {
  gymCount: 8, homeGymDistance: [5, 8], minCapitalDistance: 4, minSpacing: 4, minOverseas: 2,
  maxTeam: 3, cooldownRounds: 3,
  /** Leader team by the challenger's badges held (0..7): members, stage and total power (maxHp + attack + defense). */
  teams: [
    { members: 1, stage: 1, power: 170 }, { members: 1, stage: 1, power: 200 }, { members: 2, stage: 1, power: 300 }, { members: 2, stage: 2, power: 380 },
    { members: 2, stage: 2, power: 440 }, { members: 3, stage: 2, power: 560 }, { members: 3, stage: 3, power: 640 }, { members: 3, stage: 3, power: 700 },
  ],
  reward: { goldPerBadge: 15, essence: 10, xp: 20 },
  eliteFour: { team: 6, cooldownRounds: 10, powers: [620, 660, 700, 760, 880], healPercentBetween: 50, gold: 100, titlesPerGame: 1 },
} as const;
