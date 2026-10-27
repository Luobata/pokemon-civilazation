import { expect, test } from 'vitest';
import { combatFixture } from '../core/combat-fixture.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { hexToIndex } from '../../src/core/hex.ts';
import { refreshKnowledge } from '../../src/core/vision.ts';
import { classifyRejection } from '../../tools/rejections.ts';

test('offline classification separates unknown hidden city from known city, ocean and other defects', () => {
  const state = combatFixture();
  state.units[10] = createMapUnit({ kind: 'logistics', role: 'settler' }, 10, 0, { q: 6, r: 2 }, undefined, 0, 1);
  state.cities[2].position = { q: 9, r: 2 }; refreshKnowledge(state);
  const command = { actorId: 0, expectedSeq: 0, action: { type: 'FoundCity' as const, unitId: 10 } };
  expect(classifyRejection(state, command, 'invalid-city-site')).toBe('fog');
  expect(classifyRejection(state, command, 'no-action')).toBe('defect');
  state.map.tiles[hexToIndex(state.units[10].position!, state.map)!] = 'ocean';
  expect(classifyRejection(state, command, 'invalid-city-site')).toBe('defect');
  state.map.tiles[hexToIndex(state.units[10].position!, state.map)!] = 'grassland';
  state.knowledge[0].lastKnownCities[2] = { ownerId: 1, position: { q: 9, r: 2 }, lastSeenRound: 1 };
  expect(classifyRejection(state, command, 'invalid-city-site')).toBe('defect');
});
