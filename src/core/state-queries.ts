// Pure read-only state queries shared across core subsystems (zero dependencies on domain modules).
import { lateTuning } from '../content/depth-v26.ts';
import { eraState } from '../content/eras.ts';
import type { EraProgression } from '../content/eras.ts';
import type { TypeId } from '../content/species.ts';
import type { Content } from '../content/units.ts';
import type { GameState } from './model.ts';

/** Pokémon generation reached by a player (1 = Red/Green/Blue/Yellow). */
export function generationOf(player: { research: { unlockedIds: readonly string[] } }, mode: EraProgression | undefined): number {
  const era = eraState(player, mode);
  return era ? Number(era.current.id.replace('generation-', '')) : 1;
}

/** The TM type a unit carries in battle (undefined = none). */
export const taughtMoveType = (state: Pick<GameState, 'expansion'>, unitId: number): TypeId | undefined =>
  state.expansion?.goldSinks?.moves[unitId];

export const isRivalUnit = (state: Pick<GameState, 'expansion'>, unitId: number): boolean =>
  state.expansion?.rivals?.unitTargets[unitId] !== undefined;

/** 劲敌气势 of a unit (0 for everyone but rival Pokémon): authority and preview read the same number. */
export const rivalSpirit = (state: Pick<GameState, 'expansion'>, unitId: number): number =>
  state.expansion?.rivals?.spirit[unitId] ?? 0;

export const isRaidUnit = (state: Pick<GameState, 'expansion'>, unitId: number): boolean =>
  state.expansion?.raids?.active?.unitId === unitId;

/** Season rounds of a game (45, 60 … within the round limit). */
export function seasonRounds(content: Content, roundLimit: number): number[] {
  const tuning = lateTuning(content), rounds: number[] = [];
  for (let round = tuning.seasonFirstRound; round <= roundLimit; round += tuning.seasonInterval) rounds.push(round);
  return rounds;
}

/** The season judged at or after `round` (index and round), null after the last one. */
export function currentSeason(content: Content, round: number, roundLimit: number): { index: number; round: number } | null {
  const rounds = seasonRounds(content, roundLimit), index = rounds.findIndex(item => item >= round);
  return index < 0 ? null : { index, round: rounds[index] };
}

export function leaderVisionBonus(state: GameState, playerId: number, cityId: number): number {
  const ledger = state.expansion?.leaders.players[playerId];
  const id = state.players[playerId].leaderId;
  if (!ledger) return 0;
  if (id === 'jenny') return Number(ledger.activeUntilRound >= state.round) + Number(ledger.uniqueCityIds.includes(cityId));
  return id === 'jasmine' ? Number(ledger.activeUntilRound >= state.round) : 0;
}

export function leaderCityYield(state: GameState, cityId: number): { food: number; production: number; gold: number; research: number } {
  const city = state.cities[cityId], owner = city.ownerId;
  const none = { food: 0, production: 0, gold: 0, research: 0 };
  if (owner === null || !state.expansion?.leaders.players[owner]?.uniqueCityIds.includes(cityId)) return none;
  switch (state.players[owner].leaderId) {
    case 'oak': return { ...none, research: 2 };
    case 'lance': return { ...none, production: 2 };
    case 'jenny': return { ...none, gold: 2 };
    case 'joy': return { ...none, food: 2 };
    case 'brock': return { ...none, production: 2 };
    case 'misty': return { ...none, food: 2 };
    case 'steven': return { ...none, research: 2 };
    case 'jasmine': return { ...none, gold: 2 };
    case 'giovanni': return { ...none, gold: 2 };
    default: return none;
  }
}
