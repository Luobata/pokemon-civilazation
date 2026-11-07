import { expect, test } from 'vitest';
import { ROSTER_CONTENT } from '../../src/content/units.ts';
import type { GameplayVersion } from '../../src/content/eras.ts';
import { createGame } from '../../src/core/game.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { hexDistance } from '../../src/core/hex.ts';
import { observe, refreshKnowledge } from '../../src/core/vision.ts';
import { step } from '../../src/core/step.ts';
import { movementBudget, reachablePaths } from '../../src/core/movement.ts';
import { gameVersions } from '../../src/core/versions.ts';
import type { Command, GameSetup, GameState, MapUnit } from '../../src/core/model.ts';

const duel = (gameplayVersion: GameplayVersion): GameSetup => ({ seed: 12345, width: 24, height: 16, expansionVersion: 1, multiplayer: true, eraProgression: 'simple-v1', gameplayVersion,
  players: [{ id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, { id: 1, controller: 'human', starterId: 'charmander', leaderId: 'misty' }] });
const act = (state: GameState, action: Command['action']) => step(state, { actorId: state.activePlayerId, expectedSeq: state.commandSeq, action });
/** Open grassland: player 0's Ponyta (move 5) at (6,6); a rival Machop (melee: zone of control) at (10,6); at war. */
function field(version: GameplayVersion): GameState {
  const state = createGame(duel(version));
  state.map.tiles.fill('grassland'); state.units = {};
  state.diplomacy[0].status = 'war';
  state.cities[state.players[0].headquartersCityId].position = { q: 1, r: 1 };
  state.cities[state.players[1].headquartersCityId].position = { q: 22, r: 14 };
  state.units[9000] = createMapUnit({ kind: 'pokemon', speciesId: 'ponyta' }, 9000, 0, { q: 6, r: 6 }, ROSTER_CONTENT, 0, 1);
  state.units[9001] = createMapUnit({ kind: 'pokemon', speciesId: 'machop' }, 9001, 1, { q: 10, r: 6 }, ROSTER_CONTENT, 0, 1);
  state.map.tiles.forEach((biomeId, index) => { state.knowledge[0].rememberedTiles[index] = { biomeId }; });
  refreshKnowledge(state);
  return state;
}

test('v16: a unit moves, keeps its remaining points, and can still attack; v15 keeps one action per round', () => {
  const state = field(16);
  expect(gameVersions(state.setup)).toEqual({ schemaVersion: 11, rulesVersion: 'movement-v16' });
  const moved = act(state, { type: 'Move', unitId: 9000, to: { q: 7, r: 6 } });
  expect(moved.ok).toBe(true);
  if (!moved.ok) return;
  const unit = moved.state.units[9000];
  expect(unit.movesSpent).toBe(1);
  expect(unit.actionLeft).toBe(1);
  // Another move from the remaining points.
  const second = act(moved.state, { type: 'Move', unitId: 9000, to: { q: 8, r: 6 } });
  expect(second.ok).toBe(true);
  if (!second.ok) return;
  expect(second.state.units[9000].movesSpent).toBe(2);
  const reach = Object.keys(reachablePaths(observe(second.state, 0), 9000)).length;
  expect(reach).toBeGreaterThan(0);
  // v15: the same first move spends the whole action.
  const legacy = act(field(15), { type: 'Move', unitId: 9000, to: { q: 7, r: 6 } });
  expect(legacy.ok && legacy.state.units[9000].actionLeft).toBe(0);
  expect(legacy.ok && legacy.state.units[9000].movesSpent).toBeUndefined();
});

test('v16: move next to an enemy and attack in the same turn; entering a zone of control ends movement', () => {
  const state = field(16);
  // (9,6) is adjacent to the machop: a melee zone of control, so the unit stops and cannot act further.
  const into = act(state, { type: 'Move', unitId: 9000, to: { q: 9, r: 6 } });
  expect(into.ok).toBe(true);
  if (!into.ok) return;
  expect(hexDistance(into.state.units[9000].position as { q: number; r: number }, { q: 10, r: 6 }, state.map)).toBe(1);
  expect(into.state.units[9000].actionLeft).toBe(0);
  // Without the zone of control (rival is a scout-role caterpie, which exerts none), the unit moves adjacent and attacks.
  const open = field(16);
  open.units[9001] = createMapUnit({ kind: 'pokemon', speciesId: 'caterpie' }, 9001, 1, { q: 10, r: 6 }, ROSTER_CONTENT, 0, 1);
  refreshKnowledge(open);
  const approach = act(open, { type: 'Move', unitId: 9000, to: { q: 9, r: 6 } });
  expect(approach.ok).toBe(true);
  if (!approach.ok) return;
  expect(approach.state.units[9000].actionLeft).toBe(1);
  const attack = act(approach.state, { type: 'Attack', unitId: 9000, target: { kind: 'unit', id: 9001 } });
  expect(attack.ok).toBe(true);
  if (!attack.ok) return;
  expect(attack.state.units[9000].actionLeft).toBe(0);
});

test('v16: spending every point ends the unit’s turn, and points reset next round', () => {
  const state = field(16);
  state.units[9000] = createMapUnit({ kind: 'pokemon', speciesId: 'rattata' }, 9000, 0, { q: 6, r: 10 }, ROSTER_CONTENT, 0, 1);
  refreshKnowledge(state);
  const budget = movementBudget(observe(state, 0), state.units[9000] as MapUnit, ROSTER_CONTENT);
  const far = act(state, { type: 'Move', unitId: 9000, to: { q: 6 - budget, r: 10 } });
  expect(far.ok).toBe(true);
  if (!far.ok) return;
  expect(far.state.units[9000].actionLeft).toBe(0);
  let next = far.state;
  for (let turn = 0; turn < 2; turn++) { const result = act(next, { type: 'EndTurn' }); if (!result.ok) throw new Error(result.reason); next = result.state; }
  expect(next.units[9000].actionLeft).toBe(1);
  expect(next.units[9000].movesSpent).toBeUndefined();
});

test('v16: the starting settler stands beside the capital, not on it', () => {
  for (const version of [15, 16] as const) {
    const state = createGame(duel(version));
    for (const player of Object.values(state.players)) {
      const city = state.cities[player.headquartersCityId], settler = Object.values(state.units).find(unit => unit.ownerId === player.id && unit.kind === 'logistics')!;
      const distance = hexDistance(city.position, settler.position as { q: number; r: number }, state.map);
      expect(distance).toBe(version === 16 ? 1 : 0);
    }
  }
});
