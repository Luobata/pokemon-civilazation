import { expect, test } from 'vitest';
import { GameSession, replay } from '../../src/app/session.ts';
import { createGame } from '../../src/core/game.ts';
import { createCity } from '../../src/core/city.ts';
import { observe } from '../../src/core/vision.ts';
import { step } from '../../src/core/step.ts';
import { canonicalSerialize } from '../../src/core/snapshot.ts';
import { BOND_RECLAIM, bondPressure, resolveBondRound } from '../../src/core/bonds.ts';
import { parseAuditAction } from '../../src/audit/commands.ts';
import type { GameSetup, GameState } from '../../src/core/model.ts';
import type { GameplayVersion } from '../../src/content/eras.ts';

function setup(gameplayVersion?: GameplayVersion): GameSetup {
  return { seed: 12345, width: 24, height: 16, expansionVersion: 1, multiplayer: true, eraProgression: 'simple-v1',
    ...(gameplayVersion ? { gameplayVersion } : {}), players: [
      { id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' },
      { id: 1, controller: 'human', starterId: 'charmander', leaderId: 'lance' },
    ] };
}
function farCity(state: GameState, capturedAtRound: number | null = null) {
  const hq = state.cities[state.players[0].headquartersCityId];
  const city = createCity(900, 0, { q: hq.position.q + 12, r: hq.position.r }, false);
  city.capturedAtRound = capturedAtRound;
  state.cities[900] = city;
  return city;
}

test('bonds exist only in gameplay v6 and the headquarters never wavers', () => {
  expect(createGame(setup(5)).expansion).not.toHaveProperty('bonds');
  const state = createGame(setup(6));
  const hq = state.players[0].headquartersCityId;
  expect(state.expansion!.bonds![hq]).toBe(100);
  expect(bondPressure(state, state.cities[hq]).total).toBe(100);
  expect(parseAuditAction({ type: 'ReclaimCity', cityId: 3 })).toEqual({ type: 'ReclaimCity', cityId: 3 });
});

test('distant freshly captured cities lose bond and defect at zero; garrison and centers resist', () => {
  const state = createGame(setup(6));
  const city = farCity(state, 1);
  state.expansion!.bonds![900] = 5;
  const pressure = bondPressure(state, city);
  expect(pressure.total).toBeLessThan(0);
  expect(pressure.parts.map(part => part.label)).toEqual(expect.arrayContaining(['新占领']));
  const events = resolveBondRound(state);
  expect(events).toContainEqual(expect.objectContaining({ type: 'CityDefected', playerId: 0, cityId: 900 }));
  expect(state.cities[900].ownerId).toBe(null);
  expect(state.expansion!.bonds![900]).toBeUndefined();
  const steady = createGame(setup(6));
  const second = farCity(steady);
  second.buildingIds = ['trainingGround'];
  expect(bondPressure(steady, second).total).toBeGreaterThan(bondPressure(createGame(setup(6)), farCity(createGame(setup(6)))).total);
});

test('neutral camps can be reclaimed with gold when near own cities', () => {
  const state = createGame(setup(6));
  const hq = state.cities[state.players[0].headquartersCityId];
  const camp = createCity(901, 0, { q: hq.position.q + 4, r: hq.position.r }, false);
  camp.ownerId = null; state.cities[901] = camp;
  state.players[0].gold = BOND_RECLAIM.gold - 1;
  expect(step(state, { actorId: 0, expectedSeq: 0, action: { type: 'ReclaimCity', cityId: 901 } }).ok).toBe(false);
  state.players[0].gold = BOND_RECLAIM.gold;
  const result = step(state, { actorId: 0, expectedSeq: 0, action: { type: 'ReclaimCity', cityId: 901 } });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.state.cities[901].ownerId).toBe(0);
  expect(result.state.expansion!.bonds![901]).toBe(50);
  expect(observe(result.state, 0).expansion!.bonds![901].bond).toBe(50);
  expect(observe(result.state, 1).expansion!.bonds![901]).toBeUndefined();
});

test('gameplay v6 keeps exact save/load and replay', () => {
  const session = new GameSession({ ...setup(6), multiplayer: undefined, players: [
    { id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, { id: 1, controller: 'ai', personality: 'aggressive', leaderId: 'brock' }] });
  for (let turn = 0; turn < 40; turn++) {
    const current = session.getState();
    if (current.outcome) break;
    expect(session.submit({ actorId: current.activePlayerId, expectedSeq: current.commandSeq, action: { type: 'EndTurn' } }).ok).toBe(true);
  }
  const saved = session.save(), loaded = new GameSession(setup(6));
  loaded.load(saved);
  expect(loaded.save()).toBe(saved);
  expect(canonicalSerialize(replay(session.exportLog()))).toBe(canonicalSerialize(session.getState()));
  expect(session.aiInvalidCommands).toEqual([]);
}, 30_000);
