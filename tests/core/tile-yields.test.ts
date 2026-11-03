import { expect, test } from 'vitest';
import { EXPANSION_CONTENT } from '../../src/content/units.ts';
import { WORLD_DEFINITIONS } from '../../src/content/world-systems.ts';
import type { BerryId } from '../../src/content/world-systems.ts';
import { RULE_QUERIES } from '../../src/ai/query.ts';
import { planNext } from '../../src/ai/plan.ts';
import { createGame } from '../../src/core/game.ts';
import { workedTileYield } from '../../src/core/city.ts';
import { hexToIndex } from '../../src/core/hex.ts';
import { observe } from '../../src/core/vision.ts';
import { step } from '../../src/core/step.ts';
import type { Command, GameSetup, GameState } from '../../src/core/model.ts';
import { tileYieldReader } from '../../src/browser/tile-yields.ts';

function playedV10(rounds: number): GameState {
  const setup: GameSetup = { seed: 7, width: 30, height: 20, roundLimit: 100, expansionVersion: 1, eraProgression: 'simple-v1', gameplayVersion: 10, players: [
    { id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'brock' }, { id: 1, controller: 'ai', personality: 'expansion', leaderId: 'misty' },
    { id: 2, controller: 'ai', personality: 'aggressive', leaderId: 'lance' }] };
  let state = createGame(setup, EXPANSION_CONTENT);
  while (!state.outcome && state.round < rounds) {
    const view = observe(state, state.activePlayerId, EXPANSION_CONTENT);
    let command: Command = planNext(view, { ...RULE_QUERIES, content: EXPANSION_CONTENT }, []);
    let result = step(state, command, EXPANSION_CONTENT);
    if (!result.ok) { command = { actorId: view.playerId, expectedSeq: view.commandSeq, action: { type: 'EndTurn' } }; result = step(state, command, EXPANSION_CONTENT); }
    if (!result.ok) throw new Error(result.reason);
    state = result.state;
  }
  return state;
}

test('map tile yields equal what the rules pay for working each visible tile', () => {
  const state = playedV10(60), view = observe(state, 0, EXPANSION_CONTENT), read = tileYieldReader(view);
  const cityTiles = new Set(Object.values(state.cities).map(city => hexToIndex(city.position, state.map)));
  const districtTiles = new Set(Object.keys(state.expansion?.districts?.tiles ?? {}).map(Number));
  let compared = 0, improved = 0;
  for (const index of view.visibleTileIds) {
    const info = read(index);
    if (cityTiles.has(index) || districtTiles.has(index)) { expect(info).toBeNull(); continue; }
    const expected = workedTileYield(state, index, state.players[0], EXPANSION_CONTENT);
    const resource = state.expansion!.world.resources[index];
    if (resource?.kind === 'berry') expected.food += Math.max(1, Math.floor(WORLD_DEFINITIONS.berries[resource.definitionId as BerryId].food / 4));
    else if (resource?.kind === 'stone') expected.production += 1;
    expect(info?.yields, `tile ${index}`).toEqual(expected);
    compared++;
    if (state.expansion?.improvements?.tiles[index]) improved++;
  }
  expect(compared).toBeGreaterThan(25);
  expect(improved).toBeGreaterThan(0);
}, 30_000);
