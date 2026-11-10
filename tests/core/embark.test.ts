import { expect, test } from 'vitest';
import { IMPROVEMENT_CONTENT, contentFor } from '../../src/content/units.ts';
import type { SpeciesId } from '../../src/content/units.ts';
import { createGame } from '../../src/core/game.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { emptyKnowledge, observe, refreshKnowledge } from '../../src/core/vision.ts';
import { previewAttack } from '../../src/core/preview.ts';
import { canEnter, reachablePaths, waterAccess } from '../../src/core/movement.ts';
import { step } from '../../src/core/step.ts';
import { hexToIndex } from '../../src/core/hex.ts';
import type { Hex } from '../../src/core/hex.ts';
import type { GameSetup, GameState } from '../../src/core/model.ts';
import type { MapFeatures } from '../../src/core/terrain.ts';

const duel = (gameplayVersion: 23 | 24): GameSetup => ({ seed: 12345, width: 24, height: 16, expansionVersion: 1, multiplayer: true, eraProgression: 'simple-v1', gameplayVersion,
  players: [{ id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, { id: 1, controller: 'human', starterId: 'charmander', leaderId: 'misty' }] });
const empty = (): MapFeatures => ({ hills: [], peaks: [], rivers: [], lakes: [], deep: [], landmarks: [] });
/** Columns ≥ 11 are sea (column 11–13 shallow, ≥ 14 deep); a land unit stands at (col 10, row 6), next to the shore. */
function coast(species: SpeciesId = 'machop', techs: string[] = [], version: 23 | 24 = 24): GameState {
  const state = createGame(duel(version));
  state.units = {}; state.diplomacy[0].status = 'war';
  const deep: number[] = [];
  for (let i = 0; i < state.map.tiles.length; i++) {
    const col = i % state.map.width;
    state.map.tiles[i] = col >= 11 && col <= 22 ? 'ocean' : 'grassland';
    if (col >= 14 && col <= 20) deep.push(i);
  }
  if (version === 24) state.map.features = { ...empty(), deep }; else delete state.map.features;
  state.cities[state.players[0].headquartersCityId].position = { q: 0, r: 2 };
  state.cities[state.players[1].headquartersCityId].position = { q: 0, r: 12 };
  state.players[0].research.unlockedIds.push(...techs as never[]);
  state.knowledge[0] = emptyKnowledge(); state.knowledge[1] = emptyKnowledge();
  state.units[9000] = createMapUnit({ kind: 'pokemon', speciesId: species }, 9000, 0, at(state, 10, 6), contentFor(state.setup), 0, 1);
  refreshKnowledge(state);
  return state;
}
function at(state: GameState, col: number, row: number): Hex { return { q: col - Math.floor(row / 2), r: row }; }
const index = (state: GameState, col: number, row: number) => hexToIndex(at(state, col, row), state.map)!;
const move = (state: GameState, to: Hex) => step(state, { actorId: 0, expectedSeq: state.commandSeq, action: { type: 'Move', unitId: 9000, to } });

test('v24 embark: no water without 近海航行; shallow after it, deep only after 远洋航行', () => {
  const content = contentFor({ expansionVersion: 1, gameplayVersion: 24 });
  const none = coast();
  expect(waterAccess(none.players[0], content)).toBe(0);
  expect(reachablePaths(observe(none, 0), 9000)[index(none, 11, 6)]).toBeUndefined();
  expect(move(none, at(none, 11, 6))).toEqual({ ok: false, reason: 'unreachable' });
  const shallow = coast('machop', ['seafaring']);
  expect(waterAccess(shallow.players[0], content)).toBe(1);
  const boarded = move(shallow, at(shallow, 11, 6));
  // Boarding spends every remaining movement point.
  expect(boarded.ok && boarded.state.units[9000].actionLeft).toBe(0);
  if (!boarded.ok) throw new Error('board');
  const next = boarded.state;
  for (const unit of Object.values(next.units)) { unit.actionLeft = 1; delete unit.movesSpent; }
  const paths = reachablePaths(observe(next, 0), 9000);
  expect(paths[index(next, 13, 6)]).toBeDefined();
  expect(paths[index(next, 14, 6)]).toBeUndefined();
  const deep = coast('machop', ['seafaring', 'oceanography']);
  expect(waterAccess(deep.players[0], content)).toBe(2);
  deep.units[9000].position = at(deep, 13, 6); refreshKnowledge(deep);
  expect(reachablePaths(observe(deep, 0), 9000)[index(deep, 14, 6)]).toBeDefined();
});

test('v24 embark: landing ends the move; embarked units defend at −10 and cannot attack', () => {
  const state = coast('machop', ['seafaring']);
  state.units[9000].position = at(state, 11, 6);
  state.units[9001] = createMapUnit({ kind: 'pokemon', speciesId: 'rattata' }, 9001, 1, at(state, 11, 7), contentFor(state.setup), 0, 1);
  refreshKnowledge(state);
  expect(previewAttack(observe(state, 0), 9000, { kind: 'unit', id: 9001 })).toEqual({ ok: false, reason: 'embarked' });
  expect(step(state, { actorId: 0, expectedSeq: 0, action: { type: 'Attack', unitId: 9000, target: { kind: 'unit', id: 9001 } } })).toEqual({ ok: false, reason: 'attack-unavailable' });
  // The enemy on the water: its defence carries the 乘浪 term.
  state.units[9001].position = at(state, 12, 6); state.units[9000] = createMapUnit({ kind: 'pokemon', speciesId: 'charmander' }, 9000, 0, at(state, 10, 6), contentFor(state.setup), 0, 1);
  refreshKnowledge(state);
  const preview = previewAttack(observe(state, 0), 9000, { kind: 'unit', id: 9001 });
  expect(preview.ok && preview.strength!.factors).toContainEqual({ side: 'defense', label: '乘浪', value: -10 });
  // Landing from the water ends the move.
  state.units[9000] = createMapUnit({ kind: 'pokemon', speciesId: 'machop' }, 9000, 0, at(state, 11, 5), contentFor(state.setup), 0, 1); delete state.units[9001]; refreshKnowledge(state);
  const landed = move(state, at(state, 10, 5));
  expect(landed.ok && landed.state.units[9000].actionLeft).toBe(0);
});

test('v24 embark: peaks only for flyers, landmarks for no one; amphibious and flying species keep their table; v23 unchanged', () => {
  const state = coast('squirtle');
  // Squirtle swims without any technology, and moving on water does not end its move.
  const swim = move(state, at(state, 11, 6));
  expect(swim.ok && swim.state.units[9000].actionLeft).toBe(1);
  const map = { ...state.map, features: { ...empty(), peaks: [5], landmarks: [{ tileIndex: 6, id: 'elderCanopy' as const }] } };
  map.tiles = [...map.tiles]; map.tiles[5] = 'mountain'; map.tiles[6] = 'forest';
  const content = contentFor(state.setup);
  expect(canEnter({ kind: 'pokemon', speciesId: 'machop' }, 'mountain', content, { map, index: 5 })).toBe(false);
  expect(canEnter({ kind: 'pokemon', speciesId: 'pidgey' }, 'mountain', content, { map, index: 5 })).toBe(true);
  expect(canEnter({ kind: 'pokemon', speciesId: 'pidgey' }, 'forest', content, { map, index: 6 })).toBe(false);
  // Without a passage (or without features) the old table is the answer.
  expect(canEnter({ kind: 'pokemon', speciesId: 'machop' }, 'ocean', IMPROVEMENT_CONTENT)).toBe(false);
  const v23 = coast('machop', ['seafaring'], 23);
  expect(reachablePaths(observe(v23, 0), 9000)[index(v23, 11, 6)]).toBeUndefined();
});
