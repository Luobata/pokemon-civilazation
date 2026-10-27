import { expect, test } from 'vitest';
import { combatFixture, pokemon } from './combat-fixture.ts';
import { createCity } from '../../src/core/city.ts';
import { hexToIndex } from '../../src/core/hex.ts';
import { observe, refreshKnowledge } from '../../src/core/vision.ts';

test('D39 overlapping city radii expose sorted unique owners, neutral camps claim nothing', () => {
  const state = combatFixture(); state.cities[2].position = { q: 6, r: 2 };
  state.cities[3] = createCity(3, 0, { q: 4, r: 4 });
  state.cities[4] = { ...createCity(4, 0, { q: 10, r: 5 }), ownerId: null };
  pokemon(state, 10, 'pidgeot', 0, 10, 5); refreshKnowledge(state);
  const view = observe(state, 0);
  expect(view.territoryOwnerIds[hexToIndex({ q: 4, r: 2 }, state.map)!]).toEqual([0, 1]);
  expect(view.territoryOwnerIds[hexToIndex({ q: 10, r: 5 }, state.map)!]).toEqual([]);
  view.territoryOwnerIds[hexToIndex({ q: 4, r: 2 }, state.map)!]!.push(99);
  expect(observe(state, 0).territoryOwnerIds[hexToIndex({ q: 4, r: 2 }, state.map)!]).toEqual([0, 1]);
});

test('hidden territory is absent; explored ownership stays historical until seen again, including unclaimed', () => {
  const state = combatFixture(), tile = hexToIndex({ q: 10, r: 2 }, state.map)!;
  refreshKnowledge(state); expect(observe(state, 0).territoryOwnerIds[tile]).toBeNull();
  const unseen = observe(state, 0); state.cities[2].population = 4; refreshKnowledge(state);
  expect(observe(state, 0)).toEqual(unseen);
  pokemon(state, 10, 'pidgeot', 0, 9, 3); refreshKnowledge(state);
  expect(observe(state, 0).territoryOwnerIds[tile]).toEqual([1]);
  delete state.units[10]; refreshKnowledge(state);
  state.cities[2].ownerId = null; refreshKnowledge(state);
  expect(observe(state, 0).territoryOwnerIds[tile]).toEqual([1]);
  pokemon(state, 10, 'pidgeot', 0, 9, 3); refreshKnowledge(state);
  expect(observe(state, 0).territoryOwnerIds[tile]).toEqual([]);
  delete state.units[10]; refreshKnowledge(state); state.cities[2].ownerId = 1; refreshKnowledge(state);
  expect(observe(state, 0).territoryOwnerIds[tile]).toEqual([]);
});

test('older remembered terrain without ownership remains unknown without refreshing hidden history', () => {
  const state = combatFixture(), tile = hexToIndex({ q: 10, r: 2 }, state.map)!;
  state.knowledge[0].exploredTileIds.push(tile); state.knowledge[0].rememberedTiles[tile] = { biomeId: 'grassland' };
  const before = structuredClone(state);
  expect(observe(state, 0).map.tiles[tile]).toBe('grassland');
  expect(observe(state, 0).territoryOwnerIds[tile]).toBeNull(); expect(state).toEqual(before);
});

test('moving a hidden city changes only visible territory, never hidden tiles or the visible city list', () => {
  const state = combatFixture(); state.cities[2].position = { q: 9, r: 2 };
  pokemon(state, 10, 'pidgeot', 0, 10, 4); refreshKnowledge(state);
  pokemon(state, 10, 'charmander', 0, 6, 2); refreshKnowledge(state);
  const before = observe(state, 0), visible = new Set(before.visibleTileIds);
  expect(before.cities.some(city => city.id === 2)).toBe(false);
  expect(before.territoryOwnerIds[hexToIndex({ q: 9, r: 2 }, state.map)!]).toEqual([1]);
  state.cities[2].position = { q: 12, r: 2 };
  const after = observe(state, 0);
  expect(after.cities.some(city => city.id === 2)).toBe(false);
  expect({ ...after, territoryOwnerIds: before.territoryOwnerIds }).toEqual(before);
  const changed = before.territoryOwnerIds.flatMap((owners, index) =>
    JSON.stringify(owners) === JSON.stringify(after.territoryOwnerIds[index]) ? [] : [index]);
  expect(changed.length).toBeGreaterThan(0); expect(changed.every(index => visible.has(index))).toBe(true);
  refreshKnowledge(state);
  const refreshed = observe(state, 0);
  for (const [index, owners] of before.territoryOwnerIds.entries()) if (!visible.has(index)) {
    expect(after.territoryOwnerIds[index]).toEqual(owners);
    expect(refreshed.territoryOwnerIds[index]).toEqual(owners);
    expect(owners).toEqual(before.knowledge.rememberedTiles[index]?.territoryOwnerIds ?? null);
  }
  expect(refreshed.cities.some(city => city.id === 2)).toBe(false);
});
