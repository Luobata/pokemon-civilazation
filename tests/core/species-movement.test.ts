import { expect, test } from 'vitest';
import { combatFixture, pokemon, issue } from './combat-fixture.ts';
import { CONTENT } from '../../src/content/units.ts';
import { canEnter, reachablePaths } from '../../src/core/movement.ts';
import { hexToIndex } from '../../src/core/hex.ts';
import { observe, refreshKnowledge } from '../../src/core/vision.ts';

test('D28 flight passage still costs terrain; ghost ignores terrain costs and has scout vision', () => {
  const state = combatFixture(); state.cities = {}; state.map.tiles.fill('forest');
  const unit = pokemon(state, 10, 'gastly', 0, 3, 3);
  refreshKnowledge(state);
  expect(CONTENT.species.gastly.vision).toBe(3); expect(CONTENT.species.haunter.vision).toBe(3); expect(CONTENT.species.gengar.vision).toBe(3);
  expect(reachablePaths(observe(state, 0), 10)[hexToIndex({ q: 6, r: 3 }, state.map)!]).toBeDefined();
  unit.speciesId = 'pidgey'; refreshKnowledge(state);
  expect(reachablePaths(observe(state, 0), 10)[hexToIndex({ q: 6, r: 3 }, state.map)!]).toBeUndefined(); // move4, cost6
  expect(canEnter(unit, 'ocean')).toBe(true); expect(canEnter(unit, 'volcano')).toBe(true);
  unit.speciesId = 'magikarp'; expect(canEnter(unit, 'grassland')).toBe(false); expect(canEnter(unit, 'ocean')).toBe(true);
  unit.speciesId = 'squirtle'; expect(canEnter(unit, 'grassland')).toBe(true); expect(canEnter(unit, 'ocean')).toBe(true); expect(canEnter(unit, 'volcano')).toBe(false);
  unit.speciesId = 'dragonite'; expect(canEnter(unit, 'ocean')).toBe(true); expect(canEnter(unit, 'volcano')).toBe(true);
});

test('registered fast species require riding, ordinary registered species remain trainable', () => {
  const state = combatFixture(); state.players[0].registeredSpeciesIds.push('ponyta', 'raticate', 'machop');
  const order = (defId: 'ponyta' | 'raticate' | 'machop') => ({ type: 'SetProductionQueue' as const, cityId: 1, orders: [{ item: { kind: 'pokemon' as const, defId } }] });
  expect(issue(state, order('ponyta')).ok).toBe(false); expect(issue(state, order('raticate')).ok).toBe(false); expect(issue(state, order('machop')).ok).toBe(true);
  state.players[0].research.unlockedIds.push('riding'); expect(issue(state, order('ponyta')).ok).toBe(true); expect(issue(state, order('raticate')).ok).toBe(true);
});
