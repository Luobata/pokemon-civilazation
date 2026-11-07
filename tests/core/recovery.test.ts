import { afterEach, expect, test, vi } from 'vitest';
import { combatFixture, pokemon, accepted, issue } from './combat-fixture.ts';
import { resolveRecovery } from '../../src/core/recovery.ts';
import { resolveAttack } from '../../src/core/combat.ts';
import { resolveEconomy } from '../../src/core/economy.ts';
import { actWild } from '../../src/core/wild.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { hexToIndex, neighbors } from '../../src/core/hex.ts';
import { observe, refreshKnowledge, visibleTiles } from '../../src/core/vision.ts';
import { reachablePaths } from '../../src/core/movement.ts';
import * as rng from '../../src/core/rng.ts';

afterEach(() => vi.restoreAllMocks());

test('action knockout count3 decrements this round; stage6 count2 waits until next stage5', () => {
  const state = combatFixture(); pokemon(state, 10, 'charmander', 0, 3, 3); pokemon(state, 11, 'bulbasaur', 1, 4, 3).hp = 1;
  vi.spyOn(rng, 'randomBelow').mockReturnValue(15);
  resolveAttack(state, 10, { kind: 'unit', id: 11 }); expect(state.units[11]).toMatchObject({ roundsLeft: 3, hp: 1 });
  resolveRecovery(state); expect(state.units[11]).toMatchObject({ roundsLeft: 2, hp: 1 });
  pokemon(state, 20, 'charmander', null, 6, 4); pokemon(state, 21, 'bulbasaur', 0, 7, 4).hp = 1;
  actWild(state); expect(state.units[21]).toMatchObject({ roundsLeft: 2, hp: 1 });
  expect(state.units[11]).toMatchObject({ roundsLeft: 2 });
  resolveRecovery(state); expect(state.units[11]).toMatchObject({ roundsLeft: 1 }); expect(state.units[21]).toMatchObject({ roundsLeft: 1 });
});

test('EndTurn executes stage5 before stage6 and never restores recovering AP', () => {
  const state = combatFixture(); state.activePlayerId = 1;
  state.units[11] = { ...pokemon(state, 11, 'bulbasaur', 0), location: 'recovering', position: null, cityId: 1, roundsLeft: 3, hp: 1, actionLeft: 0 };
  pokemon(state, 20, 'charmander', null, 5, 5); pokemon(state, 21, 'bulbasaur', 0, 6, 5).hp = 1;
  vi.spyOn(rng, 'randomBelow').mockImplementation((_rng, bound) => bound === 100 ? 99 : bound - 1);
  const next = accepted(state, { type: 'EndTurn' });
  expect(next.round).toBe(2);
  for (const id of [11, 21]) expect(next.units[id]).toMatchObject({ location: 'recovering', roundsLeft: 2, hp: 1, actionLeft: 0 });
});

test('recovery has no occupancy, vision or actions, but pays maintenance', () => {
  const state = combatFixture(); pokemon(state, 10, 'charmander');
  state.units[11] = { ...pokemon(state, 11, 'snorlax', 0, 12, 6), location: 'recovering', position: null, cityId: 1, roundsLeft: 2, actionLeft: 0 };
  refreshKnowledge(state);
  const view = observe(state, 0), noSlot = structuredClone(state); delete noSlot.units[11];
  expect(visibleTiles(state, 0)).toEqual(visibleTiles(noSlot, 0)); expect(view.units.map(unit => unit.id)).toEqual([10]);
  expect(view.recoveringUnits.map(unit => unit.id)).toEqual([11]); expect(reachablePaths(view, 10)).toEqual(reachablePaths(observe(noSlot, 0), 10));
  for (const action of [
    { type: 'Move' as const, unitId: 11, to: { q: 4, r: 3 } },
    { type: 'Attack' as const, unitId: 11, target: { kind: 'unit' as const, id: 10 } },
    { type: 'Capture' as const, unitId: 11, targetUnitId: 10, ballId: 'pokeBall' as const },
    { type: 'Evolve' as const, unitId: 11, intoSpeciesId: 'charmeleon' as const },
  ]) expect(issue(state, action)).toMatchObject({ ok: false, reason: 'unit-unavailable' });
  const events = resolveEconomy(state); expect(events).toContainEqual(expect.objectContaining({ type: 'GoldSettled', playerId: 0, upkeep: 4 }));
});

test('D17 ID order, terrain-filtered deployment, blocked retry restores25% only once, then territory heals', () => {
  const state = combatFixture(), city = state.cities[1];
  const adjacent = neighbors(city.position, state.map).sort((a, b) => hexToIndex(a, state.map)! - hexToIndex(b, state.map)!);
  for (const position of adjacent) state.map.tiles[hexToIndex(position, state.map)!] = 'ocean';
  state.map.tiles[hexToIndex(adjacent[2], state.map)!] = 'volcano'; // fire's sole legal empty tile
  for (const id of [9, 7]) state.units[id] = { ...pokemon(state, id, 'charmander'), location: 'recovering', position: null, cityId: city.id, roundsLeft: 1, hp: 1, actionLeft: 0 };
  resolveRecovery(state);
  expect(state.units[7]).toMatchObject({ location: 'map', position: adjacent[2], hp: 17 }); // floor(50*.25)+5
  expect(state.units[9]).toMatchObject({ location: 'recovering', roundsLeft: 0, hp: 12 });
  state.units[9].hp = 8; resolveRecovery(state); expect(state.units[9].hp).toBe(8);
  delete state.units[7]; resolveRecovery(state); expect(state.units[9]).toMatchObject({ location: 'map', position: adjacent[2], hp: 13 });
});

test('stage2 deployment occupies recovery destination first; medicine heals10 only own territory', () => {
  const state = combatFixture(), city = state.cities[1];
  const adjacent = neighbors(city.position, state.map).sort((a, b) => hexToIndex(a, state.map)! - hexToIndex(b, state.map)!);
  for (const [i, position] of adjacent.slice(1).entries()) state.units[20 + i] = createMapUnit({ kind: 'logistics', role: 'settler' }, 20 + i, 0, position);
  state.units[7] = { ...pokemon(state, 7), location: 'recovering', position: null, cityId: 1, roundsLeft: 1, hp: 1 };
  city.pendingDeployments = [{ enteredAtRound: 0, sourceOrderId: 70, item: { kind: 'pokemon', defId: 'charmander' } }];
  resolveEconomy(state); resolveRecovery(state);
  expect(state.units[100]).toMatchObject({ position: adjacent[0] }); expect(state.units[7]).toMatchObject({ location: 'recovering', roundsLeft: 0 });
  pokemon(state, 50, 'charmander', 0, 2, 2).hp = 1; pokemon(state, 51, 'charmander', 0, 12, 5).hp = 1;
  state.players[0].research.unlockedIds.push('medicine'); resolveRecovery(state);
  expect(state.units[50].hp).toBe(11); expect(state.units[51].hp).toBe(1);
});
