import { expect, test } from 'vitest';
import { combatFixture, pokemon } from './combat-fixture.ts';
import { createCity } from '../../src/core/city.ts';
import { refreshKnowledge } from '../../src/core/vision.ts';
import { step } from '../../src/core/step.ts';
import { CONTENT } from '../../src/content/units.ts';

test.each([false, true])('captured HP is injected; HQ=%s still neutralizes remaining cities at 50', headquarters => {
  const state = combatFixture(), content = structuredClone(CONTENT);
  content.balance.city.baseHp = 80; content.balance.city.capturedHp = 60;
  pokemon(state, 10, 'charmander', 0, 9, 2);
  state.diplomacy[0].status = 'war';
  state.cities[3] = createCity(3, 1, { q: 14, r: 5 }, !headquarters, content);
  if (!headquarters) {
    state.players[1].headquartersCityId = 3;
    state.cities[2] = createCity(2, 1, { q: 10, r: 2 }, false, content);
  }
  state.cities[2].hp = 1;
  refreshKnowledge(state);
  const result = step(state, { actorId: 0, expectedSeq: state.commandSeq, action: { type: 'Attack', unitId: 10, target: { kind: 'city', id: 2 } } }, content);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.state.cities[2]).toMatchObject({ ownerId: 0, hp: 60 });
  expect(result.state.cities[3]).toMatchObject(headquarters ? { ownerId: null, hp: 50 } : { ownerId: 1, hp: 80 });
  expect(result.state.players[1].eliminated).toBe(headquarters);
});
