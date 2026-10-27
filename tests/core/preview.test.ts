import { expect, test } from 'vitest';
import { combatFixture, pokemon } from './combat-fixture.ts';
import { observe, refreshKnowledge } from '../../src/core/vision.ts';
import { previewAttack, previewCapture } from '../../src/core/preview.ts';

test('GDD7.4 17–21 damage, counter2; preview includes possible vs guaranteed knockout', () => {
  const state = combatFixture(); pokemon(state, 10, 'charmeleon').hp = 51; pokemon(state, 11, 'ivysaur', null, 4);
  refreshKnowledge(state); const view = observe(state, 0);
  expect(previewAttack(view, 10, { kind: 'unit', id: 11 })).toEqual({ ok: true, damage: { min: 17, max: 21 }, counter: { trigger: 'always', damage: 2 }, knockdown: 'none' });
  view.units.find(unit => unit.id === 11)!.hp = 20;
  expect(previewAttack(view, 10, { kind: 'unit', id: 11 })).toMatchObject({ counter: { trigger: 'possible' }, knockdown: 'possible' });
  view.units.find(unit => unit.id === 11)!.hp = 17;
  expect(previewAttack(view, 10, { kind: 'unit', id: 11 })).toMatchObject({ counter: { trigger: 'never', damage: 0 }, knockdown: 'guaranteed' });
});
test.each([
  ['machoke', 15, 'pokeBall', false, 47], ['machoke', 15, 'greatBall', false, 71],
  ['machoke', 15, 'pokeBall', true, 57], ['snorlax', 20, 'greatBall', true, 43],
] as const)('capture preview %s hp%i %s observe=%s ->%i', (species, hp, ball, researched, probability) => {
  const state = combatFixture(); pokemon(state); pokemon(state, 11, species, null, 4).hp = hp;
  state.players[0].research.unlockedIds = ['domestication', 'ballCraft', ...(researched ? ['fieldObservation' as const] : [])];
  state.players[0].ballInventory[ball] = 1; refreshKnowledge(state);
  expect(previewCapture(observe(state, 0), 10, 11, ball)).toEqual({ ok: true, probability });
});
test('previews ignore all hidden state and do not mutate observation', () => {
  const state = combatFixture(); pokemon(state); pokemon(state, 11, 'bulbasaur', null, 4);
  refreshKnowledge(state); const view = observe(state, 0), before = structuredClone(view);
  const expected = previewAttack(view, 10, { kind: 'unit', id: 11 });
  pokemon(state, 90, 'dragonite', 1, 12, 6); state.rng.value = 999; state.players[1].gold = 0;
  expect(previewAttack(view, 10, { kind: 'unit', id: 11 })).toEqual(expected); expect(view).toEqual(before);
  expect(previewAttack(view, 10, { kind: 'unit', id: 90 }).ok).toBe(false);
  expect(previewCapture(view, 10, 90, 'pokeBall').ok).toBe(false);
});
