import { expect, test } from 'vitest';
import { combatFixture } from './combat-fixture.ts';
import { GameSession, replay } from '../../src/app/session.ts';
import type { CommandLog } from '../../src/app/session.ts';
import { serializeSave, deserializeSave } from '../../src/app/save.ts';
import { contentFor } from '../../src/content/units.ts';
import { gameVersions } from '../../src/core/versions.ts';
import { canonicalSerialize } from '../../src/core/snapshot.ts';

test('round RNG and session continuation survive save/load and reject synthetic non-expansion saves', () => {
  const fixture = combatFixture();
  const badLog: CommandLog = { version: 1, schemaVersion: fixture.schemaVersion, rulesVersion: fixture.rulesVersion, contentVersion: fixture.contentVersion, setup: fixture.setup, commands: [] };
  expect(() => deserializeSave(serializeSave(fixture, badLog))).toThrow('扩展规则版本或日志大小无效');

  const session = new GameSession(fixture.setup);
  expect(session.issue({ type: 'SetResearch', techId: 'domestication' }).ok).toBe(true);
  expect(session.issue({ type: 'EndTurn' }).ok).toBe(true);
  expect(session.issue({ type: 'EndTurn' }).ok).toBe(true);
  const restored = new GameSession(fixture.setup); restored.load(session.save());
  expect(canonicalSerialize(restored.getState())).toBe(canonicalSerialize(session.getState()));
  for (const instance of [session, restored]) expect(instance.issue({ type: 'EndTurn' }).ok).toBe(true);
  expect(canonicalSerialize(restored.getState())).toBe(canonicalSerialize(session.getState()));
  expect(canonicalSerialize(replay(session.exportLog()))).toBe(canonicalSerialize(session.getState()));
});

test.each([2, 3])('old schema%s/rules rejected, no migration silently changes replay', version => {
  const session = new GameSession(combatFixture().setup), old = JSON.parse(session.save());
  for (const object of [old, old.state, old.log]) { object.schemaVersion = version; object.rulesVersion = `m${version}-v1`; }
  expect(() => deserializeSave(JSON.stringify(old))).toThrow('版本不匹配');
});


test.each(['envelope', 'state', 'log', 'all'] as const)('D46 rejects old rules in %s even with current schema', target => {
  const session = new GameSession(combatFixture().setup), before = session.save(), old = JSON.parse(before);
  const versions = gameVersions();
  expect(old).toMatchObject({ schemaVersion: versions.schemaVersion, rulesVersion: versions.rulesVersion, contentVersion: contentFor(session.getState().setup).version });
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


test('malformed AI rejection memory is rejected before replacing the session; optional and valid memory load', () => {
  const session = new GameSession(combatFixture().setup), before = session.save(), save = JSON.parse(before);
  const valid = { playerId: 1, position: { q: -1, r: 2 }, seq: 0 }; // Valid axial q may be negative.
  const malformed = [null, {}, 'bad', [null], [{}], [{ ...valid, playerId: '1' }], [{ ...valid, playerId: 99 }],
    [{ ...valid, position: null }], [{ playerId: 1, seq: 0 }], [{ playerId: 1, position: valid.position }],
    [{ ...valid, position: { q: 0.5, r: 2 } }], [{ ...valid, position: { q: 0, r: -1 } }],
    [{ ...valid, position: { q: 0, r: save.state.map.height } }],
    [{ ...valid, seq: -1 }], [{ ...valid, seq: 0.5 }], [{ ...valid, seq: '0' }]];
  for (const memory of malformed) {
    save.log.aiRejectedCitySites = memory;
    expect(() => session.load(JSON.stringify(save))).toThrow('AI 建城拒绝记忆无效');
    expect(session.save()).toBe(before);
  }
  save.log.aiRejectedCitySites = [valid]; session.load(JSON.stringify(save));
  expect(session.exportLog().aiRejectedCitySites).toEqual([valid]);
  save.log.aiRejectedCitySites = []; session.load(JSON.stringify(save));
  expect(session.exportLog().aiRejectedCitySites).toEqual([]);
  delete save.log.aiRejectedCitySites; session.load(JSON.stringify(save));
  expect(session.exportLog().aiRejectedCitySites).toEqual([]);
});
