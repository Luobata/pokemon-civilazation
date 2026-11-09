import { expect, test } from 'vitest';
import { IMPROVEMENT_CONTENT, WORLD_CONTENT } from '../../src/content/units.ts';
import type { GameplayVersion } from '../../src/content/eras.ts';
import { IMPROVEMENT_RULES_V23 } from '../../src/content/improvements.ts';
import { createGame } from '../../src/core/game.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { hexDistance, indexToHex } from '../../src/core/hex.ts';
import { observe, projectEvents, refreshKnowledge } from '../../src/core/vision.ts';
import { step } from '../../src/core/step.ts';
import { workedTileYield } from '../../src/core/city.ts';
import { leaguePointsPerRound } from '../../src/core/policies.ts';
import { viewPillage, viewRepairs } from '../../src/core/pillage.ts';
import { buildScene } from '../../src/browser/render/scene.ts';
import type { Command, GameSetup, GameState } from '../../src/core/model.ts';

const duel = (gameplayVersion: GameplayVersion): GameSetup => ({ seed: 12345, width: 24, height: 16, expansionVersion: 1, multiplayer: true, eraProgression: 'simple-v1', gameplayVersion,
  players: [{ id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, { id: 1, controller: 'human', starterId: 'charmander', leaderId: 'misty' }] });
const as = (state: GameState, actorId: number, action: Command['action']) => {
  state.activePlayerId = actorId;
  return step(state, { actorId, expectedSeq: state.commandSeq, action }, IMPROVEMENT_CONTENT);
};

/** Player 0 owns a farm next to its capital; player 1 has a Pokémon standing on it. */
function raid(version: GameplayVersion = 23, war = true) {
  const state = createGame(duel(version)), capital = state.cities[state.players[0].headquartersCityId];
  const tileIndex = capital.workedTileIds.find(index => state.map.tiles[index] === 'grassland')
    ?? state.map.tiles.findIndex((biome, index) => biome === 'grassland' && hexDistance(indexToHex(index, state.map), capital.position, state.map) === 1);
  if (!capital.workedTileIds.includes(tileIndex)) capital.workedTileIds = [tileIndex];
  state.expansion!.improvements!.tiles[tileIndex] = { kind: 'berryFarm', builtBy: 0, builtAtRound: 0 };
  const raider = createMapUnit({ kind: 'pokemon', speciesId: 'charmander' }, 9100, 1, indexToHex(tileIndex, state.map), IMPROVEMENT_CONTENT, 0, 1);
  state.units[9100] = raider;
  if (war) state.diplomacy[0].status = 'war';
  refreshKnowledge(state);
  return { state, capital, tileIndex };
}

test('pillage: only at war, on an intact enemy improvement; damages it and pays the raider', () => {
  const peace = raid(23, false);
  expect(as(peace.state, 1, { type: 'PillageImprovement', unitId: 9100 }).ok).toBe(false);
  const { state, tileIndex } = raid();
  expect(viewPillage(observe(state, 1, IMPROVEMENT_CONTENT), 9100)).toMatchObject({ tileIndex, kind: 'berryFarm', reward: { kind: 'food', amount: IMPROVEMENT_RULES_V23.pillage.food } });
  const raiderCity = state.cities[state.players[1].headquartersCityId], food = raiderCity.food;
  const before = workedTileYield(state, tileIndex, state.players[0], IMPROVEMENT_CONTENT);
  const result = as(state, 1, { type: 'PillageImprovement', unitId: 9100 });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const next = result.state;
  expect(next.expansion!.improvements!.tiles[tileIndex]).toMatchObject({ kind: 'berryFarm', damaged: true });
  expect(next.cities[raiderCity.id].food).toBe(food + IMPROVEMENT_RULES_V23.pillage.food);
  expect(next.units[9100].actionLeft).toBe(0);
  expect(workedTileYield(next, tileIndex, next.players[0], IMPROVEMENT_CONTENT).food).toBe(before.food - 1);
  // Cannot pillage twice; the same unit has no action anyway, a fresh one is refused too.
  next.units[9100].actionLeft = 1;
  expect(as(next, 1, { type: 'PillageImprovement', unitId: 9100 }).ok).toBe(false);
  // Event reaches the victim and the raider.
  expect(projectEvents(state, next, result.events, 0, IMPROVEMENT_CONTENT).some(event => event.payload.type === 'ImprovementPillaged')).toBe(true);
  expect(projectEvents(state, next, result.events, 1, IMPROVEMENT_CONTENT).some(event => event.payload.type === 'ImprovementPillaged')).toBe(true);
});

test('pillage is unknown before v23', () => {
  const { state } = raid(22);
  state.activePlayerId = 1;
  expect(step(state, { actorId: 1, expectedSeq: state.commandSeq, action: { type: 'PillageImprovement', unitId: 9100 } }, WORLD_CONTENT).ok).toBe(false);
});

test('a damaged improvement stops counting for league points and is repaired by a builder without a charge', () => {
  const { state, tileIndex } = raid();
  const points = leaguePointsPerRound(state, 0);
  state.expansion!.improvements!.tiles[1000] = { kind: 'mine', builtBy: 0, builtAtRound: 0 };
  const two = leaguePointsPerRound(state, 0);
  expect(two).toBe(points + 1);
  delete state.expansion!.improvements!.tiles[1000];
  const pillaged = as(state, 1, { type: 'PillageImprovement', unitId: 9100 });
  expect(pillaged.ok).toBe(true);
  if (!pillaged.ok) return;
  const next = pillaged.state;
  delete next.units[9100];
  const builder = createMapUnit({ kind: 'logistics', role: 'builder' }, 9000, 0, indexToHex(tileIndex, next.map), IMPROVEMENT_CONTENT, 0, 1);
  builder.charges = 2; next.units[9000] = builder; refreshKnowledge(next);
  expect(viewRepairs(observe(next, 0, IMPROVEMENT_CONTENT), 9000, IMPROVEMENT_CONTENT)).toEqual([tileIndex]);
  const repaired = as(next, 0, { type: 'RepairImprovement', unitId: 9000, tileIndex });
  expect(repaired.ok).toBe(true);
  if (!repaired.ok) return;
  expect(repaired.state.expansion!.improvements!.tiles[tileIndex].damaged).toBeUndefined();
  expect(repaired.state.units[9000]).toMatchObject({ charges: 2, actionLeft: 0 });
});

test('fog: a pillage you cannot see does not change your view of the improvement', () => {
  const { state, tileIndex } = raid();
  // Player 1 saw the farm intact through its raider.
  const remembered = state.knowledge[1].rememberedTiles[tileIndex];
  expect(remembered.improvement).toMatchObject({ kind: 'berryFarm' });
  expect(remembered.improvement?.damaged).toBeUndefined();
  // Damage it behind player 1's back (e.g. a third party), while player 1 cannot see the tile.
  delete state.units[9100];
  const visibleBefore = observe(state, 1, IMPROVEMENT_CONTENT).visibleTileIds.includes(tileIndex);
  state.expansion!.improvements!.tiles[tileIndex].damaged = true;
  const view = observe(state, 1, IMPROVEMENT_CONTENT).expansion!.improvements!.tiles.find(tile => tile.tileIndex === tileIndex);
  expect(visibleBefore).toBe(false);
  expect(view).toMatchObject({ kind: 'berryFarm' });
  expect(view?.damaged).toBeUndefined();
  // The owner always sees its own territory live.
  expect(observe(state, 0, IMPROVEMENT_CONTENT).expansion!.improvements!.tiles.find(tile => tile.tileIndex === tileIndex)?.damaged).toBe(true);
});

test('map scene: a damaged improvement carries the damaged mark (drawn on every wrapped copy); intact ones do not', () => {
  const { state, tileIndex } = raid();
  const intact = buildScene({ view: observe(state, 0, IMPROVEMENT_CONTENT) }).improvements.find(item => item.index === tileIndex);
  expect(intact).toMatchObject({ kind: 'berryFarm' });
  expect(intact).not.toHaveProperty('damaged');
  state.expansion!.improvements!.tiles[tileIndex].damaged = true;
  const scene = buildScene({ view: observe(state, 0, IMPROVEMENT_CONTENT) });
  expect(scene.wrap).toBe(true);
  expect(scene.improvements.find(item => item.index === tileIndex)).toMatchObject({ kind: 'berryFarm', damaged: true });
});

test('v22 remembered tiles carry no improvement snapshot', () => {
  const { state, tileIndex } = raid(22);
  expect(state.knowledge[1].rememberedTiles[tileIndex]).not.toHaveProperty('improvement');
});
