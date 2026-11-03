import { expect, test } from 'vitest';
import { compareDistrictCandidates, districtCandidates } from '../../src/ai/district-plan.ts';
import { planNext } from '../../src/ai/plan.ts';
import { RULE_QUERIES } from '../../src/ai/query.ts';
import { EXPANSION_CONTENT } from '../../src/content/units.ts';
import { createCity, tileYield } from '../../src/core/city.ts';
import { observe } from '../../src/core/vision.ts';
import { districtFixture } from '../core/fixtures/districts.ts';

const candidates = (state: ReturnType<typeof districtFixture>['state']) => districtCandidates(observe(state, 0), 1, EXPANSION_CONTENT);
test('district AI uses the exact resource, XP, bond, cost, opportunity and personality terms', () => {
  const { state, city, tile } = districtFixture();
  state.players[0].personality = 'expansion';
  const garden = () => candidates(state).find(item => item.kind === 'gardenDistrict' && item.tileIndex === tile)!;
  expect(garden()).toMatchObject({ resourceValue: 6, personalityBonus: 100, opportunityCost: 0, sameKindCount: 0, score: 680 });
  city.workedTileIds = [tile];
  const y = tileYield('grassland', state.players[0], EXPANSION_CONTENT);
  const lost = 100 * (2 * y.food + 3 * y.production + 2 * y.gold + 3 * y.research);
  expect(garden().score).toBe(680 - lost);
  expect(garden().opportunityCost).toBe(lost);
  city.workedTileIds = [];
  state.players[0].personality = 'aggressive';
  expect(candidates(state).find(item => item.kind === 'gymDistrict' && item.tileIndex === tile)?.score).toBe(5 * 30 - 70 + 150);
  state.players[0].personality = 'conservative';
  expect(candidates(state).find(item => item.kind === 'researchDistrict' && item.tileIndex === tile)?.score).toBe(100 * 6 - 60 + 100);
});

test('AI empire penalty counts owned completed and queued districts and tie order is deterministic', () => {
  const { state, tile } = districtFixture();
  state.cities[90] = createCity(90, 0, { q: 11, r: 6 });
  state.expansion!.districts!.tiles[tile + 4] = { cityId: 90, kind: 'gardenDistrict', tileIndex: tile + 4, builtAtRound: 0 };
  state.cities[90].queue = [{ id: 900, progress: 0, item: { kind: 'district', defId: 'gardenDistrict', tileIndex: tile + 5 } }];
  state.players[0].personality = 'expansion';
  expect(candidates(state).find(item => item.kind === 'gardenDistrict' && item.tileIndex === tile)).toMatchObject({ sameKindCount: 2, score: 530 });
  const base = candidates(state)[0];
  const tied = [{ ...base, cityId: 2, tileIndex: 5, kind: 'gardenDistrict' as const },
    { ...base, cityId: 1, tileIndex: 6, kind: 'gardenDistrict' as const },
    { ...base, cityId: 1, tileIndex: 5, kind: 'gymDistrict' as const },
    { ...base, cityId: 1, tileIndex: 5, kind: 'gardenDistrict' as const }];
  expect(tied.sort(compareDistrictCandidates).map(item => [item.cityId, item.tileIndex, item.kind])).toEqual([
    [1, 5, 'gardenDistrict'], [1, 5, 'gymDistrict'], [1, 6, 'gardenDistrict'], [2, 5, 'gardenDistrict'],
  ]);
});

test('AI uses only observed state, excludes contested land and does not offer districts in v9 or occupied queues', () => {
  const { state, city, tile } = districtFixture();
  const before = candidates(state);
  state.map.tiles[state.map.tiles.length - 1] = 'volcano';
  state.cities[3].queue = [{ id: 900, progress: 0, item: { kind: 'district', defId: 'gardenDistrict', tileIndex: state.map.tiles.length - 1 } }];
  expect(candidates(state)).toEqual(before);
  state.cities[90] = createCity(90, 1, { q: 9, r: 6 });
  expect(candidates(state).some(item => item.tileIndex === tile)).toBe(false);
  city.queue = [{ id: 901, progress: 1, item: { kind: 'building', defId: 'meetingHall' } }];
  const command = planNext(observe(state, 0), { ...RULE_QUERIES, content: EXPANSION_CONTENT });
  expect(command.action.type).not.toBe('SetProductionQueue');
  expect(candidates(districtFixture('gardenDistrict', 9).state)).toEqual([]);
});

test('own completed facilities outside vision still block duplicate kinds in AI', () => {
  const { state, tile } = districtFixture();
  const hidden = state.map.tiles.length - 1;
  state.expansion!.districts!.tiles[hidden] = { cityId: 1, kind: 'gardenDistrict', tileIndex: hidden, builtAtRound: 0 };
  expect(observe(state, 0).visibleTileIds).not.toContain(hidden);
  expect(candidates(state).some(item => item.kind === 'gardenDistrict')).toBe(false);
  expect(candidates(state).some(item => item.tileIndex === tile)).toBe(true);
});
