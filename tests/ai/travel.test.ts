import { expect, test } from 'vitest';
import { contentFor } from '../../src/content/units.ts';
import { createGame } from '../../src/core/game.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { emptyKnowledge, observe, refreshKnowledge } from '../../src/core/vision.ts';
import { hexDistance } from '../../src/core/hex.ts';
import type { Hex } from '../../src/core/hex.ts';
import type { GameSetup, GameState, MapUnit } from '../../src/core/model.ts';
import { safeToBoard, travelCloser, travelDistance } from '../../src/ai/travel.ts';

const setup = (gameplayVersion: 23 | 24): GameSetup => ({ seed: 12345, width: 24, height: 16, expansionVersion: 1, multiplayer: true, eraProgression: 'simple-v1', gameplayVersion,
  players: [{ id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, { id: 1, controller: 'human', starterId: 'charmander', leaderId: 'misty' }] });
const at = (col: number, row: number): Hex => ({ q: col - Math.floor(row / 2), r: row });
/** Land at columns ≤ 10 and 16–22, shallow straits at 11–15 and 23 (the map wraps); a peak wall at column 5 except row 12. */
function strait(version: 23 | 24 = 24, techs: string[] = []): GameState {
  const state = createGame(setup(version));
  state.units = {};
  const peaks: number[] = [];
  for (let i = 0; i < state.map.tiles.length; i++) {
    const col = i % state.map.width, row = Math.floor(i / state.map.width);
    state.map.tiles[i] = (col >= 11 && col <= 15) || col === 23 ? 'ocean' : 'grassland';
    if (col === 5 && row !== 12) { state.map.tiles[i] = 'mountain'; peaks.push(i); }
  }
  state.map.features = version === 24 ? { hills: [], peaks, rivers: [], lakes: [], deep: [], landmarks: [] } : undefined;
  if (version !== 24) delete state.map.features;
  state.cities[state.players[0].headquartersCityId].position = at(8, 2);
  state.cities[state.players[1].headquartersCityId].position = at(20, 13);
  state.players[0].research.unlockedIds.push(...techs as never[]);
  state.knowledge[0] = emptyKnowledge(); state.knowledge[1] = emptyKnowledge();
  state.units[9000] = createMapUnit({ kind: 'pokemon', speciesId: 'machop' }, 9000, 0, at(7, 6), contentFor(state.setup), 0, 1);
  // Explore the whole map so the field reads the real terrain.
  state.knowledge[0].exploredTileIds = state.map.tiles.map((_, i) => i);
  state.map.tiles.forEach((biomeId, i) => { state.knowledge[0].rememberedTiles[i] = { biomeId, territoryOwnerIds: [] }; });
  refreshKnowledge(state);
  return state;
}

test('travel field: walls of peaks are walked around, water needs 近海航行; before v24 it is the hex distance', () => {
  const state = strait(), view = observe(state, 0), unit = view.units.find(item => item.id === 9000) as MapUnit;
  const west = at(2, 6);
  // Straight it is 5 steps; around the peak wall (gap at row 12) it is much longer.
  expect(hexDistance(unit.position, west, view.map)).toBe(5);
  expect(travelDistance(view, unit, unit.position, west)).toBeGreaterThan(10);
  expect(travelDistance(view, unit, unit.position, at(20, 6))).toBe(Infinity);
  expect(travelCloser(view, unit, at(8, 6), at(20, 6))).toBe(false);
  const sailing = strait(24, ['seafaring']), sailView = observe(sailing, 0);
  expect(travelDistance(sailView, sailView.units.find(item => item.id === 9000) as MapUnit, at(7, 6), at(20, 6))).toBeLessThan(Infinity);
  const old = strait(23), oldView = observe(old, 0);
  expect(travelDistance(oldView, oldView.units[0] as MapUnit, at(7, 6), west)).toBe(5);
});

test('travel field: unexplored tiles are assumed passable (no hidden terrain leaks)', () => {
  const state = strait();
  state.knowledge[0] = emptyKnowledge(); refreshKnowledge(state);
  const view = observe(state, 0), unit = view.units.find(item => item.id === 9000) as MapUnit;
  // The peak wall lies in vision, the far side does not: the field is finite and no smaller than the straight distance.
  const far = at(1, 14);
  expect(view.map.tiles[far.r * 24 + 1]).toBeNull();
  expect(travelDistance(view, unit, unit.position, far)).toBeLessThan(Infinity);
});

test('boarding: escorts for settlers, no sea monsters within 3', () => {
  const state = strait(24, ['seafaring']), content = contentFor(state.setup);
  state.units[9002] = createMapUnit({ kind: 'logistics', role: 'settler' }, 9002, 0, at(10, 8), content, 0, 1);
  refreshKnowledge(state);
  let view = observe(state, 0);
  const settler = view.units.find(item => item.id === 9002) as MapUnit;
  expect(safeToBoard(view, settler, at(11, 8))).toBe(false);
  state.units[9000].position = at(10, 7); refreshKnowledge(state); view = observe(state, 0);
  expect(safeToBoard(view, view.units.find(item => item.id === 9002) as MapUnit, at(11, 8))).toBe(true);
  state.units[9003] = createMapUnit({ kind: 'pokemon', speciesId: 'magikarp' }, 9003, null, at(12, 8), content, 0, 1); refreshKnowledge(state); view = observe(state, 0);
  expect(safeToBoard(view, view.units.find(item => item.id === 9002) as MapUnit, at(11, 8))).toBe(false);
  // Not a boarding move: always fine.
  expect(safeToBoard(view, view.units.find(item => item.id === 9002) as MapUnit, at(9, 8))).toBe(true);
});
