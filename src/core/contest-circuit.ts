// Gameplay v27 ⑦ (docs/design/pace-v27.md §8, option 7A): the contest circuit — EnterContest from in or next to any own city (halls still
// add points), placing prizes (1st: a TM of the category and +1 era score; 2nd / 3rd: gold; every other entrant: XP), and the rehearsal
// bonus of city projects (③ writes, ⑦ reads `seasonScoreBonus`). Stub: the events lane fills it in. Wired once each in
// src/core/contest-seasons.ts: the entry cities (authority and view mirror), the entry score and the judging.
import type { Content } from '../content/units.ts';
import type { EventPayload, GameState } from './model.ts';
import type { ContestPlacing } from './contest-seasons.ts';
import { rehearsalScoreBonus } from './city-projects.ts';

/** City ids a Pokémon may enter from (in or next to): the contest halls before v27. Same rule for the authority and the view. */
export function contestEntryCityIds(halls: readonly number[], _ownCityIds: readonly number[], content: Content): readonly number[] {
  if (!content.contestCircuit) return halls;
  return halls;
}
/** ③ → ⑦: extra season score for `playerId`'s entrant this season (the contest rehearsal project); 0 before v27. */
export function seasonScoreBonus(state: GameState, playerId: number, content: Content): number {
  if (!content.contestCircuit) return 0;
  return rehearsalScoreBonus(state, playerId, content);
}
/** Placing prizes after a season is judged ([] before v27). */
export function resolveCircuitPrizes(_state: GameState, _placings: readonly ContestPlacing[], content: Content): EventPayload[] {
  if (!content.contestCircuit) return [];
  return [];
}
