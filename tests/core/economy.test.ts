import { describe, expect, test } from 'vitest';
import { CONTENT } from '../../src/content/units.ts';
import type { Content } from '../../src/content/units.ts';
import type { Command, GameSetup, GameState, ProductionItem } from '../../src/core/model.ts';
import { createGame } from '../../src/core/game.ts';
import { createCity, assignNewWorkers, cityYield, cleanWork, growthThreshold, workCandidates } from '../../src/core/city.ts';
import { canResearch } from '../../src/core/economy-commands.ts';
import { resolveEconomy } from '../../src/core/economy.ts';
import { hexToIndex, indexToHex, neighbors } from '../../src/core/hex.ts';
import { emptyKnowledge, observe, projectEvents, refreshKnowledge } from '../../src/core/vision.ts';
import { canonicalSerialize, stateDigest } from '../../src/core/snapshot.ts';
import { step } from '../../src/core/step.ts';
import { GameSession, replay } from '../../src/app/session.ts';
import { deserializeSave } from '../../src/app/save.ts';

const setup: GameSetup = { seed: 12345, width: 24, height: 16, players: [
  { id: 0, controller: 'human', starterId: 'charmander' }, { id: 1, controller: 'ai' },
] };
const pokemon: ProductionItem = { kind: 'pokemon', defId: 'charmander' };
const settler: ProductionItem = { kind: 'logistics', defId: 'settler' };
function fixture(): GameState {
  const state = createGame(setup);
  state.map = { width: 16, height: 12, tiles: Array(192).fill('grassland') };
  state.units = {}; state.cities = { 1: createCity(1, 0, { q: 3, r: 4 }, true), 2: createCity(2, 1, { q: 10, r: 8 }, true) };
  state.knowledge = { 0: emptyKnowledge(), 1: emptyKnowledge() }; state.nextEntityId = 100;
  refreshKnowledge(state); return state;
}
function command(state: GameState, action: Command['action'], actorId = state.activePlayerId) {
  return step(state, { actorId, expectedSeq: state.commandSeq, action });
}
function accepted(state: GameState, action: Command['action']) {
  const result = command(state, action); expect(result.ok).toBe(true); if (!result.ok) throw new Error(result.reason); return result.state;
}
function round(state: GameState) {
  return accepted(accepted(state, { type: 'EndTurn' }), { type: 'EndTurn' });
}
function panelFixture() {
  const state = fixture(), city = state.cities[1];
  city.workedTileIds = neighbors(city.position).slice(0, 2).map(hex => hexToIndex(hex, state.map)!);
  state.map.tiles[city.workedTileIds[1]] = 'forest';
  city.buildingIds.push('pasture'); city.hp = 120; city.food = 22;
  return state;
}

describe('city economy and D30 snapshot', () => {
  test('GDD §7.2 exact panel numbers and six-round growth', () => {
    let state = panelFixture();
    expect(cityYield(state, state.cities[1])).toEqual({ food: 7, production: 4, gold: 1, research: 0 });
    expect(growthThreshold(state.cities[1])).toBe(40);
    for (let i = 0; i < 5; i++) state = round(state);
    expect(state.cities[1]).toMatchObject({ population: 2, food: 37 });
    state = round(state); expect(state.cities[1]).toMatchObject({ population: 3, food: 0 });
    expect(state.cities[1].workedTileIds).toHaveLength(3); expect(growthThreshold(state.cities[1])).toBe(50);
  });
  test('growth is capped at one; grass starter floors its per-city food bonus', () => {
    const state = panelFixture(); state.cities[1].food = 500; state.players[0].starterId = 'bulbasaur';
    expect(cityYield(state, state.cities[1]).food).toBe(7);
    resolveEconomy(state); expect(state.cities[1].population).toBe(3);
    state.cities[1].workedTileIds = workCandidates(state, state.cities[1]).filter(id => state.map.tiles[id] === 'grassland').slice(0, 3);
    state.cities[1].population = 3; expect(cityYield(state, state.cities[1]).food).toBe(11); // (2+6+2)*1.1
  });
  test('starvation releases worst unlocked tile first; all-locked fallback and population floor', () => {
    const state = fixture(), city = state.cities[1]; state.map.tiles.fill('mountain');
    city.population = 3; city.food = 0; assignNewWorkers(state, city, 3);
    const worked = [...city.workedTileIds]; city.lockedTileIds = worked.slice(1);
    resolveEconomy(state); expect(city.population).toBe(2); expect(city.workedTileIds).toEqual(worked.slice(1));
    resolveEconomy(state); expect(city.population).toBe(1); expect(city.workedTileIds).toEqual([worked[1]]);
    resolveEconomy(state); expect(city.population).toBe(1); expect(city.food).toBe(0);
  });
  test('D30 B2 growth/new building do not change this round production, gold or research', () => {
    const state = panelFixture(), city = state.cities[1]; city.food = 39;
    city.queue = [{ id: 10, progress: 37, item: { kind: 'building', defId: 'meetingHall' } },
      { id: 11, progress: 0, item: { kind: 'building', defId: 'observatory' } }];
    resolveEconomy(state);
    expect(city.population).toBe(3); expect(city.queue[0].progress).toBe(1); // old production=4, not 5
    expect(state.players[0].gold).toBe(51); // new meeting hall pays next round
    expect(cityYield(state, city).gold).toBe(3);
    const second = fixture(); second.cities[1].queue = [{ id: 10, progress: 49, item: { kind: 'building', defId: 'observatory' } }];
    resolveEconomy(second); expect(second.players[0].research.reserve).toBe(2);
    resolveEconomy(second); expect(second.players[0].research.reserve).toBe(6);
  });
  test('captured-this-round city produces nothing and consumes no food', () => {
    const state = panelFixture(), city = state.cities[1]; city.capturedAtRound = state.round;
    const before = structuredClone(city); resolveEconomy(state);
    expect(city).toEqual(before); expect(state.players[0].gold).toBe(50); expect(state.players[0].research.reserve).toBe(0);
  });
});

describe('work assignment', () => {
  test('automatic choice uses yield lexicographic order then (r,q)', () => {
    const state = fixture(), city = state.cities[1];
    const candidates = workCandidates(state, city);
    expect(candidates).toEqual([...candidates].sort((a, b) => a - b));
    state.map.tiles[candidates[0]] = 'forest'; // grass beats higher forest production
    assignNewWorkers(state, city, 2); expect(city.workedTileIds).toEqual(candidates.slice(1, 3));
  });
  test('first assignment wins across overlapping city radii regardless of city ID', () => {
    const state = fixture(); state.cities[2].position = { q: 7, r: 4 };
    const shared = hexToIndex({ q: 5, r: 4 }, state.map)!;
    state.cities[2].workedTileIds = [shared];
    expect(workCandidates(state, state.cities[1])).not.toContain(shared);
    expect(command(state, { type: 'AssignWork', cityId: 1, workedTileIds: [shared], lockedTileIds: [] }).ok).toBe(false);
    assignNewWorkers(state, state.cities[1], 2); expect(state.cities[2].workedTileIds).toEqual([shared]);
  });
  test('D30 B3 manual observers persist; growth only fills the added population', () => {
    let state = panelFixture(); state = accepted(state, { type: 'AssignWork', cityId: 1, workedTileIds: [], lockedTileIds: [] });
    state = round(state); expect(state.cities[1].workedTileIds).toEqual([]); expect(state.players[0].research.reserve).toBe(2);
    state.cities[1].food = 40; state = round(state);
    expect(state.cities[1].population).toBe(3); expect(state.cities[1].workedTileIds).toHaveLength(1);
    expect(state.players[0].research.reserve).toBe(4); // new worker begins next round
  });
  test('out-of-radius locks disappear and invalidated workers remain observers', () => {
    const state = fixture(), city = state.cities[1]; city.population = 4;
    const distant = hexToIndex({ q: 6, r: 4 }, state.map)!;
    city.workedTileIds = [distant]; city.lockedTileIds = [distant];
    cleanWork(state, city); expect(city.lockedTileIds).toEqual([distant]);
    city.population = 3; cleanWork(state, city);
    expect(city.workedTileIds).toEqual([]); expect(city.lockedTileIds).toEqual([]); expect(cityYield(state, city).research).toBe(3);
  });
  test('snow/volcano need meteorology and get +1 research when unlocked', () => {
    const state = fixture(), city = state.cities[1], ids = neighbors(city.position).slice(0, 2).map(hex => hexToIndex(hex, state.map)!);
    state.map.tiles[ids[0]] = 'snow'; state.map.tiles[ids[1]] = 'volcano';
    expect(workCandidates(state, city)).not.toContain(ids[0]); expect(workCandidates(state, city)).not.toContain(ids[1]);
    state.players[0].research.unlockedIds = ['meteorology'];
    expect(workCandidates(state, city)).toEqual(expect.arrayContaining(ids)); city.workedTileIds = ids;
    expect(cityYield(state, city).research).toBe(5);
  });
});

describe('production and D16/D17/D28', () => {
  test('five orders allowed, sixth rejected; reorder/nonhead removal keep other progress', () => {
    let state = fixture();
    state = accepted(state, { type: 'SetProductionQueue', cityId: 1, orders: Array.from({ length: 5 }, () => ({ item: pokemon })) });
    const [first, second] = state.cities[1].queue; first.progress = 9; second.progress = 3;
    const overflow = command(state, { type: 'SetProductionQueue', cityId: 1, orders: Array.from({ length: 6 }, () => ({ item: pokemon })) });
    expect(overflow.ok).toBe(false);
    state = accepted(state, { type: 'SetProductionQueue', cityId: 1, orders: [second, first].map(order => ({ orderId: order.id, item: order.item })) });
    expect(state.cities[1].queue.map(order => order.progress)).toEqual([3, 9]);
    state = accepted(state, { type: 'SetProductionQueue', cityId: 1, orders: [{ orderId: second.id, item: second.item }] });
    expect(state.cities[1].queue[0].progress).toBe(3);
    state = accepted(state, { type: 'SetProductionQueue', cityId: 1, orders: [{ item: settler }] });
    expect(state.cities[1].queue[0].progress).toBe(0); expect(state.players[0].gold).toBe(50);
  });
  test('registered species and building prerequisites/uniqueness are enforced', () => {
    const state = fixture();
    for (const item of [{ kind: 'pokemon', defId: 'squirtle' }, { kind: 'building', defId: 'headquarters' }, { kind: 'building', defId: 'pasture' }] as ProductionItem[]) {
      expect(command(state, { type: 'SetProductionQueue', cityId: 1, orders: [{ item }] }).ok).toBe(false);
    }
    state.players[0].research.unlockedIds = ['berryCultivation'];
    const order = { item: { kind: 'building', defId: 'pasture' } as const };
    expect(command(state, { type: 'SetProductionQueue', cityId: 1, orders: [order] }).ok).toBe(true);
    expect(command(state, { type: 'SetProductionQueue', cityId: 1, orders: [order, order] }).ok).toBe(false);
  });
  test('old waiting records claim the only gap first; new waiting order waits and overflow only carries', () => {
    const state = fixture(), city = state.cities[1]; state.round = 4;
    const adjacent = neighbors(city.position).sort((a, b) => hexToIndex(a, state.map)! - hexToIndex(b, state.map)!);
    for (const [i, position] of adjacent.slice(1).entries()) state.units[20 + i] = { kind: 'logistics', role: 'settler', id: 20 + i, ownerId: 0, position, actionLeft: 1, xp: 0 };
    city.pendingDeployments = [{ enteredAtRound: 3, sourceOrderId: 10, item: pokemon as { kind: 'pokemon'; defId: 'charmander' } },
      { enteredAtRound: 2, sourceOrderId: 20, item: pokemon as { kind: 'pokemon'; defId: 'charmander' } }];
    city.queue = [{ id: 42, progress: 100, item: pokemon }, { id: 43, progress: 0, item: { kind: 'building', defId: 'meetingHall' } }];
    const events = resolveEconomy(state);
    expect(events.filter(e => e.type === 'UnitTrained').map(e => e.orderId)).toEqual([20]);
    expect(state.units[100].position).toEqual(adjacent[0]); expect(state.units[100].actionLeft).toBe(0);
    expect(city.pendingDeployments.map(p => p.sourceOrderId)).toEqual([10, 42]); expect(state.nextEntityId).toBe(101);
    expect(city.queue).toHaveLength(1); expect(city.queue[0].progress).toBe(81); expect(city.buildingIds).not.toContain('meetingHall');
    expect(state.players[0].gold).toBe(50); // income1 - only actual Pokemon1
    delete state.units[100]; delete state.units[20]; state.round++;
    const nextEvents = resolveEconomy(state);
    expect(nextEvents.filter(e => e.type === 'UnitTrained').map(e => e.orderId)).toEqual([10, 42]);
    expect(city.pendingDeployments).toEqual([]); expect(city.buildingIds).toContain('meetingHall');
  });
  test('same-round pending ties use order ID; blocked terrain is filtered before spawn', () => {
    const state = fixture(), city = state.cities[1];
    for (const position of neighbors(city.position)) state.map.tiles[hexToIndex(position, state.map)!] = 'ocean';
    city.pendingDeployments = [
      { enteredAtRound: 1, sourceOrderId: 20, item: { kind: 'pokemon', defId: 'squirtle' } },
      { enteredAtRound: 1, sourceOrderId: 10, item: { kind: 'pokemon', defId: 'charmander' } },
      { enteredAtRound: 1, sourceOrderId: 15, item: { kind: 'pokemon', defId: 'squirtle' } },
    ];
    city.buildingIds.push('trainingGround');
    const events = resolveEconomy(state);
    expect(events.filter(e => e.type === 'UnitTrained').map(e => e.orderId)).toEqual([15, 20]);
    expect(city.pendingDeployments.map(p => p.sourceOrderId)).toEqual([10]); expect(state.units[100].xp).toBe(20);
    expect(hexToIndex(state.units[100].position, state.map)).toBeLessThan(hexToIndex(state.units[101].position, state.map)!);
  });
  test('empty queue discards production overflow; new training pays upkeep immediately', () => {
    const state = fixture(), city = state.cities[1]; city.queue = [{ id: 10, progress: 30, item: settler }];
    resolveEconomy(state); expect(city.queue).toEqual([]); expect(state.players[0].gold).toBe(51);
    const next = accepted(state, { type: 'SetProductionQueue', cityId: 1, orders: [{ item: pokemon }] });
    expect(next.cities[1].queue[0].progress).toBe(0);
  });
});

describe('research, purchase, deficit, atomic commands', () => {
  test('D30 B1 reserve before selection, progress preservation, completion overflow and one topic per round', () => {
    let state = fixture(); state = round(state); expect(state.players[0].research.reserve).toBe(2);
    state = accepted(state, { type: 'SetResearch', techId: 'domestication' }); state = round(state);
    expect(state.players[0].research.progressByTech.domestication).toBe(4);
    state = accepted(state, { type: 'SetResearch', techId: 'berryCultivation' }); state = round(state);
    expect(state.players[0].research.progressByTech.domestication).toBe(4);
    expect(state.players[0].research.progressByTech.berryCultivation).toBe(2);
    state.players[0].research.reserve = 100;
    state = accepted(state, { type: 'SetResearch', techId: 'domestication' }); state = round(state);
    expect(state.players[0].research).toMatchObject({ techId: null, reserve: 86, progressByTech: { domestication: 20 }, unlockedIds: ['domestication'] });
    state = accepted(state, { type: 'SetResearch', techId: 'ballCraft' });
    expect(state.players[0].research.progressByTech.ballCraft).toBe(0); // selection doesn't instantly spend reserve
    state = round(state); expect(state.players[0].research).toMatchObject({ techId: null, reserve: 48, unlockedIds: ['ballCraft', 'domestication'] });
  });
  test('tier requires one prior-tier completion, same tier has no prerequisite', () => {
    const state = fixture(), player = state.players[0];
    expect(canResearch(player, 'berryCultivation')).toBe(true); expect(canResearch(player, 'ballCraft')).toBe(false);
    player.research.unlockedIds.push('berryCultivation'); expect(canResearch(player, 'ballCraft')).toBe(true); expect(canResearch(player, 'medicine')).toBe(false);
    player.research.unlockedIds.push('ballCraft'); expect(canResearch(player, 'medicine')).toBe(true); expect(canResearch(player, 'ballCraft')).toBe(false);
  });
  test('ball purchase deducts exact price, checks both techs, amount and owner', () => {
    let state = fixture(); state.players[0].research.unlockedIds = ['domestication'];
    state = accepted(state, { type: 'BuyBall', cityId: 1, ballId: 'pokeBall', quantity: 2 });
    expect(state.players[0]).toMatchObject({ gold: 10, ballInventory: { pokeBall: 2, greatBall: 0 } });
    expect(command(state, { type: 'BuyBall', cityId: 1, ballId: 'pokeBall', quantity: 1 }).ok).toBe(false);
    state.players[0].gold = 50;
    expect(command(state, { type: 'BuyBall', cityId: 1, ballId: 'greatBall', quantity: 1 }).ok).toBe(false);
    state.players[0].research.unlockedIds.push('ballCraft');
    state = accepted(state, { type: 'BuyBall', cityId: 1, ballId: 'greatBall', quantity: 1 });
    expect(state.players[0].gold).toBe(5); expect(state.players[0].ballInventory.greatBall).toBe(1);
    expect(command(state, { type: 'BuyBall', cityId: 2, ballId: 'pokeBall', quantity: 1 }).ok).toBe(false);
    expect(command(state, { type: 'BuyBall', cityId: 1, ballId: 'pokeBall', quantity: 0 }).ok).toBe(false);
  });
  test('upkeep descending then entity ID descending; settlers never pay or get disbanded', () => {
    const state = fixture(), content: Content = structuredClone(CONTENT);
    content.units.charmander.upkeep = 3; content.units.squirtle.upkeep = 2; state.players[0].gold = 0;
    state.units = {
      10: { kind: 'pokemon', speciesId: 'charmander', id: 10, ownerId: 0, position: indexToHex(10, state.map), xp: 0, actionLeft: 1 },
      11: { kind: 'pokemon', speciesId: 'squirtle', id: 11, ownerId: 0, position: indexToHex(11, state.map), xp: 0, actionLeft: 1 },
      12: { kind: 'pokemon', speciesId: 'charmander', id: 12, ownerId: 0, position: indexToHex(12, state.map), xp: 0, actionLeft: 1 },
      13: { kind: 'logistics', role: 'settler', id: 13, ownerId: 0, position: indexToHex(13, state.map), xp: 0, actionLeft: 1 },
    };
    const events = resolveEconomy(state, content);
    expect(events.filter(e => e.type === 'UnitRemoved').map(e => e.unitId)).toEqual([12, 10, 11]);
    expect(Object.keys(state.units)).toEqual(['13']); expect(state.players[0].gold).toBe(1);
    expect(state.players[0].registeredSpeciesIds).toEqual(['charmander']);
  });
  test.each<Command['action']>([
    { type: 'FoundCity', unitId: 999 },
    { type: 'SetProductionQueue', cityId: 1, orders: Array.from({ length: 6 }, () => ({ item: pokemon })) },
    { type: 'AssignWork', cityId: 1, workedTileIds: [0, 1, 2], lockedTileIds: [] },
    { type: 'SetResearch', techId: 'medicine' },
    { type: 'BuyBall', cityId: 1, ballId: 'pokeBall', quantity: 1 },
  ])('$type failure preserves all state, seq, RNG and IDs', action => {
    const state = fixture(), before = canonicalSerialize(state); expect(command(state, action).ok).toBe(false);
    expect(canonicalSerialize(state)).toBe(before);
  });
  test('FoundCity consumes a ready settler, creates initial city and claims work; distance/AP/water reject', () => {
    const state = fixture(); const position = { q: 7, r: 4 };
    state.units[50] = { kind: 'logistics', role: 'settler', id: 50, ownerId: 0, position, xp: 0, actionLeft: 1 };
    refreshKnowledge(state);
    const next = accepted(state, { type: 'FoundCity', unitId: 50 });
    expect(next.units[50]).toBeUndefined(); expect(next.cities[100]).toMatchObject({ population: 1, food: 0, hp: 100, buildingIds: [], queue: [], position });
    expect(next.cities[100].workedTileIds).toHaveLength(1); expect(next.nextEntityId).toBe(101);
    state.units[50].actionLeft = 0; expect(command(state, { type: 'FoundCity', unitId: 50 }).ok).toBe(false);
    state.units[50].actionLeft = 1; state.units[50].position = { q: 6, r: 4 }; expect(command(state, { type: 'FoundCity', unitId: 50 }).ok).toBe(false);
    state.units[50].position = position; state.map.tiles[hexToIndex(position, state.map)!] = 'ocean';
    expect(command(state, { type: 'FoundCity', unitId: 50 }).ok).toBe(false);
  });
  test('observed disband clears historical memory even when its vision source disappears', () => {
    const state = fixture(); state.cities = {}; state.players[0].gold = 0;
    state.units[50] = { kind: 'pokemon', speciesId: 'charmander', id: 50, ownerId: 0, position: { q: 3, r: 4 }, xp: 0, actionLeft: 1 };
    refreshKnowledge(state); expect(state.knowledge[0].lastKnownUnits[50]).toBeDefined();
    const next = round(state); expect(next.units[50]).toBeUndefined(); expect(next.knowledge[0].lastKnownUnits[50]).toBeUndefined();
  });
  test('other players never receive economic details in views or projected events', () => {
    const state = fixture(); const result = command(state, { type: 'SetResearch', techId: 'domestication' });
    if (!result.ok) throw new Error(result.reason);
    expect(projectEvents(state, result.state, result.events, 1)).toEqual([]);
    const view = observe(state, 1); expect(view.economy.player.id).toBe(1); expect(view.economy.cities.map(c => c.id)).toEqual([2]);
    expect(view.cities.every(c => !('gold' in c) && !('queue' in c))).toBe(true);
  });
});

describe('M2 save and resume', () => {
  function playing() {
    const session = new GameSession(setup), cityId = session.getView().cities.find(c => c.ownerId === 0)!.id;
    session.issue({ type: 'AssignWork', cityId, workedTileIds: [], lockedTileIds: [] });
    session.issue({ type: 'SetResearch', techId: 'domestication' });
    session.issue({ type: 'SetProductionQueue', cityId, orders: [{ item: pokemon }, { item: settler }] });
    for (let i = 0; i < 4; i++) session.issue({ type: 'EndTurn' });
    return session;
  }
  test('save/load then continue matches uninterrupted state and log replay', () => {
    const direct = playing(), save = direct.save(), restored = new GameSession(setup);
    restored.load(save); expect(restored.presentationQueue).toEqual([]);
    expect(canonicalSerialize(restored.getState())).toBe(canonicalSerialize(direct.getState()));
    for (let i = 0; i < 8; i++) { direct.issue({ type: 'EndTurn' }); restored.issue({ type: 'EndTurn' }); }
    expect(stateDigest(restored.getState())).toBe(stateDigest(direct.getState()));
    expect(stateDigest(replay(restored.exportLog()))).toBe(stateDigest(direct.getState()));
    expect(JSON.parse(save)).not.toHaveProperty('camera'); expect(JSON.parse(save).state).not.toHaveProperty('visibleTileIds');
  });
  test.each(['schemaVersion', 'rulesVersion', 'contentVersion'] as const)('mismatched %s rejects atomically', key => {
    const session = playing(), before = stateDigest(session.getState()), save = JSON.parse(session.save()); save[key] = 'old';
    expect(() => session.load(JSON.stringify(save))).toThrow('版本不匹配'); expect(stateDigest(session.getState())).toBe(before);
  });
  test('malformed JSON and state/log disagreement are rejected', () => {
    expect(() => deserializeSave('{')).toThrow(); const save = JSON.parse(playing().save()); save.state.commandSeq = 999;
    expect(() => deserializeSave(JSON.stringify(save))).toThrow('不匹配');
  });
});
