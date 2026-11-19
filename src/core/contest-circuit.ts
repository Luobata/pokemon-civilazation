// Gameplay v27 ⑦ (docs/design/pace-v27.md §8, option 7A): the contest circuit — EnterContest from in or next to any own city (halls still
// add points), placing prizes (1st: a TM of the category and +1 era score; 2nd / 3rd: gold; every other entrant: XP), and the rehearsal
// bonus of city projects (③ writes, ⑦ reads `seasonScoreBonus`). Wired once each in src/core/contest-seasons.ts: the entry cities
// (authority and view mirror), the entry score and the judging. No randomness; integers; every prize is in a public event, the TM goes
// to the winner's own (private) stock.
import { ERA_MILESTONES } from '../content/era-honors.ts';
import { eventsTuning } from '../content/pace-v27.ts';
import type { TypeId } from '../content/species.ts';
import type { Content, SpeciesId } from '../content/units.ts';
import { isMapUnit } from './model.ts';
import type { EventPayload, GameState } from './model.ts';
import type { ContestCategory, ContestEntry, ContestPlacing } from './contest-seasons.ts';
import { rehearsalScoreBonus } from './city-projects.ts';

/** The TM type a category's winner receives: the category's first type (`CONTEST_CATEGORY_INFO`, mirrored here to avoid an import cycle). */
export const CIRCUIT_PRIZE_TYPES: Record<ContestCategory, TypeId> = { cool: 'fire', beauty: 'water', cute: 'normal', smart: 'psychic', tough: 'rock' };
export type CircuitPrize = { place: number; playerId: number; speciesId: SpeciesId; tm?: TypeId; eraScore?: number; gold?: number; xp?: number; unitId?: number };
export type ContestCircuitEvent = { type: 'ContestCircuitPrizes'; public: true; season: number; category: ContestCategory; prizes: CircuitPrize[] };

/** City ids a Pokémon may enter from (in or next to): the contest halls before v27, every own city with the circuit. Same rule for the authority and the view. */
export function contestEntryCityIds(halls: readonly number[], ownCityIds: readonly number[], content: Content): readonly number[] {
  if (!content.contestCircuit) return halls;
  return [...new Set([...halls, ...ownCityIds])].sort((a, b) => a - b);
}
/** ③ → ⑦: extra season score for `playerId`'s entrant this season (the contest rehearsal project); 0 before v27. */
export function seasonScoreBonus(state: GameState, playerId: number, content: Content): number {
  if (!content.contestCircuit) return 0;
  return rehearsalScoreBonus(state, playerId, content);
}
/** The prizes of the placings (what the season card shows ahead: same table as the judging). */
export function circuitPrizeFor(place: number, category: ContestCategory, content: Content): Omit<CircuitPrize, 'playerId' | 'speciesId' | 'place' | 'unitId'> {
  const tuning = eventsTuning(content);
  if (place === 1) return { tm: CIRCUIT_PRIZE_TYPES[category], eraScore: ERA_MILESTONES.contestSeasonWon.points };
  if (place === 2 || place === 3) return { gold: tuning.circuitGold[place - 2] };
  return { xp: tuning.circuitEntrantXp };
}
/** Placing prizes after a season is judged ([] before v27); `entries` are the season's entries (cleared from the ledger by the caller). */
export function resolveCircuitPrizes(state: GameState, placings: readonly ContestPlacing[], entries: Readonly<Record<number, ContestEntry>>, season: { number: number; category: ContestCategory },
  content: Content): EventPayload[] {
  if (!content.contestCircuit || !placings.length) return [];
  const prizes: CircuitPrize[] = [];
  for (const placing of placings) {
    const prize = circuitPrizeFor(placing.place, season.category, content), player = state.players[placing.playerId];
    const item: CircuitPrize = { place: placing.place, playerId: placing.playerId, speciesId: placing.speciesId, ...prize };
    if (prize.tm) {
      const sinks = state.expansion?.goldSinks;
      if (sinks) ((sinks.prizeTms ??= {})[placing.playerId] ??= []).push(prize.tm);
      else delete item.tm;
      const honor = state.expansion?.eraHonors?.players[placing.playerId];
      if (honor) { honor.score += prize.eraScore!; honor.byMilestone.contestSeasonWon = (honor.byMilestone.contestSeasonWon ?? 0) + 1; }
      else delete item.eraScore;
    }
    if (prize.gold) player.gold += prize.gold;
    if (prize.xp) {
      // The performer gains the XP if it still stands on the map (else nobody does).
      const unit = state.units[entries[placing.playerId]?.unitId ?? -1];
      if (unit && isMapUnit(unit) && unit.ownerId === placing.playerId && unit.kind === 'pokemon') { unit.xp += prize.xp; item.unitId = unit.id; }
      else delete item.xp;
    }
    prizes.push(item);
  }
  return [{ type: 'ContestCircuitPrizes', public: true, season: season.number, category: season.category, prizes }];
}
