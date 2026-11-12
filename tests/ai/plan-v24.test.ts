import { expect, test } from 'vitest';
import { contentFor } from '../../src/content/units.ts';
import { wanderersFor } from '../../src/content/roster.ts';
import { createGame } from '../../src/core/game.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { emptyKnowledge, observe, refreshKnowledge } from '../../src/core/vision.ts';
import { step } from '../../src/core/step.ts';
import { hexDistance, hexToIndex } from '../../src/core/hex.ts';
import type { Hex } from '../../src/core/hex.ts';
import type { AiPersonality, GameSetup, GameState } from '../../src/core/model.ts';
import { canProduceSettler, planNext } from '../../src/ai/plan.ts';
import { RULE_QUERIES } from '../../src/ai/query.ts';
import { rivalResponseTeam } from '../../src/ai/rival-plan.ts';

const setup = (gameplayVersion: 23 | 24): GameSetup => ({ seed: 12345, width: 24, height: 16, expansionVersion: 1, multiplayer: true, eraProgression: 'simple-v1', gameplayVersion,
  players: [{ id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, { id: 1, controller: 'human', starterId: 'charmander', leaderId: 'misty' }] });
const at = (col: number, row: number): Hex => ({ q: col - Math.floor(row / 2), r: row });
/** An explored all-grassland map (v24 features without hills or water) with the two capitals far apart and no units. */
function open(version: 23 | 24, personality: AiPersonality): GameState {
  const state = createGame(setup(version));
  state.units = {};
  state.map.tiles = state.map.tiles.map(() => 'grassland');
  if (version === 24) state.map.features = { hills: [], peaks: [], rivers: [], lakes: [], deep: [], landmarks: [] };
  else delete state.map.features;
  state.cities[state.players[0].headquartersCityId].position = at(4, 4);
  state.cities[state.players[1].headquartersCityId].position = at(18, 12);
  state.players[0].personality = personality;
  state.knowledge[0] = emptyKnowledge(); state.knowledge[1] = emptyKnowledge();
  state.knowledge[0].exploredTileIds = state.map.tiles.map((_, i) => i);
  state.map.tiles.forEach((biomeId, i) => { state.knowledge[0].rememberedTiles[i] = { biomeId, territoryOwnerIds: [] }; });
  refreshKnowledge(state);
  return state;
}
/** Plays player 0's commands until it ends its turn; returns the commands. */
function playTurn(state: GameState): { state: GameState; actions: string[] } {
  const content = contentFor(state.setup), actions: string[] = [];
  for (let i = 0; i < 200; i++) {
    const view = observe(state, 0, content), command = planNext(view, { ...RULE_QUERIES, content });
    if (command.action.type === 'EndTurn') break;
    actions.push(JSON.stringify(command.action));
    const result = step(state, command, content);
    if (!result.ok) break;
    state = result.state;
  }
  return { state, actions };
}

test('v24 opening: settlers overlap while cities + settlers stay under 3 and each has a known site', () => {
  const state = open(24, 'expansion'), content = contentFor(state.setup);
  state.units[9100] = createMapUnit({ kind: 'logistics', role: 'settler' }, 9100, 0, at(8, 4), content, 0, 1);
  refreshKnowledge(state);
  const view = observe(state, 0, content);
  expect(canProduceSettler(view, undefined, true)).toBe(false);
  expect(canProduceSettler(view, undefined, true, 1)).toBe(false);
  expect(canProduceSettler(view, undefined, true, 2)).toBe(true);
  view.economy.cities.push({ ...view.economy.cities[0], id: 99 });
  expect(canProduceSettler(view, undefined, true, 5)).toBe(false);
});
test.each([24, 23] as const)('opening settler comes first for a conservative civilization on v24 only (v%i)', version => {
  const { state } = playTurn(open(version, 'conservative'));
  const queue = state.cities[state.players[0].headquartersCityId].queue.map(order => order.item.kind === 'logistics' ? order.item.defId : order.item.kind);
  if (version === 24) expect(queue).toEqual(['settler']);
  else expect(queue).not.toContain('settler');
});
test('v24: a settler never steps next to a wild Pokémon that strikes, and steps away from one', () => {
  const state = open(24, 'expansion'), content = contentFor(state.setup);
  const striker = Object.keys(content.species).find(id => !wanderersFor(content).includes(id as never) && content.species[id as never].terrain.includes('grassland'))!;
  // Next to the capital (no site), the striker one step away towards the free land.
  state.units[9100] = createMapUnit({ kind: 'logistics', role: 'settler' }, 9100, 0, at(5, 4), content, 0, 1);
  state.units[9200] = createMapUnit({ kind: 'pokemon', speciesId: striker as never }, 9200, null, at(6, 4), content, 0, 1);
  refreshKnowledge(state);
  const { state: next, actions } = playTurn(state), after = next.units[9100];
  expect(actions.some(action => action.includes('"unitId":9100'))).toBe(true);
  expect(after.location === 'map' && hexDistance(after.position, at(6, 4), state.map)).toBeGreaterThan(1);
});
test.each([24, 23] as const)('rival response team: favourable matchups within reach, never busy units (v%i)', version => {
  const state = open(version, 'conservative'), content = contentFor(state.setup);
  // Player 0 started with Bulbasaur, so its rival brings fire: Squirtle is the counter, a Bulbasaur is not.
  state.units[9300] = createMapUnit({ kind: 'pokemon', speciesId: 'charmander' }, 9300, null, at(8, 4), content, 0, 1);
  if (state.expansion?.rivals) { state.expansion.rivals.unitTargets[9300] = 0; state.expansion.rivals.spirit[9300] = 0; }
  state.units[9100] = createMapUnit({ kind: 'pokemon', speciesId: 'squirtle' }, 9100, 0, at(6, 4), content, 0, 1);
  state.units[9101] = createMapUnit({ kind: 'pokemon', speciesId: 'bulbasaur' }, 9101, 0, at(6, 5), content, 0, 1);
  state.units[9102] = createMapUnit({ kind: 'pokemon', speciesId: 'squirtle' }, 9102, 0, at(6, 6), content, 0, 1);
  state.units[9103] = createMapUnit({ kind: 'pokemon', speciesId: 'squirtle' }, 9103, 0, at(22, 14), content, 0, 1);
  refreshKnowledge(state);
  const view = observe(state, 0, content);
  const team = rivalResponseTeam(view, content, unit => unit.id === 9102);
  if (version === 23) expect([...team.keys()]).toEqual([]);
  else expect([...team.keys()]).toEqual([9100]);
});
test('v24: a Pokémon on the water leaves a tile next to a striking wild Pokémon and never ends next to one at sea', () => {
  const state = open(24, 'expansion'), content = contentFor(state.setup);
  const water = (hex: Hex) => state.map.tiles[hexToIndex(hex, state.map)!] === 'ocean';
  state.map.tiles = state.map.tiles.map((biome, i) => i % state.map.width >= 10 && i % state.map.width <= 14 ? 'ocean' : biome);
  state.map.tiles.forEach((biomeId, i) => { state.knowledge[0].rememberedTiles[i] = { biomeId, territoryOwnerIds: [] }; });
  state.players[0].research.unlockedIds.push('seafaring');
  const striker = Object.keys(content.species).find(id => !wanderersFor(content).includes(id as never) && content.species[id as never].terrain.includes('grassland'))!;
  state.units[9100] = createMapUnit({ kind: 'pokemon', speciesId: 'machop' }, 9100, 0, at(10, 4), content, 0, 1);
  state.units[9200] = createMapUnit({ kind: 'pokemon', speciesId: striker as never }, 9200, null, at(9, 4), content, 0, 1);
  refreshKnowledge(state);
  expect(water(at(10, 4))).toBe(true);
  const after = playTurn(state).state.units[9100];
  expect(after.location).toBe('map');
  if (after.location !== 'map') return;
  expect(hexDistance(after.position, at(10, 4), state.map)).toBeGreaterThan(0);
  expect(water(after.position) && hexDistance(after.position, at(9, 4), state.map) <= 1).toBe(false);
});
