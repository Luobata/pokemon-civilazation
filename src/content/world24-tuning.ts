// Gameplay v24 balance knobs (docs/design/world-v24.md §10, balance gate): the numbers a balance sweep may vary, carried on the v24
// `Content` only (`content.world24`), so `tools/patch.ts` can override them and older contents are untouched. Each module keeps its
// own rule table; this block only repeats the tunable values, and `world24Tuning(content)` falls back to the stock values.
import { ELITE_FOUR, GYM_RULES_V24 } from './gym-circuit.ts';
import { RIVAL_RULES_V24 } from './rivals.ts';
import { MAP_GENERATION_V24 } from './terrain.ts';

export type World24Tuning = {
  /** §2.1 land share of the map in percent (continents + islands). */
  landPercent: number;
  /** §4.1 rival arrival rounds (visit 1, 2, 3; increasing) and the 劲敌气势 offsets per visit. */
  rivalArrivals: number[]; rivalStrengthOffsets: number[];
  /** Tiles a rival Pokémon walks per round. */
  rivalStepsPerRound: number;
  /** §3.1 leader team power by the challenger's badges held (0..7); `gymLatePowerPercent` scales the rows for badges 5–8 (4..7 held). */
  gymTeamPower: number[]; gymLatePowerPercent: number;
  /** §3.2 Elite Four and champion team power (five battles). */
  eliteFourPower: number[];
};
/** Badges held from which `gymLatePowerPercent` applies (the 5th to 8th badge). */
export const GYM_LATE_BADGES_FROM = 4;
export const WORLD24_TUNING: World24Tuning = {
  landPercent: MAP_GENERATION_V24.landPercent,
  rivalArrivals: [...RIVAL_RULES_V24.arrivals], rivalStrengthOffsets: [...RIVAL_RULES_V24.strengthOffsets],
  rivalStepsPerRound: RIVAL_RULES_V24.stepsPerRound,
  gymTeamPower: GYM_RULES_V24.teams.map(row => row.power), gymLatePowerPercent: 100,
  eliteFourPower: ELITE_FOUR.map(member => member.power),
};
/** The tuning a content carries (the stock values when it has none, e.g. a view built without the v24 content). */
export const world24Tuning = (content: { world24?: World24Tuning } | undefined): World24Tuning => content?.world24 ?? WORLD24_TUNING;
/** Leader team power for a challenger holding `badges` badges (index clamped to the table). */
export function gymTeamPower(content: { world24?: World24Tuning } | undefined, badges: number): number {
  const tuning = world24Tuning(content), row = Math.max(0, Math.min(tuning.gymTeamPower.length - 1, badges));
  const power = tuning.gymTeamPower[row];
  return row >= GYM_LATE_BADGES_FROM && tuning.gymLatePowerPercent !== 100 ? Math.max(1, Math.floor(power * tuning.gymLatePowerPercent / 100)) : power;
}
