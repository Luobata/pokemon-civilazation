import type { CombatEvent, GameState, Score } from './model.ts';

export function scorePlayer(state: GameState, playerId: number): Score {
  const player = state.players[playerId];
  if (player.frozenScore) return { ...player.frozenScore };
  const cities = Object.values(state.cities).filter(city => city.ownerId === playerId);
  const score = { playerId, cities: cities.length, population: cities.reduce((sum, city) => sum + city.population, 0),
    species: player.registeredSpeciesIds.length, techs: player.research.unlockedIds.length, knockdowns: player.knockdownCount, total: 0 };
  const base = score.cities * 100 + score.population * 10 + score.species * 5 + score.techs * 20 + score.knockdowns * 2;
  score.total = Math.floor(base * (player.research.unlockedIds.includes('leagueRules') ? 1200 : 1000) / 1000);
  return score;
}
export function compareScores(a: Score, b: Score): number {
  return b.total - a.total || b.cities - a.cities || b.population - a.population || b.techs - a.techs || b.knockdowns - a.knockdowns;
}
export function finishGame(state: GameState, kind: 'conquest' | 'score' | 'playerDefeat', winners?: number[]): CombatEvent[] {
  const ranking = Object.keys(state.players).map(Number).map(id => scorePlayer(state, id)).sort((a, b) => compareScores(a, b) || a.playerId - b.playerId);
  const alive = ranking.filter(score => !state.players[score.playerId].eliminated);
  state.outcome = { kind, winners: winners ?? alive.filter(score => compareScores(score, alive[0]) === 0).map(score => score.playerId), ranking, round: state.round };
  return [{ type: 'GameEnded', outcome: JSON.parse(JSON.stringify(state.outcome)) }];
}
// Called only after HQ ownership transfer, inside step's unpublished transaction.
export function eliminateCivilization(state: GameState, playerId: number): CombatEvent[] {
  const player = state.players[playerId];
  for (const city of Object.values(state.cities)) if (city.ownerId === playerId) {
    city.ownerId = null; city.hp = 50; city.workedTileIds = []; city.lockedTileIds = [];
  }
  for (const unit of Object.values(state.units)) if (unit.ownerId === playerId) delete state.units[unit.id];
  player.frozenScore = scorePlayer(state, playerId); player.eliminated = true;
  state.turnOrder = state.turnOrder.filter(id => id !== playerId);
  for (const pair of state.diplomacy) if (pair.a === playerId || pair.b === playerId) pair.proposal = null;
  const events: CombatEvent[] = [{ type: 'CivilizationEliminated', eliminatedPlayerId: playerId }];
  if (player.controller === 'human') events.push(...finishGame(state, 'playerDefeat', []));
  else if (state.turnOrder.length === 1) events.push(...finishGame(state, 'conquest', [...state.turnOrder]));
  return events;
}
