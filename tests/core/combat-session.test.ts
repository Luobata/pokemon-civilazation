import { expect, test } from 'vitest';
import { combatFixture, pokemon } from './combat-fixture.ts';
import { GameSession, replay } from '../../src/app/session.ts';
import type { CommandLog } from '../../src/app/session.ts';
import { serializeSave, deserializeSave } from '../../src/app/save.ts';
import { CONTENT } from '../../src/content/units.ts';
import { refreshKnowledge } from '../../src/core/vision.ts';
import { createRng } from '../../src/core/rng.ts';
import { canonicalSerialize } from '../../src/core/snapshot.ts';

test('capture/evolution/round RNG and recovery survive fixture save/load continuation', () => {
  const state = combatFixture(); pokemon(state).xp = 100; pokemon(state, 11, 'bulbasaur', null, 4).hp = 5;
  state.units[12] = { ...pokemon(state, 12, 'squirtle'), location: 'recovering', position: null, cityId: 1, roundsLeft: 2, hp: 1 };
  state.players[0].research.unlockedIds.push('domestication'); state.players[0].ballInventory.pokeBall = 1; state.rng = createRng(30);
  refreshKnowledge(state);
  const log: CommandLog = { version: 1, schemaVersion: 4, rulesVersion: 'm5-v1', contentVersion: CONTENT.version, setup: state.setup, commands: [] };
  const session = new GameSession(state.setup); session.load(serializeSave(state, log));
  expect(session.issue({ type: 'Capture', unitId: 10, targetUnitId: 11, ballId: 'pokeBall' }).ok).toBe(true);
  expect(session.getState().units[11].ownerId).toBe(0);
  expect(session.issue({ type: 'EndTurn' }).ok).toBe(true);
  expect(session.issue({ type: 'Evolve', unitId: 10, intoSpeciesId: 'charmeleon' }).ok).toBe(true);
  const restored = new GameSession(state.setup); restored.load(session.save());
  expect(canonicalSerialize(restored.getState())).toBe(canonicalSerialize(session.getState()));
  for (const instance of [session, restored]) expect(instance.issue({ type: 'EndTurn' }).ok).toBe(true);
  expect(canonicalSerialize(restored.getState())).toBe(canonicalSerialize(session.getState()));
});

test.each([2, 3])('old schema%s/rules rejected, no migration silently changes replay', version => {
  const session = new GameSession(combatFixture().setup), old = JSON.parse(session.save());
  for (const object of [old, old.state, old.log]) { object.schemaVersion = version; object.rulesVersion = `m${version}-v1`; }
  expect(() => deserializeSave(JSON.stringify(old))).toThrow('版本不匹配');
});


test.each(['envelope', 'state', 'log', 'all'] as const)('D46 rejects old rules in %s even with schema 4', target => {
  const session = new GameSession(combatFixture().setup), before = session.save(), old = JSON.parse(before);
  expect(old).toMatchObject({ schemaVersion: 4, rulesVersion: 'm5-v1', contentVersion: CONTENT.version });
  const objects = target === 'all' ? [old, old.state, old.log] : [target === 'envelope' ? old : old[target]];
  for (const object of objects) object.rulesVersion = 'm4-v1';
  expect(() => session.load(JSON.stringify(old))).toThrow('版本不匹配');
  expect(session.save()).toBe(before);
});

test('D46 rejects standalone old-rule logs and replays current logs', () => {
  const session = new GameSession(combatFixture().setup), log = session.exportLog();
  expect(replay(log)).toEqual(session.getState());
  const old = JSON.parse(JSON.stringify(log)); old.rulesVersion = 'm4-v1';
  expect(() => replay(old)).toThrow('Unsupported log');
});
