import { describe, expect, test } from 'vitest';
import { DISTRICT_IDS, DISTRICTS, emptyDistrictEffects } from '../../src/content/districts.ts';
import type { DistrictId } from '../../src/content/districts.ts';
import { EXPANSION_CONTENT } from '../../src/content/units.ts';
import { districtBlocker, districtEffects, districtInput, districtSites, cityDistrictEffects, cityDistrictDetails, previewDistrict, districtOccupiedTiles } from '../../src/core/districts.ts';
import { observe, refreshKnowledge, visibleTiles } from '../../src/core/vision.ts';
import { createCity, cityYield, maxCityHp } from '../../src/core/city.ts';
import { validateImprovementAction } from '../../src/core/improvements.ts';
import { resolveEconomy } from '../../src/core/economy.ts';
import { bondPressure, resolveBondRound, applyBondAction } from '../../src/core/bonds.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { hexToIndex, indexToHex, neighbors } from '../../src/core/hex.ts';
import { resolveAttack } from '../../src/core/combat.ts';
import { eliminateCivilization } from '../../src/core/victory.ts';
import { resolveEssenceRound } from '../../src/core/essences.ts';
import { validateCivilizationAction } from '../../src/core/civilization-systems.ts';
import { canonicalSerialize } from '../../src/core/snapshot.ts';
import { parseAuditAction } from '../../src/audit/commands.ts';
import type { GameState, ProductionItem } from '../../src/core/model.ts';
import { command, districtFixture } from './fixtures/districts.ts';

const input = (state: GameState) => districtInput(state, 0, visibleTiles(state, 0));
const item = (kind: DistrictId, tileIndex: number): ProductionItem => ({ kind: 'district', defId: kind, tileIndex });
function queue(state: GameState, kind: DistrictId, tileIndex: number) {
  const result = command(state, { type: 'SetProductionQueue', cityId: 1, orders: [{ item: item(kind, tileIndex) }] });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}
function built(state: GameState, kind: DistrictId, tileIndex: number, cityId = 1) {
  state.expansion!.districts!.tiles[tileIndex] = { cityId, kind, tileIndex, builtAtRound: 0 };
}

for (const kind of DISTRICT_IDS) describe(kind, () => {
  test('requires v10, technology, allowed terrain, own city radius, visibility and a non-center tile', () => {
    const { state, city, tile } = districtFixture(kind);
    expect(districtBlocker(input(state), 1, kind, tile)).toBeNull();
    expect(districtBlocker({ ...input(state), gameplayVersion: 9 }, 1, kind, tile)).toBe('districts-unavailable');
    expect(districtBlocker({ ...input(state), techs: [] }, 1, kind, tile)).toBe('district-tech-locked');
    state.map.tiles[tile] = kind === 'harborDistrict' ? 'grassland' : 'ocean';
    expect(districtBlocker(input(state), 1, kind, tile)).toBe('wrong-biome');
    state.map.tiles[tile] = DISTRICTS[kind].biomes[0];
    const center = hexToIndex(city.position, state.map)!;
    expect(districtBlocker(input(state), 1, kind, center)).toBe('city-center');
    expect(districtBlocker({ ...input(state), visible: new Set() }, 1, kind, tile)).toBe('unknown-tile');
    expect(districtBlocker(input(state), 3, kind, tile)).toBe('city-unavailable');
    const far = hexToIndex({ q: 11, r: 6 }, state.map)!;
    state.map.tiles[far] = DISTRICTS[kind].biomes[0];
    const context = input(state); context.visible = new Set([far]);
    expect(districtBlocker(context, 1, kind, far)).toBe('outside-city-territory');
    expect(districtSites(observe(state, 0), 1, kind).find(site => site.tileIndex === tile)?.reason).toBeNull();
  });
  test('counts completed and queued limits, blocks improvements/projects/berries, and reserves on enqueue', () => {
    const { state, city, tile, adjacent } = districtFixture(kind);
    built(state, kind, adjacent[0]);
    expect(districtBlocker(input(state), 1, kind, tile)).toBe('district-kind-limit');
    delete state.expansion!.districts!.tiles[adjacent[0]];
    city.queue = [{ id: 98, progress: 0, item: item(kind, adjacent[0]) }];
    expect(districtBlocker(input(state), 1, kind, tile)).toBe('district-kind-limit');
    city.queue = [];
    const others = DISTRICT_IDS.filter(id => id !== kind);
    built(state, others[0], adjacent[0]);
    city.queue = [{ id: 99, progress: 0, item: item(others[1], adjacent[1]) }];
    expect(districtBlocker(input(state), 1, kind, tile)).toBe('district-city-limit');
    state.expansion!.districts!.tiles = {}; city.queue = [];
    state.expansion!.improvements!.tiles[tile] = { kind: 'mine', builtBy: 1, builtAtRound: 0 };
    expect(districtBlocker(input(state), 1, kind, tile)).toBe('tile-improved-or-under-construction');
    delete state.expansion!.improvements!.tiles[tile];
    state.expansion!.improvements!.projects[tile] = { kind: 'mine', playerId: 1, progress: 1 };
    expect(districtBlocker(input(state), 1, kind, tile)).toBe('tile-improved-or-under-construction');
    delete state.expansion!.improvements!.projects[tile];
    state.expansion!.rareBerries!.deposits[tile] = 'liechi';
    expect(districtBlocker(input(state), 1, kind, tile)).toBe('rare-berry-deposit');
    delete state.expansion!.rareBerries!.deposits[tile];
    const queued = queue(state, kind, tile);
    expect(districtBlocker(input(queued), 1, kind, tile)).toBe('district-tile-occupied');
    const duplicate = command(state, { type: 'SetProductionQueue', cityId: 1, orders: [{ item: item(kind, tile) }, { item: item(kind, tile) }] });
    expect(duplicate.ok).toBe(false);
  });
  test('releases workers without reassignment, prohibits work/improvement, and cancellation releases the reservation', () => {
    const { state, city, tile } = districtFixture(kind);
    city.workedTileIds = [tile]; city.lockedTileIds = [tile];
    expect(previewDistrict(observe(state, 0), 1, kind, tile).releasesWork).toBe(true);
    const queued = queue(state, kind, tile);
    expect(queued.cities[1].workedTileIds).toEqual([]); expect(queued.cities[1].lockedTileIds).toEqual([]);
    expect(queued.cities[1].population).toBe(city.population);
    expect(command(queued, { type: 'AssignWork', cityId: 1, workedTileIds: [tile], lockedTileIds: [] }).ok).toBe(false);
    queued.units[900] = createMapUnit({ kind: 'pokemon', speciesId: 'bulbasaur' }, 900, 0, indexToHex(tile, state.map), EXPANSION_CONTENT, 0, 1);
    expect(command(queued, { type: 'ImproveTile', unitId: 900, tileIndex: tile, kind: kind === 'harborDistrict' ? 'fishery' : 'berryFarm' }).ok).toBe(false);
    const canceled = command(queued, { type: 'SetProductionQueue', cityId: 1, orders: [] });
    expect(canceled.ok).toBe(true);
    if (!canceled.ok) return;
    expect(districtOccupiedTiles(canceled.state).has(tile)).toBe(false);
    expect(canceled.state.cities[1].workedTileIds).toEqual([]);
    expect(command(canceled.state, { type: 'AssignWork', cityId: 1, workedTileIds: [tile], lockedTileIds: [] }).ok).toBe(true);
    expect(previewDistrict(observe(canceled.state, 0), 1, kind, tile).reason).toBeNull();
  });
  test('completes using the existing cost/overflow and only contributes to next-round output', () => {
    const { state, tile } = districtFixture(kind);
    const queued = queue(state, kind, tile), city = queued.cities[1];
    city.queue[0].progress = DISTRICTS[kind].cost;
    city.queue.push({ id: 901, progress: 0, item: { kind: 'building', defId: 'meetingHall' } });
    const before = cityYield(queued, city), hp = maxCityHp(city);
    const events = resolveEconomy(queued);
    expect(events).toContainEqual(expect.objectContaining({ type: 'DistrictCompleted', kind, tileIndex: tile, cityId: 1, cost: DISTRICTS[kind].cost, overflow: before.production }));
    expect(city.queue).toHaveLength(1); expect(city.queue[0].progress).toBe(before.production);
    expect(city.buildingIds).not.toContain(kind); expect(maxCityHp(city)).toBe(hp);
    expect(cityDistrictEffects(queued, 1)).toEqual(emptyDistrictEffects());
    queued.round++;
    const effects = districtEffects(input(queued), kind, tile).total;
    expect(cityDistrictEffects(queued, 1)).toEqual(effects);
    const withDistrict = cityYield(queued, city);
    delete queued.expansion!.districts!.tiles[tile];
    const withoutDistrict = cityYield(queued, city);
    for (const resource of ['food', 'production', 'gold', 'research'] as const) expect(withDistrict[resource] - withoutDistrict[resource]).toBe(effects[resource]);
  });
});

test('research adjacency independently caps terrain at two and completed observatories at one', () => {
  const { state, tile, adjacent } = districtFixture('researchDistrict');
  adjacent.slice(0, 3).forEach(index => { state.map.tiles[index] = 'mountain'; });
  adjacent.slice(3, 5).forEach(index => { state.expansion!.improvements!.tiles[index] = { kind: 'observatoryCamp', builtBy: 1, builtAtRound: 0 }; });
  const result = districtEffects(input(state), 'researchDistrict', tile);
  expect(result.total.research).toBe(5); expect(result.adjacency.map(part => part.value)).toEqual([2, 1]);
  expect(result.adjacency.map(part => part.tileIndices.length)).toEqual([3, 2]);
});

test('harbor rejects landlocked ocean and caps fisheries separately from coastal forest food', () => {
  const { state, tile, adjacent } = districtFixture('harborDistrict');
  adjacent.forEach(index => { state.map.tiles[index] = 'ocean'; });
  expect(districtBlocker(input(state), 1, 'harborDistrict', tile)).toBe('harbor-needs-coast');
  state.map.tiles[adjacent[0]] = 'forest';
  adjacent.slice(1, 4).forEach(index => { state.expansion!.improvements!.tiles[index] = { kind: 'fishery', builtBy: 1, builtAtRound: 0 }; });
  expect(districtBlocker(input(state), 1, 'harborDistrict', tile)).toBeNull();
  expect(districtEffects(input(state), 'harborDistrict', tile).total).toMatchObject({ food: 2, gold: 3 });
});

test('power plant terrain and mine caps are independent; unfinished adjacent projects never contribute', () => {
  const { state, tile, adjacent } = districtFixture('powerPlantDistrict');
  adjacent.slice(0, 3).forEach(index => { state.map.tiles[index] = 'volcano'; });
  adjacent.slice(3).forEach(index => { state.expansion!.improvements!.projects[index] = { kind: 'mine', playerId: 0, progress: 2 }; });
  expect(districtEffects(input(state), 'powerPlantDistrict', tile).total.production).toBe(4);
  adjacent.slice(3).forEach(index => { state.expansion!.improvements!.tiles[index] = { kind: 'mine', builtBy: 1, builtAtRound: 0 }; });
  expect(districtEffects(input(state), 'powerPlantDistrict', tile).total.production).toBe(6);
  state.map.tiles[tile] = 'forest';
  expect(districtBlocker(input(state), 1, 'powerPlantDistrict', tile)).toBe('wrong-biome');
});

test('garden has capped food and one bond point, keeps HQ fixed, and neutral cities have zero effects', () => {
  const { state, tile, adjacent } = districtFixture();
  built(state, 'gardenDistrict', tile);
  state.expansion!.improvements!.tiles[adjacent[0]] = { kind: 'berryFarm', builtBy: 1, builtAtRound: 0 };
  expect(cityDistrictEffects(state, 1)).toMatchObject({ food: 4, bondPressure: 1 });
  expect(bondPressure(state, state.cities[1]).total).toBe(100);
  state.players[0].headquartersCityId = 99;
  const parts = bondPressure(state, state.cities[1]).parts.filter(part => part.label === '花园');
  expect(parts).toEqual([{ label: '花园', value: 1 }]);
  state.units[900] = createMapUnit({ kind: 'pokemon', speciesId: 'bulbasaur' }, 900, 0, indexToHex(tile, state.map), EXPANSION_CONTENT);
  state.cities[1].ownerId = null;
  expect(cityDistrictDetails(observe(state, 0), 1)).toHaveLength(1);
  expect(cityDistrictEffects(state, 1)).toEqual(emptyDistrictEffects());
  expect(cityDistrictDetails(observe(state, 0), 1).every(item => Object.values(item.effects.total).every(value => value === 0))).toBe(true);
});

test('gym XP stacks with center and matching gym at actual deployment; district does not create other systems', () => {
  const { state, city, tile, adjacent } = districtFixture('gymDistrict');
  built(state, 'gymDistrict', tile); city.buildingIds.push('trainingGround');
  state.expansion!.essences!.gyms[1] = 'sylvan';
  adjacent.filter(index => index !== hexToIndex(city.position, state.map)).slice(0, 3).forEach(index => {
    state.expansion!.improvements!.tiles[index] = { kind: 'mine', builtBy: 0, builtAtRound: 0 };
  });
  expect(cityDistrictEffects(state, 1).trainedXp).toBe(50);
  city.pendingDeployments = [{ enteredAtRound: 0, sourceOrderId: 10, item: { kind: 'pokemon', defId: 'bulbasaur' } }];
  const events = resolveEconomy(state), trained = events.find(event => event.type === 'UnitTrained');
  expect(trained?.type === 'UnitTrained' && trained.unit.xp).toBe(90);
  const noDistrict = structuredClone(state); noDistrict.expansion!.districts!.tiles = {};
  expect(maxCityHp(city)).toBe(maxCityHp(noDistrict.cities[1]));
  expect(resolveEssenceRound(structuredClone(state))).toEqual(resolveEssenceRound(noDistrict));
  delete state.expansion!.essences!.gyms[1];
  expect(state.expansion!.contests![0].halls.includes(1)).toBe(false);
  expect(validateCivilizationAction(state, 0, { type: 'MakeOffering', cityId: 1, resource: 'gold' })).not.toBeNull();
  const settlerBase = structuredClone(state); settlerBase.expansion!.districts!.tiles = {};
  for (const s of [state, settlerBase]) s.cities[1].pendingDeployments = [{ enteredAtRound: 0, sourceOrderId: 20, item: { kind: 'logistics', defId: 'settler' } }];
  const trainedSettler = (s: GameState) => resolveEconomy(s).find(event => event.type === 'UnitTrained');
  const a = trainedSettler(state), b = trainedSettler(settlerBase);
  expect(a?.type === 'UnitTrained' && a.unit.xp).toBe(b?.type === 'UnitTrained' && b.unit.xp);
});

test('gym pending deployments gain district XP only on the eventual successful deployment', () => {
  const { state, city, tile } = districtFixture('gymDistrict');
  city.pendingDeployments = [{ enteredAtRound: 1, sourceOrderId: 20, item: { kind: 'pokemon', defId: 'bulbasaur' } }];
  neighbors(city.position, state.map).forEach((position, index) => { state.units[100 + index] = createMapUnit({ kind: 'pokemon', speciesId: 'bulbasaur' }, 100 + index, 0, position, EXPANSION_CONTENT); });
  resolveEconomy(state); expect(city.pendingDeployments).toHaveLength(1);
  built(state, 'gymDistrict', tile); delete state.units[100];
  const result = resolveEconomy(state).find(event => event.type === 'UnitTrained');
  expect(result?.type === 'UnitTrained' && result.unit.xp).toBe(30);
});

test('overlap releases all own workers without reassignment, but never changes foreign worked tiles', () => {
  const { state, city, tile } = districtFixture();
  state.cities[90] = { ...createCity(90, 0, { q: 9, r: 6 }), workedTileIds: [tile], lockedTileIds: [tile] };
  city.workedTileIds = [tile]; city.lockedTileIds = [tile];
  expect(previewDistrict(observe(state, 0), 1, 'gardenDistrict', tile).releasedCityIds).toEqual([1, 90]);
  const next = queue(state, 'gardenDistrict', tile);
  for (const id of [1, 90]) { expect(next.cities[id].workedTileIds).toEqual([]); expect(next.cities[id].lockedTileIds).toEqual([]); }
  state.cities[90].ownerId = 1;
  expect(previewDistrict(observe(state, 0), 1, 'gardenDistrict', tile).reason).toBe('contested-territory');
  const before = canonicalSerialize(state);
  expect(districtBlocker(input(state), 1, 'gardenDistrict', tile)).toBe('contested-territory');
  expect(command(state, { type: 'SetProductionQueue', cityId: 1, orders: [{ item: item('gardenDistrict', tile) }] })).toEqual({ ok: false, reason: 'contested-territory' });
  expect(canonicalSerialize(state)).toBe(before);
});

test('capture keeps completed districts, removes only unfinished district orders and restores new-owner output next round', () => {
  const { state, city, tile } = districtFixture();
  built(state, 'gardenDistrict', tile);
  city.queue = [{ id: 95, progress: 20, item: item('gymDistrict', tile + 1) }, { id: 96, progress: 7, item: { kind: 'building', defId: 'meetingHall' } }];
  state.players[0].headquartersCityId = 999;
  city.hp = 1;
  state.units[91] = createMapUnit({ kind: 'pokemon', speciesId: 'geodude' }, 91, 1, { q: 5, r: 6 }, EXPANSION_CONTENT, 0, 1);
  state.diplomacy[0].status = 'war';
  resolveAttack(state, 91, { kind: 'city', id: 1 }, EXPANSION_CONTENT);
  expect(city.ownerId).toBe(1); expect(city.queue).toEqual([{ id: 96, progress: 7, item: { kind: 'building', defId: 'meetingHall' } }]);
  expect(state.expansion!.districts!.tiles[tile].cityId).toBe(1);
  expect(cityDistrictEffects(state, 1)).toEqual(emptyDistrictEffects());
  state.round++; expect(cityDistrictEffects(state, 1).food).toBeGreaterThan(0);
  state.players[1].research.unlockedIds = [];
  expect(cityDistrictEffects(state, 1).food).toBeGreaterThan(0);
});

test('defection disables and reclaim restores fixed-city districts; elimination releases district reservations', () => {
  const { state, city, tile } = districtFixture();
  built(state, 'gardenDistrict', tile);
  state.players[0].headquartersCityId = 999; state.expansion!.bonds![1] = 0;
  resolveBondRound(state);
  expect(city.ownerId).toBeNull(); expect(cityDistrictEffects(state, 1)).toEqual(emptyDistrictEffects());
  applyBondAction(state, 1, { type: 'ReclaimCity', cityId: 1 }); state.round++;
  expect(cityDistrictEffects(state, 1).food).toBeGreaterThan(0);
  city.queue = [{ id: 95, progress: 20, item: item('gymDistrict', tile + 1) }];
  eliminateCivilization(state, 1);
  expect(city.ownerId).toBeNull(); expect(districtOccupiedTiles(state).has(tile + 1)).toBe(false);
  expect(state.expansion!.districts!.tiles[tile].cityId).toBe(1);
});

test('unknown districts and foreign projects stay hidden; memory cannot reveal later hidden construction', () => {
  const { state, tile } = districtFixture();
  const hidden = hexToIndex({ q: 15, r: 10 }, state.map)!;
  built(state, 'gardenDistrict', tile); built(state, 'researchDistrict', hidden, 3);
  state.cities[3].queue = [{ id: 90, progress: 3, item: item('gardenDistrict', hidden + 1) }];
  refreshKnowledge(state);
  let view = observe(state, 0);
  expect(view.expansion!.districts!.tiles.map(item => item.tileIndex)).toEqual([tile]);
  expect(view.expansion!.districts!.projects).toEqual([]);
  state.units[900] = createMapUnit({ kind: 'pokemon', speciesId: 'bulbasaur' }, 900, 0, { q: 6, r: 6 }, EXPANSION_CONTENT, 0, 1);
  expect(validateImprovementAction(state, 0, { type: 'ImproveTile', unitId: 900, tileIndex: hidden, kind: 'berryFarm' })).toBe('unknown-tile');
  delete state.units[900];
  state.cities[1].ownerId = null;
  state.expansion!.districts!.tiles[tile].kind = 'gymDistrict';
  view = observe(state, 0);
  expect(view.expansion!.districts!.tiles[0].kind).toBe('gardenDistrict');
  expect(view.expansion!.districts!.tiles[0].ownerId).toBe(0);
  expect(JSON.stringify(view.expansion!.districts)).not.toContain(String(hidden));
});

test('unknown adjacent tiles lower previews without leaking terrain; full knowledge equals authority', () => {
  const { state, tile, adjacent } = districtFixture('researchDistrict');
  adjacent.forEach(index => { state.map.tiles[index] = 'mountain'; }); refreshKnowledge(state);
  const view = observe(state, 0);
  for (const index of adjacent) view.map.tiles[index] = null;
  const partial = previewDistrict(view, 1, 'researchDistrict', tile).effects;
  expect(partial.total.research).toBe(2); expect(partial.incomplete).toBe(true);
  expect(partial.unknownAdjacentTileIds).toEqual(adjacent);
  expect(partial.adjacency.every(source => source.tileIndices.length === 0)).toBe(true);
  expect(districtEffects(input(state), 'researchDistrict', tile).total.research).toBe(4);
  for (const index of adjacent) view.map.tiles[index] = state.map.tiles[index];
  expect(previewDistrict(view, 1, 'researchDistrict', tile).effects).toEqual(districtEffects(input(state), 'researchDistrict', tile));
});

test('audit parser preserves the district tile and rejects malformed district inputs', () => {
  const action = { type: 'SetProductionQueue', cityId: 1, orders: [{ item: item('gardenDistrict', 5) }] } as const;
  expect(parseAuditAction(action)).toEqual(action);
  expect(() => parseAuditAction({ ...action, orders: [{ item: { kind: 'district', defId: 'gardenDistrict' } }] })).toThrow();
});

test('completed districts survive reduced radius and contested territory, and cannot be worked by foreigners', () => {
  const { state, city, tile } = districtFixture();
  built(state, 'gardenDistrict', tile);
  state.cities[90] = createCity(90, 1, { q: 9, r: 6 });
  city.population = 1;
  const original = cityDistrictEffects(state, 1);
  state.activePlayerId = 1;
  expect(command(state, { type: 'AssignWork', cityId: 90, workedTileIds: [tile], lockedTileIds: [] }).ok).toBe(false);
  expect(cityDistrictEffects(state, 1)).toEqual(original);
  city.position = { q: 1, r: 1 }; state.players[0].research.unlockedIds = [];
  expect(cityDistrictEffects(state, 1)).toEqual(original);
  state.cities[90].ownerId = null;
  expect(previewDistrict(observe(state, 1), 90, 'gardenDistrict', tile).reason).toBe('city-unavailable');
});

test('contested land is rejected even without foreign work; neutral territory is allowed', () => {
  const { state, tile } = districtFixture();
  state.cities[90] = createCity(90, 1, { q: 9, r: 6 });
  expect(districtBlocker(input(state), 1, 'gardenDistrict', tile)).toBe('contested-territory');
  expect(previewDistrict(observe(state, 0), 1, 'gardenDistrict', tile).reason).toBe('contested-territory');
  state.cities[90].ownerId = null;
  expect(districtBlocker(input(state), 1, 'gardenDistrict', tile)).toBeNull();
  expect(previewDistrict(observe(state, 0), 1, 'gardenDistrict', tile).reason).toBeNull();
});

test('retained orders keep progress and location; replacement frees the old site without refund or reassignment', () => {
  const { state, tile } = districtFixture();
  const next = queue(state, 'gardenDistrict', tile), order = next.cities[1].queue[0]; order.progress = 13;
  const retain = command(next, { type: 'SetProductionQueue', cityId: 1, orders: [{ orderId: order.id, item: order.item }] });
  expect(retain.ok && retain.state.cities[1].queue[0].progress).toBe(13);
  const target = tile + 1;
  expect(command(next, { type: 'SetProductionQueue', cityId: 1, orders: [{ orderId: order.id, item: item('gardenDistrict', target) }] }).ok).toBe(false);
  const replaced = queue(next, 'gardenDistrict', target);
  expect(districtOccupiedTiles(replaced).has(tile)).toBe(false);
  expect(replaced.cities[1].queue[0].progress).toBe(0);
  expect(replaced.players[0].gold).toBe(next.players[0].gold);
});

test('adjacent improvements change the next snapshot, district resources are not multiplied, and harmony still prevents defection', () => {
  const { state, city, tile, adjacent } = districtFixture();
  built(state, 'gardenDistrict', tile);
  city.buildingIds.push('pasture'); // Bulbasaur already multiplies the ordinary food by 1.1.
  const before = cityYield(state, city).food;
  state.expansion!.improvements!.tiles[adjacent[0]] = { kind: 'berryFarm', builtBy: 1, builtAtRound: state.round };
  state.round++;
  expect(cityYield(state, city).food - before).toBe(1);
  expect(cityDistrictDetails(observe(state, 0), 1)[0].effects.total).toEqual(cityDistrictEffects(state, 1));
  state.players[0].headquartersCityId = 999; state.expansion!.bonds![1] = 0;
  state.expansion!.faith!.faiths[0] = { founderId: 0, legend: 'lugia', tenets: ['harmony', 'shrineFood'], foundedRound: 1 };
  state.expansion!.faith!.cityFaith[1] = 0;
  resolveBondRound(state);
  expect(city.ownerId).toBe(0); expect(state.expansion!.bonds![1]).toBe(0);
});

test('own districts completed outside vision are city information without refreshing hidden terrain; capture transfers that knowledge', () => {
  const { state, city, tile, adjacent } = districtFixture('researchDistrict');
  const queued = queue(state, 'researchDistrict', tile);
  queued.cities[1].queue[0].progress = DISTRICTS.researchDistrict.cost;
  queued.cities[1].position = { q: 1, r: 1 }; // Simulate loss of the scout/visibility after valid enqueue.
  queued.map.tiles[adjacent[0]] = 'volcano';
  const hiddenBefore = observe(queued, 0).map.tiles[adjacent[0]];
  expect(visibleTiles(queued, 0).has(tile)).toBe(false);
  resolveEconomy(queued); refreshKnowledge(queued);
  const view = observe(queued, 0);
  expect(view.expansion!.districts!.tiles).toContainEqual(expect.objectContaining({ tileIndex: tile, kind: 'researchDistrict', cityId: city.id }));
  expect(view.map.tiles[adjacent[0]]).toBe(hiddenBefore);
  expect(observe(queued, 1).expansion!.districts!.tiles).toEqual([]);
  queued.cities[1].position = city.position; refreshKnowledge(queued);
  queued.cities[1].ownerId = 1; queued.cities[1].position = { q: 1, r: 1 };
  const oldMemory = observe(queued, 0).expansion!.districts!.tiles[0];
  expect(oldMemory.ownerId).toBe(0); // Last observation, not hidden ownership truth.
  expect(observe(queued, 1).expansion!.districts!.tiles[0].ownerId).toBe(1);
});
