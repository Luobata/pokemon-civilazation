import { createCity } from '../../src/core/city.ts';
import { describe, expect, test } from 'vitest';
import { CONTENT, STARTER_IDS } from '../../src/content/units.ts';
import type { StarterId } from '../../src/content/units.ts';
import { createGame } from '../../src/core/game.ts';
import { hexDistance, hexToIndex, indexToHex, neighbors } from '../../src/core/hex.ts';
import type { Hex } from '../../src/core/hex.ts';
import type { Command, GameSetup, GameState, UnitState } from '../../src/core/model.ts';
import { canEnter, initialUnitPosition, reachablePaths } from '../../src/core/movement.ts';
import { canonicalSerialize, stateDigest } from '../../src/core/snapshot.ts';
import { step } from '../../src/core/step.ts';
import { emptyKnowledge, observe, projectEvents, refreshKnowledge, visibleTiles } from '../../src/core/vision.ts';
import { GameSession, replay } from '../../src/app/session.ts';

const setup: GameSetup = { seed: 12345, width: 24, height: 16, players: [
  { id: 0, controller: 'human', starterId: 'bulbasaur' }, { id: 1, controller: 'ai' },
  { id: 2, controller: 'ai' }, { id: 3, controller: 'ai' },
] };
const at = (q: number): Hex => ({ q, r: 4 });
function fixture(speciesId: StarterId = 'bulbasaur'): GameState {
  const state = createGame(setup);
  state.map = { width: 12, height: 9, tiles: Array(108).fill('grassland') };
  state.turnOrder = [0, 1]; state.cities = {};
  state.units = { 1: { id: 1, kind: 'pokemon', speciesId, ownerId: 0, location: 'map', hp: 30, enraged: false, wildHome: null, position: at(2), actionLeft: 1, xp: 0 } };
  state.knowledge = { 0: emptyKnowledge(), 1: emptyKnowledge() };
  refreshKnowledge(state);
  return state;
}
function move(state: GameState, to: Hex, unitId = 1) {
  return step(state, { actorId: 0, expectedSeq: state.commandSeq, action: { type: 'Move', unitId, to } });
}
function blocker(state: GameState, ownerId: number, q: number) {
  state.units[2] = { id: 2, kind: 'logistics', role: 'settler', ownerId, location: 'map', hp: 30, enraged: false, wildHome: null, position: at(q), actionLeft: 1, xp: 0 };
  refreshKnowledge(state);
}
function rejectUnchanged(state: GameState, command: Command, reason: string) {
  const before = canonicalSerialize(state);
  expect(step(state, command)).toEqual({ ok: false, reason });
  expect(canonicalSerialize(state)).toBe(before); // includes RNG, nextEntityId and seq
}

describe('D28 creation and placement', () => {
  for (const speciesId of STARTER_IDS) test(`seed 12345 places ${speciesId} on enterable terrain`, () => {
    const config = structuredClone(setup);
    config.players[0] = { id: 0, controller: 'human', starterId: speciesId };
    const state = createGame(config);
    expect(stateDigest(createGame(config))).toBe(stateDigest(state));
    expect(Object.values(state.units).filter(unit => unit.ownerId !== null)).toHaveLength(8); expect(Object.keys(state.cities)).toHaveLength(4);
    const city = Object.values(state.cities).find(city => city.ownerId === 0)!;
    expect(hexToIndex(city.position, state.map)).toBe(295);
    const starter = Object.values(state.units).find(unit => unit.ownerId === 0 && unit.kind === 'pokemon')!;
    expect(hexToIndex(starter.position!, state.map)).toBe(speciesId === 'squirtle' ? 270 : 296);
    for (const unit of Object.values(state.units)) expect(canEnter(unit, state.map.tiles[hexToIndex(unit.position!, state.map)!])).toBe(true);
    const settler = Object.values(state.units).find(unit => unit.ownerId === 0 && unit.kind === 'logistics')!;
    expect(settler.position).toEqual(city.position);
    expect(new Set(Object.values(state.units).map(unit => hexToIndex(unit.position!, state.map))).size).toBe(Object.keys(state.units).length);
  });
  test('B3 searches beyond an impassable first ring, using distance then tile index', () => {
    const state = fixture(); const city = at(2);
    for (const hex of neighbors(city)) state.map.tiles[hexToIndex(hex, state.map)!] = 'ocean';
    const chosen = initialUnitPosition(state, city, state.units[1]);
    expect(hexDistance(city, chosen)).toBe(2);
    const expected = state.map.tiles.map((_, i) => i).filter(i => hexDistance(city, indexToHex(i, state.map)) === 2)[0];
    expect(hexToIndex(chosen, state.map)).toBe(expected);
  });
});

describe('atomic Move', () => {
  test('legal multi-tile path costs one AP and leaves input untouched', () => {
    const state = fixture(); const original = canonicalSerialize(state);
    const result = move(state, at(4)); expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.units[1].position!).toEqual(at(4)); expect(result.state.units[1].actionLeft).toBe(0);
    expect(result.state.commandSeq).toBe(1); expect(result.state.rng).toEqual(state.rng);
    expect(canonicalSerialize(state)).toBe(original);
    expect(result.events[0].payload).toEqual({ type: 'Moved', unitId: 1, path: [at(2), at(3), at(4)] });
  });
  test.each(['no-action', 'unit-unavailable', 'unreachable', 'stale-command', 'not-your-turn'] as const)('%s is atomic', reason => {
    const state = fixture();
    const command: Command = { actorId: 0, expectedSeq: 0, action: { type: 'Move', unitId: 1, to: at(3) } };
    if (reason === 'no-action') state.units[1].actionLeft = 0;
    if (reason === 'unit-unavailable') state.units[1].ownerId = 1;
    if (reason === 'unreachable') command.action = { type: 'Move', unitId: 1, to: at(6) };
    if (reason === 'stale-command') command.expectedSeq = 1;
    if (reason === 'not-your-turn') command.actorId = 1;
    rejectUnchanged(state, command, reason);
  });
  test.each([0, 1])('visible unit owned by %i blocks entry', ownerId => {
    const state = fixture(); blocker(state, ownerId, 3);
    expect(move(state, at(3))).toEqual({ ok: false, reason: 'unreachable' });
  });
  test.each([
    ['bulbasaur', 'ocean', false], ['bulbasaur', 'volcano', false],
    ['charmander', 'volcano', true], ['charmander', 'ocean', false],
    ['squirtle', 'ocean', true], ['squirtle', 'grassland', true], ['squirtle', 'volcano', false],
  ] as const)('B1/B4 %s enters %s = %s', (species, biome, allowed) => {
    const state = fixture(species); state.map.tiles[hexToIndex(at(3), state.map)!] = biome;
    refreshKnowledge(state); const result = move(state, at(3)); expect(result.ok).toBe(allowed);
    expect(CONTENT.moveCosts.ocean).toBe(1); expect(CONTENT.moveCosts.volcano).toBe(2);
  });
  test('terrain cost, not tile count, limits the route', () => {
    const state = fixture('charmander'); state.map.tiles.fill('volcano'); refreshKnowledge(state);
    expect(move(state, at(3)).ok).toBe(true); expect(move(state, at(4)).ok).toBe(false);
    state.map.tiles.fill('ocean'); state.units[1] = { ...state.units[1], kind: 'pokemon', speciesId: 'squirtle' };
    refreshKnowledge(state);
    state.knowledge[0].rememberedTiles[hexToIndex(at(5), state.map)!] = { biomeId: 'ocean' };
    expect(move(state, at(5)).ok).toBe(true);
  });
  test('B2 own city can be entered, traversed and stopped on; other city blocks', () => {
    const state = fixture(); state.cities[2] = createCity(2, 0, at(3)); refreshKnowledge(state);
    expect(move(state, at(3)).ok).toBe(true);
    const through = move(state, at(4)); expect(through.ok && through.events[0].payload).toMatchObject({ path: [at(2), at(3), at(4)] });
    state.map.tiles.fill('mountain'); refreshKnowledge(state); expect(move(state, at(4)).ok).toBe(false);
    state.cities[2].ownerId = 1; refreshKnowledge(state); expect(move(state, at(3)).ok).toBe(false);
    state.cities[2].ownerId = 0; blocker(state, 0, 3); expect(move(state, at(3)).ok).toBe(false);
  });
  test('planning ignores hidden occupancy; execution stops without a blocker payload', () => {
    const state = fixture(); blocker(state, 1, 5);
    const target = hexToIndex(at(5), state.map)!;
    state.knowledge[0].rememberedTiles[target] = { biomeId: 'grassland' }; state.knowledge[0].exploredTileIds.push(target);
    const view = observe(state, 0); expect(view.units.map(u => u.id)).toEqual([1]);
    expect(reachablePaths(view, 1)[target]).toEqual([at(2), at(3), at(4), at(5)]);
    const result = move(state, at(5)); expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.units[1].position!).toEqual(at(4)); expect(result.state.units[1].actionLeft).toBe(0);
    expect(result.events[0].payload).toEqual({ type: 'Moved', unitId: 1, path: [at(2), at(3), at(4)] });
    expect(projectEvents(state, result.state, result.events, 0)[0].payload).toMatchObject({ path: [at(2), at(3), at(4)] });
    expect(move(state, at(3), 2)).toEqual(move(state, at(3), 999));
  });
  test('settler has a two-point budget through the same movement pipeline', () => {
    const state = fixture(); state.units[1] = { kind: 'logistics', role: 'settler', id: 1, ownerId: 0, location: 'map', hp: 30, enraged: false, wildHome: null, position: at(2), actionLeft: 1, xp: 0 };
    state.knowledge[0].rememberedTiles[hexToIndex(at(5), state.map)!] = { biomeId: 'grassland' };
    expect(move(state, at(4)).ok).toBe(true); expect(move(state, at(5)).ok).toBe(false);
  });
  test('unknown terrain never enters the planned route', () => {
    const state = fixture(); expect(reachablePaths(observe(state, 0), 1)[hexToIndex(at(5), state.map)!]).toBeUndefined();
  });
});

test('EndTurn advances players; only a complete round refreshes AP', () => {
  const state = fixture(); state.units[1].actionLeft = 0;
  rejectUnchanged(state, { actorId: 1, expectedSeq: 0, action: { type: 'EndTurn' } }, 'not-your-turn');
  const next = step(state, { actorId: 0, expectedSeq: 0, action: { type: 'EndTurn' } });
  expect(next.ok).toBe(true); if (!next.ok) return;
  expect(next.state.activePlayerId).toBe(1); expect(next.state.round).toBe(1); expect(next.state.units[1].actionLeft).toBe(0);
  const end = step(next.state, { actorId: 1, expectedSeq: 1, action: { type: 'EndTurn' } });
  expect(end.ok).toBe(true); if (!end.ok) return;
  expect(end.state.activePlayerId).toBe(0); expect(end.state.round).toBe(2); expect(end.state.units[1].actionLeft).toBe(1);
  expect(end.events.slice(-2).map(e => e.payload.type)).toEqual(['RoundEnded', 'TurnChanged']);
});

describe('vision and historical knowledge', () => {
  test('unit radius 2, mountain +1, city radius 2', () => {
    const state = fixture(); expect(visibleTiles(state, 0).size).toBe(19);
    state.map.tiles[hexToIndex(at(2), state.map)!] = 'mountain'; expect(visibleTiles(state, 0).size).toBe(37);
    state.units = {}; state.cities[1] = createCity(1, 0, at(2));
    expect(visibleTiles(state, 0).size).toBe(19);
  });
  test('visible, remembered, unknown terrain and observation isolation', () => {
    const state = fixture(); state.units[1].position = at(7); refreshKnowledge(state);
    const original = canonicalSerialize(state), view = observe(state, 0);
    expect(view.map.tiles[hexToIndex(at(2), state.map)!]).toBe('grassland');
    expect(view.visibleTileIds).not.toContain(hexToIndex(at(2), state.map));
    expect(view.map.tiles[0]).toBeNull(); expect(view.visibleTileIds).toContain(hexToIndex(at(7), state.map));
    view.knowledge.rememberedTiles[0] = { biomeId: 'volcano' }; view.units[0].position.q = 99;
    expect(canonicalSerialize(state)).toBe(original); expect(view).not.toHaveProperty('rng');
  });
  test.each(['pokemon', 'logistics'] as const)('%s memory stays historical, clears on visible empty tile or removed entity', kind => {
    const state = fixture();
    const identity = kind === 'pokemon' ? { kind, speciesId: 'squirtle' as const } : { kind, role: 'settler' as const };
    state.units[2] = { ...identity, id: 2, ownerId: 1, location: 'map', hp: 30, enraged: false, wildHome: null, position: at(3), actionLeft: 1, xp: 0 } as UnitState;
    refreshKnowledge(state); const memory = structuredClone(state.knowledge[0].lastKnownUnits[2]);
    expect(memory).toMatchObject(identity); if (kind === 'logistics') expect(memory).not.toHaveProperty('speciesId');
    state.units[1].position = at(7); state.units[2].position = at(4); state.round = 2; refreshKnowledge(state);
    expect(observe(state, 0).units.map(u => u.id)).toEqual([1]);
    expect(state.knowledge[0].lastKnownUnits[2]).toEqual(memory);
    state.units[2].position = at(7); state.units[1].position = at(2); refreshKnowledge(state);
    expect(state.knowledge[0].lastKnownUnits[2]).toBeUndefined();
    state.units[2].position = at(3); refreshKnowledge(state); delete state.units[2]; refreshKnowledge(state);
    expect(state.knowledge[0].lastKnownUnits[2]).toBeUndefined();
  });
  test('projection retains before-only visibility and splits a hidden middle', () => {
    const before = fixture(); before.units[1].position = at(0);
    before.units[2] = { kind: 'pokemon', speciesId: 'squirtle', id: 2, ownerId: 1, location: 'map', hp: 30, enraged: false, wildHome: null, position: at(0), actionLeft: 1, xp: 0 };
    const after = structuredClone(before); after.units[1].position = at(8); after.units[2].position = at(8);
    const events = projectEvents(before, after, [{ seq: 1, index: 0, payload: {
      type: 'Moved', unitId: 2, path: Array.from({ length: 9 }, (_, q) => at(q)),
    } }], 0);
    expect(events.map(event => event.payload.type === 'Moved' && event.payload.path)).toEqual([
      [at(0), at(1), at(2)], [at(6), at(7), at(8)],
    ]);
    expect(events[0].payload).not.toHaveProperty('unit.position');
    after.units[1].position = at(0); after.units[2].position = at(5);
    const clipped = projectEvents(before, after, [{ seq: 1, index: 0, payload: { type: 'Moved', unitId: 2, path: [at(2), at(3), at(4), at(5)] } }], 0);
    expect(clipped[0].payload).toMatchObject({ path: [at(2)] });
  });
});

describe('GameSession command log and replay', () => {
  function played() {
    const session = new GameSession(setup);
    const unit = session.getView().units.find(u => u.kind === 'pokemon' && u.ownerId === 0)!;
    const route = Object.values(reachablePaths(session.getView(), unit.id))[0];
    const result = session.issue({ type: 'Move', unitId: unit.id, to: route.at(-1)! });
    expect(result.ok).toBe(true);
    if (result.ok) result.state.round = 99;
    expect(session.getState().round).toBe(1);
    session.issue({ type: 'EndTurn' }); return session;
  }
  test('recorded AI EndTurns replay exactly, including continuation from checkpoint', () => {
    const session = played(); const log = JSON.parse(JSON.stringify(session.exportLog()));
    expect(log.commands).toHaveLength(5); expect(session.getState().round).toBe(2);
    expect(stateDigest(replay(log))).toBe(stateDigest(session.getState()));
    const checkpoint = replay(log, 2);
    expect(canonicalSerialize(replay(log, log.commands.length, checkpoint))).toBe(canonicalSerialize(session.getState()));
    const before = stateDigest(session.getState()); session.skipAnimations(); expect(stateDigest(session.getState())).toBe(before);
    session.replayTo(1); expect(session.getState().commandSeq).toBe(1); expect(session.presentationQueue).toEqual([]);
    session.replayTo(5); expect(stateDigest(session.getState())).toBe(before);
  });
  test('new accepted commands after replay replace the future; rejections do not append', () => {
    const session = played(); session.replayTo(0);
    session.issue({ type: 'Move', unitId: 999, to: at(0) }); expect(session.exportLog().commands).toHaveLength(5);
    session.issue({ type: 'EndTurn' }); expect(session.exportLog().commands).toHaveLength(4);
    expect(stateDigest(replay(session.exportLog()))).toBe(stateDigest(session.getState()));
    session.replayTo(1); session.resumeFromReplay(); expect(session.getState().activePlayerId).toBe(0);
    expect(stateDigest(replay(session.exportLog()))).toBe(stateDigest(session.getState()));
  });
});
