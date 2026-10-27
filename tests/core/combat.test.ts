import { afterEach, describe, expect, test, vi } from 'vitest';
import * as rng from '../../src/core/rng.ts';
import { combatFixture, pokemon, accepted, issue } from './combat-fixture.ts';
import { resolveAttack } from '../../src/core/combat.ts';
import { canonicalSerialize } from '../../src/core/snapshot.ts';
import { hexToIndex } from '../../src/core/hex.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { createCity, assignNewWorkers } from '../../src/core/city.ts';
import { resolveEconomy } from '../../src/core/economy.ts';
import { observe, projectEvents, refreshKnowledge } from '../../src/core/vision.ts';
import type { CombatAction } from '../../src/core/model.ts';

afterEach(() => vi.restoreAllMocks());
const attack = { type: 'Attack', unitId: 10, target: { kind: 'unit', id: 11 } } as const;
function maxRoll() { return vi.spyOn(rng, 'randomBelow').mockReturnValue(15); }

describe('Attack transactions', () => {
  test('default peace rejects; war enables damage and fixed counter with one RNG draw', () => {
    const state = combatFixture(); pokemon(state, 10, 'charmeleon'); pokemon(state, 11, 'wartortle', 1, 4);
    const random = maxRoll();
    expect(issue(state, attack)).toMatchObject({ ok: false, reason: 'attack-unavailable' }); expect(random).not.toHaveBeenCalled();
    state.diplomacy[0].status = 'war';
    const next = accepted(state, attack);
    expect(next.units[11].hp).toBe(66); expect(next.units[10].hp).toBe(62);
    expect(next.units[10].xp).toBe(10); expect(next.units[11].xp).toBe(10);
    expect(next.units[10].actionLeft).toBe(0); expect(next.units[11].actionLeft).toBe(1);
    expect(random.mock.calls.map(call => call[1])).toEqual([16]);
  });
  test('immunity still allows a counter; defender out of range cannot counter', () => {
    const state = combatFixture(); pokemon(state, 10, 'pikachu'); pokemon(state, 11, 'geodude', null, 4); maxRoll();
    const next = accepted(state, attack); expect(next.units[11].hp).toBe(50); expect(next.units[10].hp).toBeLessThan(45);
    expect(next.units[10].xp).toBe(0);
    pokemon(state, 11, 'machop', null, 5);
    const distant = accepted(state, attack); expect(distant.units[10].hp).toBe(45);
  });
  test('D33 XP combines damage and knockout before both multipliers; M3 temporary no-city removal', () => {
    const state = combatFixture(); pokemon(state); pokemon(state, 11, 'bulbasaur', 1, 4).hp = 1;
    state.diplomacy[0].status = 'war'; state.cities = { 1: state.cities[1] };
    state.players[0].starterId = 'charmander'; state.players[0].research.unlockedIds.push('training'); maxRoll();
    const next = accepted(state, attack);
    expect(next.units[11]).toBeUndefined(); expect(next.units[10].xp).toBe(71); expect(next.players[0].knockdownCount).toBe(1);
    state.players[0].research.unlockedIds = []; pokemon(state, 11, 'bulbasaur', null, 4);
    expect(accepted(state, attack).units[10].xp).toBe(11);
  });
  test('settler adjacent attack destroys HP30 without counter/bonus XP; range2 rejected', () => {
    const state = combatFixture(); pokemon(state);
    state.diplomacy[0].status = 'war';
    state.units[11] = createMapUnit({ kind: 'logistics', role: 'settler' }, 11, 1, { q: 4, r: 3 });
    const next = accepted(state, attack);
    expect(next.units[11]).toBeUndefined(); expect(next.units[10].hp).toBe(50); expect(next.units[10].xp).toBe(10);
    expect(next.players[0].knockdownCount).toBe(1);
    state.units[11].position = { q: 5, r: 3 }; expect(issue(state, attack).ok).toBe(false);
  });
  test.each(['bulbasaur', 'squirtle'] as const)('D33 city E100 D50, counter A30/34: %s', starter => {
    const state = combatFixture(); pokemon(state, 10, 'gastly', 0, 9, 2); state.diplomacy[0].status = 'war';
    state.players[1].starterId = starter; const random = maxRoll();
    const next = accepted(state, { ...attack, target: { kind: 'city', id: 2 } });
    expect(next.cities[2].hp).toBe(89); // ghost attack city E100, no normal immunity
    expect(next.units[10].hp).toBe(48 - (starter === 'squirtle' ? 3 : 2));
    expect(random.mock.calls.map(call => call[1])).toEqual([16]);
  });
  test('city cover T80; range3 siege attack cannot be countered; siege tech multiplier', () => {
    const state = combatFixture(); pokemon(state, 10, 'golem', 0, 7, 2); state.diplomacy[0].status = 'war'; maxRoll();
    state.map.tiles[hexToIndex(state.cities[2].position, state.map)!] = 'forest';
    // Supply vision at the target; range alone does not reveal hidden cities.
    pokemon(state, 12, 'pidgey', 0, 10, 3);
    state.players[0].research.unlockedIds.push('siegeCraft');
    const next = accepted(state, { ...attack, target: { kind: 'city', id: 2 } });
    expect(next.cities[2].hp).toBe(78); expect(next.units[10].hp).toBe(85);
  });
  test('city counter knockout credits city owner without XP to a unit', () => {
    const state = combatFixture(); pokemon(state, 10, 'charmander', 0, 9, 2).hp = 1;
    const ally = pokemon(state, 12, 'squirtle', 1, 10, 3); state.diplomacy[0].status = 'war'; maxRoll();
    const next = accepted(state, { ...attack, target: { kind: 'city', id: 2 } });
    expect(next.units[10]).toMatchObject({ location: 'recovering', hp: 1, roundsLeft: 3 });
    expect(next.players[1].knockdownCount).toBe(1); expect(next.units[12].xp).toBe(ally.xp);
  });
  test('M3 temporary HQ conquest keeps civilization alive, removes recovery, preserves city and skips economy', () => {
    const state = combatFixture(); pokemon(state, 10, 'charmander', 0, 9, 2); maxRoll(); state.diplomacy[0].status = 'war';
    const city = state.cities[2]; city.hp = 1; city.food = 10; city.buildingIds.push('pasture');
    city.queue = [{ id: 50, progress: 4, item: { kind: 'logistics', defId: 'settler' } }]; assignNewWorkers(state, city, city.population);
    city.lockedTileIds = [...city.workedTileIds];
    state.units[11] = { ...pokemon(state, 11, 'squirtle', 1), location: 'recovering', position: null, cityId: 2, roundsLeft: 2, hp: 1 };
    const next = accepted(state, { ...attack, target: { kind: 'city', id: 2 } });
    expect(next.cities[2]).toMatchObject({ ownerId: 0, hp: 50, population: 2, buildingIds: ['headquarters', 'pasture'], capturedAtRound: 1, lockedTileIds: [] });
    expect(next.cities[2].workedTileIds).toHaveLength(2); expect(next.units[11]).toBeUndefined();
    expect(next.players[1]).toBeDefined(); expect(next.turnOrder).toEqual([0, 1]); expect(next.units[10].hp).toBe(50);
    resolveEconomy(next); expect(next.cities[2].food).toBe(10); expect(next.cities[2].queue[0].progress).toBe(4);
    next.round++; resolveEconomy(next); expect(next.cities[2].queue[0].progress).toBeGreaterThan(4);
  });
  test('retreat nearest city with lowest city ID tie', () => {
    const state = combatFixture(); pokemon(state); pokemon(state, 11, 'bulbasaur', 1, 4).hp = 1; maxRoll();
    state.cities = { 5: createCity(5, 1, { q: 4, r: 2 }), 3: createCity(3, 1, { q: 5, r: 3 }) };
    state.diplomacy[0].status = 'war';
    expect(accepted(state, attack).units[11]).toMatchObject({ location: 'recovering', position: null, cityId: 3, roundsLeft: 3, hp: 1, actionLeft: 0 });
  });
});

describe('Capture and Evolve', () => {
  test('failure consumes ball/action; enrage boosts next attack once, including counter', () => {
    const state = combatFixture(); pokemon(state); pokemon(state, 11, 'machop', null, 4);
    state.players[0].research.unlockedIds.push('domestication'); state.players[0].ballInventory.pokeBall = 2;
    const next = accepted(state, { type: 'Capture', unitId: 10, targetUnitId: 11, ballId: 'pokeBall' });
    expect(next.units[11].enraged).toBe(true); expect(next.players[0].ballInventory.pokeBall).toBe(1); expect(next.units[10].actionLeft).toBe(0);
    maxRoll(); const event = resolveAttack(next, 11, { kind: 'unit', id: 10 })[0];
    expect(event).toMatchObject({ damage: 12 }); expect(next.units[11].enraged).toBe(false);
    expect(resolveAttack(next, 11, { kind: 'unit', id: 10 })[0]).toMatchObject({ damage: 10 });
  });
  test('successful capture preserves HP, registers species and gives no XP/AP', () => {
    const state = combatFixture(); pokemon(state); pokemon(state, 11, 'machoke', null, 4).hp = 15;
    state.players[0].research.unlockedIds.push('domestication'); state.players[0].ballInventory.pokeBall = 1;
    vi.spyOn(rng, 'randomBelow').mockReturnValue(0);
    const next = accepted(state, { type: 'Capture', unitId: 10, targetUnitId: 11, ballId: 'pokeBall' });
    expect(next.units[11]).toMatchObject({ ownerId: 0, hp: 15, xp: 0, actionLeft: 0, wildHome: null });
    expect(next.players[0].registeredSpeciesIds).toContain('machoke'); expect(next.units[10].xp).toBe(0);
  });
  test('evolution thresholds, gold, second-stage tech, proportional minimum HP, XP/AP reset', () => {
    const state = combatFixture(); const unit = pokemon(state); unit.xp = 100; unit.hp = 25;
    const next = accepted(state, { type: 'Evolve', unitId: 10, intoSpeciesId: 'charmeleon' });
    expect(next.units[10]).toMatchObject({ speciesId: 'charmeleon', hp: 36, xp: 0, actionLeft: 0 }); expect(next.players[0].gold).toBe(970);
    next.units[10].xp = 250; next.units[10].hp = 1; next.units[10].actionLeft = 1;
    expect(issue(next, { type: 'Evolve', unitId: 10, intoSpeciesId: 'charizard' })).toMatchObject({ ok: false, reason: 'evolution-unavailable' });
    next.players[0].research.unlockedIds.push('training');
    const evolved = accepted(next, { type: 'Evolve', unitId: 10, intoSpeciesId: 'charizard' });
    expect(evolved.units[10]).toMatchObject({ speciesId: 'charizard', hp: 1, xp: 0, actionLeft: 0 }); expect(evolved.players[0].gold).toBe(890);
  });
});

test.each([
  ['attack peace', attack],
  ['capture civilized', { type: 'Capture', unitId: 10, targetUnitId: 11, ballId: 'pokeBall' }],
  ['evolve insufficient XP', { type: 'Evolve', unitId: 10, intoSpeciesId: 'charmeleon' }],
] as const)('%s rejection is atomic (state, RNG, sequence)', (_name, action) => {
  const state = combatFixture(); pokemon(state); pokemon(state, 11, 'bulbasaur', 1, 4); refreshKnowledge(state);
  const before = canonicalSerialize(state), random = vi.spyOn(rng, 'randomBelow');
  expect(issue(state, action as CombatAction).ok).toBe(false);
  expect(canonicalSerialize(state)).toBe(before); expect(random).not.toHaveBeenCalled();
});

test('combat projections and recovery views do not leak hidden identities or recovery slots', () => {
  const state = combatFixture(); pokemon(state); pokemon(state, 11, 'bulbasaur', 1, 4);
  state.units[12] = { ...pokemon(state, 12, 'squirtle', 1), location: 'recovering', position: null, cityId: 2, roundsLeft: 2 };
  refreshKnowledge(state); expect(observe(state, 0).recoveringUnits).toHaveLength(0); expect(observe(state, 1).recoveringUnits).toHaveLength(1);
  expect(observe(state, 0).units.map(unit => unit.id)).not.toContain(12);
  expect(projectEvents(state, state, [{ seq: 1, index: 0, payload: { type: 'BattleResolved', attackerId: 999,
    target: { kind: 'unit', id: 998 }, positions: [{ q: 12, r: 6 }, { q: 13, r: 6 }], damage: 5, counterDamage: 2, capturedCity: false, knockedDownUnitIds: [] } }], 0)).toEqual([]);
});

test('capture rejects missing tech, inventory, great-ball unlock, distance and friendly targets atomically', () => {
  const state = combatFixture(); pokemon(state); pokemon(state, 11, 'bulbasaur', null, 4);
  const command = { type: 'Capture', unitId: 10, targetUnitId: 11, ballId: 'greatBall' } as const;
  const reject = () => {
    refreshKnowledge(state); const before = canonicalSerialize(state);
    expect(issue(state, command).ok).toBe(false); expect(canonicalSerialize(state)).toBe(before);
  };
  reject(); state.players[0].research.unlockedIds.push('domestication'); reject();
  state.players[0].ballInventory.greatBall = 1; reject();
  state.players[0].research.unlockedIds.push('ballCraft'); state.units[11].position = { q: 5, r: 3 }; reject();
  state.units[11].position = { q: 4, r: 3 }; state.units[11].ownerId = 0; reject();
  state.units[11].ownerId = null; state.units[10].actionLeft = 0; reject();
});

test('evolution rejects insufficient gold, wrong chain and terminal species without spending', () => {
  const state = combatFixture(); const unit = pokemon(state); unit.xp = 100;
  state.players[0].gold = 29; expect(issue(state, { type: 'Evolve', unitId: 10, intoSpeciesId: 'charmeleon' }).ok).toBe(false);
  state.players[0].gold = 30; expect(issue(state, { type: 'Evolve', unitId: 10, intoSpeciesId: 'ivysaur' }).ok).toBe(false);
  unit.speciesId = 'snorlax'; unit.xp = 1000; expect(issue(state, { type: 'Evolve', unitId: 10, intoSpeciesId: 'charmeleon' }).ok).toBe(false);
  expect(state.players[0].gold).toBe(30); expect(unit.actionLeft).toBe(1);
});

test('attack rejects out-of-range and unseen entities without RNG or seq mutation', () => {
  const state = combatFixture(); pokemon(state); pokemon(state, 11, 'bulbasaur', null, 12, 6);
  const random = vi.spyOn(rng, 'randomBelow');
  refreshKnowledge(state); const before = canonicalSerialize(state);
  expect(issue(state, attack)).toMatchObject({ ok: false, reason: 'attack-unavailable' }); expect(canonicalSerialize(state)).toBe(before);
  pokemon(state, 12, 'pidgey', 0, 12, 5); expect(issue(state, attack).ok).toBe(false); expect(random).not.toHaveBeenCalled();
});

test('enrage is consumed by counterattack too and does not persist to the next attack', () => {
  const state = combatFixture(); pokemon(state); pokemon(state, 11, 'machop', null, 4).enraged = true; maxRoll();
  const next = accepted(state, attack);
  expect(next.units[10].hp).toBe(44); expect(next.units[11].enraged).toBe(false);
  expect(resolveAttack(next, 11, { kind: 'unit', id: 10 })[0]).toMatchObject({ damage: 10 });
});

test('damage modifiers are multiplied before a single floor (enrage and siege)', () => {
  const state = combatFixture(); pokemon(state).enraged = true; pokemon(state, 11, 'bulbasaur', null, 4); maxRoll();
  expect(resolveAttack(state, 10, { kind: 'unit', id: 11 })[0]).toMatchObject({ damage: 26 }); // floor(60*10*200/55/100*1.2), not floor(21*1.2)
  vi.restoreAllMocks(); vi.spyOn(rng, 'randomBelow').mockReturnValue(0);
  pokemon(state, 10, 'geodude', 0, 9, 2); state.players[0].research.unlockedIds.push('siegeCraft');
  expect(resolveAttack(state, 10, { kind: 'city', id: 2 })[0]).toMatchObject({ damage: 14 }); // floor(9.35*1.5), not floor(9*1.5)
});

test('visible wild unit does not expose its hidden original spawn coordinates', () => {
  const state = combatFixture(); pokemon(state); pokemon(state, 11, 'pidgey', null, 4).wildHome = { q: 12, r: 6 };
  refreshKnowledge(state); expect(observe(state, 0).units.find(unit => unit.id === 11)?.wildHome).toBeNull();
});
