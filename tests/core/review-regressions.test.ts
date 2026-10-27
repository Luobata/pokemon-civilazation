import { expect, test } from 'vitest';
import { combatFixture, pokemon } from './combat-fixture.ts';
import { refreshKnowledge, projectEvents } from '../../src/core/vision.ts';
import { GameSession, replay } from '../../src/app/session.ts';
import { canonicalSerialize } from '../../src/core/snapshot.ts';

test('BL05 fully hidden Moved emits nothing', () => {
  const before = combatFixture(); pokemon(before, 20, 'squirtle', 1, 11, 4);
  const after = structuredClone(before); after.units[20].position = { q: 12, r: 4 };
  expect(projectEvents(before, after, [{ seq: 1, index: 0, payload: { type: 'Moved', unitId: 20, path: [{ q: 11, r: 4 }, { q: 12, r: 4 }] } }], 0)).toEqual([]);
});
test('BL05 revisiting occupied tile removes old identity and remembers replacement identity', () => {
  const state = combatFixture(); pokemon(state, 20, 'squirtle', 1, 3, 2); refreshKnowledge(state);
  expect(state.knowledge[0].lastKnownUnits[20]).toBeDefined();
  delete state.units[20]; pokemon(state, 21, 'bulbasaur', 1, 3, 2); refreshKnowledge(state);
  expect(state.knowledge[0].lastKnownUnits[20]).toBeUndefined();
  expect(state.knowledge[0].lastKnownUnits[21]).toMatchObject({ speciesId: 'bulbasaur', ownerId: 1 });
});
test('BL05 checkpoints validate schema, sequence and exact source prefix', () => {
  const session = new GameSession(combatFixture().setup);
  session.issue({ type: 'SetResearch', techId: 'domestication' }); session.issue({ type: 'EndTurn' });
  const log = session.exportLog(), checkpoint = replay(log, 1);
  expect(canonicalSerialize(replay(log, log.commands.length, checkpoint))).toBe(canonicalSerialize(session.getState()));
  for (const mutate of [
    (value: Record<string, unknown>) => { value.schemaVersion = 999; },
    (value: Record<string, unknown>) => { value.round = 99; },
    (value: Record<string, unknown>) => { value.commandSeq = -1; },
    (value: Record<string, unknown>) => { value.commandSeq = 1.5; },
  ]) {
    const bad = structuredClone(checkpoint); mutate(bad);
    expect(() => replay(log, log.commands.length, bad)).toThrow('Checkpoint');
  }
  const foreign = structuredClone(checkpoint); foreign.players[0].gold++;
  expect(() => replay(log, log.commands.length, foreign)).toThrow('log prefix');
  const differentLog = structuredClone(log); differentLog.commands[0].action = { type: 'SetResearch', techId: 'stoneCraft' };
  expect(() => replay(differentLog, differentLog.commands.length, checkpoint)).toThrow('log prefix');
});
test('player facade exposes only view, copied presentation and stripped command result', () => {
  const developer = new GameSession(combatFixture().setup), session = developer.asPlayerSession();
  expect(session).not.toHaveProperty('getState'); expect(session).not.toHaveProperty('getDebugView');
  expect(session.issue({ type: 'SetResearch', techId: 'domestication' })).toEqual({ ok: true });
  const events = session.presentationQueue;
  if (events.length) events[0].seq = -99;
  expect(developer.presentationQueue[0].seq).not.toBe(-99);
  const before = developer.getState(); const view = session.getView(); view.economy.player.gold = 999;
  expect(developer.getState()).toEqual(before);
});
