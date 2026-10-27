import { expect, test } from 'vitest';
import { combatFixture, pokemon } from '../core/combat-fixture.ts';
import { observe, refreshKnowledge } from '../../src/core/vision.ts';
import { CONTENT } from '../../src/content/units.ts';
import { planNext } from '../../src/ai/plan.ts';
import { previewCapture } from '../../src/core/preview.ts';
import { hexToIndex } from '../../src/core/hex.ts';
import { canCaptureByPersonality } from '../../src/ai/plan.ts';

function captureScenario(personality: 'aggressive' | 'conservative') {
  const state = combatFixture(); state.players[0].personality = personality;
  state.players[0].research.unlockedIds = Object.keys(CONTENT.techs) as (keyof typeof CONTENT.techs)[];
  state.players[0].ballInventory.pokeBall = 1;
  state.cities[1].queue = [{ id: 50, progress: 0, item: { kind: 'pokemon', defId: 'bulbasaur' } }];
  state.cities[1].workedTileIds = [0, 1];
  pokemon(state, 10, 'charmander', 0, 3, 2); pokemon(state, 11, 'bulbasaur', null, 4, 2).hp = 5;
  refreshKnowledge(state); return observe(state, 0);
}

test.each(['aggressive', 'conservative'] as const)('%s captures an eligible low-HP wild target instead of spending its action attacking it', personality => {
  const view = captureScenario(personality);
  expect(previewCapture(view, 10, 11, 'pokeBall').ok).toBe(true);
  expect(planNext(view).action).toEqual({ type: 'Capture', unitId: 10, targetUnitId: 11, ballId: 'pokeBall' });
});

test.each(['aggressive', 'conservative'] as const)('%s buys a ball for the eligible nearby target before attacking it', personality => {
  const view = captureScenario(personality); view.economy.player.ballInventory.pokeBall = 0;
  expect(planNext(view).action).toEqual({ type: 'BuyBall', cityId: 1, ballId: 'pokeBall', quantity: 1 });
});

test('aggressive military training still precedes capture', () => {
  const view = captureScenario('aggressive'); view.economy.cities[0].queue = [];
  expect(planNext(view).action).toMatchObject({ type: 'SetProductionQueue', orders: [{ item: { kind: 'pokemon' } }] });
});

test('conservative still does not capture outside its territory', () => {
  const view = captureScenario('conservative'), target = view.units.find(unit => unit.id === 11)!;
  const tile = hexToIndex(target.position, view.map)!;
  for (const ownership of [null, [], [1]]) {
    view.territoryOwnerIds[tile] = ownership;
    expect(canCaptureByPersonality(view, target)).toBe(false);
    expect(planNext(view).action.type).not.toBe('Capture');
  }
  view.territoryOwnerIds[tile] = [0, 1];
  expect(canCaptureByPersonality(view, target)).toBe(true);
  expect(planNext(view).action.type).toBe('Capture');
});
