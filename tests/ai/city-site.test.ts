import { expect, test } from 'vitest';
import { combatFixture, pokemon } from '../core/combat-fixture.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { observe, refreshKnowledge } from '../../src/core/vision.ts';
import { hexDistance } from '../../src/core/hex.ts';
import { knownCities, isCitySite } from '../../src/ai/query.ts';
import { planNext } from '../../src/ai/plan.ts';
import { simulateMatch } from '../../tools/simulate.ts';
import { explorationMatches } from '../../tools/matches.ts';

test('undiscovered city three tiles away: old candidate guessed valid, new planner scouts first', () => {
  const state = combatFixture(); state.players[0].personality = 'expansion';
  state.units[10] = createMapUnit({ kind: 'logistics', role: 'settler' }, 10, 0, { q: 6, r: 2 }, undefined, 0, 1);
  state.cities[2].position = { q: 9, r: 2 }; refreshKnowledge(state);
  const view = observe(state, 0), position = { q: 6, r: 2 };
  expect(knownCities(view).every(city => hexDistance(city.position, position) >= 4)).toBe(true); // previous implementation
  expect(isCitySite(view, position)).toBe(false); expect(planNext(view).action.type).not.toBe('FoundCity');
  const unchanged = structuredClone(view); state.cities[2].position = { q: 12, r: 2 };
  expect(observe(state, 0)).toEqual(unchanged); expect(planNext(observe(state, 0))).toEqual(planNext(view));
  state.cities[2].position = { q: 9, r: 2 }; pokemon(state, 11, 'pidgeot', 0, 6, 3); refreshKnowledge(state);
  expect(knownCities(observe(state, 0)).some(city => city.id === 2)).toBe(true);
  expect(isCitySite(observe(state, 0), position)).toBe(false);
  const remembered = observe(state, 0); remembered.cities = remembered.cities.filter(city => city.id !== 2);
  remembered.map.tiles.fill('grassland');
  expect(remembered.knowledge.lastKnownCities[2]).toBeDefined();
  expect(isCitySite(remembered, position)).toBe(false);
});
test('explored valid land remains a candidate and permits normal founding', () => {
  const state = combatFixture(); state.units[10] = createMapUnit({ kind: 'logistics', role: 'settler' }, 10, 0, { q: 6, r: 5 }, undefined, 0, 1);
  state.players[0].personality = 'expansion'; refreshKnowledge(state);
  const view = observe(state, 0); view.map.tiles.fill('grassland');
  expect(isCitySite(view, { q: 6, r: 5 })).toBe(true);
  expect(planNext(view).action).toEqual({ type: 'FoundCity', unitId: 10 });
});
test('original1v3 seed1 repeated invalid-city-site defect no longer recurs', () => {
  const match = explorationMatches(100).find(match => match.id === '1v3-1-0')!;
  const result = simulateMatch(match);
  expect(result.invalid).toEqual([]); expect(result.aborted).toBe(false);
}, 30_000);
