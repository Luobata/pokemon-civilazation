import { createGame } from '../../../src/core/game.ts';
import { emptyKnowledge, refreshKnowledge } from '../../../src/core/vision.ts';
import { hexToIndex, neighbors } from '../../../src/core/hex.ts';
import { DISTRICTS } from '../../../src/content/districts.ts';
import type { DistrictId } from '../../../src/content/districts.ts';
import { TECHS } from '../../../src/content/economy.ts';
import type { TechId } from '../../../src/content/economy.ts';
import type { GameplayVersion } from '../../../src/content/eras.ts';
import type { Command, GameState } from '../../../src/core/model.ts';
import { step } from '../../../src/core/step.ts';

/** Small controlled authority fixture for individual rule boundaries, not a browser save. */
export function districtFixture(kind: DistrictId = 'gardenDistrict', gameplayVersion: GameplayVersion = 10) {
  const state = createGame({ seed: 12345, width: 24, height: 16, roundLimit: 100, expansionVersion: 1,
    eraProgression: 'simple-v1', gameplayVersion, multiplayer: true, players: [
      { id: 0, controller: 'human', starterId: 'bulbasaur' }, { id: 1, controller: 'human', starterId: 'squirtle' },
    ] });
  state.map.tiles.fill('grassland'); state.units = {};
  const city = state.cities[1]; city.position = { q: 6, r: 6 }; city.population = 8; city.workedTileIds = []; city.lockedTileIds = [];
  state.cities[3].position = { q: 16, r: 10 }; state.cities[3].workedTileIds = []; state.cities[3].lockedTileIds = [];
  state.players[0].research.unlockedIds = Object.keys(TECHS) as TechId[];
  state.expansion!.rareBerries!.deposits = {};
  const position = { q: 7, r: 6 }, tile = hexToIndex(position, state.map)!;
  state.map.tiles[tile] = DISTRICTS[kind].biomes[0];
  const adjacent = neighbors(position, state.map).map(hex => hexToIndex(hex, state.map)!).sort((a, b) => a - b);
  state.knowledge = { 0: emptyKnowledge(), 1: emptyKnowledge() }; refreshKnowledge(state);
  return { state, city, tile, adjacent };
}
export function command(state: GameState, action: Command['action'], actorId = state.activePlayerId) {
  return step(state, { actorId, expectedSeq: state.commandSeq, action });
}
