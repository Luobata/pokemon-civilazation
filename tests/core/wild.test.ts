import { afterEach, expect, test, vi } from 'vitest';
import { combatFixture, pokemon } from './combat-fixture.ts';
import * as rng from '../../src/core/rng.ts';
import { spawnWild, actWild } from '../../src/core/wild.ts';
import { createCity, workRadius } from '../../src/core/city.ts';
import { hexDistance, hexToIndex, indexToHex, neighbors } from '../../src/core/hex.ts';
import { createGame } from '../../src/core/game.ts';
import { isMapUnit } from '../../src/core/model.ts';
import { canEnter } from '../../src/core/movement.ts';

afterEach(() => vi.restoreAllMocks());
function region() {
  const state = combatFixture(); state.map = { width: 8, height: 8, tiles: Array(64).fill('ocean') };
  state.units = {}; state.cities = {}; state.rng = rng.createRng(30); return state;
}

test('full region skips all RNG; region count is current position', () => {
  const state = region(); pokemon(state, 10, 'magikarp', null, 1, 1); pokemon(state, 11, 'magikarp', null, 2, 1);
  const random = vi.spyOn(rng, 'randomBelow'); spawnWild(state);
  expect(random.mock.calls).toEqual([]);
});

test('fixed seed1 failed spawn only draws decision; seed30 success draws decision/biome/species/position', () => {
  const state = region(); state.rng = rng.createRng(1);
  const random = vi.spyOn(rng, 'randomBelow'); expect(spawnWild(state)).toEqual([]);
  expect(random.mock.calls.map(call => call[1])).toEqual([100]);
  random.mockClear(); state.rng = rng.createRng(30); expect(spawnWild(state)).toHaveLength(1);
  expect(random.mock.calls.map(call => call[1])).toEqual([100, 64, 82, 64]); // D31 ocean wheel
  expect(Object.values(state.units).every(unit => unit.kind === 'pokemon' && unit.speciesId !== 'dratini')).toBe(true);
});

test('no candidate consumes decision/biome/species but no position', () => {
  const state = region();
  for (let i = 0; i < 64; i++) state.cities[i + 1] = createCity(i + 1, 0, indexToHex(i, state.map));
  const random = vi.spyOn(rng, 'randomBelow'); expect(spawnWild(state)).toEqual([]);
  expect(random.mock.calls.map(call => call[1])).toEqual([100, 64, 82]);
});

test('initial per-region attempts skip decision and consume two ordered roulettes/positions', () => {
  const state = region(); const random = vi.spyOn(rng, 'randomBelow');
  expect(spawnWild(state, true)).toHaveLength(2);
  expect(random.mock.calls.map(call => call[1])).toEqual([64, 82, 64, 64, 82, 63]);
  random.mockClear(); spawnWild(state, true); expect(random).not.toHaveBeenCalled();
});

test('fixed seed creates deterministic legal wild population outside starting exclusion', () => {
  const setup = { seed: 12345, width: 24, height: 16, players: [
    { id: 0, controller: 'human' as const, starterId: 'bulbasaur' as const }, { id: 1, controller: 'ai' as const },
  ] };
  const state = createGame(setup); expect(state).toEqual(createGame(setup));
  const wild = Object.values(state.units).filter(isMapUnit).filter(unit => unit.ownerId === null);
  expect(wild.length).toBeGreaterThan(0); expect(wild.length).toBeLessThanOrEqual(12);
  const regionCounts = new Map<number, number>();
  for (const unit of wild) {
    const index = hexToIndex(unit.position, state.map)!, region = Math.floor(index / 24 / 8) * 3 + Math.floor(index % 24 / 8);
    regionCounts.set(region, (regionCounts.get(region) ?? 0) + 1);
    expect(canEnter(unit, state.map.tiles[index])).toBe(true);
    for (const city of Object.values(state.cities)) expect(hexDistance(city.position, unit.position)).toBeGreaterThanOrEqual(3);
  }
  for (const count of regionCounts.values()) expect(count).toBeLessThanOrEqual(2);
});

test('wander with no legal neighbor draws nothing; legal choices exclude work radii/occupants', () => {
  const state = region(); const unit = pokemon(state, 10, 'rattata', null, 2, 3);
  const random = vi.spyOn(rng, 'randomBelow'); actWild(state); expect(random).not.toHaveBeenCalled();
  state.map.tiles.fill('grassland'); state.cities[1] = createCity(1, 0, { q: 0, r: 2 });
  pokemon(state, 11, 'snorlax', null, 3, 3);
  const legal = neighbors(unit.position).filter(position => hexToIndex(position, state.map) !== null
    && hexDistance(position, state.cities[1].position) > workRadius(state.cities[1]) && hexDistance(position, state.units[11].position!) !== 0);
  const before = { ...unit.position }; actWild(state);
  expect(random.mock.calls.map(call => call[1])).toEqual([legal.length]);
  expect(hexDistance(before, unit.position)).toBe(1); expect(legal).toContainEqual(unit.position);
});

test('guard selects lowest adjacent nonwild ID, fixed counter needs no extra draw; no target no draw', () => {
  const state = region(); state.map.tiles.fill('grassland'); pokemon(state, 30, 'machop', null, 3, 3);
  pokemon(state, 20, 'bulbasaur', 0, 4, 3); pokemon(state, 10, 'bulbasaur', 0, 3, 4);
  const random = vi.spyOn(rng, 'randomBelow');
  expect(actWild(state)[0]).toMatchObject({ type: 'BattleResolved', attackerId: 30, target: { kind: 'unit', id: 10 } });
  expect(random.mock.calls.map(call => call[1])).toEqual([16]);
  delete state.units[10]; delete state.units[20]; random.mockClear(); actWild(state); expect(random).not.toHaveBeenCalled();
});
