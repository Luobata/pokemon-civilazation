import { expect, test } from 'vitest';
import { GameSession, replay } from '../../src/app/session.ts';
import { deserializeSave, serializeSave } from '../../src/app/save.ts';
import { LATEST_GAMEPLAY_VERSION, isGameplayVersion } from '../../src/content/eras.ts';
import { canonicalSerialize } from '../../src/core/snapshot.ts';
import { createGame } from '../../src/core/game.ts';
import { step } from '../../src/core/step.ts';
import { validateRoomCreateRequest } from '../../src/network/contract.ts';
import { parseLeaderBalanceArgs } from '../../tools/leader-balance.ts';

const setup = { seed: 31, width: 24, height: 16, roundLimit: 100 as const, expansionVersion: 1 as const,
  eraProgression: 'simple-v1' as const, multiplayer: true as const, players: [
    { id: 0, controller: 'human' as const, starterId: 'bulbasaur' as const }, { id: 1, controller: 'human' as const, starterId: 'bulbasaur' as const },
  ] };

test('v10 explicit setup, room and CLI are supported; new games default to the latest version (v23)', () => {
  expect(LATEST_GAMEPLAY_VERSION).toBe(23); expect(isGameplayVersion(10)).toBe(true); expect(isGameplayVersion(23)).toBe(true); expect(isGameplayVersion(24)).toBe(false);
  expect(validateRoomCreateRequest({ seed: 31, gameplayVersion: 10 })?.gameplayVersion).toBe(10);
  expect(validateRoomCreateRequest({ seed: 31 })?.gameplayVersion).toBe(23);
  expect(validateRoomCreateRequest({ seed: 31, gameplayVersion: 10 })?.gameplayVersion).toBe(10);
  expect(validateRoomCreateRequest({ seed: 31, gameplayVersion: 9 })?.gameplayVersion).toBe(9);
  expect(parseLeaderBalanceArgs(['--expansion', 'true', '--eras', 'simple', '--gameplay', '10']).config.gameplayVersion).toBe(10);
  expect(parseLeaderBalanceArgs(['--expansion', 'true', '--eras', 'simple']).config.gameplayVersion).toBe(23);
});

test.each([9, 10] as const)('v%s save and replay preserve state, envelope and event determinism', version => {
  const session = new GameSession({ ...setup, gameplayVersion: version });
  expect(session.issue({ type: 'EndTurn' }).ok).toBe(true);
  const log = session.exportLog(), state = session.getState();
  expect(state.schemaVersion).toBe(version === 10 ? 5 : 4);
  expect(state.rulesVersion).toBe(version === 10 ? 'districts-v10' : 'm5-v1');
  expect(state.expansion?.districts === undefined).toBe(version === 9);
  expect(canonicalSerialize(replay(log))).toBe(canonicalSerialize(state));
  expect(canonicalSerialize(deserializeSave(serializeSave(state, log)).state)).toBe(canonicalSerialize(state));
  const first = createGame(log.setup), command = log.commands[0];
  expect(step(first, command)).toEqual(step(createGame(log.setup), command));
  expect(() => replay({ ...log, schemaVersion: version === 10 ? 4 : 5 })).toThrow();
  expect(() => deserializeSave(serializeSave(state, { ...log, rulesVersion: version === 10 ? 'm5-v1' : 'districts-v10' }))).toThrow();
});

test('a real v10 research/build command log replays a completed district and survives save loading', async () => {
  const { districtSites } = await import('../../src/core/districts.ts');
  const { observe } = await import('../../src/core/vision.ts');
  let state = createGame({ ...setup, gameplayVersion: 10 });
  const log = { version: 1 as const, schemaVersion: state.schemaVersion, rulesVersion: state.rulesVersion,
    contentVersion: state.contentVersion, setup: state.setup, commands: [] as import('../../src/core/model.ts').Command[] };
  const issue = (action: import('../../src/core/model.ts').Command['action']) => {
    const command = { actorId: state.activePlayerId, expectedSeq: state.commandSeq, action };
    const result = step(state, command);
    if (!result.ok) throw new Error(result.reason);
    log.commands.push(command); state = result.state;
    return result.events;
  };
  issue({ type: 'AssignWork', cityId: 1, workedTileIds: [], lockedTileIds: [] });
  issue({ type: 'SetResearch', techId: 'berryCultivation' });
  while (!state.players[0].research.unlockedIds.includes('berryCultivation') || state.activePlayerId !== 0) issue({ type: 'EndTurn' });
  const site = districtSites(observe(state, 0), 1, 'gardenDistrict').find(site => site.reason === null)!;
  expect(site).toBeDefined();
  issue({ type: 'SetProductionQueue', cityId: 1, orders: [{ item: { kind: 'district', defId: 'gardenDistrict', tileIndex: site.tileIndex } }] });
  let completed = false;
  while (!completed && !state.outcome) completed = issue({ type: 'EndTurn' }).some(event => event.payload.type === 'DistrictCompleted');
  expect(completed).toBe(true);
  expect(canonicalSerialize(replay(log))).toBe(canonicalSerialize(state));
  expect(canonicalSerialize(deserializeSave(serializeSave(state, log)).state)).toBe(canonicalSerialize(state));
});
