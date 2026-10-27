import { createGame } from '../../src/core/game.ts';
import { createCity } from '../../src/core/city.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { createRng } from '../../src/core/rng.ts';
import type { SpeciesId } from '../../src/content/species.ts';
import type { GameState, MapUnit, Command } from '../../src/core/model.ts';
import { emptyKnowledge, refreshKnowledge } from '../../src/core/vision.ts';
import { step } from '../../src/core/step.ts';

export function combatFixture(): GameState {
  const state = createGame({ seed: 12345, width: 24, height: 16, players: [
    { id: 0, controller: 'human', starterId: 'bulbasaur' }, { id: 1, controller: 'ai' },
  ] });
  state.map = { width: 16, height: 8, tiles: Array(128).fill('grassland') };
  state.cities = { 1: createCity(1, 0, { q: 2, r: 2 }, true), 2: createCity(2, 1, { q: 10, r: 2 }, true) };
  state.players[0].headquartersCityId = 1; state.players[1].headquartersCityId = 2;
  state.players[1].starterId = 'bulbasaur';
  state.players[0].gold = 1000; state.players[1].gold = 1000;
  state.units = {}; state.nextEntityId = 100; state.rng = createRng(1);
  state.knowledge = { 0: emptyKnowledge(), 1: emptyKnowledge() };
  return state;
}
export function pokemon(state: GameState, id = 10, speciesId: SpeciesId = 'charmander', ownerId: number | null = 0, q = 3, r = 3): MapUnit & { kind: 'pokemon' } {
  const unit = createMapUnit({ kind: 'pokemon', speciesId }, id, ownerId, { q, r }, undefined, 0, 1) as MapUnit & { kind: 'pokemon' };
  state.units[id] = unit; return unit;
}
export function issue(state: GameState, action: Command['action']) {
  refreshKnowledge(state);
  return step(state, { actorId: state.activePlayerId, expectedSeq: state.commandSeq, action });
}
export function accepted(state: GameState, action: Command['action']): GameState {
  const result = issue(state, action);
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}
