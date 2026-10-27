import { expect, test } from 'vitest';
import { combatFixture, pokemon, issue } from './combat-fixture.ts';
import { observe, projectEvents, refreshKnowledge } from '../../src/core/vision.ts';
import { step } from '../../src/core/step.ts';

test.each([true, false])('M3-01 only capturing player receives Captured even when bystander visibility=%s', visible => {
  const state = combatFixture(); pokemon(state, 10, 'charmander', 0, 3, 3);
  pokemon(state, 11, 'bulbasaur', null, 4, 3).hp = 1;
  if (visible) pokemon(state, 12, 'pidgeot', 1, 4, 4);
  state.players[0].research.unlockedIds.push('domestication'); state.players[0].ballInventory.pokeBall = 1;
  refreshKnowledge(state);
  expect(observe(state, 1).units.some(unit => unit.id === 11)).toBe(visible);
  const result = issue(state, { type: 'Capture', unitId: 10, targetUnitId: 11, ballId: 'pokeBall' });
  if (!result.ok) throw new Error(result.reason);
  expect(result.events.some(event => event.payload.type === 'Captured')).toBe(true);
  expect(projectEvents(state, result.state, result.events, 0).some(event => event.payload.type === 'Captured')).toBe(true);
  expect(projectEvents(state, result.state, result.events, 1).some(event => event.payload.type === 'Captured')).toBe(false);
});

test('hidden and absent capture targets have the same rejection and cannot consume RNG or emit events', () => {
  const state = combatFixture(); pokemon(state, 10, 'charmander', 0, 3, 3);
  pokemon(state, 11, 'bulbasaur', null, 11, 5).hp = 1;
  state.players[0].research.unlockedIds.push('domestication'); state.players[0].ballInventory.pokeBall = 1;
  refreshKnowledge(state); const before = structuredClone(state), hiddenView = observe(state, 0);
  const capture = (targetUnitId: number) => step(state, { actorId: 0, expectedSeq: state.commandSeq,
    action: { type: 'Capture', unitId: 10, targetUnitId, ballId: 'pokeBall' } });
  expect(capture(11)).toEqual({ ok: false, reason: 'capture-unavailable' });
  expect(capture(999)).toEqual(capture(11)); expect(state).toEqual(before);
  state.units[11].hp = 5;
  expect(observe(state, 0)).toEqual(hiddenView);
  expect(capture(11)).toEqual({ ok: false, reason: 'capture-unavailable' });
});
