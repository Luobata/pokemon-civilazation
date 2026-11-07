import { expect, test } from 'vitest';
import { EXPANSION_CONTENT } from '../../src/content/units.ts';
import { createCity } from '../../src/core/city.ts';
import { districtBlocker, districtEffects, districtInput, districtViewInput, previewDistrict } from '../../src/core/districts.ts';
import { hexToIndex, indexToHex, neighbors } from '../../src/core/hex.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { emptyKnowledge, observe, refreshKnowledge, visibleTiles } from '../../src/core/vision.ts';
import { command, districtFixture } from './fixtures/districts.ts';

function hiddenNeighborFixture(biome: 'grassland' | 'mountain' = 'grassland') {
  const { state } = districtFixture('gymDistrict');
  const target = hexToIndex({ q: 9, r: 6 }, state.map)!;
  const hidden = hexToIndex({ q: 10, r: 6 }, state.map)!;
  state.map.tiles[hidden] = biome;
  state.units[900] = createMapUnit({ kind: 'pokemon', speciesId: 'bulbasaur' }, 900, 0, { q: 7, r: 6 }, EXPANSION_CONTENT);
  state.units[901] = createMapUnit({ kind: 'pokemon', speciesId: 'bulbasaur' }, 901, 0, { q: 10, r: 6 }, EXPANSION_CONTENT);
  refreshKnowledge(state);
  delete state.units[901];
  refreshKnowledge(state);
  expect(visibleTiles(state, 0).has(target)).toBe(true);
  expect(visibleTiles(state, 0).has(hidden)).toBe(false);
  return { state, target, hidden };
}

test('R-P3-01: a city founded after exploration does not make remembered adjacency complete', () => {
  let { state } = hiddenNeighborFixture();
  const target = hexToIndex({ q: 9, r: 6 }, state.map)!;
  const hidden = hexToIndex({ q: 10, r: 6 }, state.map)!;
  state.units[902] = createMapUnit({ kind: 'logistics', role: 'settler' }, 902, 1, indexToHex(hidden, state.map), EXPANSION_CONTENT, 0, 1);
  state.activePlayerId = 1;
  const founded = command(state, { type: 'FoundCity', unitId: 902 });
  expect(founded.ok).toBe(true);
  if (!founded.ok) throw new Error(founded.reason);
  state = founded.state;
  const view = observe(state, 0), effects = previewDistrict(view, 1, 'gymDistrict', target).effects;
  expect(view.map.tiles[hidden]).toBe('grassland');
  expect(view.cities.some(city => hexToIndex(city.position, state.map) === hidden)).toBe(false);
  expect(Object.values(view.knowledge.lastKnownCities).some(city => hexToIndex(city.position, state.map) === hidden)).toBe(false);
  expect(effects.total.trainedXp).toBe(20);
  expect(districtEffects(districtInput(state, 0, visibleTiles(state, 0)), 'gymDistrict', target).total.trainedXp).toBe(30);
  expect(effects.incomplete).toBe(true);
  expect(effects.unknownAdjacentTileIds).toContain(hidden);
});

test('remembered foreign city centers are omitted, while own hidden centers remain known', () => {
  const { state, target, hidden } = hiddenNeighborFixture();
  state.cities[91] = createCity(91, 1, indexToHex(hidden, state.map));
  state.knowledge[0].lastKnownCities[91] = { ownerId: 1, position: indexToHex(hidden, state.map), lastSeenRound: state.round, headquartersOf: null };
  expect(previewDistrict(observe(state, 0), 1, 'gymDistrict', target).effects.total.trainedXp).toBe(20);
  state.cities[91].ownerId = 0;
  expect(previewDistrict(observe(state, 0), 1, 'gymDistrict', target).effects.total.trainedXp).toBe(30);
});

test('district adjacency omits later hidden foreign improvements but counts own improvements', () => {
  const { state, target, hidden } = hiddenNeighborFixture('mountain');
  state.expansion!.improvements!.tiles[hidden] = { kind: 'mine', builtBy: 1, builtAtRound: state.round };
  let view = observe(state, 0);
  expect(view.map.tiles[hidden]).toBe('mountain');
  expect(view.expansion!.improvements!.tiles.some(item => item.tileIndex === hidden)).toBe(true);
  expect(previewDistrict(view, 1, 'gymDistrict', target).effects).toMatchObject({ incomplete: true, total: { trainedXp: 20 } });
  state.expansion!.improvements!.tiles[hidden].builtBy = 0;
  view = observe(state, 0);
  expect(view.map.tiles[hidden]).toBe('mountain');
  expect(view.expansion!.improvements!.tiles.some(item => item.tileIndex === hidden)).toBe(true);
  expect(previewDistrict(view, 1, 'gymDistrict', target).effects).toMatchObject({ incomplete: true, total: { trainedXp: 30 } });
});

for (const shrink of [false, true]) test(`R-P3-02: legal foreign reservation remains public after founding, shrink=${shrink}`, () => {
  let { state } = districtFixture();
  state.cities[1].position = { q: 2, r: 2 };
  state.cities[3].position = { q: 10, r: 6 }; state.cities[3].population = 8;
  state.players[1].research.unlockedIds = [...state.players[0].research.unlockedIds];
  const target = hexToIndex({ q: 7, r: 6 }, state.map)!;
  state.units[900] = createMapUnit({ kind: 'pokemon', speciesId: 'bulbasaur' }, 900, 1, indexToHex(target, state.map), EXPANSION_CONTENT);
  state.activePlayerId = 1; refreshKnowledge(state);
  const queued = command(state, { type: 'SetProductionQueue', cityId: 3, orders: [{ item: { kind: 'district', defId: 'gardenDistrict', tileIndex: target } }] });
  expect(queued.ok).toBe(true);
  if (!queued.ok) throw new Error(queued.reason);
  state = queued.state;
  state.units[901] = createMapUnit({ kind: 'logistics', role: 'settler' }, 901, 0, { q: 5, r: 6 }, EXPANSION_CONTENT, 0, 1);
  state.activePlayerId = 0;
  const founded = command(state, { type: 'FoundCity', unitId: 901 });
  expect(founded.ok).toBe(true);
  if (!founded.ok) throw new Error(founded.reason);
  state = founded.state;
  const city = Object.values(state.cities).find(city => city.position.q === 5 && city.position.r === 6)!;
  if (shrink) state.cities[3].population = 1;
  refreshKnowledge(state);
  const view = observe(state, 0);
  expect(view.territoryOwnerIds[target]).toEqual(shrink ? [0] : [0, 1]);
  expect(view.expansion!.districts!.projects).toEqual([]);
  expect(view.expansion!.districts!.constructionSites).toEqual([{ tileIndex: target, ownerId: 1, category: 'district' }]);
  expect(previewDistrict(view, city.id, 'gymDistrict', target).reason).toBe('district-tile-occupied');
  expect(districtBlocker(districtInput(state, 0, visibleTiles(state, 0)), city.id, 'gymDistrict', target)).toBe('district-tile-occupied');
  expect(command(state, { type: 'SetProductionQueue', cityId: city.id, orders: [{ item: { kind: 'district', defId: 'gymDistrict', tileIndex: target } }] })).toEqual({ ok: false, reason: 'invalid-production' });
  const noReservation = structuredClone(state); noReservation.cities[3].queue = [];
  expect(previewDistrict(observe(noReservation, 0), city.id, 'gymDistrict', target).reason).toBe(shrink ? null : 'contested-territory');
  state.cities[city.id].position = { q: 1, r: 1 }; refreshKnowledge(state);
  expect(observe(state, 0).expansion!.districts!.constructionSites).toEqual([]);
  if (!shrink) expect(command(noReservation, { type: 'SetProductionQueue', cityId: city.id, orders: [{ item: { kind: 'district', defId: 'gymDistrict', tileIndex: target } }] })).toEqual({ ok: false, reason: 'contested-territory' });
});

test('visible foreign improvement construction exposes only occupancy, without memory or detail', () => {
  const { state, tile } = districtFixture();
  state.expansion!.improvements!.projects[tile] = { kind: 'mine', playerId: 1, progress: 2 };
  let view = observe(state, 0);
  expect(view.expansion!.improvements!.projects).toEqual([]);
  expect(view.expansion!.districts!.constructionSites).toEqual([{ tileIndex: tile, ownerId: 1, category: 'improvement' }]);
  expect(previewDistrict(view, 1, 'gardenDistrict', tile).reason).toBe('tile-improved-or-under-construction');
  state.cities[1].position = { q: 1, r: 1 }; refreshKnowledge(state);
  view = observe(state, 0);
  expect(view.expansion!.districts).toMatchObject({ constructionSites: [] });
});

test('D-P3-7: harbor target 155 requires explored adjacent land 156 in both inputs', () => {
  const { state } = districtFixture('harborDistrict');
  const position = { q: 8, r: 6 }, target = hexToIndex(position, state.map)!;
  const hidden = hexToIndex({ q: 9, r: 6 }, state.map)!;
  expect([target, hidden]).toEqual([155, 156]);
  for (const p of [position, ...neighbors(position, state.map)]) state.map.tiles[hexToIndex(p, state.map)!] = 'ocean';
  state.map.tiles[hidden] = 'grassland';
  state.knowledge = { 0: emptyKnowledge(), 1: emptyKnowledge() }; refreshKnowledge(state);
  for (const explored of [false, true]) {
    if (explored) {
      state.units[900] = createMapUnit({ kind: 'pokemon', speciesId: 'bulbasaur' }, 900, 0, { q: 9, r: 6 }, EXPANSION_CONTENT);
      refreshKnowledge(state); delete state.units[900]; refreshKnowledge(state);
    }
    const view = observe(state, 0), visible = visibleTiles(state, 0);
    expect(visible.has(target)).toBe(true); expect(visible.has(hidden)).toBe(false);
    for (const input of [districtViewInput(view), districtInput(state, 0, visible)])
      expect(districtBlocker(input, 1, 'harborDistrict', target)).toBe(explored ? null : 'harbor-needs-coast');
    expect(command(state, { type: 'SetProductionQueue', cityId: 1, orders: [{ item: { kind: 'district', defId: 'harborDistrict', tileIndex: target } }] }).ok).toBe(explored);
  }
});

test('remembered immutable terrain still contributes while its dynamic facts are incomplete', () => {
  const { state, target, hidden } = hiddenNeighborFixture();
  const view = observe(state, 0);
  // Isolate a remembered terrain source; neither revealed nor hidden mutable sources are needed.
  for (const hex of neighbors(indexToHex(target, state.map), state.map)) {
    const index = hexToIndex(hex, state.map)!;
    if (index !== hidden) view.map.tiles[index] = null;
  }
  const effects = previewDistrict(view, 1, 'gardenDistrict', target).effects;
  expect(effects.total.food).toBe(2);
  expect(effects.adjacency.find(rule => rule.id === 'terrain')!.tileIndices).toEqual([hidden]);
  expect(effects.incomplete).toBe(true);
  expect(effects.unknownAdjacentTileIds).toContain(hidden);
});

for (const category of ['district', 'improvement'] as const) test(`hidden ${category} occupancy cannot change command rejection`, () => {
  const { state } = districtFixture();
  const hidden = hexToIndex({ q: 15, r: 10 }, state.map)!;
  const baseline = structuredClone(state);
  if (category === 'district') state.cities[3].queue = [{ id: 99, progress: 3, item: { kind: 'district', defId: 'gardenDistrict', tileIndex: hidden } }];
  else state.expansion!.improvements!.projects[hidden] = { kind: 'berryFarm', playerId: 1, progress: 1 };
  for (const candidate of [baseline, state]) {
    const view = observe(candidate, 0);
    expect(view.visibleTileIds).not.toContain(hidden);
    expect(view.expansion!.districts!.constructionSites).toEqual([]);
    expect(previewDistrict(view, 1, 'gardenDistrict', hidden).reason).toBe('unknown-tile');
    expect(command(candidate, { type: 'SetProductionQueue', cityId: 1, orders: [{ item: { kind: 'district', defId: 'gardenDistrict', tileIndex: hidden } }] })).toEqual({ ok: false, reason: 'invalid-production' });
  }
});

test('A2: foreign improvement stays on the explored map after leaving vision but not in adjacency', () => {
  const { state, target, hidden } = hiddenNeighborFixture('mountain');
  state.expansion!.improvements!.tiles[hidden] = { kind: 'mine', builtBy: 1, builtAtRound: state.round };
  state.units[901] = createMapUnit({ kind: 'pokemon', speciesId: 'bulbasaur' }, 901, 0, indexToHex(hidden, state.map), EXPANSION_CONTENT);
  refreshKnowledge(state);
  expect(previewDistrict(observe(state, 0), 1, 'gymDistrict', target).effects.total.trainedXp).toBe(30);
  delete state.units[901]; refreshKnowledge(state);
  const view = observe(state, 0);
  expect(view.visibleTileIds).not.toContain(hidden);
  expect(view.expansion!.improvements!.tiles).toContainEqual(expect.objectContaining({ tileIndex: hidden, kind: 'mine', builtBy: 1 }));
  const effects = previewDistrict(view, 1, 'gymDistrict', target).effects;
  expect(effects.total.trainedXp).toBe(20);
  expect(effects.adjacency.find(rule => rule.id === 'mine')!.tileIndices).not.toContain(hidden);
  expect(effects.incomplete).toBe(true);
  expect(effects.unknownAdjacentTileIds).toContain(hidden);
});
